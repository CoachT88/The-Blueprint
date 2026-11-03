import { describe, test, expect } from 'vitest';
import { openApp, authSignIn } from './harness.js';

/**
 * MOVE, PREVIEW ONLY. What it does, and that it writes nothing.
 *
 * The component exists so a support day has something real to do on it. It is
 * reachable by no current member, and the tests that matter most here are not
 * the journey ones: they are the four-way snapshots proving that Confirm, Stop
 * and Skip leave session history, XP, completed days and the write log exactly
 * as they were.
 *
 * TWO GATES, AND ONLY ONE IS A GUARANTEE.
 *
 * A day's plan must carry a `move` supporting item, AND MOVE_UI_PREVIEW must
 * be true. The data condition narrows what is reachable and is NOT a safety
 * claim: importData() adopts member-supplied JSON and a day_plans row is just
 * data, so "the generator does not write move work" proves nothing about a
 * stored plan. MOVE_UI_PREVIEW is the gate that holds, and it is re-checked in
 * every handler so markup left in the DOM by any route cannot be driven.
 *
 * A TIMER REACHING THE DURATION IS NOT COMPLETION. Today onSetDone() is the
 * timer's callback and it is what records a session. This component inverts
 * that: reaching the target changes the screen and awards nothing, and Confirm
 * is the only control that would ever record.
 */

const DATES = ['2026-03-15','2026-03-16','2026-03-17','2026-03-18',
               '2026-03-19','2026-03-20','2026-03-21'];
const TODAY = new Date('2026-03-16T12:00:00Z');
const MOVE_ITEM = { type:'move', category:'aerobic', title:'Move',
                    required:true, dose:{ minutes:15 } };

/** A week of rest with one Move support day on the 16th. */
const planWeek = (withMove = true) => {
    const plans = DATES.map(d => ({ date:d, mode:'rest', status:'pending',
        primarySession:null, supportingWork:[], dailyPractice:[],
        generatedFrom:{ programmeKey:'erectionQuality', version:1 } }));
    if (withMove) {
        plans[1].mode = 'prescribed';
        plans[1].supportingWork = [MOVE_ITEM];
    }
    return plans;
};

const rowFor = (withMove = true) => ({
    id:'m1', schedule:Array(7).fill('rest'), completed_days:Array(7).fill(false),
    total_xp:100, all_time_session_count:3, difficulty:'intermediate',
    session_log:[], measurements:[], progress_checkins:[],
    day_plans:planWeek(withMove), week_key:'w', xp_migrated:true,
    programme:{ key:'erectionQuality', version:1, custom:false, adoptedAt:'2026-03-01',
        migration:{ source:'preset', presetKey:'eq', classifiedAt:'2026-03-01' } },
    updated_at:'2026-03-14T12:00:00Z',
});

/** Signed in on the Move day. `preview` flips the gate. */
const start = async ({ withMove = true, preview = true } = {}) => {
    const app = await openApp({ clock: TODAY, timezoneId: 'UTC' });
    await app.page.evaluate(() => localStorage.clear());
    await authSignIn(app.page, { id:'m1', email:'m1@example.com', row: rowFor(withMove) });
    await app.page.evaluate(p => {
        dismissUpdateNotice(); hideOnboarding();
        MOVE_UI_PREVIEW = p;
        renderDashboard();
    }, preview);
    /* Let the sign-in boot's debounced save land before any test takes a
       baseline. savePersisted() debounces 800ms, so without this the boot's
       own write is counted against the Move component. */
    await app.page.waitForTimeout(1500);
    return app;
};

const vis = (page, id) => page.evaluate(i => {
    const n = document.getElementById(i);
    return !!n && !n.classList.contains('hidden');
}, id);
const click = (page, id) => page.evaluate(i => document.getElementById(i).click(), id);
const text = (page, id) => page.evaluate(i => document.getElementById(i).textContent.trim(), id);

/** Everything that must not move. */
const snapshot = page => page.evaluate(() => ({
    logLen: (persisted.sessionLog || []).length,
    totalXp: persisted.totalXp,
    completedDays: JSON.stringify(persisted.completedDays),
    writes: window.__writes.length,
    xp: persisted.xpMigrated,
}));

/** Choose an activity and a duration, the only way Start becomes available. */
const choose = page => page.evaluate(() => {
    document.querySelector('#move-activities [data-activity="indoors"]').click();
    document.querySelector('#move-durations [data-duration="15"]').click();
});

describe('the gates', () => {
    test('with the preview switch off the card never renders, even with Move data', async () => {
        const app = await start({ preview: false });
        try {
            expect(await vis(app.page, 'move-card')).toBe(false);
        } finally { await app.close(); }
    }, 90_000);

    test('with the switch on but no Move data the card still does not render', async () => {
        const app = await start({ withMove: false, preview: true });
        try {
            expect(await vis(app.page, 'move-card')).toBe(false);
        } finally { await app.close(); }
    }, 90_000);

    test('THE SWITCH GATES INTERACTIONS, NOT ONLY RENDERING', async () => {
        /* A stored or imported plan can carry anything, so the card must be
           inert rather than merely hidden. Markup is forced visible with the
           switch off and every control is clicked. */
        const app = await start({ preview: true });
        try {
            await click(app.page, 'move-open');
            await choose(app.page);
            const before = await app.page.evaluate(() => {
                MOVE_UI_PREVIEW = false;
                document.getElementById('move-card').classList.remove('hidden');
                document.getElementById('move-session').classList.remove('hidden');
                return _move.state;
            });
            for (const id of ['move-open','move-start','move-pause','move-resume',
                              'move-stop','move-confirm','move-discard',
                              'move-keep-going','move-skip','move-undo','move-done']) {
                await click(app.page, id);
            }
            const after = await app.page.evaluate(() => _move.state);
            expect(after).toBe(before);
        } finally { await app.close(); }
    }, 90_000);
});

describe('the journey', () => {
    test('Open is not Start, and Start needs both choices', async () => {
        const app = await start();
        try {
            expect(await vis(app.page, 'move-card')).toBe(true);
            await click(app.page, 'move-open');
            expect(await vis(app.page, 'move-ready')).toBe(true);
            // Opening starts nothing.
            expect(await vis(app.page, 'move-running')).toBe(false);
            expect(await app.page.evaluate(() => document.getElementById('move-start').disabled)).toBe(true);
            await app.page.evaluate(() =>
                document.querySelector('#move-activities [data-activity="walk"]').click());
            expect(await app.page.evaluate(() => document.getElementById('move-start').disabled)).toBe(true);
            await app.page.evaluate(() =>
                document.querySelector('#move-durations [data-duration="30"]').click());
            expect(await app.page.evaluate(() => document.getElementById('move-start').disabled)).toBe(false);
        } finally { await app.close(); }
    }, 90_000);

    test('elapsed counts up against the chosen duration, and pause holds it', async () => {
        const app = await start();
        try {
            await click(app.page, 'move-open');
            await choose(app.page);
            await click(app.page, 'move-start');
            expect(await text(app.page, 'move-elapsed')).toBe('0:00');
            expect(await text(app.page, 'move-target')).toContain('of 15:00');
            expect(await text(app.page, 'move-target')).toContain('Walking indoors');
            // Advance the clock the component reads, then tick.
            await app.page.evaluate(() => { _move.startedAt = Date.now() - 372_000; _moveTick(); });
            expect(await text(app.page, 'move-elapsed')).toBe('6:12');
            await click(app.page, 'move-pause');
            expect(await text(app.page, 'move-target')).toContain('Paused');
            expect(await vis(app.page, 'move-resume')).toBe(true);
            // Frozen while paused.
            await app.page.waitForTimeout(1200);
            expect(await text(app.page, 'move-elapsed')).toBe('6:12');
            await click(app.page, 'move-resume');
            expect(await vis(app.page, 'move-pause')).toBe(true);
        } finally { await app.close(); }
    }, 90_000);

    test('an early stop reports both numbers and never reads as completed', async () => {
        const app = await start();
        try {
            await click(app.page, 'move-open');
            await choose(app.page);
            await click(app.page, 'move-start');
            await app.page.evaluate(() => { _move.startedAt = Date.now() - 372_000; _moveTick(); });
            await click(app.page, 'move-stop');
            const line = await text(app.page, 'move-summary-line');
            expect(line).toContain('6 minutes and 12 seconds');
            expect(line).toContain('Your selected target was 15 minutes');
            expect(line).not.toMatch(/complete|target reached|well done/i);
            expect(await text(app.page, 'move-preview-note'))
                .toBe('Preview only. This activity has not been saved.');
            expect(await vis(app.page, 'move-discard')).toBe(true);
            expect(await vis(app.page, 'move-keep-going')).toBe(false);
        } finally { await app.close(); }
    }, 90_000);

    test('reaching the duration awards nothing and offers Keep going', async () => {
        const app = await start();
        try {
            await click(app.page, 'move-open');
            await choose(app.page);
            const before = await snapshot(app.page);
            await click(app.page, 'move-start');
            await app.page.evaluate(() => { _move.startedAt = Date.now() - 16 * 60_000; _moveTick(); });
            expect(await vis(app.page, 'move-summary')).toBe(true);
            expect(await vis(app.page, 'move-keep-going')).toBe(true);
            expect(await vis(app.page, 'move-discard')).toBe(false);
            // NOTHING was awarded by the timer alone.
            const after = await snapshot(app.page);
            expect(after).toEqual(before);
            await click(app.page, 'move-keep-going');
            expect(await vis(app.page, 'move-running')).toBe(true);
        } finally { await app.close(); }
    }, 90_000);

    test('Skip then Undo returns to Ready and touches interface state only', async () => {
        const app = await start();
        try {
            await click(app.page, 'move-open');
            const before = await snapshot(app.page);
            await click(app.page, 'move-skip');
            expect(await vis(app.page, 'move-skipped')).toBe(true);
            await click(app.page, 'move-undo');
            expect(await vis(app.page, 'move-ready')).toBe(true);
            expect(await snapshot(app.page)).toEqual(before);
        } finally { await app.close(); }
    }, 90_000);
});

describe('NOTHING IS SAVED, for Confirm, Stop and Skip', () => {
    const run = async (upTo) => {
        const app = await start();
        await click(app.page, 'move-open');
        await choose(app.page);
        const before = await snapshot(app.page);
        if (upTo !== 'skip') {
            await click(app.page, 'move-start');
            await app.page.evaluate(() => { _move.startedAt = Date.now() - 372_000; _moveTick(); });
            await click(app.page, 'move-stop');
        }
        if (upTo === 'confirm') await click(app.page, 'move-confirm');
        if (upTo === 'skip') await click(app.page, 'move-skip');
        /* Past the 800ms save debounce, so a write would have landed. */
        await app.page.waitForTimeout(1500);
        const after = await snapshot(app.page);
        await app.close();
        return { before, after };
    };

    test('Stop writes nothing', async () => {
        const { before, after } = await run('stop');
        expect(after).toEqual(before);
    }, 90_000);

    test('Confirm writes nothing, and says so three times', async () => {
        const app = await start();
        try {
            await click(app.page, 'move-open');
            await choose(app.page);
            const before = await snapshot(app.page);
            await click(app.page, 'move-start');
            await app.page.evaluate(() => { _move.startedAt = Date.now() - 372_000; _moveTick(); });
            await click(app.page, 'move-stop');
            await click(app.page, 'move-confirm');
            await app.page.waitForTimeout(1500);
            expect(await snapshot(app.page)).toEqual(before);
            // On the summary, on the confirm panel, and in the button's own name.
            expect(await text(app.page, 'move-confirmed-note'))
                .toBe('Preview only. This activity has not been saved.');
            expect(await text(app.page, 'move-confirmed-detail'))
                .toContain('No session was recorded');
            expect(await text(app.page, 'move-confirm')).toContain('nothing is saved');
        } finally { await app.close(); }
    }, 90_000);

    test('Skip writes nothing', async () => {
        const { before, after } = await run('skip');
        expect(after).toEqual(before);
    }, 90_000);
});

describe('layout and accessibility', () => {
    for (const [name, width] of [['320', 320], ['390', 390], ['desktop', 1280]]) {
        test(`no horizontal overflow at ${name}`, async () => {
            const app = await openApp({ clock: TODAY, timezoneId: 'UTC' });
            try {
                await app.page.setViewportSize({ width, height: 900 });
                await app.page.evaluate(() => localStorage.clear());
                await authSignIn(app.page, { id:'m1', email:'m1@example.com', row: rowFor() });
                await app.page.evaluate(() => {
                    dismissUpdateNotice(); hideOnboarding();
                    MOVE_UI_PREVIEW = true; renderDashboard();
                    document.getElementById('move-open').click();
                });
                const over = await app.page.evaluate(() =>
                    document.documentElement.scrollWidth - document.documentElement.clientWidth);
                expect(over).toBe(0);
            } finally { await app.close(); }
        }, 90_000);
    }

    test('every control is a real button, and Start is not Confirm', async () => {
        const app = await start();
        try {
            const out = await app.page.evaluate(() => {
                const ids = ['move-open','move-start','move-pause','move-resume','move-stop',
                             'move-confirm','move-discard','move-keep-going','move-skip',
                             'move-undo','move-done'];
                return {
                    tags: ids.map(i => document.getElementById(i).tagName),
                    sameElement: document.getElementById('move-start')
                                 === document.getElementById('move-confirm'),
                    live: document.getElementById('move-elapsed').getAttribute('aria-live'),
                    confirmName: document.getElementById('move-confirm').textContent.trim(),
                };
            });
            expect(out.tags.every(t => t === 'BUTTON')).toBe(true);
            expect(out.sameElement).toBe(false);
            expect(out.live).toBe('polite');
            // The preview wording is in the accessible name, not only beside it.
            expect(out.confirmName).toContain('nothing is saved');
        } finally { await app.close(); }
    }, 90_000);
});
