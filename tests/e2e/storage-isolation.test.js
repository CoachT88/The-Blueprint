import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Two accounts, one browser.
 *
 * bp_notif_prefs and bp_push_tz were the only member-scoped bp_ keys without
 * a user id on them, and both leaked. The reminder time one was the worst:
 * _savePushSubscription() writes it into whichever member is signed in, so
 * account A choosing 06:00 put A's hour into B's push_subscriptions row and
 * B was notified at it. The timezone one was quieter but real: A signing in
 * populated the shared cache, so B's refresh early-returned and B's row kept
 * a stale timezone from another device.
 *
 * Every test here switches accounts for real, by replacing currentUser the
 * way a sign-in does, and then drives the actual production functions.
 */

const A = { id: 'acct-a', email: 'a@example.com' };
const B = { id: 'acct-b', email: 'b@example.com' };

/** Become this member, exactly as far as these functions can see. */
const become = (page, who) => page.evaluate((who) => {
    currentUser = { id: who.id, email: who.email, user_metadata: {} };
}, who);

/** Capture every Supabase write the push code makes. */
const spy = (page) => page.evaluate(() => {
    window.__pushWrites = [];
    const realFrom = sb.from.bind(sb);
    sb.from = (table) => {
        const inner = realFrom(table);
        return {
            ...inner,
            upsert: (payload, opts) => { window.__pushWrites.push({ table, op: 'upsert', payload }); return inner.upsert ? inner.upsert(payload, opts) : Promise.resolve({ error: null }); },
            update: (payload) => {
                window.__pushWrites.push({ table, op: 'update', payload });
                return { eq: () => Promise.resolve({ error: null }) };
            },
        };
    };
});

const writes = (page) => page.evaluate(() => window.__pushWrites.map(w => ({ ...w })));

/** A fake subscription, the shape _savePushSubscription expects. */
const subscribeAs = (page) => page.evaluate(() => {
    window.__pushWrites = [];
    return _savePushSubscription({
        toJSON: () => ({ endpoint: 'https://push.example/' + currentUser.id, keys: { p256dh: 'p', auth: 'a' } }),
    }).then(() => window.__pushWrites.map(w => ({ ...w })));
});

describe('reminder time cannot cross accounts', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'iso1' }); await spy(app.page); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('ACCEPTANCE: A picking a time does not pre-fill B', async () => {
        await become(app.page, A);
        await app.page.evaluate(() => {
            document.getElementById('notif-time').value = '06:00';
            saveNotifPrefs();
        });
        await app.page.waitForTimeout(80);

        await become(app.page, B);
        const shown = await app.page.evaluate(() => {
            document.getElementById('notif-time').value = '';
            _refreshNotifUI();
            return document.getElementById('notif-time').value;
        });
        expect(shown).not.toBe('06:00');
    }, 30_000);

    test("ACCEPTANCE: A's time is never written into B's push row", async () => {
        await become(app.page, A);
        await app.page.evaluate(() => { document.getElementById('notif-time').value = '06:00'; saveNotifPrefs(); });
        await app.page.waitForTimeout(80);

        await become(app.page, B);
        const w = await subscribeAs(app.page);
        const upsert = w.find(x => x.op === 'upsert' && x.table === 'push_subscriptions');
        expect(upsert).toBeTruthy();
        expect(upsert.payload.user_id).toBe(B.id);
        expect(upsert.payload.reminder_time).not.toBe('06:00');
        expect(upsert.payload.reminder_time).toBe('19:00');     // the existing default
    }, 30_000);

    test('switching back to A restores A\'s own value', async () => {
        await become(app.page, A);
        const shown = await app.page.evaluate(() => {
            document.getElementById('notif-time').value = '';
            _refreshNotifUI();
            return document.getElementById('notif-time').value;
        });
        expect(shown).toBe('06:00');
    }, 30_000);

    test('each account keeps its own time independently', async () => {
        await become(app.page, B);
        await app.page.evaluate(() => { document.getElementById('notif-time').value = '21:30'; saveNotifPrefs(); });
        await app.page.waitForTimeout(80);
        const read = async (who) => {
            await become(app.page, who);
            return app.page.evaluate(() => { document.getElementById('notif-time').value = ''; _refreshNotifUI(); return document.getElementById('notif-time').value; });
        };
        expect(await read(A)).toBe('06:00');
        expect(await read(B)).toBe('21:30');
    }, 30_000);

    test('the keys really are scoped by user id', async () => {
        const keys = await app.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('bp_notif_prefs')));
        expect(keys).toContain('bp_notif_prefs_' + A.id);
        expect(keys).toContain('bp_notif_prefs_' + B.id);
    }, 30_000);
});

describe('timezone refresh cannot be suppressed across accounts', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'iso2' }); await spy(app.page); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test("ACCEPTANCE: A's cache does not suppress B's refresh", async () => {
        await become(app.page, A);
        await app.page.evaluate(() => { window.__pushWrites = []; return _refreshPushTimezone(); });
        const first = await writes(app.page);
        expect(first.filter(w => w.op === 'update' && w.payload.timezone).length).toBe(1);

        // Same device, same timezone, different member. The refresh must run.
        await become(app.page, B);
        await app.page.evaluate(() => { window.__pushWrites = []; return _refreshPushTimezone(); });
        const second = await writes(app.page);
        expect(second.filter(w => w.op === 'update' && w.payload.timezone).length).toBe(1);
    }, 30_000);

    test('and it still runs only once per member per device', async () => {
        // The caching behaviour that made this worth having is preserved.
        await become(app.page, B);
        await app.page.evaluate(() => { window.__pushWrites = []; return _refreshPushTimezone(); });
        expect((await writes(app.page)).length).toBe(0);
    }, 30_000);

    test('the keys really are scoped by user id', async () => {
        const keys = await app.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('bp_push_tz')));
        expect(keys).toContain('bp_push_tz_' + A.id);
        expect(keys).toContain('bp_push_tz_' + B.id);
    }, 30_000);
});

describe('the old unscoped keys are never read again', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'iso3' }); await spy(app.page); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('ACCEPTANCE: a leftover unscoped reminder time is ignored', async () => {
        // Exactly what is sitting in every existing member's browser right
        // now. It must not reappear, for them or for anyone sharing the
        // device, and it is deliberately not migrated.
        await become(app.page, A);
        const r = await app.page.evaluate(() => {
            localStorage.setItem('bp_notif_prefs', JSON.stringify({ time: '03:00' }));
            Object.keys(localStorage).filter(k => k.startsWith('bp_notif_prefs_')).forEach(k => localStorage.removeItem(k));
            document.getElementById('notif-time').value = '';
            _refreshNotifUI();
            return document.getElementById('notif-time').value;
        });
        expect(r).not.toBe('03:00');
    }, 30_000);

    test('and a leftover unscoped timezone does not suppress a refresh', async () => {
        await become(app.page, A);
        const n = await app.page.evaluate(() => {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            localStorage.setItem('bp_push_tz', tz);
            Object.keys(localStorage).filter(k => k.startsWith('bp_push_tz_')).forEach(k => localStorage.removeItem(k));
            window.__pushWrites = [];
            return _refreshPushTimezone().then(() => window.__pushWrites.length);
        });
        expect(n).toBe(1);
    }, 30_000);

    test('REGRESSION: no preferred name is involved in any of this', async () => {
        // The identity work and this patch are deliberately separate.
        const r = await app.page.evaluate(() => {
            currentUser = { ...currentUser, user_metadata: { preferred_name: 'Zebediah' } };
            saveNotifPrefs();
            return Object.keys(localStorage).map(k => `${k}=${localStorage.getItem(k)}`).join('|');
        });
        expect(r).not.toContain('Zebediah');
    }, 30_000);

    test('the page threw nothing throughout', () => {
        expect(app.errors).toEqual([]);
    });
});
