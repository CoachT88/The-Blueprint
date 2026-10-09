import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, authSignIn } from './harness.js';

/**
 * A brand new paying member, from login to a usable HQ.
 *
 * This is the test the suite did not have. Every other fixture either seeds a
 * programme, seeds day plans, or reaches the HQ through signIn(), which
 * assigns currentUser directly and installs the LEGACY authority sentinel. So
 * the one path no test had ever walked is the one every new member walks:
 *
 *   auth account exists, membership claimed, NO user_data row
 *   -> DEFAULT_PERSISTED adopted, programme null, dayPlans []
 *   -> onboarding, goal, finish
 *   -> renderDashboard -> syncProgression -> classification -> cutover
 *   -> currentTodayPrescription -> nextBestAction -> renderToday
 *
 * NOTHING here pre-classifies the account or injects a programme. row is null
 * and the production orchestration does the rest, because seeding any of that
 * would skip the exact code under suspicion.
 */

/* The eight states renderToday is allowed to settle in. Anything else, or an
   empty headline, means the static markup was never replaced. */
const VALID_STATES = ['TRAIN', 'MODIFIED', 'RECOVER', 'REST',
                      'SUPPORT_ONLY', 'PREPARE', 'COMPLETE', 'RESUME'];

const read = (page) => page.evaluate(() => {
    const card = document.getElementById('hq-today-card');
    const h = document.getElementById('today-headline');
    const sub = document.getElementById('today-sub');
    const reason = document.getElementById('today-reason');
    const txt = (el) => (el ? (el.innerText || el.textContent || '').trim() : null);
    return {
        state: card ? card.getAttribute('data-state') : null,
        headline: txt(h),
        sub: txt(sub),
        reason: txt(reason),
        programmeKey: persisted.programme ? persisted.programme.key : null,
        dayPlans: (persisted.dayPlans || []).length,
        goal: persisted.primaryGoal || null,
        count: persisted.allTimeSessionCount,
        prescription: (() => {
            try {
                const p = currentTodayPrescription();
                return p ? { ok: p.ok, dayKind: p.dayKind || null,
                             primaryType: p.primaryType || null,
                             reason: p.reason || null } : null;
            } catch (e) { return { threw: String(e) }; }
        })(),
    };
});

describe('a brand new paying member reaches a usable HQ', () => {
    let app, afterOnboarding, errors;
    beforeAll(async () => {
        app = await openApp({ row: null });     // NO user_data row. The real first run.
        /* Membership is claimed through the RPC, so the purchase exists and is
           unclaimed, exactly as a new buyer's row is. */
        await app.page.evaluate(() => { window.__members = ['new@example.com']; });
        await authSignIn(app.page, { id: 'NEW1', email: 'new@example.com', row: null });

        afterOnboarding = await app.page.evaluate(async () => {
            const thrown = [];
            /* Walk the REAL onboarding, the way a thumb does. */
            try {
                if (document.getElementById('onboarding-overlay').classList.contains('show')) {
                    // Name slide, if the flow is on it.
                    const nameInput = document.getElementById('ob-name-input');
                    if (nameInput) { nameInput.value = 'Marcus'; commitPreferredName(); }
                }
                selectGoal('size');
                finishOnboarding();
            } catch (e) { thrown.push('onboarding: ' + String(e)); }
            /* Let finishOnboarding's deferred tour start and any render settle. */
            await new Promise(r => setTimeout(r, 1200));
            return { thrown };
        });
        errors = app.errors;
    }, 180_000);
    afterAll(async () => { await app?.close(); });

    test('onboarding itself threw nothing', () => {
        expect(afterOnboarding.thrown).toEqual([]);
    });

    test('THE TODAY CARD IS NOT THE BLANK STATIC MARKUP', async () => {
        const s = await read(app.page);
        /* The regression, stated as the invariant it violated. The static HTML
           ships with an empty headline, so a non-empty one is proof that
           renderToday actually ran and settled. */
        expect(s.headline).toBeTruthy();
        expect(s.headline.length).toBeGreaterThan(0);
        expect(VALID_STATES).toContain(s.state);
    }, 60_000);

    test('and the account really was classified and given plans', async () => {
        const s = await read(app.page);
        expect(s.goal).toBe('size');
        expect(s.programmeKey).toBeTruthy();     // cutover happened
        expect(s.dayPlans).toBeGreaterThan(0);   // generation happened
        expect(s.count).toBe(0);                 // still a new member
    }, 60_000);

    test('the prescription and the card agree', async () => {
        const s = await read(app.page);
        expect(s.prescription).toBeTruthy();
        expect(s.prescription.threw).toBeUndefined();
        /* A resolved prescription must match the state shown. A rest day shows
           REST, a primary day shows a working state, and a refusal shows
           PREPARE rather than a blank card. */
        if (s.prescription.ok === true && s.prescription.dayKind === 'primary') {
            expect(['TRAIN', 'MODIFIED', 'RECOVER', 'RESUME', 'COMPLETE']).toContain(s.state);
        } else if (s.prescription.ok === true && s.prescription.dayKind === 'rest') {
            expect(['REST', 'COMPLETE']).toContain(s.state);
        } else {
            expect(['PREPARE', 'SUPPORT_ONLY', 'REST']).toContain(s.state);
        }
    }, 60_000);

    test('NO UNCAUGHT PAGE ERRORS THROUGH THE WHOLE FIRST RUN', () => {
        expect(errors).toEqual([]);
    });
});

describe('the tour will not run over a broken HQ', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ row: null });
        await app.page.evaluate(() => { window.__members = ['guard@example.com']; });
        await authSignIn(app.page, { id: 'GUARD1', email: 'guard@example.com', row: null });
    }, 120_000);
    afterAll(async () => { await app?.close(); });

    /** Ask the real guard under a chosen broken condition. */
    const ready = (mutate) => app.page.evaluate((mutate) => {
        const h = document.getElementById('today-headline');
        const savedText = h.textContent;
        const savedBP = window.BP;
        const savedFlag = window._bpHqRendered;
        try {
            if (mutate === 'no-bp') window.BP = undefined;
            if (mutate === 'not-rendered') window._bpHqRendered = false;
            if (mutate === 'blank-headline') h.textContent = '';
            if (mutate === 'whitespace-headline') h.textContent = '   ';
            return _hqReadyForTour();
        } finally {
            window.BP = savedBP; window._bpHqRendered = savedFlag; h.textContent = savedText;
        }
    }, mutate);

    test('a rendered HQ, actually on screen, is ready', async () => {
        /* Baseline, and it earned its place: the first version of this test
           called renderDashboard() without navigating to the HQ, and the
           guard correctly said not-ready because #hq-today-card had zero
           geometry while step-0 was hidden. Every negative below would have
           passed for the wrong reason. The guard refusing to tour an
           off-screen HQ is desirable behaviour, not an obstacle. */
        await app.page.evaluate(async () => {
            goToStep(0);
            renderDashboard();
            await new Promise(r => setTimeout(r, 150));
        });
        expect(await ready(null)).toBe(true);
    }, 60_000);

    test('NO window.BP: NOT READY', async () => {
        /* The exact production condition. renderToday returns early, the card
           is the static markup, and the tour must not run. */
        expect(await ready('no-bp')).toBe(false);
    }, 60_000);

    test('HQ never rendered: NOT READY', async () => {
        expect(await ready('not-rendered')).toBe(false);
    }, 60_000);

    test('BLANK HEADLINE: NOT READY', async () => {
        /* The load bearing check: an empty headline is how the static markup
           is distinguished from a real render. */
        expect(await ready('blank-headline')).toBe(false);
    }, 60_000);

    test('a whitespace-only headline is also not ready', async () => {
        expect(await ready('whitespace-headline')).toBe(false);
    }, 60_000);

    test('and maybeStartTour does not open the overlay over a broken HQ', async () => {
        const o = await app.page.evaluate(async () => {
            try { localStorage.removeItem('bp_tour_done_' + currentUser.id); } catch (e) {}
            const savedBP = window.BP;
            window.BP = undefined;                 // break it the production way
            maybeStartTour();
            await new Promise(r => setTimeout(r, 300));
            const layer = document.getElementById('tour-layer');
            const open = !!layer && layer.classList.contains('show');
            window.BP = savedBP;
            return { open };
        });
        expect(o.open).toBe(false);
    }, 60_000);
});
