import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, visibleStep } from './harness.js';

/**
 * Ready, driven through every readiness answer in a real browser.
 *
 * The resolver's own precedence has 84 unit tests and is not re-asserted
 * here. What this file asserts is that the screen honours it: that the
 * answer changes the plan, that the change is visible, that high soreness
 * has no way around it from any surface, and that Ready and the Today card
 * never disagree.
 *
 * Today's weekday is whatever day the suite runs on, so each case writes the
 * slot it needs at `new Date().getDay()`.
 */

const WEEK = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
const UID = 'rdy';
const sorenessKey = () => `bp_soreness_${UID}_${new Date().toISOString().split('T')[0]}`;

/** Set the world up, open Ready, and report everything it is showing. */
async function ready(page, { type = 'length', soreness = null, sleep = null, draft = null, patch = {} } = {}) {
    return page.evaluate(({ type, soreness, sleep, draft, patch, WEEK, UID }) => {
        const d = new Date().getDay();
        persisted.schedule = [...WEEK];
        persisted.schedule[d] = type;
        persisted.completedDays = [false, false, false, false, false, false, false];
        persisted.primaryGoal = 'all';
        persisted.pelvicProfile = 'standard';
        persisted.firstSessionDate = '';
        persisted.allTimeSessionCount = 10;
        Object.assign(persisted, patch);

        const day = new Date().toISOString().split('T')[0];
        const sKey = `bp_soreness_${UID}_${day}`;
        const slKey = `bp_sleep_${UID}_${day}`;
        if (soreness) localStorage.setItem(sKey, soreness); else localStorage.removeItem(sKey);
        if (sleep) localStorage.setItem(slKey, sleep); else localStorage.removeItem(slKey);

        const dKey = `bp_session_draft_${UID}`;
        if (draft) localStorage.setItem(dKey, JSON.stringify({ savedAt: Date.now(), exerciseIndex: 0, setIndex: 1, ...draft }));
        else localStorage.removeItem(dKey);

        goToStep(1);

        const el = i => document.getElementById(i);
        const vis = i => !el(i).classList.contains('hidden');
        return {
            step: 'step-1',
            planned: vis('ready-planned') ? el('ready-planned').textContent.trim() : null,
            response: vis('ready-response')
                ? { title: el('ready-response-title').textContent.trim(), body: el('ready-response-body').textContent.trim() }
                : null,
            withheld: vis('ready-response-withheld') ? el('ready-response-withheld').textContent.trim() : null,
            safetyShort: el('ready-safety-short').textContent.trim(),
            safetyLongShown: vis('ready-safety-long'),
            cta: el('ready-cta').textContent.trim(),
            ctaDisabled: el('ready-cta').disabled,
            resolverState: currentPrescription().state,
            overrideAllowed: currentPrescription().overrideAllowed,
            draftStillStored: !!localStorage.getItem(`bp_session_draft_${UID}`),
        };
    }, { type, soreness, sleep, draft, patch, WEEK, UID });
}

const press = (page) => page.evaluate(() => document.getElementById('ready-cta').click());

describe('Ready: the soreness answer changes the plan', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('soreness is required: nothing moves until it is answered', async () => {
        const r = await ready(app.page);
        expect(r.ctaDisabled).toBe(true);
        expect(r.cta).toMatch(/soreness/i);
        await press(app.page);
        expect(await visibleStep(app.page)).toBe('step-1');
    });

    test('the planned mission is named before and after answering', async () => {
        expect((await ready(app.page)).planned).toBe('On the plan today: Length.');
        expect((await ready(app.page, { soreness: 'none' })).planned).toBe('On the plan today: Length.');
    });

    test('None leaves the prescription alone and adds no friction', async () => {
        const r = await ready(app.page, { soreness: 'none' });
        expect(r.resolverState).toBe('TRAIN');
        expect(r.response).toBeNull();
        expect(r.cta).toBe('START LENGTH SESSION');
        expect(r.ctaDisabled).toBe(false);
    });

    test('Mild leaves the prescription alone too', async () => {
        const r = await ready(app.page, { soreness: 'mild' });
        expect(r.resolverState).toBe('TRAIN');
        expect(r.response).toBeNull();
        expect(r.cta).toBe('START LENGTH SESSION');
    });

    test('Moderate reacts visibly and becomes MODIFIED', async () => {
        const r = await ready(app.page, { soreness: 'moderate' });
        expect(r.resolverState).toBe('MODIFIED');
        expect(r.response.title).toBe('Modified session');
        expect(r.response.body).toBe("You reported moderate muscle soreness, so today's volume is reduced.");
        expect(r.cta).toBe('START MODIFIED SESSION');
        // A conservative product heuristic, not a validated dose.
        expect(r.response.body).not.toMatch(/\d+\s*%|research|study|clinical/i);
    });

    test('High becomes RECOVER and says so without calling soreness an injury', async () => {
        const r = await ready(app.page, { soreness: 'high' });
        expect(r.resolverState).toBe('RECOVER');
        expect(r.response.title).toBe('Recovery today');
        expect(r.response.body).toMatch(/mechanical training is paused today/i);
        expect(r.response.body).not.toMatch(/injur|damage|scar|risk/i);
        expect(r.cta).toBe('START RECOVERY');
    });

    test('High offers no override back to mechanical work, from anywhere', async () => {
        const r = await ready(app.page, { soreness: 'high' });
        expect(r.overrideAllowed).toBe(false);
        // There is exactly one button out of Ready and it goes to recovery.
        const buttons = await app.page.evaluate(() =>
            [...document.querySelectorAll('#step-1 button')]
                .filter(b => !b.disabled && b.offsetParent !== null)
                .map(b => b.textContent.trim()));
        expect(buttons.filter(t => /length|girth|stamina|train anyway|continue/i.test(t))).toEqual([]);
    });

    test('High routes into the recovery picker, not the training funnel', async () => {
        await ready(app.page, { soreness: 'high' });
        await press(app.page);
        await app.page.waitForTimeout(250);
        const r = await app.page.evaluate(() => ({ type: session.routineType, step: session.step }));
        expect(r.type).toBe('recovery');
        expect(r.step).not.toBe(3);
    });
});

describe('Ready: the withheld session', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('a mechanical draft plus High is withheld, not resumed and not deleted', async () => {
        const r = await ready(app.page, { soreness: 'high', draft: { routineType: 'girth' } });
        expect(r.resolverState).toBe('RECOVER');
        expect(r.withheld).toBe('Your unfinished Girth session is paused, not deleted. It will still be there when the soreness settles.');
        expect(r.cta).toBe('START RECOVERY');
        // The draft survives, and the copy says so rather than sounding
        // like the app dropped it.
        expect(r.draftStillStored).toBe(true);
        expect(r.withheld).toMatch(/paused, not deleted/i);
        expect(r.withheld).toMatch(/still be there/i);
        expect(r.withheld).not.toMatch(/\blost\b|\bgone\b|discard/i);
    });

    test('no Resume control exists while the block is active', async () => {
        await ready(app.page, { soreness: 'high', draft: { routineType: 'length' } });
        const resumeVisible = await app.page.evaluate(() =>
            [...document.querySelectorAll('#step-1 button')]
                .some(b => b.offsetParent !== null && /resume/i.test(b.textContent)));
        expect(resumeVisible).toBe(false);
    });

    test('the HQ offers no Resume either while the block is active', async () => {
        await ready(app.page, { soreness: 'high', draft: { routineType: 'length' } });
        const hq = await app.page.evaluate(() => {
            goToStep(0);
            return {
                state: document.getElementById('hq-today-card').dataset.state,
                resumeHidden: document.getElementById('resume-btn').classList.contains('hidden'),
                launch: document.getElementById('launch-btn').classList.contains('hidden')
                    ? null : document.getElementById('launch-btn').textContent.trim(),
            };
        });
        expect(hq.state).toBe('RECOVER');
        expect(hq.resumeHidden).toBe(true);
        expect(hq.launch).toBe('START RECOVERY');
    });

    test('a RECOVERY draft plus High may still resume', async () => {
        // Withholding here would leave a sore member with nothing to finish
        // and nothing to do. The rule is about mechanical work.
        const r = await ready(app.page, { soreness: 'high', draft: { routineType: 'recovery' } });
        expect(r.resolverState).toBe('RESUME');
        expect(r.cta).toBe('RESUME SESSION');
        expect(r.withheld).toBeNull();
    });

    test('a draft whose type cannot be read is treated as mechanical', async () => {
        for (const routineType of [null, 'mystery']) {
            const r = await ready(app.page, { soreness: 'high', draft: { routineType } });
            expect(r.resolverState, String(routineType)).toBe('RECOVER');
            expect(r.cta).toBe('START RECOVERY');
        }
    });

    test('without High soreness the same draft resumes normally', async () => {
        const r = await ready(app.page, { soreness: 'none', draft: { routineType: 'girth' } });
        expect(r.resolverState).toBe('RESUME');
        expect(r.cta).toBe('RESUME SESSION');
    });
});

describe('Ready: the pelvic screener gate', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('RECOVER stays available to an unscreened member, with the requirement visible', async () => {
        // Safety routing must not be answered with a questionnaire.
        //
        // The recovery plan is the time-of-day recommendation, and only the
        // night set contains contraction work, so the gate is pinned to that
        // set rather than left to depend on the hour the suite runs at. The
        // morning and afternoon case is covered separately below.
        const r = await ready(app.page, { soreness: 'high', patch: { pelvicProfile: '' } });
        expect(r.resolverState).toBe('RECOVER');
        expect(r.cta).toBe('START RECOVERY');
        const flagged = await app.page.evaluate(() => {
            const orig = getDailyRecommendedUnfiltered;
            window.getDailyRecommendedUnfiltered = () => [0, 1, 2, 3];   // the night set
            goToStep(1);
            const out = {
                state: currentPrescription().state,
                cta: document.getElementById('ready-cta').textContent.trim(),
                required: currentPrescription().modifiers.pelvicScreenRequired,
                plan: currentPrescription().recoveryPlan,
                changes: currentPrescription().changes,
            };
            window.getDailyRecommendedUnfiltered = orig;
            return out;
        });
        // Still Recovery. The screener does not stand between a sore member
        // and something safe to do.
        expect(flagged.state).toBe('RECOVER');
        expect(flagged.cta).toBe('START RECOVERY');
        expect(flagged.required).toBe(true);
        // Contraction work removed, and named rather than silently dropped.
        expect(flagged.plan).not.toContain(0);
        expect(flagged.plan).not.toContain(3);
        expect(flagged.changes.join(' ')).toMatch(/pelvic floor check/i);
    });

    test('an unscreened member whose plan has no contraction work raises nothing', async () => {
        // The morning and afternoon recommendations are hip work only, so
        // there is nothing for the screener to gate. The standing prompt in
        // the nudge band still keeps it reachable.
        const r = await app.page.evaluate(() => {
            const orig = getDailyRecommendedUnfiltered;
            window.getDailyRecommendedUnfiltered = () => [4, 5];          // the morning set
            persisted.pelvicProfile = '';
            goToStep(1);
            const out = {
                state: currentPrescription().state,
                required: currentPrescription().modifiers.pelvicScreenRequired,
                plan: currentPrescription().recoveryPlan,
            };
            window.getDailyRecommendedUnfiltered = orig;
            return out;
        });
        expect(r.required).toBe(false);
        expect(r.plan).toEqual([4, 5]);
    });

    test('the standing screener prompt is still reachable on the HQ', async () => {
        const shown = await app.page.evaluate(() => {
            persisted.pelvicProfile = '';
            _coachNudgeLive = false; _passUsedThisRender = false;
            goToStep(0);
            return [...document.getElementById('hq-nudge-band').children]
                .filter(c => !c.classList.contains('hidden')).map(c => c.id);
        });
        expect(shown).toEqual(['hq-pelvic-prompt']);
    });

    test('a pelvic-specific prescription plus an unscreened member becomes PREPARE', async () => {
        // The Phase 2B shape: a scheduled pelvic training day.
        const r = await app.page.evaluate(() => {
            const d = new Date().getDay();
            persisted.schedule = ['rest', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest'];
            persisted.schedule[d] = 'pelvic';
            persisted.primaryGoal = 'all';
            persisted.pelvicProfile = '';
            localStorage.setItem(`bp_soreness_rdy_${new Date().toISOString().split('T')[0]}`, 'none');
            localStorage.removeItem('bp_session_draft_rdy');
            /* The known-set seam, widened where it now lives.
               Phase 3C.4 moved the "which values count as training" question
               out of the resolver and into the Today-prescription adapter, so
               widening trainingMissions alone no longer reaches it: the
               prescription is already resolved by the time buildResolverInput
               returns, and 'pelvic' would come back unresolved. The override
               therefore re-resolves it with the wider vocabulary, which is
               what the adapter's primaryTypes option exists for. Both
               resolver lists stay, because the screener gate still reads
               pelvicMissions. Reachable and provable before 2B ships. */
            const orig = buildResolverInput;
            const WIDE = ['length', 'girth', 'stamina', 'pelvic'];
            window.buildResolverInput = () => ({ ...orig(),
                todayPrescription: window.BP.todayPrescription({
                    now: new Date(),
                    authoritative: onAuthoritativePlans(),
                    dayPlans: persisted.dayPlans,
                    legacySchedule: persisted.schedule,
                    primaryTypes: WIDE,
                }),
                trainingMissions: WIDE,
                pelvicMissions: ['recovery', 'pelvic'] });
            goToStep(1);
            const out = {
                state: currentPrescription().state,
                prepare: currentPrescription().prepare,
                cta: document.getElementById('ready-cta').textContent.trim(),
                title: document.getElementById('ready-response-title').textContent.trim(),
                body: document.getElementById('ready-response-body').textContent.trim(),
                shown: !document.getElementById('ready-response').classList.contains('hidden'),
            };
            window.buildResolverInput = orig;
            return out;
        });
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe('pelvic-screen');
        expect(r.shown).toBe(true);
        expect(r.title).toBe('Before we personalise this');
        expect(r.body).toMatch(/pelvic floor check before prescribing contraction work/i);
        expect(r.cta).toBe('TAKE THE CHECK');
        // Explains the consequence, and is not a diagnosis.
        expect(r.body).toMatch(/not a medical diagnosis/i);
    });
});

describe('Ready: sleep, safety copy and storage', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('sleep is optional and does not gate the CTA', async () => {
        const r = await ready(app.page, { soreness: 'none' });
        expect(r.ctaDisabled).toBe(false);
    });

    test('sleep does not change the prescription', async () => {
        const without = await ready(app.page, { soreness: 'none' });
        for (const sleep of ['poor', 'okay', 'good', 'great']) {
            const r = await ready(app.page, { soreness: 'none', sleep });
            expect(r.resolverState, sleep).toBe(without.resolverState);
            expect(r.cta).toBe(without.cta);
            expect(r.response).toBeNull();
        }
    });

    test('sleep is still recorded for Coach Tee and the nudge', async () => {
        await ready(app.page, { soreness: 'none' });
        const stored = await app.page.evaluate(() => {
            document.querySelector('[data-sleep="poor"]').click();
            return localStorage.getItem(getTodaySleepKey());
        });
        expect(stored).toBe('poor');
    });

    test('the long stop-signal text shows for the first three sessions', async () => {
        for (const n of [0, 1, 2]) {
            const r = await ready(app.page, { soreness: 'none', patch: { allTimeSessionCount: n } });
            expect(r.safetyLongShown, `session ${n}`).toBe(true);
        }
    });

    test('and compacts after that, without disappearing', async () => {
        for (const n of [3, 10, 400]) {
            const r = await ready(app.page, { soreness: 'none', patch: { allTimeSessionCount: n } });
            expect(r.safetyLongShown, `session ${n}`).toBe(false);
            expect(r.safetyShort).toMatch(/sharp, electric, stinging, joint, or nerve-like/i);
        }
    });

    test('the short text names what the scale is not measuring', async () => {
        const r = await ready(app.page, { soreness: 'none' });
        expect(r.safetyShort).toMatch(/this check is for muscle soreness/i);
        // Concise and non-alarmist: no diagnosis, no catastrophising.
        expect(r.safetyShort).not.toMatch(/injury|damage|emergency|serious/i);
    });

    test('readiness is per user and per day', async () => {
        const keys = await app.page.evaluate(() => {
            localStorage.clear();
            const d = new Date().toISOString().split('T')[0];
            setSoreness('high');
            return { key: getTodaySorenessKey(), expected: `bp_soreness_rdy_${d}`, value: localStorage.getItem(getTodaySorenessKey()) };
        });
        expect(keys.key).toBe(keys.expected);
        expect(keys.value).toBe('high');
    });

    test('yesterday’s answer does not carry into today', async () => {
        const r = await app.page.evaluate(() => {
            localStorage.clear();
            const y = new Date(Date.now() - 86400000).toISOString().split('T')[0];
            localStorage.setItem(`bp_soreness_rdy_${y}`, 'high');
            persisted.schedule[new Date().getDay()] = 'length';
            persisted.primaryGoal = 'all';
            goToStep(1);
            return {
                answered: !!localStorage.getItem(getTodaySorenessKey()),
                disabled: document.getElementById('ready-cta').disabled,
                state: currentPrescription().state,
            };
        });
        expect(r.answered).toBe(false);
        expect(r.disabled).toBe(true);
        expect(r.state).toBe('TRAIN');
    });

    test('another member’s answer does not leak into this one', async () => {
        const r = await app.page.evaluate(() => {
            localStorage.clear();
            const d = new Date().toISOString().split('T')[0];
            localStorage.setItem(`bp_soreness_someoneelse_${d}`, 'high');
            persisted.schedule[new Date().getDay()] = 'length';
            persisted.primaryGoal = 'all';
            goToStep(1);
            return { answered: !!localStorage.getItem(getTodaySorenessKey()), state: currentPrescription().state };
        });
        expect(r.answered).toBe(false);
        expect(r.state).toBe('TRAIN');
    });
});

describe('Ready and the Today card stay in step', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test.each([
        ['none', 'TRAIN', 'Length Day'],
        ['mild', 'TRAIN', 'Length Day'],
        ['moderate', 'MODIFIED', 'Modified Session'],
        ['high', 'RECOVER', 'Recovery'],
    ])('answering %s in Ready leaves the HQ saying %s', async (soreness, state, headline) => {
        await ready(app.page, { type: 'length' });
        const r = await app.page.evaluate(s => {
            document.querySelector(`[data-soreness="${s}"]`).click();
            const readyState = currentPrescription().state;
            goToStep(0);
            return {
                readyState,
                hqState: document.getElementById('hq-today-card').dataset.state,
                hqHeadline: document.getElementById('today-headline').textContent.trim(),
            };
        }, soreness);
        expect(r.readyState).toBe(state);
        expect(r.hqState).toBe(state);
        expect(r.hqHeadline).toBe(headline);
    }, 30_000);

    test('there is no surface left that still reports the old prescription', async () => {
        // The daily check-in used to live on the HQ and the warning modal
        // used to recommend Recovery beside a Dismiss button. Both are gone.
        const leftovers = await app.page.evaluate(() => ({
            checkinCard: !!document.getElementById('hq-checkin-card'),
            warningModal: !!document.getElementById('soreness-warning-modal'),
            dismiss: !!document.getElementById('soreness-dismiss-btn'),
            primed: !!document.getElementById('primed-btn'),
        }));
        expect(leftovers).toEqual({ checkinCard: false, warningModal: false, dismiss: false, primed: false });
    });

    test('the soreness controls exist exactly once, on Ready', async () => {
        const r = await app.page.evaluate(() => ({
            groups: document.querySelectorAll('#soreness-btns').length,
            buttons: document.querySelectorAll('[data-soreness]').length,
            insideReady: [...document.querySelectorAll('[data-soreness]')]
                .every(b => document.getElementById('step-1').contains(b)),
        }));
        expect(r.groups).toBe(1);
        expect(r.buttons).toBe(4);
        expect(r.insideReady).toBe(true);
    });
});
