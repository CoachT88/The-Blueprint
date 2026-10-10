import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * The four destinations, and the way back.
 *
 * WHAT THIS EXISTS FOR. The HQ ended with a row of three and a row of two,
 * and the measured bottom of that stack was 856px on a 390x844 screen. In the
 * worst state the way OUT of the HQ was the one thing below the fold, which
 * is a navigation problem rather than a cosmetic one. Four tiles in one row
 * replaced them.
 *
 * WHAT IT MUST NOT BREAK. #hq-tools-row and #hq-coach-row are guided-tour
 * targets, so the row is built as two pair-containers rather than one grid.
 * Week, Photos and Manual are the SAME button nodes moved into Tools, so
 * their ids and listeners are unchanged and every destination still opens.
 */

const SEED = {
    TRAIN:    {},
    REST:     { schedule: ['rest','rest','rest','rest','rest','rest','rest'] },
    RECOVER:  { soreness: 'high' },
    RESUME:   { draft: true },
    COMPLETE: { completedDays: [true,true,true,true,true,true,true],
                sessionLog: [{ date: new Date().toISOString(), routineType: 'length',
                               duration: 45, xpEarned: 51 }] },
    STACKED:  { schedule: ['rest','rest','rest','rest','rest','rest','rest'],
                draft: true, storageFull: true },
};

const seed = (page, o) => page.evaluate(async (o) => {
    const U = 'tst';
    currentUser = { id: U, email: 't@e.com', user_metadata: { preferred_name: 'Marcus' } };
    _persistedLoaded = true; _storageFull = !!o.storageFull;
    persisted.primaryGoal = 'all';
    persisted.pelvicProfile = 'standard'; persisted.pelvicScreenDate = '2025-01-01';
    persisted.schedule = o.schedule || ['length','length','length','length','length','length','length'];
    persisted.completedDays = o.completedDays || [false,false,false,false,false,false,false];
    persisted.sessionLog = o.sessionLog ||
        [{ date: new Date(Date.now() - 2*864e5).toISOString(), routineType: 'length', duration: 30, xpEarned: 42 }];
    persisted.progressionLedger = []; persisted.allTimeSessionCount = 40;
    try {
        localStorage.setItem('bp_onboarded_' + U, '1');
        localStorage.setItem('bp_update_notice_v1_' + U, '1');
        localStorage.removeItem(getTodaySorenessKey());
        localStorage.removeItem('bp_session_draft_' + U);
        if (o.soreness) localStorage.setItem(getTodaySorenessKey(), o.soreness);
        if (o.draft) localStorage.setItem('bp_session_draft_' + U, JSON.stringify(
            { savedAt: Date.now(), exerciseIndex: 0, setIndex: 1, routineType: 'length', xp: 0,
              sessionStartTime: Date.now() - 3e5 }));
    } catch (e) {}
    goToStep(0); renderDashboard();
    await new Promise(r => setTimeout(r, 700));   // let the entry stagger settle
    return document.getElementById('hq-today-card').dataset.state;
}, o);

/** Bottom edge of the nav within the scroll content, transform-independent. */
const navBottom = (page) => page.evaluate(() => {
    const sc = document.getElementById('step-0');
    const nav = document.getElementById('hq-nav');
    let n = nav, top = 0;
    while (n && n !== sc) { top += n.offsetTop; n = n.offsetParent; }
    return { top, bottom: top + nav.offsetHeight, viewport: window.innerHeight };
});

describe('four destinations, reachable', () => {
    let app;
    beforeAll(async () => { app = await openApp({}); await signIn(app.page, { id: 'tst' }); }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('THE WHOLE NAV IS ABOVE THE FOLD IN EVERY ORDINARY STATE', async () => {
        for (const name of ['TRAIN','REST','RECOVER','RESUME','COMPLETE']) {
            await seed(app.page, SEED[name]);
            const m = await navBottom(app.page);
            expect(m.bottom, `${name}: nav bottom ${m.bottom} vs ${m.viewport}`)
                .toBeLessThanOrEqual(m.viewport);
        }
    }, 180_000);

    test('and the STACKED worst case is improved, though still not solved', async () => {
        /* Measured honestly rather than asserted away. On the previous HQ
           (805cf93) the two rows spanned 858 to 956 in this state, so the
           nav ended 112px below a 844px fold. One row of four ends at 918:
           74px below. Better by 38px, and NOT fixed.

           Closing the remaining 74px means taking content off the HQ, which
           is the relocation work this slice deliberately excludes. This
           assertion is therefore a RATCHET: it pins the improvement so a
           later change cannot quietly give it back, and it refuses to
           pretend the fold problem is solved in this state. */
        await seed(app.page, SEED.STACKED);
        const m = await navBottom(app.page);
        expect(m.bottom, `stacked nav bottom ${m.bottom}`).toBeLessThan(956);
        expect(m.bottom, 'and the whole nav is still one row').toBeLessThanOrEqual(930);
    }, 60_000);

    test('the two tour containers both survive, with real boxes', async () => {
        /* Collapsing the pairs into one grid would delete two tour stops.
           A box of zero size is as bad as a missing one: the tour measures
           geometry, so it would point at nothing. */
        await seed(app.page, SEED.TRAIN);
        const r = await app.page.evaluate(() => ['hq-tools-row','hq-coach-row'].map(id => {
            const e = document.getElementById(id); const b = e && e.getBoundingClientRect();
            return { id, exists: !!e, w: b ? Math.round(b.width) : 0, h: b ? Math.round(b.height) : 0,
                     tiles: e ? e.querySelectorAll('button').length : 0 };
        }));
        for (const x of r) {
            expect(x.exists, x.id).toBe(true);
            expect(x.w, `${x.id} width`).toBeGreaterThan(40);
            expect(x.h, `${x.id} height`).toBeGreaterThan(40);
            expect(x.tiles, `${x.id} tiles`).toBe(2);
        }
    }, 60_000);

    test('EVERY DESTINATION ACTUALLY OPENS', async () => {
        await seed(app.page, SEED.TRAIN);
        /* Progress and Coach straight from the nav. */
        const direct = await app.page.evaluate(async () => {
            const shown = id => { const e = document.getElementById(id); if (!e) return null;
                return !e.classList.contains('hidden') || e.classList.contains('show'); };
            const out = {};
            document.getElementById('progress-btn').click();
            await new Promise(r => setTimeout(r, 150));
            out.progress = shown('chart-modal');
            document.getElementById('chart-close-btn')?.click();
            await new Promise(r => setTimeout(r, 120));
            document.getElementById('ai-coach-btn').click();
            await new Promise(r => setTimeout(r, 150));
            out.coach = shown('coach-modal');
            closeCoach();
            await new Promise(r => setTimeout(r, 120));
            return out;
        });
        expect(direct.progress, 'Progress opens the chart modal').toBe(true);
        expect(direct.coach, 'Coach opens the coach modal').toBe(true);
    }, 90_000);

    test('and the three inside Tools open, each closing Tools behind it', async () => {
        await seed(app.page, SEED.TRAIN);
        for (const [btn, modal, close] of [
            ['weekly-report-btn','weekly-report-modal','weekly-report-close-btn'],
            ['photos-btn','photo-log-modal','photo-log-close'],
            ['manual-btn','manual-modal','manual-close-btn'],
        ]) {
            const o = await app.page.evaluate(async ({ btn, modal, close }) => {
                document.getElementById('hq-tools-btn').click();
                await new Promise(r => setTimeout(r, 120));
                const toolsOpen = !document.getElementById('tools-modal').classList.contains('hidden');
                document.getElementById(btn).click();
                await new Promise(r => setTimeout(r, 200));
                const m = document.getElementById(modal);
                const opened = m && (!m.classList.contains('hidden') || m.classList.contains('show')
                                     || getComputedStyle(m).display !== 'none');
                const toolsClosed = document.getElementById('tools-modal').classList.contains('hidden');
                document.getElementById(close)?.click();
                await new Promise(r => setTimeout(r, 150));
                return { toolsOpen, opened, toolsClosed };
            }, { btn, modal, close });
            expect(o.toolsOpen, `Tools opens before ${btn}`).toBe(true);
            expect(o.opened, `${btn} opens ${modal}`).toBe(true);
            expect(o.toolsClosed, `Tools closes behind ${btn}`).toBe(true);
        }
    }, 120_000);

    test('HQ IS A RELIABLE WAY BACK, even with an overlay open', async () => {
        await seed(app.page, SEED.TRAIN);
        const o = await app.page.evaluate(async () => {
            document.getElementById('progress-btn').click();
            await new Promise(r => setTimeout(r, 180));
            const before = !document.getElementById('chart-modal').classList.contains('hidden');
            document.getElementById('hq-home-btn').click();
            await new Promise(r => setTimeout(r, 250));
            return { before, after: !document.getElementById('chart-modal').classList.contains('hidden'),
                     current: document.getElementById('hq-home-btn').getAttribute('aria-current') };
        });
        expect(o.before, 'an overlay was open').toBe(true);
        expect(o.after, 'HQ closed it').toBe(false);
        expect(o.current, 'HQ marks itself as the current page').toBe('page');
    }, 90_000);

    test('the nav is NOT present during a training session', async () => {
        /* It lives inside #step-0. The session funnel is step-1 onward, and
           nothing from the HQ should be reachable mid-set. */
        const o = await app.page.evaluate(async () => {
            goToStep(4);
            await new Promise(r => setTimeout(r, 200));
            const nav = document.getElementById('hq-nav');
            const inStep0 = !!nav.closest('#step-0');
            const visible = nav.getBoundingClientRect().height > 0
                && !document.getElementById('step-0').classList.contains('hidden-step');
            goToStep(0);
            await new Promise(r => setTimeout(r, 200));
            return { inStep0, visible };
        });
        expect(o.inStep0, 'nav lives inside #step-0').toBe(true);
        expect(o.visible, 'nav is not on screen during a session').toBe(false);
    }, 90_000);
});

describe('the hero says each thing once', () => {
    let app;
    beforeAll(async () => { app = await openApp({}); await signIn(app.page, { id: 'tst' }); }, 90_000);
    afterAll(async () => { await app?.close(); });

    const lines = (page) => page.evaluate(() => {
        const t = id => { const e = document.getElementById(id);
            return (!e || e.classList.contains('hidden')) ? '' : (e.textContent || '').trim(); };
        return { sub: t('today-sub'), why: t('today-why'), headline: t('today-headline') };
    });

    test('A PLAIN TRAINING DAY EXPLAINS ITSELF ONCE, NOT TWICE', async () => {
        /* It used to print "Today's focus: your length protocol." AND
           "Today is a Length day on your schedule." under a headline already
           reading LENGTH DAY. Three lines, one fact. */
        await seed(app.page, SEED.TRAIN);
        const l = await lines(app.page);
        expect(l.headline).toMatch(/day/i);
        expect(l.sub).toMatch(/focus/i);
        expect(l.why, 'the reason restates the headline, so it is suppressed').toBe('');
    }, 60_000);

    test('but a MODIFIED day keeps its reason, because that reason is news', async () => {
        /* The line between repetition and context. Suppressing a reason that
           explains an adjustment would remove prescribed information, which
           is the opposite of the intent. */
        await seed(app.page, { soreness: 'moderate' });
        const st = await app.page.evaluate(() => document.getElementById('hq-today-card').dataset.state);
        const l = await lines(app.page);
        expect(st).toBe('MODIFIED');
        expect(l.why.length, 'MODIFIED still explains why').toBeGreaterThan(0);
    }, 60_000);

    test('and RECOVER keeps its reason too', async () => {
        await seed(app.page, SEED.RECOVER);
        const l = await lines(app.page);
        expect(l.why.length, 'RECOVER still explains why').toBeGreaterThan(0);
    }, 60_000);
});
