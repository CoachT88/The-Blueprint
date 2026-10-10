import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * WHERE THE MISSION SITS, measured rather than eyeballed.
 *
 * THE DEFECT THIS PINS. The hero used to move. Measured at 390x844 it sat at
 * 83px in six of the eight states, at 127px in COMPLETE because the context
 * line is live there, and at 201px with one attention banner up. Two regions
 * above it caused all of that, and the one thing on this screen that should
 * never move is the thing the screen exists to deliver. Both moved below it.
 *
 * WHAT THIS FILE DOES NOT ASSERT, deliberately. Not that the hero is a
 * particular height: the CTA was already above the fold in every state by
 * 389px or more, so there is nothing to buy by growing it. Not that the tools
 * row is reachable: reordering content does not reduce it, and claiming
 * otherwise here would make a passing test out of a problem that is still
 * there.
 *
 * The seeds are the ones from today-states.test.js, so this file and that one
 * cannot disagree about what a state means.
 */

const SEED = {
    PREPARE:  { goal: '' },
    TRAIN:    {},
    MODIFIED: { soreness: 'moderate' },
    RECOVER:  { soreness: 'high' },
    REST:     { schedule: ['rest','rest','rest','rest','rest','rest','rest'] },
    RESUME:   { draft: true },
    COMPLETE: { completedDays: [true,true,true,true,true,true,true],
                sessionLog: [{ date: new Date().toISOString(), routineType: 'length', duration: 45 }] },
    /* The stacked case. Seeded, not faked: a real rest schedule, a real
       session draft and a real storage-full flag, which is the worst
       combination a member can actually be in. */
    STACKED:  { schedule: ['rest','rest','rest','rest','rest','rest','rest'],
                draft: true, storageFull: true },
    /* TWO attention entries genuinely live at once: the data did not load AND
       storage is full. Without this the one-banner rule below is vacuous,
       because every other fixture has at most one live entry, so a mutation
       that showed all of them changed nothing. Found exactly that way. */
    CONTENDING: { notLoaded: true, storageFull: true },
};

const measure = (page, o) => page.evaluate(async (o) => {
    const U = 'tst';
    currentUser = { id: U, email: 't@e.com', user_metadata: { preferred_name: 'Marcus' } };
    _persistedLoaded = !o.notLoaded;
    _storageFull = !!o.storageFull;
    persisted.primaryGoal = o.goal === undefined ? 'all' : o.goal;
    persisted.pelvicProfile = 'standard'; persisted.pelvicScreenDate = '2025-01-01';
    persisted.schedule = o.schedule || ['length','length','length','length','length','length','length'];
    persisted.completedDays = o.completedDays || [false,false,false,false,false,false,false];
    persisted.sessionLog = o.sessionLog ||
        [{ date: new Date(Date.now() - 2 * 864e5).toISOString(), routineType: 'length', duration: 30 }];
    persisted.progressionLedger = []; persisted.allTimeSessionCount = 40;
    try {
        localStorage.setItem('bp_onboarded_' + U, '1');
        localStorage.removeItem(getTodaySorenessKey());
        localStorage.removeItem('bp_session_draft_' + U);
        if (o.soreness) localStorage.setItem(getTodaySorenessKey(), o.soreness);
        if (o.draft) localStorage.setItem('bp_session_draft_' + U, JSON.stringify(
            { savedAt: Date.now(), exerciseIndex: 0, setIndex: 1, routineType: 'length', xp: 0,
              sessionStartTime: Date.now() - 3e5 }));
    } catch (e) {}
    goToStep(0); renderDashboard();
    /* Let the entry stagger finish before anything is read from a rect. The
       four animated regions start 55ms apart and the longest token duration
       is 360ms, so 650ms clears it with room to spare. Only the CTA fold
       check needs this; the offsets below are transform-independent. */
    await new Promise(r => setTimeout(r, 650));

    const scroller = document.getElementById('step-0');
    /* Offset within the SCROLL CONTENT, which is the distance the member
       actually has to travel past, not the viewport-relative top. */
    const vis = (id) => { const e = document.getElementById(id);
        return !!e && !e.classList.contains('hidden') && e.offsetHeight > 0; };
    /* offsetTop, NOT getBoundingClientRect().top, and this is not a detail.
       renderDashboard() restarts the .hq-anim stagger on every render, and
       those keyframes translate, so a rect read straight afterwards reports
       the animation's current position rather than the layout's. Measured: it
       inflated the hero's apparent offset by up to 23px and varied by state,
       which is exactly the kind of jitter this file exists to detect, so
       measuring it would make the test lie in both directions.

       offsetTop is the laid-out position and transforms do not touch it.

       Summed up the offsetParent chain, because offsetTop alone is relative
       to each element's own offsetParent and these regions are not all at the
       same depth: #hq-secondary is nested, so its bare offsetTop reads as 27
       and would compare as though it were above the hero. Walking to the
       scroll container puts every region in one coordinate space.

       null for anything not laid out, since a display:none node has no
       position to compare. */
    const off = (id) => {
        const e = document.getElementById(id);
        if (!e || !vis(id)) return null;
        let n = e, t = 0;
        while (n && n !== scroller) { t += n.offsetTop; n = n.offsetParent; }
        return t;
    };

    const primaryId = ['launch-btn','resume-btn','today-prepare-btn'].find(vis) || null;
    const pr = primaryId ? document.getElementById(primaryId).getBoundingClientRect() : null;
    const BANNERS = ['hq-load-failed-banner','hq-storage-full-banner','deload-banner',
                     'hq-rest-banner','resume-banner'];

    return {
        state: document.getElementById('hq-today-card').dataset.state,
        heroTop: off('hq-today-card'),
        contextTop: off('hq-context'),
        bandTop: off('hq-attention-band'),
        weekTop: off('hq-week-card'),
        secondaryTop: off('hq-secondary'),
        primary: primaryId,
        primaryFullyVisible: pr ? (pr.bottom <= window.innerHeight && pr.top >= 0) : null,
        bannersShown: BANNERS.filter(vis),
        contextVisible: vis('hq-context'),
        contextHidden: document.getElementById('hq-context').classList.contains('hidden'),
        /* How many entries WANT the slot, independent of how many got it.
           Read from the same predicates the renderer uses. */
        liveAttentionEntries: ATTENTION_BAND.filter(e => { try { return !!e.live(); } catch (x) { return false; } }).length,
    };
}, o);

describe('the mission does not move', () => {
    let app;
    const got = {};
    beforeAll(async () => {
        app = await openApp({});
        await signIn(app.page, { id: 'tst' });
        for (const [name, o] of Object.entries(SEED)) got[name] = await measure(app.page, o);
    }, 180_000);
    afterAll(async () => { await app?.close(); });

    test('THE HERO STARTS AT THE SAME OFFSET IN EVERY STATE', () => {
        /* The whole point of the slice. Before the move these were 83, 83, 83,
           83, 84, 84, 127 and 201. */
        const tops = Object.entries(got).map(([n, r]) => [n, r.heroTop]);
        const distinct = [...new Set(tops.map(([, t]) => t))];
        expect(distinct, `heroTop per state: ${JSON.stringify(tops)}`).toHaveLength(1);
    });

    test('and every state really was exercised, so the above is not vacuous', () => {
        /* A guard on the guard: if the seeds silently produced one state
           eight times, the constant above would be trivially true. */
        expect(Object.keys(got)).toHaveLength(9);
        const states = new Set(Object.values(got).map(r => r.state));
        expect(states.size).toBeGreaterThanOrEqual(6);
        /* And the stacked case must genuinely have raised a banner, or it is
           not testing the displaced case at all. */
        expect(got.STACKED.bannersShown.length).toBe(1);
        /* CONTENDING must have had two entries CONTEND, or the one-banner
           test below proves nothing. Both conditions are set, so both
           entries' live() return true and the renderer has a real choice. */
        expect(got.CONTENDING.liveAttentionEntries).toBe(2);
    });

    test('THE HERO IS THE FIRST REGION ON THE HQ, in every state', () => {
        for (const [name, r] of Object.entries(got)) {
            for (const [label, v] of [['context', r.contextTop], ['attention band', r.bandTop],
                                      ['week', r.weekTop], ['secondary', r.secondaryTop]]) {
                if (v === null) continue;
                expect(r.heroTop, `${name}: hero must precede ${label}`).toBeLessThan(v);
            }
        }
    });

    test('the context line and the attention band both sit below it', () => {
        /* Only where they are actually on screen. Both collapse when they
           have nothing to say, and a collapsed region has no position to
           compare. At least one state must exercise each, which the two
           assertions after the loop require. */
        let sawContext = 0, sawBand = 0;
        for (const [name, r] of Object.entries(got)) {
            if (r.contextTop !== null) {
                sawContext++;
                expect(r.contextTop, `${name} context`).toBeGreaterThan(r.heroTop);
                expect(r.contextTop, `${name} context before week`).toBeLessThan(r.weekTop);
            }
            if (r.bandTop !== null) {
                sawBand++;
                expect(r.bandTop, `${name} band`).toBeGreaterThan(r.heroTop);
                /* And above the week, so the move did not overshoot past it. */
                expect(r.bandTop, `${name} band before week`).toBeLessThan(r.weekTop);
            }
        }
        expect(sawContext, 'no state rendered the context line').toBeGreaterThan(0);
        expect(sawBand, 'no state rendered the attention band').toBeGreaterThan(0);
    });

    test('the primary CTA is STILL fully visible without scrolling', () => {
        /* True before the move and must stay true. This is the measurement
           that says the hero does not need to be enlarged. */
        for (const [name, r] of Object.entries(got)) {
            if (!r.primary) continue;                 // REST and COMPLETE have none, by design
            expect(r.primaryFullyVisible, `${name} CTA (${r.primary})`).toBe(true);
        }
    });

    test('the attention band still shows AT MOST ONE banner', () => {
        /* _renderBand's one-banner rule is what stops the region below the
           hero growing without limit now that it lives there. */
        for (const [name, r] of Object.entries(got)) {
            expect(r.bannersShown.length, `${name}: ${r.bannersShown}`).toBeLessThanOrEqual(1);
        }
    });

    test('an empty context region collapses instead of leaving a gap', () => {
        /* The bug _renderBand's own comment warns about, now one region
           lower: an invisible element with a margin still pushes everything
           under it down. TRAIN has nothing contextual to say. */
        expect(got.TRAIN.contextVisible).toBe(false);
        expect(got.TRAIN.contextHidden).toBe(true);
        /* COMPLETE does, so the collapse is conditional and not permanent. */
        expect(got.COMPLETE.contextVisible).toBe(true);
    });
});
