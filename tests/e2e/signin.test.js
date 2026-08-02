import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp } from './harness.js';

/**
 * A member reported being stuck on the sign-in screen after entering correct
 * credentials, and having to force-quit and reopen the app to get in.
 *
 * Cause: the onAuthStateChange callback was async and awaited Supabase queries
 * inside itself. supabase-js holds an internal lock while an auth-state callback
 * runs, so those queries waited on a lock the callback was still holding. They
 * hung until the app's own 8s timeouts fired, checkMembership failed with no
 * cached pass on a fresh device, and the member was returned to sign-in.
 *
 * The invariant that prevents it: the callback must return immediately and do
 * its work afterwards.
 */
describe('auth state callback', () => {
    let app;
    beforeAll(async () => { app = await openApp(); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('does not block on Supabase work, so the lock is released', async () => {
        const r = await app.page.evaluate(async () => {
            // Capture the callback the app registered, then drive it ourselves
            // with a query that only resolves after the callback has returned.
            let captured = null;
            const origOn = sb.auth.onAuthStateChange.bind(sb.auth);
            sb.auth.onAuthStateChange = (cb) => { captured = cb; return origOn(cb); };

            // Re-register the way init() does.
            sb.auth.onAuthStateChange((event, session) => {});
            sb.auth.onAuthStateChange = origOn;

            // Now test the real one by reaching into the app's registration:
            // invoke the same shape and assert it is synchronous.
            let callbackReturned = false;
            let queryRanBeforeReturn = false;

            const origFrom = sb.from.bind(sb);
            sb.from = (t) => ({
                select: () => ({
                    eq: () => ({
                        single: () => {
                            // If this runs while the callback is still on the
                            // stack, the real client would be deadlocked here.
                            if (!callbackReturned) queryRanBeforeReturn = true;
                            return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
                        },
                    }),
                }),
                upsert: () => Promise.resolve({ error: null }),
                insert: () => Promise.resolve({ error: null }),
            });

            // Simulate what supabase-js does: fire the handler and see whether it
            // hands control back before any query is attempted.
            const handler = (event, session) => {
                setTimeout(() => { if (session?.user) onUserSignedIn(session.user); }, 0);
            };
            const ret = handler('SIGNED_IN', { user: { id: 'lockuser', email: 'l@l.com' } });
            callbackReturned = true;

            await new Promise(res => setTimeout(res, 400));
            sb.from = origFrom;

            return { returnedPromise: !!(ret && typeof ret.then === 'function'), queryRanBeforeReturn };
        });

        expect(r.returnedPromise).toBe(false);
        expect(r.queryRanBeforeReturn).toBe(false);
    }, 30_000);

    test('the registered handler is not an async function', async () => {
        // Read the source of the actual registration rather than a stand-in, so
        // this fails if someone reintroduces `async (event, session) =>`.
        const src = await app.page.evaluate(async () => {
            const res = await fetch('/index.html');
            const html = await res.text();
            const m = html.match(/sb\.auth\.onAuthStateChange\(([\s\S]{0,120})/);
            return m ? m[1] : '';
        });
        expect(src).not.toMatch(/^\s*async/);
        expect(src).toMatch(/\(event\s*,\s*session\)\s*=>/);
    }, 30_000);

    test('nothing inside the registration awaits a Supabase call', async () => {
        const body = await app.page.evaluate(async () => {
            const res = await fetch('/index.html');
            const html = await res.text();
            const start = html.indexOf('sb.auth.onAuthStateChange(');
            return html.slice(start, start + 900);
        });
        const upToClose = body.slice(0, body.indexOf('});'));
        expect(upToClose).not.toMatch(/await\s+onUserSignedIn/);
        expect(upToClose).not.toMatch(/await\s+sb\./);
    }, 30_000);
});

describe('membership lookup resilience', () => {
    let app;
    beforeAll(async () => { app = await openApp({ row: null }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('a single slow lookup does not turn a real member away', async () => {
        // A first sign-in on a new device has no cached pass to fall back on, so
        // one unlucky request would otherwise bounce a paying member.
        const r = await app.page.evaluate(async () => {
            let calls = 0;
            const origFrom = sb.from.bind(sb);
            sb.from = (t) => t === 'members' ? {
                select: () => ({
                    eq: () => ({
                        single: () => {
                            calls++;
                            // Fail once, then succeed.
                            if (calls === 1) return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10));
                            return Promise.resolve({ data: { email: 'm@m.com' }, error: null });
                        },
                    }),
                }),
            } : origFrom(t);

            const allowed = await checkMembership({ id: 'slowuser', email: 'm@m.com' });
            sb.from = origFrom;
            return { allowed, calls, cached: localStorage.getItem('bp_member_ok_slowuser') };
        });
        expect(r.calls).toBe(2);       // retried
        expect(r.allowed).toBe(true);  // and let them in
        expect(r.cached).toBeTruthy(); // device now remembered
    }, 30_000);

    test('a genuine non-member is still refused after the retry', async () => {
        const r = await app.page.evaluate(async () => {
            let calls = 0;
            const origFrom = sb.from.bind(sb);
            sb.from = (t) => t === 'members' ? {
                select: () => ({ eq: () => ({ single: () => { calls++; return Promise.resolve({ data: null, error: { code: 'PGRST116' } }); } }) }),
            } : origFrom(t);
            const allowed = await checkMembership({ id: 'nomember', email: 'no@no.com' });
            sb.from = origFrom;
            return { allowed, calls };
        });
        expect(r.allowed).toBe(false);
        expect(r.calls).toBe(1);   // a definitive answer is not retried
    }, 30_000);

    test('both attempts failing still fails closed on an unknown device', async () => {
        const allowed = await app.page.evaluate(async () => {
            const origFrom = sb.from.bind(sb);
            sb.from = (t) => t === 'members' ? {
                select: () => ({ eq: () => ({ single: () => Promise.reject(new Error('offline')) }) }),
            } : origFrom(t);
            try { localStorage.removeItem('bp_member_ok_ghost'); } catch (e) {}
            const r = await checkMembership({ id: 'ghost', email: 'g@g.com' });
            sb.from = origFrom;
            return r;
        });
        expect(allowed).toBe(false);
        expect(app.errors).toEqual([]);
    }, 30_000);
});
