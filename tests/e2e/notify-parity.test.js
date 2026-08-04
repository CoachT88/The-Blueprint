import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';
import { currentStreak } from '../../supabase/functions/_shared/notifyRules.js';

/**
 * The streak warning is sent by a server that computes the streak itself, from
 * a copy of the app's logic. A member reading "your 6 day streak is still
 * going" on a phone that says 5 on the HQ would rightly stop believing either
 * number.
 *
 * So this suite does not test the port against fixtures. It runs the real
 * getCurrentStreak() inside the real page and asserts the two agree, case for
 * case. It fails the moment either side is edited without the other.
 */
const DAY = 864e5;
const key = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString().split('T')[0];
const sessionsOn = (offsets) => offsets.map(d => ({
    date: `${key(d)}T12:00:00.000Z`, routineType: 'length', eq: 7, rpe: 5, xpEarned: 15, note: '',
}));

/**
 * Cases chosen for where the two could plausibly disagree, not for coverage:
 * the today-not-trained allowance, Recovery Passes bridging gaps, a pass on
 * today itself, and the boundary either side of the warning threshold.
 */
const CASES = [
    { name: 'no history',                     days: [],              passes: [] },
    { name: 'today only',                     days: [0],             passes: [] },
    { name: 'yesterday only, today still open', days: [1],           passes: [] },
    { name: 'three running, today trained',   days: [2, 1, 0],       passes: [] },
    { name: 'three running, today still open', days: [3, 2, 1],      passes: [] },
    { name: 'a gap two days back',            days: [4, 3, 1],       passes: [] },
    { name: 'a pass bridging that gap',       days: [4, 3, 1],       passes: [key(2)] },
    { name: 'a pass covering today',          days: [3, 2, 1],       passes: [key(0)] },
    { name: 'two passes back to back',        days: [5, 1],          passes: [key(2), key(3)] },
    { name: 'a pass on a day already trained', days: [2, 1, 0],      passes: [key(1)] },
    { name: 'long run, exactly at threshold', days: [3, 2, 1],       passes: [] },
    { name: 'long run, one under threshold',  days: [2, 1],          passes: [] },
    { name: 'a fortnight unbroken',           days: Array.from({ length: 14 }, (_, i) => 13 - i), passes: [] },
    { name: 'stale history only',             days: [40, 39, 38],    passes: [] },
    { name: 'two sessions on the same day',   days: [1, 1, 0],       passes: [] },
];

describe('the server computes the same streak the app shows', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'parity' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    for (const c of CASES) {
        test(c.name, async () => {
            const log = sessionsOn(c.days);

            // The app's own function, running in the app.
            const inApp = await app.page.evaluate(({ log, passes }) => {
                persisted.sessionLog = log;
                persisted.passProtectedDates = passes;
                return getCurrentStreak();
            }, { log, passes: c.passes });

            // The port the edge function will use.
            const onServer = currentStreak(log, c.passes, new Date());

            expect(onServer).toBe(inApp);
        }, 30_000);
    }

    test('and the page stayed clean throughout', async () => {
        expect(app.errors).toEqual([]);
    });
});

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

    test('milestone alerts are not offered, because none are sent', async () => {
        const copy = await app.page.evaluate(() => document.getElementById('notif-supported').textContent);
        expect(copy).not.toMatch(/milestone/i);
        expect(copy).toMatch(/one reminder a day/i);
        expect(copy).toMatch(/streak/i);
    }, 30_000);

    test('the dead local scheduler is gone rather than left looking implemented', async () => {
        const html = await app.page.evaluate(async () => (await fetch('/index.html')).text());
        for (const dead of ['_scheduleLocalNotif', '_fireLocalNotif', '_buildNotifPayload', '_NOTIF_MSGS']) {
            expect(html).not.toContain(dead + '(');
            expect(html).not.toContain('function ' + dead);
        }
    }, 30_000);

    test('the reminder time and streak toggle are written where the server reads them', async () => {
        // These two columns are the whole contract between the picker and the
        // sender. If a refactor stops writing them, the settings go decorative
        // again and nothing else would notice.
        const src = await app.page.evaluate(async () => (await fetch('/index.html')).text());
        const fn = src.slice(src.indexOf('async function saveNotifPrefs'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        expect(body).toContain('reminder_time');
        expect(body).toContain('streak_warn');
        expect(body).toContain('push_subscriptions');
    }, 30_000);
});
