import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Push subscription repair, and the settings screen telling the truth about
 * what can be sent.
 *
 * WHAT THIS FILE USED TO BE. Its first suite ran the app's getCurrentStreak()
 * inside the real page and asserted it agreed, case for case, with the port
 * in notifyRules.js, because the server sent streak warnings naming a number
 * the member could also read on their HQ. Phase 2B.2 retired the streak
 * warning and deleted both implementations, so there are no two sides left to
 * agree. The suite is gone rather than kept green against nothing, and the
 * file is named for what remains.
 */

/**
 * A push subscription is bound to the VAPID key it was made with. Rotating the
 * key leaves every existing subscription undeliverable while the member's
 * settings still say reminders are on, which is the exact failure this whole
 * change set exists to remove. Permission is already granted, so the repair can
 * happen silently.
 */
describe('a subscription made with an old key repairs itself', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'rotate' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    /**
     * Stand in for the service worker registration. `withKey` decides whether
     * the existing subscription looks current or stale.
     */
    const stub = (page, { withKey, hasSubscription = true }) => page.evaluate(({ withKey, hasSubscription }) => {
        // Notification.permission is a read-only getter on the real object.
        Object.defineProperty(Notification, 'permission', { value: 'granted', configurable: true });

        const fakeSub = (endpoint, keyBytes) => ({
            endpoint,
            options: { applicationServerKey: keyBytes ? keyBytes.buffer : null },
            toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
            unsubscribe: () => { window.__calls.push('unsubscribe'); return Promise.resolve(true); },
        });

        window.__calls = [];
        const current = _urlBase64ToUint8(VAPID_PUBLIC_KEY);
        const stale = new Uint8Array(current.length).fill(7);   // a different key entirely
        const existing = hasSubscription
            ? fakeSub('https://push.example/old', withKey === 'current' ? current : stale)
            : null;

        _swRegistration = {
            pushManager: {
                getSubscription: () => Promise.resolve(existing),
                subscribe: (opts) => {
                    window.__calls.push('subscribe');
                    window.__subscribedWith = [...new Uint8Array(opts.applicationServerKey)];
                    return Promise.resolve(fakeSub('https://push.example/new', current));
                },
            },
        };
        window.__writes = [];
    }, { withKey, hasSubscription });

    test('a stale key is swapped for the current one, without a prompt', async () => {
        await stub(app.page, { withKey: 'stale' });
        const r = await app.page.evaluate(async () => {
            await _ensureCurrentPushSubscription();
            return {
                calls: window.__calls,
                subscribedWith: window.__subscribedWith,
                wrote: window.__writes.map(w => w.endpoint),
                expected: [..._urlBase64ToUint8(VAPID_PUBLIC_KEY)],
            };
        });
        // Old one released before the new one is taken, in that order.
        expect(r.calls).toEqual(['unsubscribe', 'subscribe']);
        expect(r.subscribedWith).toEqual(r.expected);
        // And the new endpoint is what the server will now send to.
        expect(r.wrote).toContain('https://push.example/new');
    }, 30_000);

    test('a subscription already on the current key is left alone', async () => {
        // Without this the app would churn a fresh subscription on every single
        // sign-in, invalidating the endpoint the server just stored.
        await stub(app.page, { withKey: 'current' });
        const r = await app.page.evaluate(async () => {
            await _ensureCurrentPushSubscription();
            return { calls: window.__calls, writes: window.__writes.length };
        });
        expect(r.calls).toEqual([]);
        expect(r.writes).toBe(0);
    }, 30_000);

    test('someone who never enabled reminders is not subscribed behind their back', async () => {
        await stub(app.page, { withKey: 'stale', hasSubscription: false });
        const r = await app.page.evaluate(async () => {
            await _ensureCurrentPushSubscription();
            return { calls: window.__calls, writes: window.__writes.length };
        });
        expect(r.calls).toEqual([]);
        expect(r.writes).toBe(0);
    }, 30_000);

    test('and neither is anyone who has not granted permission', async () => {
        await stub(app.page, { withKey: 'stale' });
        const r = await app.page.evaluate(async () => {
            Object.defineProperty(Notification, 'permission', { value: 'default', configurable: true });
            await _ensureCurrentPushSubscription();
            return { calls: window.__calls, writes: window.__writes.length };
        });
        expect(r.calls).toEqual([]);
        expect(r.writes).toBe(0);
        expect(app.errors).toEqual([]);
    }, 30_000);
});

describe('the settings screen no longer promises what it cannot send', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'notifcopy' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('only what can actually be sent is offered', async () => {
        const copy = await app.page.evaluate(() => document.getElementById('notif-supported').textContent);
        expect(copy).not.toMatch(/milestone/i);
        expect(copy).toMatch(/one reminder a day/i);
    }, 30_000);

    test('REGRESSION: streak warnings are no longer promised or switchable', async () => {
        // The setting outlived the feature for one checkpoint. Offering a
        // toggle for a notification that can never be sent is worse than
        // having neither.
        const r = await app.page.evaluate(() => ({
            copy: document.getElementById('notif-supported').textContent,
            toggle: !!document.getElementById('streak-warn-toggle'),
            label: !!document.getElementById('streak-warn-toggle-label'),
        }));
        expect(r.copy).not.toMatch(/streak/i);
        expect(r.toggle).toBe(false);
        expect(r.label).toBe(false);
    }, 30_000);

    test('the dead local scheduler is gone rather than left looking implemented', async () => {
        const html = await app.page.evaluate(async () => (await fetch('/app/index.html')).text());
        for (const dead of ['_scheduleLocalNotif', '_fireLocalNotif', '_buildNotifPayload',
                            '_NOTIF_MSGS', 'getCurrentStreak', '_setToggleUI']) {
            expect(html).not.toContain(dead + '(');
            expect(html).not.toContain('function ' + dead);
        }
    }, 30_000);

    test('the reminder time is written where the server reads it', async () => {
        // reminder_time is now the whole contract between the picker and the
        // sender. If a refactor stops writing it, the setting goes decorative
        // again and nothing else would notice.
        const src = await app.page.evaluate(async () => (await fetch('/app/index.html')).text());
        const fn = src.slice(src.indexOf('async function saveNotifPrefs'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        expect(body).toContain('reminder_time');
        expect(body).toContain('push_subscriptions');
        expect(body).not.toContain('streak_warn:');
    }, 30_000);
});
