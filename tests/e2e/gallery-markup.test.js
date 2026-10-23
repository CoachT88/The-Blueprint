import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * THE GALLERY BUILDS MARKUP FROM NAMES IT DOES NOT CHOOSE.
 *
 * renderGalleryInto() writes a tile per object returned by storage.list().
 * Three values on each tile come from the object's name: the path, the date
 * label when the name does not parse as a timestamp, and the signed URL,
 * which embeds the path. An object can be uploaded through the Storage API
 * under any name its owner picks, so all three are text a member controls.
 *
 * The tile used to be built as
 *
 *     onclick="onGalleryTap(${i},'${p.url}','${p.date}','${p.path}')"
 *
 * where a name containing an apostrophe closed the JavaScript string and the
 * rest of the name was parsed as code. Storage policies keep a member inside
 * their own folder, so the only account reachable that way was the
 * attacker's own, which makes it low severity and not a reason to leave
 * unescaped member text in executable markup.
 *
 * The handler now takes an index, which this code generated, and looks the
 * item up in _galleryItems. The remaining interpolations are escaped: esc()
 * for the text node, escAttr() for the attribute, which additionally
 * neutralises quotes.
 *
 * These tests seed hostile object names and then assert both halves: nothing
 * executes, and the gallery still behaves exactly as it did.
 */

/* parseInt() reads the leading digits, so this name still produces a normal
   date label and carries its payload only in the path and the signed URL.
   That is the vector the <img src> sees. */
const QUOTE_BREAKOUT = `1700000000000'),window.__xss=1,x('.jpg`;

/* No leading digits, so parseInt gives NaN and the raw name becomes the
   date label. That is the vector the text node sees. */
const TAG_BREAKOUT = `"><img src=x onerror="window.__xss=1">.jpg`;

/* A plain one, so the behaviour assertions have something ordinary to use. */
const NORMAL = `${Date.now() - 30 * 864e5}.jpg`;

describe('a hostile object name cannot reach executable markup', () => {
    let app;

    beforeAll(async () => {
        app = await openApp({
            files: [{ name: QUOTE_BREAKOUT }, { name: TAG_BREAKOUT }, { name: NORMAL }],
        });
        await signIn(app.page, { id: 'gal1' });
        /* Production puts the object path inside the signed URL. Without
           this the <img src> would be an inline image and the attribute
           vector would not be exercised at all. */
        await app.page.evaluate(() => { window.__signedUrlsEchoPath = true; });
        await app.page.evaluate(() => {
            document.querySelectorAll('.step-content').forEach(e => {
                e.classList.add('hidden-step'); e.classList.remove('active-step');
            });
        });
        await app.page.evaluate(() => openPhotoLog());
        await app.page.waitForTimeout(600);
    }, 60_000);

    afterAll(async () => { await app?.close(); });

    test('the gallery rendered all three objects', async () => {
        /* If this is wrong the rest of the file proves nothing, because an
           empty gallery passes every injection assertion below. */
        const n = await app.page.evaluate(() => _galleryItems.length);
        expect(n).toBe(3);
    });

    test('ACCEPTANCE: NOTHING FROM A FILENAME EXECUTED', async () => {
        const xss = await app.page.evaluate(() => window.__xss);
        expect(xss, 'a filename executed as code').toBeUndefined();
    });

    test('ACCEPTANCE: every handler is an index and nothing else', async () => {
        const handlers = await app.page.evaluate(() =>
            [...document.querySelectorAll('#photo-log-gallery > div')]
                .map(d => d.getAttribute('onclick')));
        expect(handlers.length).toBe(3);
        for (const h of handlers) {
            expect(h, `handler carries more than an index: ${h}`).toMatch(/^onGalleryTap\(\d+\)$/);
        }
    });

    test('ACCEPTANCE: no extra element was injected into the gallery', async () => {
        /* The tag-breakout name would add a second <img> to its own tile if
           the attribute escaping failed. Counting elements catches that
           whether or not the injected handler happened to fire. */
        const counts = await app.page.evaluate(() => ({
            tiles: document.querySelectorAll('#photo-log-gallery > div').length,
            imgs: document.querySelectorAll('#photo-log-gallery img').length,
            withOnerror: document.querySelectorAll('#photo-log-gallery [onerror]').length,
        }));
        expect(counts.tiles).toBe(3);
        expect(counts.imgs, 'an extra image was injected').toBe(3);
        expect(counts.withOnerror, 'an onerror attribute was injected').toBe(0);
    });

    test('the hostile name survives as TEXT, which is the point', async () => {
        /* Escaping has to neutralise the name without mangling it: a member
           whose file is oddly named should still see the label. */
        const labels = await app.page.evaluate(() =>
            [...document.querySelectorAll('#photo-log-gallery p')].map(p => p.textContent));
        expect(labels.some(l => l.includes('<img src=x onerror=')),
            'the raw name is not shown as text').toBe(true);
    });

    test('the path no longer appears in any handler attribute', async () => {
        const html = await app.page.evaluate(() =>
            document.getElementById('photo-log-gallery').innerHTML);
        expect(html, 'the object path is still embedded in the markup')
            .not.toMatch(/onclick="onGalleryTap\([^)]*['"]/);
    });

    test('the page threw nothing while rendering any of it', () => {
        expect(app.errors).toEqual([]);
    });
});

describe('the gallery still works exactly as before', () => {
    let app;
    const now = Date.now();
    const files = [
        { name: `${now}.jpg` },
        { name: `${now - 30 * 864e5}.jpg` },
        { name: `${now - 60 * 864e5}.jpg` },
    ];

    beforeAll(async () => {
        app = await openApp({ files });
        await signIn(app.page, { id: 'gal2' });
        await app.page.evaluate(() => {
            document.querySelectorAll('.step-content').forEach(e => {
                e.classList.add('hidden-step'); e.classList.remove('active-step');
            });
        });
        await app.page.evaluate(() => openPhotoLog());
        await app.page.waitForTimeout(600);
    }, 60_000);

    afterAll(async () => { await app?.close(); });

    test('ACCEPTANCE: tapping a tile opens the viewer on that photo', async () => {
        await app.page.evaluate(() =>
            document.querySelectorAll('#photo-log-gallery > div')[1].click());
        await app.page.waitForTimeout(300);
        const r = await app.page.evaluate(() => ({
            open: !document.getElementById('photo-viewer-overlay').classList.contains('hidden'),
            /* textContent, not innerText: the viewer date is styled
               uppercase and innerText reports the transformed string, which
               would fail this comparison for a reason that is not a bug. */
            date: document.getElementById('photo-viewer-date').textContent,
            src: document.getElementById('photo-viewer-img').getAttribute('src'),
            expectedDate: _galleryItems[1].date,
            expectedSrc: _galleryItems[1].url,
            viewerPath: _viewerPath,
            expectedPath: _galleryItems[1].path,
        }));
        expect(r.open, 'the viewer did not open').toBe(true);
        expect(r.date).toBe(r.expectedDate);
        expect(r.src).toBe(r.expectedSrc);
        /* _viewerPath is what the delete button acts on. Taking it from the
           looked-up item rather than from the attribute must not change it,
           because deleting the wrong photo is unrecoverable. */
        expect(r.viewerPath, 'the viewer is pointed at the wrong object')
            .toBe(r.expectedPath);
    }, 30_000);

    test('and compare mode still swaps the after shot instead of opening it', async () => {
        await app.page.evaluate(() => closePhotoViewer());
        await app.page.evaluate(() => document.getElementById('photo-compare-btn').click());
        await app.page.waitForTimeout(400);
        await app.page.evaluate(() =>
            document.querySelectorAll('#photo-log-gallery > div')[1].click());
        await app.page.waitForTimeout(300);
        const r = await app.page.evaluate(() => ({
            gap: document.getElementById('photo-compare-gap').textContent,
            viewerOpen: !document.getElementById('photo-viewer-overlay').classList.contains('hidden'),
            idx: _compareAfterIdx,
        }));
        expect(r.gap).toMatch(/30 days apart/);
        expect(r.viewerOpen, 'compare mode opened the viewer').toBe(false);
        expect(r.idx).toBe(1);
    }, 30_000);

    test('a tap on an index with no item does nothing rather than throwing', async () => {
        /* The lookup replaced four arguments with one, so the out-of-range
           case is new and has to be a no-op. */
        const threw = await app.page.evaluate(() => {
            try { onGalleryTap(99); return false; } catch (e) { return String(e); }
        });
        expect(threw).toBe(false);
        expect(app.errors).toEqual([]);
    }, 30_000);

    test('no photo was uploaded, removed or otherwise written', async () => {
        /* The brief was to retest gallery behaviour without altering saved
           photos. The mock records both, so this is checkable. */
        const r = await app.page.evaluate(() => ({
            uploads: (window.__uploads || []).length,
            removals: (window.__removed || []).length,
        }));
        expect(r.uploads, 'the gallery tests uploaded something').toBe(0);
        expect(r.removals, 'the gallery tests removed something').toBe(0);
    });
});
