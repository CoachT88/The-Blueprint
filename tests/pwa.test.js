import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Installability, checked statically.
 *
 * None of this existed before: no manifest, no icons, and a service worker
 * pointing at two image files that were not in the repo. The consequence was
 * larger than a missing icon. iOS only delivers web push to an installed,
 * manifest-backed standalone PWA, so the whole reminder system could never have
 * reached an iPhone no matter what the server did.
 *
 * These are cheap file assertions deliberately kept in the fast job, because
 * the failure mode is silent: nothing throws, the app just quietly stops being
 * installable.
 */
const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(path.join(ROOT, p));
const html = read('app/index.html').toString('utf8');
const landing = read('index.html').toString('utf8');

/** Width and height straight out of the PNG IHDR chunk. */
function pngSize(buf) {
    const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!isPng) return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe('the web app manifest', () => {
    const manifest = JSON.parse(read('manifest.webmanifest').toString('utf8'));

    test('is linked from the page', () => {
        expect(html).toMatch(/<link\s+rel="manifest"\s+href="\/manifest\.webmanifest">/);
    });

    test('declares standalone display, which is what iOS push requires', () => {
        expect(manifest.display).toBe('standalone');
    });

    test('has the identity fields an install prompt needs', () => {
        expect(manifest.name).toBe('The Blueprint');
        expect(manifest.short_name).toBeTruthy();
        // short_name is what sits under the icon. A long one is truncated.
        expect(manifest.short_name.length).toBeLessThanOrEqual(12);
        // The app lives at /app/. Installing has to open the app, not the
        // sales page the manifest is also reachable from.
        expect(manifest.start_url).toBe('/app/');
        expect(manifest.scope).toBe('/app/');
    });

    test('matches the app background so the splash screen does not flash white', () => {
        expect(manifest.background_color).toBe('#020617');
        expect(manifest.theme_color).toBe('#020617');
        expect(html).toMatch(/<meta name="theme-color" content="#020617">/);
    });

    test('gives Android both a 192 and a 512 icon, which it requires to install', () => {
        const any = manifest.icons.filter(i => i.purpose === 'any');
        expect(any.map(i => i.sizes).sort()).toEqual(['192x192', '512x512']);
    });

    test('ships maskable icons so Android does not letterbox the mark', () => {
        const maskable = manifest.icons.filter(i => i.purpose === 'maskable');
        expect(maskable.map(i => i.sizes).sort()).toEqual(['192x192', '512x512']);
    });

    test('every icon it points at exists and is the size it claims', () => {
        for (const icon of manifest.icons) {
            const rel = icon.src.replace(/^\//, '');
            expect(existsSync(path.join(ROOT, rel)), `${rel} is missing`).toBe(true);
            const [w, h] = icon.sizes.split('x').map(Number);
            expect(pngSize(read(rel)), `${rel} is not a PNG`).toEqual({ w, h });
        }
    });

    test('says nothing on a home screen about what the app is for', () => {
        // The icon and its label are visible to anyone holding the phone.
        const words = /erection|pelvic|kegel|penis|girth|enlarge|sexual|stamina/i;
        expect(JSON.stringify(manifest)).not.toMatch(words);
    });
});

describe('iOS home-screen metadata', () => {
    test('declares itself installable to older and current iOS', () => {
        expect(html).toMatch(/<meta name="apple-mobile-web-app-capable" content="yes">/);
        expect(html).toMatch(/<meta name="mobile-web-app-capable" content="yes">/);
    });

    test('has a touch icon, which iOS uses instead of the manifest icons', () => {
        expect(html).toMatch(/<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/);
        expect(pngSize(read('icons/apple-touch-icon.png'))).toEqual({ w: 180, h: 180 });
    });

    test('the home-screen title is short and discreet', () => {
        const m = /<meta name="apple-mobile-web-app-title" content="([^"]+)">/.exec(html);
        expect(m).toBeTruthy();
        expect(m[1].length).toBeLessThanOrEqual(12);
        expect(m[1]).not.toMatch(/erection|pelvic|kegel|penis|girth|sexual/i);
    });
});

describe('the service worker', () => {
    const sw = read('sw.js').toString('utf8');

    test('handles push and notification clicks', () => {
        expect(sw).toMatch(/addEventListener\('push'/);
        expect(sw).toMatch(/addEventListener\('notificationclick'/);
    });

    test('shows a notification for every push it receives', () => {
        // A push event that resolves without calling showNotification causes
        // browsers to display their own "this site has been updated" notice.
        expect(sw).toMatch(/showNotification/);
    });

    test('points only at icons that exist', () => {
        const refs = [...sw.matchAll(/['"](\/[^'"]*\.png)['"]/g)].map(m => m[1]);
        expect(refs.length).toBeGreaterThan(0);
        for (const ref of refs) {
            expect(existsSync(path.join(ROOT, ref.replace(/^\//, ''))), `${ref} is missing`).toBe(true);
        }
    });

    test('a click focuses an open tab rather than opening a second one', () => {
        expect(sw).toMatch(/matchAll/);
        expect(sw).toMatch(/\.focus\(\)/);
        expect(sw).toMatch(/openWindow/);
    });

    test('closes the notification when it is tapped', () => {
        expect(sw).toMatch(/notification\.close\(\)/);
    });
});

describe('the Coach Tee client', () => {
    test('sends the session token with every request', () => {
        const fn = html.slice(html.indexOf('async function fetchClaude'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        expect(body).toContain('getSession');
        expect(body).toContain('Bearer ');
    });

    test('refuses to call the endpoint with no session', () => {
        const fn = html.slice(html.indexOf('async function fetchClaude'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        expect(body).toMatch(/if\(!session\)\s*return/);
    });

    test('refreshes a stale token and retries rather than saying sign in', () => {
        // Now that the endpoint enforces 401s, an hour-old token in a phone
        // left open would otherwise read as "sign in" to someone already
        // signed in. This retry is what keeps enforcement from being felt.
        const fn = html.slice(html.indexOf('async function fetchClaude'));
        const body = fn.slice(0, fn.indexOf('\nasync function'));
        expect(body).toMatch(/res\.status===401/);
        expect(body).toMatch(/refreshSession|getSession/);
    });

    test('no longer sends a system prompt of its own', () => {
        // The persona lives in functions/api/coach-tee.js now. A client that can
        // name its own system prompt is a public Claude proxy.
        expect(html).not.toContain('systemPrompt');
        expect(html).not.toContain('You are Coach Tee,');
        expect(html).not.toContain('You are a tissue expansion recovery analyst');
    });

    test('still builds the live context, so answers stay personal', () => {
        expect(html).toContain('function _coachContext()');
        expect(html).toContain("fetchClaude('coach',q,_coachContext())");
    });
});

describe('the assets the install needs are actually served', () => {
    test('the manifest and icons are not excluded by .assetsignore', () => {
        // assets.directory is the repo root, so .assetsignore decides what is
        // fetchable. An excluded manifest is a manifest that 404s in
        // production while passing every test here.
        const ignored = read('.assetsignore').toString('utf8')
            .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        expect(ignored).not.toContain('icons');
        expect(ignored).not.toContain('manifest.webmanifest');
        expect(ignored).not.toContain('sw.js');
        expect(ignored).not.toContain('app');
    });

    test('the deployed path is still the Worker, and it is documented', () => {
        // Correcting the audit: src/worker.js is what serves the site. It
        // imports the handlers in functions/api rather than duplicating them.
        expect(existsSync(path.join(ROOT, 'src/worker.js'))).toBe(true);
        const worker = read('src/worker.js').toString('utf8');
        expect(worker).toMatch(/from '\.\.\/functions\/api\/coach-tee\.js'/);
        expect(read('README-DEPLOY.md').toString('utf8').replace(/\s+/g, ' '))
            .toMatch(/the Worker is what serves the site/i);
    });

    test('the retired Whop webhook stays gone, and the route says so', () => {
        expect(existsSync(path.join(ROOT, 'functions/api/whop-webhook.js'))).toBe(false);
        expect(read('src/worker.js').toString('utf8')).toMatch(/410/);
    });

    test('nothing still claims the Whop webhook is live', () => {
        // A comment that describes a decommissioned system as running is how
        // the next person reasons from a false premise.
        expect(html).not.toMatch(/Whop\s+webhook\s+stays\s+live/i);
        expect(html).toMatch(/Whop is decommissioned/i);
    });
});
