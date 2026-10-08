import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Phase 2A.4: the prescribed session starts without being reconfirmed, and
 * the manual path stays open without becoming a way around safety.
 *
 * Step numbers matter here, so they are named once:
 *   0 HQ   1 Ready   2 Warmup   3 Mission Select   4 Engine   5 Success
 * Length and Girth warm up first, so they land on 2. Stamina goes to 4.
 * Recovery goes to its own picker, step-3b, which is not a numbered step.
 */

const WEEK = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
const UID = 'byp';

/** Put `type` on today, set soreness, and land on the HQ. */
async function hq(page, { type = 'length', soreness = null, draft = null, patch = {} } = {}) {
    return page.evaluate(({ type, soreness, draft, patch, WEEK, UID }) => {
        const d = new Date().getDay();
        /* Phase 3C.3. The legacy authority path, where this seeded column IS
           the programme. `null` would mean unclassified, and an unclassified
           member is cut over by the authority transition at the top of
           renderDashboard, which would replace the slot just written here.
           See legacyProgramme in harness.js. */
        persisted.programme = window.__legacyProgramme();
        persisted.dayPlans = [];
        persisted.schedule = [...WEEK];
        persisted.schedule[d] = type;
        persisted.completedDays = [false, false, false, false, false, false, false];
        persisted.primaryGoal = 'all';
        persisted.pelvicProfile = 'standard';
        persisted.firstSessionDate = '';
        persisted.allTimeSessionCount = 10;
        persisted.sessionLog = [];
        Object.assign(persisted, patch);

        const day = new Date().toISOString().split('T')[0];
        const sKey = `bp_soreness_${UID}_${day}`;
        if (soreness) localStorage.setItem(sKey, soreness); else localStorage.removeItem(sKey);

        const dKey = `bp_session_draft_${UID}`;
        if (draft) localStorage.setItem(dKey, JSON.stringify({ savedAt: Date.now(), exerciseIndex: 0, setIndex: 1, ...draft }));
        else localStorage.removeItem(dKey);

        session._aborting = true; goToStep(0); session._aborting = false;
        localStorage.removeItem(dKey);
        if (draft) localStorage.setItem(dKey, JSON.stringify({ savedAt: Date.now(), exerciseIndex: 0, setIndex: 1, ...draft }));
        renderDashboard();

        const btn = id => document.getElementById(id);
        return {
            state: btn('hq-today-card').dataset.state,
            launch: btn('launch-btn').classList.contains('hidden') ? null : btn('launch-btn').textContent.trim(),
            altShown: !btn('today-alt-btn').classList.contains('hidden'),
        };
    }, { type, soreness, draft, patch, WEEK, UID });
}

/** HQ START, then Ready CTA. Returns where it landed. */
const runPrescribed = (page) => page.evaluate(() => {
    document.getElementById('launch-btn').click();
    const atReady = session.step;
    document.getElementById('ready-cta').click();
    return { atReady, step: session.step, routineType: session.routineType };
});

describe('the prescribed session bypasses Mission Select', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test.each([
        ['length', 2],
        ['girth', 2],
        ['stamina', 4],
    ])('prescribed %s goes HQ to Ready to the session, never through step 3', async (type, landing) => {
        const card = await hq(app.page, { type, soreness: 'none' });
        expect(card.launch).toBe(`START ${type.toUpperCase()} SESSION`);
        const r = await runPrescribed(app.page);
        expect(r.atReady).toBe(1);          // Ready is not skipped
        expect(r.step).toBe(landing);       // and Mission Select is
        expect(r.step).not.toBe(3);
        expect(r.routineType).toBe(type);
    }, 30_000);

    test('girth arrives with its circuit already configured', async () => {
        await hq(app.page, { type: 'girth', soreness: 'none' });
        await runPrescribed(app.page);
        const rounds = await app.page.evaluate(() => session.girthTotalRounds);
        expect(rounds).toBeGreaterThan(0);
    }, 30_000);

    test('Recovery bypasses Mission Select too', async () => {
        await hq(app.page, { type: 'length', soreness: 'high' });
        const r = await runPrescribed(app.page);
        expect(r.atReady).toBe(1);
        expect(r.routineType).toBe('recovery');
        const inPicker = await app.page.evaluate(() =>
            !document.getElementById('step-3b').classList.contains('hidden-step'));
        expect(inPicker).toBe(true);
    }, 30_000);

    test('Resume still follows the approved Ready path', async () => {
        await hq(app.page, { type: 'length', soreness: null, draft: { routineType: 'girth' } });
        const r = await app.page.evaluate(() => {
            document.getElementById('resume-btn').click();
            const atReady = session.step;
            const ctaBefore = document.getElementById('ready-cta').disabled;
            document.querySelector('[data-soreness="none"]').click();
            const label = document.getElementById('ready-cta').textContent.trim();
            document.getElementById('ready-cta').click();
            return { atReady, ctaBefore, label, step: session.step, routineType: session.routineType };
        });
        expect(r.atReady).toBe(1);
        expect(r.ctaBefore).toBe(true);     // soreness still required
        expect(r.label).toBe('RESUME SESSION');
        expect(r.step).toBe(4);
        expect(r.routineType).toBe('girth');
    }, 30_000);

    test('nothing routes HQ straight into the engine', async () => {
        const r = await hq(app.page, { type: 'length', soreness: 'none' });
        expect(r.state).toBe('TRAIN');
        const step = await app.page.evaluate(() => {
            document.getElementById('launch-btn').click();
            return session.step;
        });
        expect(step).toBe(1);
    }, 30_000);
});

describe('Something else: the manual override', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('it is offered on TRAIN and MODIFIED only', async () => {
        expect((await hq(app.page, { type: 'length', soreness: 'none' })).altShown).toBe(true);
        expect((await hq(app.page, { type: 'length', soreness: 'moderate' })).altShown).toBe(true);
        // Offering an alternative on these four is offering a way around the
        // reason each of them exists.
        expect((await hq(app.page, { type: 'length', soreness: 'high' })).altShown).toBe(false);
        expect((await hq(app.page, { type: 'rest', soreness: 'none' })).altShown).toBe(false);
        expect((await hq(app.page, {
            type: 'length', soreness: 'none',
            patch: { completedDays: [0, 1, 2, 3, 4, 5, 6].map(i => i === new Date().getDay()) },
        })).altShown).toBe(false);
        expect((await hq(app.page, { type: 'length', soreness: 'none', patch: { primaryGoal: '' } })).altShown).toBe(false);
    }, 40_000);

    test('it never competes with the primary call to action', async () => {
        await hq(app.page, { type: 'length', soreness: 'none' });
        const r = await app.page.evaluate(() => {
            const primary = document.getElementById('launch-btn');
            const alt = document.getElementById('today-alt-btn');
            const ps = getComputedStyle(primary), as = getComputedStyle(alt);
            return {
                primaryClasses: primary.className,
                altClasses: alt.className,
                primaryFont: parseFloat(ps.fontSize),
                altFont: parseFloat(as.fontSize),
                altAfterPrimary: !!(primary.compareDocumentPosition(alt) & Node.DOCUMENT_POSITION_FOLLOWING),
            };
        });
        expect(r.primaryClasses).toContain('btn-primary');
        expect(r.altClasses).not.toContain('btn-primary');
        expect(r.altFont).toBeLessThan(r.primaryFont);
        expect(r.altAfterPrimary).toBe(true);
    }, 30_000);

    test('it opens Mission Select, which says what the recommendation was', async () => {
        await hq(app.page, { type: 'length', soreness: 'none' });
        const r = await app.page.evaluate(() => {
            document.getElementById('today-alt-btn').click();
            return {
                step: session.step,
                heading: document.querySelector('#step-3 h2').textContent.trim(),
                note: document.getElementById('mission-override-note').textContent.trim(),
            };
        });
        expect(r.step).toBe(3);
        // Not "select today's mission": the app has a recommendation and says so.
        expect(r.heading).toBe('Choose A Different Session');
        expect(r.note).toMatch(/recommendation is Length/i);
    }, 30_000);

    test('a manual mechanical choice runs, and is recorded as a departure', async () => {
        await hq(app.page, { type: 'length', soreness: 'none' });
        const r = await app.page.evaluate(() => {
            document.getElementById('today-alt-btn').click();
            document.getElementById('mission-girth-btn').click();
            return { step: session.step, routineType: session.routineType };
        });
        expect(r.routineType).toBe('girth');
        expect(r.step).toBe(2);
    }, 30_000);

    test('a manual choice made before answering soreness still goes through Ready', async () => {
        await hq(app.page, { type: 'length', soreness: null });
        const r = await app.page.evaluate(() => {
            goToStep(3);
            document.getElementById('mission-girth-btn').click();
            const atReady = session.step;
            const ctaBefore = document.getElementById('ready-cta').disabled;
            const planned = document.getElementById('ready-planned').textContent.trim();
            document.querySelector('[data-soreness="none"]').click();
            const label = document.getElementById('ready-cta').textContent.trim();
            document.getElementById('ready-cta').click();
            return { atReady, ctaBefore, planned, label, step: session.step, routineType: session.routineType };
        });
        expect(r.atReady).toBe(1);
        expect(r.ctaBefore).toBe(true);
        // Ready names the choice without pretending it prescribed it.
        expect(r.planned).toBe('Your choice: Girth. On the plan today: Length.');
        expect(r.label).toBe('START GIRTH SESSION');
        expect(r.routineType).toBe('girth');
        expect(r.step).toBe(2);
    }, 30_000);

    test('the override is about one session and does not touch the schedule', async () => {
        const before = await app.page.evaluate(() => [...persisted.schedule]);
        await hq(app.page, { type: 'length', soreness: 'none' });
        const after = await app.page.evaluate(() => {
            document.getElementById('today-alt-btn').click();
            document.getElementById('mission-girth-btn').click();
            return [...persisted.schedule];
        });
        expect(after[new Date().getDay()]).toBe('length');
        expect(after).toEqual(before.map((t, i) => (i === new Date().getDay() ? 'length' : t)));
    }, 30_000);

    test('going home ends the override', async () => {
        await hq(app.page, { type: 'length', soreness: 'none' });
        const r = await app.page.evaluate(() => {
            document.getElementById('today-alt-btn').click();
            document.getElementById('mission-girth-btn').click();
            const during = _manualMission;
            session._aborting = true; goToStep(0); session._aborting = false;
            return { during, after: _manualMission };
        });
        expect(r.during).toBe('girth');
        expect(r.after).toBeNull();
    }, 30_000);
});

describe('the override cannot route around safety', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('High soreness disables every mechanical mission on the override screen', async () => {
        await hq(app.page, { type: 'length', soreness: 'high' });
        const r = await app.page.evaluate(() => {
            goToStep(3);
            return {
                length: document.getElementById('mission-length-btn').disabled,
                girth: document.getElementById('mission-girth-btn').disabled,
                stamina: document.getElementById('mission-stamina-btn').disabled,
                recovery: document.getElementById('mission-recovery-btn').disabled,
                note: document.getElementById('mission-blocked-text').textContent.trim(),
                noteShown: !document.getElementById('mission-blocked-note').classList.contains('hidden'),
            };
        });
        expect(r.length).toBe(true);
        expect(r.girth).toBe(true);
        expect(r.stamina).toBe(true);
        // Recovery is the prescription, so it stays open.
        expect(r.recovery).toBe(false);
        expect(r.noteShown).toBe(true);
        expect(r.note).toMatch(/high muscle soreness/i);
        expect(r.note).not.toMatch(/injur|damage|risk/i);
    }, 30_000);

    test('even a manual mission set before the soreness report is overridden', async () => {
        // Pick Girth while feeling fine, report high soreness at Ready, and
        // the choice must not survive the report.
        await hq(app.page, { type: 'length', soreness: null });
        const r = await app.page.evaluate(() => {
            goToStep(3);
            document.getElementById('mission-girth-btn').click();     // -> Ready
            document.querySelector('[data-soreness="high"]').click();
            const label = document.getElementById('ready-cta').textContent.trim();
            document.getElementById('ready-cta').click();
            return { label, routineType: session.routineType, override: currentPrescription().overrideAllowed };
        });
        expect(r.label).toBe('START RECOVERY');
        expect(r.routineType).toBe('recovery');
        expect(r.override).toBe(false);
    }, 30_000);

    test('a safety state never advertises the manual choice it is overriding', async () => {
        // readyPlan() hardcodes recovery for RECOVER, so the routing is safe
        // whatever effectiveMission() says. The screen is not: without the
        // guard, Ready would read "Your choice: Girth" above a button that
        // says START RECOVERY. One screen, two answers.
        await hq(app.page, { type: 'length', soreness: null });
        const r = await app.page.evaluate(() => {
            goToStep(3);
            document.getElementById('mission-girth-btn').click();   // -> Ready
            document.querySelector('[data-soreness="high"]').click();
            return {
                planned: document.getElementById('ready-planned').textContent.trim(),
                cta: document.getElementById('ready-cta').textContent.trim(),
                effective: effectiveMission(currentPrescription()),
            };
        });
        expect(r.cta).toBe('START RECOVERY');
        expect(r.effective).toBe('recovery');
        expect(r.planned).not.toMatch(/your choice/i);
        expect(r.planned).not.toMatch(/girth/i);
    }, 30_000);

    test('a rest day still disables every mechanical mission', async () => {
        await hq(app.page, { type: 'rest', soreness: 'none' });
        const r = await app.page.evaluate(() => {
            goToStep(3);
            return {
                length: document.getElementById('mission-length-btn').disabled,
                blackout: !document.getElementById('blackout-banner').classList.contains('hidden'),
            };
        });
        expect(r.length).toBe(true);
        expect(r.blackout).toBe(true);
    }, 30_000);
});

describe('the pelvic padlock explains itself', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('an unscreened member gets the reason, not six questions', async () => {
        const r = await app.page.evaluate(() => {
            persisted.pelvicProfile = '';
            goToRecoveryPicker();
            toggleRecoveryEx(0);                       // a contraction exercise
            return {
                sheet: !document.getElementById('pelvic-lock-modal').classList.contains('hidden'),
                screener: !document.getElementById('pelvic-screen-modal').classList.contains('hidden'),
                title: document.getElementById('pelvic-lock-title').textContent.trim(),
                body: document.getElementById('pelvic-lock-body').textContent.trim(),
                cta: document.getElementById('pelvic-lock-take').textContent.trim(),
            };
        });
        expect(r.sheet).toBe(true);
        expect(r.screener).toBe(false);
        expect(r.title).toBe('Pelvic Check Required');
        expect(r.body).toMatch(/before prescribing contraction work/i);
        expect(r.body).toMatch(/not a diagnosis/i);
        expect(r.cta).toBe('TAKE THE CHECK');
    }, 30_000);

    test('Not now closes it and selects nothing', async () => {
        const r = await app.page.evaluate(() => {
            document.getElementById('pelvic-lock-close').click();
            return {
                sheet: !document.getElementById('pelvic-lock-modal').classList.contains('hidden'),
                selected: selectedRecoveryIndices.includes(0),
            };
        });
        expect(r.sheet).toBe(false);
        expect(r.selected).toBe(false);
    }, 30_000);

    test('the CTA opens the screener, and answering returns to the picker unlocked', async () => {
        const r = await app.page.evaluate(() => {
            persisted.pelvicProfile = '';
            goToRecoveryPicker();
            toggleRecoveryEx(0);
            document.getElementById('pelvic-lock-take').click();
            // Answer no to everything: a standard profile, which unlocks it.
            [...document.querySelectorAll('#pelvic-screen-questions [data-screen-q]')]
                .forEach(row => row.querySelector('[data-screen-a="no"]').click());
            document.getElementById('pelvic-screen-submit').click();
            document.getElementById('pelvic-result-ok').click();
            const card = document.querySelector('.ex-pick-card[data-idx="0"]');
            return {
                profile: persisted.pelvicProfile,
                inPicker: !document.getElementById('step-3b').classList.contains('hidden-step'),
                stillLocked: card.classList.contains('pick-locked'),
                blocked: isExerciseBlocked(0),
            };
        });
        expect(r.profile).toBe('standard');
        // Back where they were, with the answer applied.
        expect(r.inPicker).toBe(true);
        expect(r.blocked).toBe(false);
        expect(r.stillLocked).toBe(false);
    }, 30_000);

    test('a tight profile gets a different explanation, not the same prompt', async () => {
        const r = await app.page.evaluate(() => {
            persisted.pelvicProfile = 'tight';
            goToRecoveryPicker();
            toggleRecoveryEx(0);
            return {
                title: document.getElementById('pelvic-lock-title').textContent.trim(),
                body: document.getElementById('pelvic-lock-body').textContent.trim(),
                cta: document.getElementById('pelvic-lock-take').textContent.trim(),
            };
        });
        expect(r.title).toBe('Contraction Work Paused');
        expect(r.body).toMatch(/tends to hold tension/i);
        expect(r.body).toMatch(/release work is open/i);
        expect(r.cta).toBe('RETAKE THE CHECK');
    }, 30_000);

    test('an unlocked exercise still just toggles', async () => {
        const r = await app.page.evaluate(() => {
            persisted.pelvicProfile = 'standard';
            goToRecoveryPicker();
            selectedRecoveryIndices = [];
            toggleRecoveryEx(5);                       // a hip stretch
            return {
                sheet: !document.getElementById('pelvic-lock-modal').classList.contains('hidden'),
                selected: selectedRecoveryIndices.includes(5),
            };
        });
        expect(r.sheet).toBe(false);
        expect(r.selected).toBe(true);
    }, 30_000);
});

describe('schedule repair and manual-session accounting', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: UID }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('an unreadable schedule still offers a working repair, and points at the week', async () => {
        const r = await hq(app.page, { type: 'mystery', soreness: 'none' });
        expect(r.state).toBe('PREPARE');
        const detail = await app.page.evaluate(() => ({
            cta: document.getElementById('today-prepare-btn').textContent.trim(),
            hint: document.getElementById('today-prepare-hint').textContent.trim(),
            hintShown: !document.getElementById('today-prepare-hint').classList.contains('hidden'),
        }));
        // The CTA promises today, because that is what it does.
        expect(detail.cta).toBe("FIX TODAY'S PLAN");
        // And the week calendar, which has always been a full weekly editor,
        // is pointed at rather than rebuilt.
        expect(detail.hintShown).toBe(true);
        expect(detail.hint).toMatch(/tap any day in your week/i);
    }, 30_000);

    test('repairing today resolves the state and lets the member continue', async () => {
        await hq(app.page, { type: 'mystery', soreness: 'none' });
        const r = await app.page.evaluate(() => {
            document.getElementById('today-prepare-btn').click();
            const modalOpen = !document.getElementById('type-modal').classList.contains('hidden');
            // The picker writes the chosen type for the selected day.
            persisted.schedule[session.selectedDayIdx] = 'girth';
            document.getElementById('type-modal').classList.add('hidden');
            renderDashboard();
            return {
                modalOpen,
                state: document.getElementById('hq-today-card').dataset.state,
                launch: document.getElementById('launch-btn').textContent.trim(),
            };
        });
        expect(r.modalOpen).toBe(true);
        expect(r.state).toBe('TRAIN');
        expect(r.launch).toBe('START GIRTH SESSION');
    }, 30_000);

    test('a substituted session is recorded as such in the log', async () => {
        const entry = await app.page.evaluate(() => {
            const d = new Date().getDay();
            persisted.schedule[d] = 'length';
            persisted.sessionLog = [];
            session.routineType = 'girth';
            // What completeSession() records, without running the whole screen.
            return {
                scheduledType: getScheduledType(),
                routineType: session.routineType,
                manualOverride: session.routineType !== getScheduledType(),
            };
        });
        expect(entry).toEqual({ scheduledType: 'length', routineType: 'girth', manualOverride: true });
    }, 30_000);

    test('the calendar marks a substituted day instead of claiming the scheduled work', async () => {
        // completedDays has one slot per weekday and cannot hold which
        // mission was done, so the log is the only record. The cell still
        // reads as completed, because it was, but it no longer asserts that
        // the scheduled mission specifically was performed.
        const r = await app.page.evaluate(() => {
            const d = new Date().getDay();
            persisted.schedule[d] = 'length';
            persisted.completedDays[d] = true;
            persisted.sessionLog = [{ date: new Date().toISOString(), routineType: 'girth',
                                      scheduledType: 'length', manualOverride: true }];
            renderDashboard();
            const cell = document.querySelectorAll('#dashboard-grid .calendar-day')[d];
            return { substituted: cell.dataset.substituted, title: cell.title,
                     completed: cell.classList.contains('completed') };
        });
        expect(r.completed).toBe(true);
        expect(r.substituted).toBe('1');
        expect(r.title).toBe('Girth done instead of Length');
    }, 30_000);

    test('a session matching the schedule is not marked as a substitution', async () => {
        const r = await app.page.evaluate(() => {
            const d = new Date().getDay();
            persisted.schedule[d] = 'length';
            persisted.completedDays[d] = true;
            persisted.sessionLog = [{ date: new Date().toISOString(), routineType: 'length',
                                      scheduledType: 'length', manualOverride: false }];
            renderDashboard();
            const cell = document.querySelectorAll('#dashboard-grid .calendar-day')[d];
            return { substituted: cell.dataset.substituted, title: cell.title };
        });
        expect(r.substituted).toBeUndefined();
        expect(r.title).toBe('');
    }, 30_000);

    test('an override from a previous week does not mark this week', async () => {
        const r = await app.page.evaluate(() => {
            const d = new Date().getDay();
            persisted.schedule[d] = 'length';
            persisted.completedDays[d] = true;
            persisted.sessionLog = [{ date: new Date(Date.now() - 14 * 86400000).toISOString(),
                                      routineType: 'girth', scheduledType: 'length', manualOverride: true }];
            renderDashboard();
            const cell = document.querySelectorAll('#dashboard-grid .calendar-day')[d];
            return cell.dataset.substituted;
        });
        expect(r).toBeUndefined();
    }, 30_000);

    test('DOCUMENTED LIMITATION: a substitution still counts toward the weekly target', async () => {
        // completedDays is one boolean per weekday, so the week counter
        // cannot tell a substituted session from the scheduled one. This
        // pins the current behaviour rather than endorsing it; see the report.
        const r = await app.page.evaluate(() => {
            const d = new Date().getDay();
            persisted.schedule = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
            persisted.schedule[d] = 'length';
            persisted.completedDays = [false, false, false, false, false, false, false];
            persisted.completedDays[d] = true;
            persisted.sessionLog = [{ date: new Date().toISOString(), routineType: 'girth',
                                      scheduledType: 'length', manualOverride: true }];
            renderDashboard();
            return document.getElementById('hq-week-label').textContent.trim();
        });
        expect(r).toMatch(/^1 of \d+ this week$/);
    }, 30_000);
});
