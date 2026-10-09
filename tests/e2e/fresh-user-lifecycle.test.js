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
