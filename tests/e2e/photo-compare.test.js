import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/** Before/after comparison in the photo log. Filenames are `Date.now().jpg`. */
describe('photo compare', () => {
    let app;
    const now = Date.now();
    const files = [
        { name: `${now}.jpg` },                  // newest first, as storage lists them
        { name: `${now - 30 * 864e5}.jpg` },
        { name: `${now - 60 * 864e5}.jpg` },
    ];

    beforeAll(async () => {
        app = await openApp({ files });
        await signIn(app.page, { id: 'u9' });
        // The shim has no arbitrary z-index utilities, so park the step layer
        // out of the way rather than fighting hit-testing.
        await app.page.evaluate(() => {
            document.querySelectorAll('.step-content').forEach(e => {
                e.classList.add('hidden-step'); e.classList.remove('active-step');
            });
        });
        await app.page.evaluate(() => openPhotoLog());
        await app.page.waitForTimeout(600);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    const click = (id) => app.page.evaluate(i => document.getElementById(i).click(), id);

    test('the gallery loads and compare is available with three photos', async () => {
        const r = await app.page.evaluate(() => ({
            items: _galleryItems.length,
            enabled: !document.getElementById('photo-compare-btn').disabled,
        }));
        expect(r.items).toBe(3);
        expect(r.enabled).toBe(true);
    });

    test('compare opens on oldest versus newest with the gap between them', async () => {
        await click('photo-compare-btn');
        await app.page.waitForTimeout(400);
        const r = await app.page.evaluate(() => ({
            visible: !document.getElementById('photo-compare').classList.contains('hidden'),
            gap: document.getElementById('photo-compare-gap').textContent,
            btn: document.getElementById('photo-compare-btn').textContent.trim(),
        }));
        expect(r.visible).toBe(true);
        expect(r.gap).toMatch(/60 days apart/);
        expect(r.btn).toMatch(/Close Comparison/i);
    }, 30_000);

    test('tapping a thumbnail swaps the after shot without opening the viewer', async () => {
        await app.page.evaluate(() => document.querySelectorAll('#photo-log-gallery > div')[1].click());
        await app.page.waitForTimeout(300);
        const r = await app.page.evaluate(() => ({
            gap: document.getElementById('photo-compare-gap').textContent,
            viewerOpen: !document.getElementById('photo-viewer-overlay').classList.contains('hidden'),
        }));
        expect(r.gap).toMatch(/30 days apart/);
        expect(r.viewerOpen).toBe(false);
    }, 30_000);

    test('closing compare restores normal tap-to-view', async () => {
        await click('photo-compare-btn');
        await app.page.waitForTimeout(300);
        expect(await app.page.evaluate(
            () => document.getElementById('photo-compare').classList.contains('hidden'))).toBe(true);

        await app.page.evaluate(() => document.querySelectorAll('#photo-log-gallery > div')[1].click());
        await app.page.waitForTimeout(300);
        expect(await app.page.evaluate(
            () => !document.getElementById('photo-viewer-overlay').classList.contains('hidden'))).toBe(true);
        await app.page.evaluate(() => closePhotoViewer && closePhotoViewer());
    }, 30_000);

    test('with a single photo the button is disabled and explains why', async () => {
        await app.page.evaluate(() => { window.__files = window.__files.slice(0, 1); });
        await app.page.evaluate(() => renderGalleryInto('photo-log-gallery'));
        await app.page.waitForTimeout(500);
        const r = await app.page.evaluate(() => ({
            disabled: document.getElementById('photo-compare-btn').disabled,
            hint: document.getElementById('photo-compare-hint').textContent,
            compareHidden: document.getElementById('photo-compare').classList.contains('hidden'),
        }));
        expect(r.disabled).toBe(true);
        expect(r.hint).toMatch(/one more photo/i);
        expect(r.compareHidden).toBe(true);
        expect(app.errors).toEqual([]);
    }, 30_000);
});
