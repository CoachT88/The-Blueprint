import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Getting a member subscribed, in the browser.
 *
 * The server side of reminders is covered by tests/notifyRules and
 * tests/sendNotifications. This is the half that decides whether there is
 * anybody to send to at all, and it had a quiet failure in it: the subscribe
 * step was guarded on `_swRegistration`, which is populated by a registration
 * the app starts and never waits for. A member who opened the notification
 * modal early granted permission, saw "Notifications are active", and was never
 * subscribed to anything.
 */

/** Replace the push plumbing with something inspectable. */
const stubPush = (page, { registrationReady = true, slowRegister = false } = {}) => page.evaluate(
    ({ registrationReady, slowRegister }) => {
        Object.defineProperty(Notification, 'permission', { value: 'default', configurable: true });
        Notification.requestPermission = () => {
            Object.defineProperty(Notification, 'permission', { value: 'granted', configurable: true });
            return Promise.resolve('granted');
        };

        window.__calls = [];
        window.__writes = [];
        let current = null;

        const registration = {
            pushManager: {
                getSubscription: () => Promise.resolve(current),
                subscribe: (opts) => {
                    window.__calls.push('subscribe');
                    window.__keyUsed = [...new Uint8Array(opts.applicationServerKey)];
                    current = {
                        endpoint: 'https://push.example/endpoint-1',
                        options: { applicationServerKey: opts.applicationServerKey },
                        toJSON: () => ({ endpoint: 'https://push.example/endpoint-1', keys: { p256dh: 'p', auth: 'a' } }),
                        unsubscribe: () => { window.__calls.push('unsubscribe'); current = null; return Promise.resolve(true); },
                    };
                    return Promise.resolve(current);
                },
            },
        };

        // The real app does not await initServiceWorker(), so reproduce that:
        // _swRegistration is null and only `ready` can supply the registration.
        _swRegistration = null;
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: {
                register: () => Promise.resolve(registration),
                ready: registrationReady
                    ? (slowRegister
                        ? new Promise(res => setTimeout(() => res(registration), 400))
                        : Promise.resolve(registration))
                    : new Promise(() => {}),
            },
        });

        // Record what reaches the database.
        const origFrom = sb.from.bind(sb);
        sb.from = (table) => {
            if (table !== 'push_subscriptions') return origFrom(table);
            return {
                upsert: (payload) => { window.__writes.push({ op: 'upsert', payload }); return Promise.resolve({ error: null }); },
                update: (payload) => ({ eq: () => { window.__writes.push({ op: 'update', payload }); return Promise.resolve({ error: null }); } }),
                delete: () => ({ eq: () => { window.__writes.push({ op: 'delete' }); return Promise.resolve({ error: null }); } }),
            };
        };
    }, { registrationReady, slowRegister });

describe('the app is installable', () => {
    let app;
    beforeAll(async () => { app = await openApp(); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the manifest is served and parses', async () => {
        const m = await app.page.evaluate(async () => {
            const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
            if (!href) return null;
            const res = await fetch(href);
            return { status: res.status, body: await res.json() };
        });
        expect(m).not.toBeNull();
        expect(m.status).toBe(200);
        expect(m.body.display).toBe('standalone');
        expect(m.body.name).toBe('The Blueprint');
    });

    test('every icon the manifest names is actually served', async () => {
        const results = await app.page.evaluate(async () => {
            const res = await fetch('/manifest.webmanifest');
            const manifest = await res.json();
            return Promise.all(manifest.icons.map(async i => {
                const r = await fetch(i.src);
                return { src: i.src, status: r.status, type: r.headers.get('content-type') };
            }));
        });
        for (const r of results) {
            expect(r.status, `${r.src} did not load`).toBe(200);
            expect(r.type).toContain('image/png');
        }
    });

    test('the apple touch icon is served too', async () => {
        const status = await app.page.evaluate(async () =>
            (await fetch('/icons/apple-touch-icon.png')).status);
        expect(status).toBe(200);
    });

    test('a real service worker registers against the real sw.js', async () => {
        const ok = await app.page.evaluate(async () => {
            try {
                const reg = await navigator.serviceWorker.register('/sw.js');
                return !!reg;
            } catch (e) { return 'ERROR: ' + e.message; }
        });
        expect(ok).toBe(true);
        expect(app.errors).toEqual([]);
    }, 30_000);
});

describe('turning reminders on actually subscribes', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'push1' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('a subscription is created and written to the database', async () => {
        await stubPush(app.page);
        const r = await app.page.evaluate(async () => {
            await enableNotifications();
            return {
                calls: window.__calls,
                writes: window.__writes,
                keyUsed: window.__keyUsed,
                expectedKey: [..._urlBase64ToUint8(VAPID_PUBLIC_KEY)],
            };
        });
        expect(r.calls).toContain('subscribe');
        expect(r.keyUsed).toEqual(r.expectedKey);
        const upsert = r.writes.find(w => w.op === 'upsert');
        expect(upsert).toBeTruthy();
        expect(upsert.payload.endpoint).toBe('https://push.example/endpoint-1');
        // Everything the sender needs to decide when to send.
        expect(upsert.payload.reminder_time).toBeTruthy();
        expect(upsert.payload.timezone).toBeTruthy();
        expect(typeof upsert.payload.streak_warn).toBe('boolean');
    }, 30_000);

    test('it waits for a registration that has not arrived yet', async () => {
        // The regression: _swRegistration is null at this moment, exactly as it
        // is for a member who opens the modal seconds after launch.
        await stubPush(app.page, { slowRegister: true });
        const r = await app.page.evaluate(async () => {
            const before = _swRegistration;
            await enableNotifications();
            return { before, calls: window.__calls, writes: window.__writes.length };
        });
        expect(r.before).toBeNull();
        expect(r.calls).toContain('subscribe');
        expect(r.writes).toBeGreaterThan(0);
    }, 30_000);

    test('it says so rather than claiming success when there is no registration', async () => {
        await stubPush(app.page, { registrationReady: false });
        const status = await app.page.evaluate(async () => {
            document.getElementById('notif-status').innerText = 'STALE';
            // Do not wait the full 10s timeout; just assert it has not lied yet.
            enableNotifications();
            await new Promise(r => setTimeout(r, 300));
            return document.getElementById('notif-status').innerText;
        });
        // Neither "active" nor the text that was sitting there before.
        expect(status).not.toMatch(/active/i);
        expect(status).not.toBe('STALE');
    }, 30_000);

    test('permission granted with no subscription does not report as active', async () => {
        await stubPush(app.page);
        const r = await app.page.evaluate(async () => {
            Object.defineProperty(Notification, 'permission', { value: 'granted', configurable: true });
            await _refreshNotifUI();
            return {
                status: document.getElementById('notif-status').innerText,
                enableShown: !document.getElementById('notif-enable-btn').classList.contains('hidden'),
            };
        });
        expect(r.status).not.toMatch(/^Notifications are active/);
        // And the way out is offered rather than hidden behind a Disable button.
        expect(r.enableShown).toBe(true);
    }, 30_000);
});

describe('turning reminders off stops them', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'push2' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the row is deleted even when the local unsubscribe finds nothing', async () => {
        // If the row survives, the server keeps sending to a dead endpoint every
        // day and the member cannot make it stop.
        await stubPush(app.page);
        const writes = await app.page.evaluate(async () => {
            window.__writes = [];
            await disableNotifications();      // never subscribed in this run
            return window.__writes;
        });
        expect(writes.some(w => w.op === 'delete')).toBe(true);
    }, 30_000);

    test('subscribing then unsubscribing leaves nothing behind', async () => {
        await stubPush(app.page);
        const r = await app.page.evaluate(async () => {
            await enableNotifications();
            window.__writes = [];
            window.__calls = [];
            await disableNotifications();
            return { calls: window.__calls, writes: window.__writes };
        });
        expect(r.calls).toContain('unsubscribe');
        expect(r.writes.some(w => w.op === 'delete')).toBe(true);
        expect(app.errors).toEqual([]);
    }, 30_000);
});
