import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, legacyProgramme } from './harness.js';

/**
 * The week strip, read and operated.
 *
 * WHAT CHANGED. The weekday label was 0.55rem, 8.8px, the last text on the HQ
 * below the design system's own 11px floor. It could not simply be raised,
 * because the cell used `aspect-ratio:1/1.3` and derived its height from its
 * width: seven columns on a 320px screen leave about 31px each, so the cell
 * could never be taller than ~40px however much the content needed. Height is
 * now set by min-height and is independent of width.
 *
 * WHAT MUST NOT CHANGE, and is the real subject of this file. The strip has
 * TWO COHORTS with deliberately different behaviour (app/index.html, the
 * interaction boundary note in renderWeekStrip):
 *
 *   authoritative  orientation only. No role, no tab stop, no listener,
 *                  because an edit to a projection is overwritten on the
 *                  next load.
 *   legacy/custom  their column IS their programme, so each cell opens the
 *                  day picker, by pointer and by keyboard.
 *
 * A change that made every cell look nicer and quietly handed authoritative
 * members an editor would be a worse outcome than the 8.8px label.
 */

const WEEK = ['length','girth','rest','stamina','length','rest','recovery'];

const AUTHORITATIVE = {
    key: 'size', version: 1, adoptedAt: '2026-01-01', custom: false, cyclePosition: 0,
    migration: { source: 'preset', presetKey: 'size', reason: 'match', classifiedAt: '2026-01-01' },
};

const seed = (page, programme) => page.evaluate(async (programme) => {
    const U = 'tst';
    currentUser = { id: U, email: 't@e.com', user_metadata: {} };
    _persistedLoaded = true;
    persisted.primaryGoal = 'all';
    persisted.pelvicProfile = 'standard'; persisted.pelvicScreenDate = '2025-01-01';
    persisted.schedule = ['length','girth','rest','stamina','length','rest','recovery'];
    persisted.completedDays = [true,true,false,false,false,false,false];
    persisted.sessionLog = []; persisted.progressionLedger = [];
    persisted.allTimeSessionCount = 40;
    persisted.programme = programme;
    try {
        localStorage.setItem('bp_onboarded_' + U, '1');
        localStorage.setItem('bp_update_notice_v1_' + U, '1');
    } catch (e) {}
    goToStep(0); renderDashboard();
    await new Promise(r => setTimeout(r, 700));
    return document.getElementById('hq-week-strip').dataset.authority;
}, programme);

const probe = (page) => page.evaluate(() => {
    const strip = document.getElementById('hq-week-strip');
    const cells = [...strip.querySelectorAll('.week-cell')];
    const c0 = cells[0], sp = c0.querySelector('span');
    const b = c0.getBoundingClientRect();
    return {
        authority: strip.dataset.authority,
        count: cells.length,
        labelPx: parseFloat(getComputedStyle(sp).fontSize),
        cellW: Math.round(b.width), cellH: Math.round(b.height),
        roles: cells.filter(c => c.getAttribute('role') === 'button').length,
        tabbable: cells.filter(c => c.tabIndex === 0).length,
        icons: new Set(cells.map(c => (c.querySelector('i') || {}).className)).size,
        aria: cells.map(c => c.getAttribute('aria-label')).filter(Boolean).length,
        ariaFirst: c0.getAttribute('aria-label'),
        states: [...new Set(cells.map(c => c.dataset.state))].sort(),
        ticks: cells.filter(c => c.dataset.state === 'satisfied').length,
        today: cells.filter(c => c.dataset.today === '1').length,
        labelClipped: cells.some(c => { const s = c.querySelector('span');
            return s.scrollWidth > s.clientWidth + 1; }),
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
        weekLabel: (document.getElementById('hq-week-label').textContent || '').trim(),
    };
});

describe('the week strip reads and measures correctly', () => {
    let app;
    beforeAll(async () => { app = await openApp({}); await signIn(app.page, { id: 'tst' }); }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('THE LABEL MEETS THE TYPE FLOOR AT EVERY WIDTH AND SCALE', async () => {
        for (const w of [320, 375, 390]) {
            await app.page.setViewportSize({ width: w, height: 844 });
            await seed(app.page, legacyProgramme());
            const p = await probe(app.page);
            expect(p.labelPx, `${w}px label`).toBeGreaterThanOrEqual(11);
            expect(p.labelClipped, `${w}px label clipped`).toBe(false);
            expect(p.overflowX, `${w}px horizontal overflow`).toBe(false);
        }
        await app.page.setViewportSize({ width: 390, height: 844 });
    }, 120_000);

    test('AN INTERACTIVE CELL IS AT LEAST 44px TALL, down to 320px', async () => {
        /* Height is the axis this change can win. Width is NOT: seven
           columns cannot each be 44px in a 248px content box, so the cells
           satisfy WCAG 2.5.8 (AA, 24x24) and not 2.5.5 (AAA, 44x44). The
           assertion says exactly that rather than rounding it up. */
        for (const w of [320, 375, 390]) {
            await app.page.setViewportSize({ width: w, height: 844 });
            await seed(app.page, legacyProgramme());
            const p = await probe(app.page);
            expect(p.cellH, `${w}px cell height`).toBeGreaterThanOrEqual(44);
            expect(p.cellW, `${w}px cell width meets AA 24px`).toBeGreaterThanOrEqual(24);
        }
        await app.page.setViewportSize({ width: 390, height: 844 });
    }, 120_000);

    test('and nothing it already said was lost', async () => {
        await seed(app.page, legacyProgramme());
        const p = await probe(app.page);
        expect(p.count).toBe(7);
        /* Icons encode the day TYPE, so a mixed week shows several. A single
           distinct icon here would mean the type language had collapsed. */
        expect(p.icons).toBeGreaterThanOrEqual(4);
        expect(p.aria, 'every cell keeps its label').toBe(7);
        expect(p.ariaFirst).toMatch(/done$/);
        expect(p.states).toContain('satisfied');
        expect(p.states).toContain('rest');
        expect(p.states).toContain('unknown');
        expect(p.ticks, 'completion ticks survive').toBe(2);
        expect(p.today, 'exactly one today').toBe(1);
        expect(p.weekLabel).toMatch(/\d+ of \d+/);
    }, 60_000);
});

describe('the authority boundary is exactly as it was', () => {
    let app;
    beforeAll(async () => { app = await openApp({}); await signIn(app.page, { id: 'tst' }); }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('AN AUTHORITATIVE MEMBER CANNOT EDIT A PROJECTED DAY', async () => {
        const authority = await seed(app.page, AUTHORITATIVE);
        expect(authority).toBe('programme');
        const p = await probe(app.page);
        expect(p.roles, 'no cell is a button').toBe(0);
        expect(p.tabbable, 'no cell is a tab stop').toBe(0);
        /* And clicking one opens nothing. */
        const opened = await app.page.evaluate(async () => {
            const before = document.querySelectorAll('.show, [style*="display: flex"]').length;
            document.querySelector('#hq-week-strip .week-cell').click();
            await new Promise(r => setTimeout(r, 200));
            const dm = document.getElementById('type-modal');
            return !dm.classList.contains('hidden');
        });
        expect(opened, 'clicking a projected day opens no editor').toBe(false);
    }, 90_000);

    test('A LEGACY MEMBER STILL GETS THE DAY EDITOR, by pointer', async () => {
        const authority = await seed(app.page, legacyProgramme());
        expect(authority).toBe('legacy');
        const p = await probe(app.page);
        expect(p.roles, 'every cell is a button').toBe(7);
        expect(p.tabbable, 'every cell is a tab stop').toBe(7);
        const opened = await app.page.evaluate(async () => {
            document.querySelector('#hq-week-strip .week-cell').click();
            await new Promise(r => setTimeout(r, 250));
            const open = !document.getElementById('type-modal').classList.contains('hidden');
            if (open) closeModal();
            return open;
        });
        expect(opened, 'the day picker opens').toBe(true);
    }, 90_000);

    test('and by KEYBOARD, with a visible focus ring', async () => {
        await seed(app.page, legacyProgramme());
        /* A REAL Tab, not element.focus(). :focus-visible deliberately does
           not match programmatic focus on a div[tabindex], so calling
           .focus() and reading the outline measures nothing: it reported a
           0px ring on markup that paints one correctly for a keyboard user.
           Tabbing is also what the member actually does. */
        await app.page.evaluate(() => {
            document.getElementById('hq-week-strip').scrollIntoView();
            const prev = document.getElementById('hq-week-label');
            if (prev) prev.setAttribute('tabindex', '-1'), prev.focus();
        });
        let hops = 0, onCell = false;
        while (hops < 40 && !onCell) {
            await app.page.keyboard.press('Tab');
            onCell = await app.page.evaluate(() =>
                !!document.activeElement?.classList?.contains('week-cell'));
            hops++;
        }
        expect(onCell, 'a week cell is reachable by Tab').toBe(true);
        /* Read IMMEDIATELY, with no settle. The cell carries
           `transition:all .3s`, which catches outline-width, so a ring that
           is not explicitly exempted fades in from 0 and a fast keyboard
           user never sees it. Reading at 0ms is the assertion. */
        const ring = await app.page.evaluate(() => {
            const cs = getComputedStyle(document.activeElement);
            return { w: cs.outlineWidth, style: cs.outlineStyle, colour: cs.outlineColor };
        });
        expect(ring.style, 'focus ring style').toBe('solid');
        expect(parseFloat(ring.w), 'focus ring width').toBeGreaterThanOrEqual(2);

        const viaKey = await app.page.evaluate(async () => {
            const c = document.querySelector('#hq-week-strip .week-cell');
            c.focus();
            c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await new Promise(r => setTimeout(r, 250));
            const open = !document.getElementById('type-modal').classList.contains('hidden');
            if (open) closeModal();
            return open;
        });
        expect(viaKey, 'Enter opens the day picker').toBe(true);
    }, 90_000);

    test('an authoritative cell cannot be focused at all', async () => {
        await seed(app.page, AUTHORITATIVE);
        const focused = await app.page.evaluate(() => {
            const c = document.querySelector('#hq-week-strip .week-cell');
            c.focus();
            return document.activeElement === c;
        });
        expect(focused, 'a projected day is not a focus target').toBe(false);
    }, 60_000);
});
