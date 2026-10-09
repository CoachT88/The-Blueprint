import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Execution authority, through the real engine.
 *
 * The pure suite proves the arithmetic and the refusals. This proves the one
 * question the phase exists to answer: when the app says "this is your
 * session", does it execute that exact prescription without consulting a
 * second source of truth?
 *
 * So the shape of nearly every test here is the same. Launch. Then change the
 * thing that used to rewrite the session underneath the member: the tier, the
 * tables, the clock, the deload state, today's soreness, the plans
 * themselves. Then read what the engine actually runs.
 */

const THU       = new Date(Date.UTC(2026, 2, 12, 12));
const THU_2350  = new Date(Date.UTC(2026, 2, 12, 23, 50));
const FRI_0010  = new Date(Date.UTC(2026, 2, 13, 0, 10));
const SIZE = ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'];

const row = (over = {}) => ({
    id: 'ex', total_xp: 500, difficulty: 'intermediate', schedule: SIZE,
    completed_days: [false, false, false, false, false, false, false],
    session_log: [], measurements: [], seen_milestones: [],
    all_time_session_count: 20, xp_migrated: true, week_key: '',
    primary_goal: 'size', programme: null, day_plans: [], pelvic_profile: 'standard',
    updated_at: '2026-03-12T00:00:00.000Z', ...over,
});

/** Load through the real loadPersisted, then render once. */
const load = (page, serverRow) => page.evaluate(async (r) => {
    try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
    try { localStorage.removeItem(getTodaySorenessKey()); } catch (e) {}
    try { localStorage.removeItem('bp_session_draft_' + currentUser.id); } catch (e) {}
    window.__row = r;
    await loadPersisted();
    renderDashboard();
    const key = window.BP.planDateKey(new Date());
    const plan = persisted.dayPlans.find(p => p.date === key);
    return { key, type: plan && plan.primarySession && plan.primarySession.type,
             dose: plan && plan.primarySession && plan.primarySession.dose };
}, serverRow);

/** Launch today's prescribed session through the real door. */
const launch = (page) => page.evaluate(() => {
    const r = window.BP.nextBestAction(buildResolverInput());
    readyPlan(r).go();
    return { state: r.state, launched: session.routineType,
             snapshot: _launchedPrescription ? JSON.parse(JSON.stringify(_launchedPrescription)) : null };
});

/** What the engine will actually run, right now, step by step. */
const engineSteps = (page) => page.evaluate(() => {
    const out = [];
    const was = session.exerciseIndex;
    for (let i = 0; i < ROUTINES[session.routineType].length; i++) {
        session.exerciseIndex = i;
        const ex = getCurEx();
        out.push({ title: ex.title, sets: ex.sets, duration: ex.duration,
                   restDur: ex.restDur === undefined ? null : ex.restDur });
    }
    session.exerciseIndex = was;
    return { steps: out, rounds: session.girthTotalRounds,
             stepCount: executableStepCount() };
});

describe('the stored dose is what executes', () => {
    let app, loaded;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex', loaded: false });
        loaded = await load(app.page, row());
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('the member really is on a dated girth plan with a stored dose', () => {
        expect(loaded.type).toBe('girth');
        expect(loaded.dose).toMatchObject({ v: 1, shape: 'circuit', rounds: 4, restDur: 45 });
    });

    test('the launch freezes the baseline, with no modifier on an ordinary day', async () => {
        const l = await launch(app.page);
        expect(l.state).toBe('TRAIN');
        expect(l.launched).toBe('girth');
        expect(l.snapshot.appliedModifiers).toEqual([]);
        expect(l.snapshot.prescribedDose).toMatchObject({ rounds: 4, restDur: 45 });
        expect(l.snapshot.executionDose).toEqual(l.snapshot.prescribedDose);
        expect(l.snapshot.doseVersion).toBe(1);
        expect(l.snapshot.performedType).toBe('girth');
        expect(l.snapshot.xpTier).toBe('intermediate');
    }, 60_000);

    test('and the engine runs exactly those numbers', async () => {
        const e = await engineSteps(app.page);
        expect(e.steps).toEqual([
            { title: 'Wet Jelq', sets: 1, duration: 120, restDur: 40 },
            { title: 'Uli — Manual Clamp', sets: 1, duration: 45, restDur: 20 },
        ]);
        expect(e.rounds).toBe(4);
        expect(e.stepCount).toBe(2);
    }, 60_000);

    test('A TIER ADVANCE AFTER LAUNCH CHANGES NOTHING', async () => {
        /* The defect this phase removes. getCurEx rebuilt the session from
           the CURRENT tier on every read, so advancing to elite mid-session
           used to rewrite a prescription that had already been made. */
        const after = await app.page.evaluate(() => {
            persisted.difficulty = 'elite';
            return { tier: getDiff().id };
        });
        expect(after.tier).toBe('elite');
        const e = await engineSteps(app.page);
        expect(e.steps.map(s => s.duration)).toEqual([120, 45]);   // intermediate, not elite's 180/60
        expect(e.rounds).toBe(4);                                   // not elite's 5
        await app.page.evaluate(() => { persisted.difficulty = 'intermediate'; });
    }, 60_000);

    test('A TABLE EDIT AFTER LAUNCH CHANGES NOTHING', async () => {
        /* The second half of the same defect: the tables were read live, so
           editing one retroactively rewrote every plan ever generated. */
        const e = await app.page.evaluate(() => {
            const realJelq = GIRTH_CIRCUIT.intermediate.jelqDur;
            const realRounds = GIRTH_CIRCUIT.intermediate.rounds;
            GIRTH_CIRCUIT.intermediate.jelqDur = 999;
            GIRTH_CIRCUIT.intermediate.rounds = 9;
            session.exerciseIndex = 0;
            const ex = getCurEx();
            const rounds = (function () { resetSession(); return session.girthTotalRounds; })();
            GIRTH_CIRCUIT.intermediate.jelqDur = realJelq;
            GIRTH_CIRCUIT.intermediate.rounds = realRounds;
            return { duration: ex.duration, rounds };
        });
        expect(e.duration).toBe(120);
        expect(e.rounds).toBe(4);
    }, 60_000);

    test('A DELOAD STARTING AFTER LAUNCH CHANGES NOTHING', async () => {
        const e = await app.page.evaluate(() => {
            const real = window.isDeloadWeek;
            window.isDeloadWeek = () => true;
            session.exerciseIndex = 0;
            const ex = getCurEx();
            window.isDeloadWeek = real;
            return ex.duration;
        });
        expect(e).toBe(120);     // not the deloaded 72
    }, 60_000);

    test('SORENESS REPORTED AFTER LAUNCH CHANGES NOTHING', async () => {
        const e = await app.page.evaluate(() => {
            try { localStorage.setItem(getTodaySorenessKey(), 'moderate'); } catch (x) {}
            session.exerciseIndex = 0;
            const ex = getCurEx();
            try { localStorage.removeItem(getTodaySorenessKey()); } catch (x) {}
            return ex.duration;
        });
        expect(e).toBe(120);
    }, 60_000);

    test('REGENERATING THE PLANS AFTER LAUNCH CHANGES NOTHING', async () => {
        const e = await app.page.evaluate(() => {
            persisted.dayPlans = [];
            renderDashboard();
            session.exerciseIndex = 0;
            return { duration: getCurEx().duration, snapshotIntact: !!_launchedPrescription };
        });
        expect(e.duration).toBe(120);
        expect(e.snapshotIntact).toBe(true);
    }, 60_000);

    test('and a rerender cannot rewrite it either', async () => {
        const e = await app.page.evaluate(() => {
            renderToday(); renderReady(); renderDashboard();
            session.exerciseIndex = 0;
            return getCurEx().duration;
        });
        expect(e).toBe(120);
        expect(app.errors).toEqual([]);
    }, 60_000);
});

describe('the modifiers reach execution exactly once', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex', loaded: false });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    /** Launch with a chosen live state and report what the engine runs. */
    const withLive = (deload, soreness) => app.page.evaluate(async ({ deload, soreness, r }) => {
        try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
        window.__row = r;
        await loadPersisted();
        /* Clear any snapshot the previous run left, so a branch that does
           not capture cannot be read as if it had. */
        _launchedPrescription = null; _frozenSteps = null; _frozenFor = null;
        const real = window.isDeloadWeek;
        window.isDeloadWeek = () => deload;
        try {
            if (soreness) localStorage.setItem(getTodaySorenessKey(), soreness);
            else localStorage.removeItem(getTodaySorenessKey());
        } catch (e) {}
        renderDashboard();
        const res = window.BP.nextBestAction(buildResolverInput());
        readyPlan(res).go();
        const snap = _launchedPrescription ? JSON.parse(JSON.stringify(_launchedPrescription)) : null;
        session.exerciseIndex = 0;
        const first = getCurEx();
        const rounds = session.girthTotalRounds;
        window.isDeloadWeek = real;
        try { localStorage.removeItem(getTodaySorenessKey()); } catch (e) {}
        return { state: res.state, applied: snap && snap.appliedModifiers,
                 readiness: snap && snap.readinessInput,
                 prescribed: snap && snap.prescribedDose, executed: snap && snap.executionDose,
                 duration: first.duration, rounds,
                 /* Identity, kept separate from dose on purpose: a withheld
                    day has no dose but still belongs to a date. */
                 snapshotPresent: !!snap,
                 prescriptionDate: snap && snap.prescriptionDate,
                 scheduledType: snap && snap.scheduledType,
                 performedType: snap && snap.performedType,
                 routineType: session.routineType };
    }, { deload, soreness, r: row() });

    test('no modifier: the baseline, and nothing recorded as applied', async () => {
        const o = await withLive(false, '');
        expect(o.applied).toEqual([]);
        expect(o.duration).toBe(120);
    }, 60_000);

    test('deload only: stations reduced once, rounds and round rest untouched', async () => {
        const o = await withLive(true, '');
        expect(o.applied).toEqual(['deload']);
        expect(o.duration).toBe(72);
        expect(o.rounds).toBe(4);
        expect(o.executed.restDur).toBe(45);
    }, 60_000);

    test('moderate soreness only: the same reduction, recorded as its own modifier', async () => {
        const o = await withLive(false, 'moderate');
        expect(o.state).toBe('MODIFIED');
        expect(o.applied).toEqual(['moderate-soreness']);
        expect(o.duration).toBe(72);
        expect(o.readiness).toBe('moderate');
    }, 60_000);

    test('both: deload first, soreness second, and ONE application each', async () => {
        const o = await withLive(true, 'moderate');
        expect(o.applied).toEqual(['deload', 'moderate-soreness']);
        /* 120 to 72 to 43. A third application would give 26. */
        expect(o.duration).toBe(43);
    }, 60_000);

    test('the baseline is preserved beside the executed dose, never overwritten', async () => {
        const o = await withLive(true, 'moderate');
        expect(o.prescribed).toMatchObject({ rounds: 4, restDur: 45 });
        expect(o.prescribed.stations.map(s => s.duration)).toEqual([120, 45]);
        expect(o.executed.stations.map(s => s.duration)).toEqual([43, 16]);
    }, 60_000);

    test('mild and none are not modifiers', async () => {
        for (const s of ['none', 'mild']) {
            const o = await withLive(false, s);
            expect(o.applied, s).toEqual([]);
            expect(o.duration, s).toBe(120);
        }
    }, 90_000);

    test('an INVALID readiness value is treated as absent, not as a modifier', async () => {
        const o = await withLive(false, 'extremely');
        expect(o.applied).toEqual([]);
        expect(o.duration).toBe(120);
    }, 60_000);

    test('high soreness withholds the Primary and freezes no execution dose', async () => {
        const o = await withLive(false, 'high');
        expect(o.state).toBe('RECOVER');
        /* Recovery is not Primary work, so no dose is frozen onto it and the
           day's baseline is untouched by having been withheld. The IDENTITY
           is still captured, which that branch never used to do: it set
           routineType directly and skipped the launch door entirely, so a
           Recovery session carried no prescription date at all. */
        expect(o.executed).toBeNull();
        expect(o.prescribed).toBeNull();
        expect(o.applied).toEqual([]);
        expect(app.errors).toEqual([]);
    }, 60_000);

    test('AND THE WITHHELD DAY STILL RECORDS WHICH DAY WAS WITHHELD', async () => {
        /* The defect this pins: the RECOVER branch set routineType directly
           and never went through the launch door, so a Recovery session
           carried no prescription identity at all and could not be attributed
           to the day that prescribed it. Dose stays absent; identity does not.
           Asserted separately from the dose so a regression in either one is
           attributable to a named test rather than to a shared expectation. */
        const o = await withLive(false, 'high');
        expect(o.routineType).toBe('recovery');
        expect(o.snapshotPresent).toBe(true);
        expect(o.prescriptionDate).toBe('2026-03-12');
        expect(o.scheduledType).toBe('girth');
        /* And still no dose, so capturing identity did not smuggle one in. */
        expect(o.executed).toBeNull();
        /* performedType is NOT 'recovery' here: with no exec block it falls
           back to the scheduled type. That is safe rather than correct, and
           deliberately pinned as the safety property it actually is. Every
           execution site guards on performedType === session.routineType, so
           'girth' against a 'recovery' session makes all of them fail closed,
           and the history block is gated on executionDose so the value never
           reaches the log. A future reader that treats this field as a claim
           about what was performed, instead of comparing it, would be wrong.
           See the readiness report: recorded as a naming risk, not fixed
           here, because changing it is outside this phase. */
        expect(o.performedType).not.toBe(o.routineType);
        expect(o.performedType).toBe('girth');
    }, 60_000);
});

describe('a manual substitution never inherits the scheduled dose', () => {
    let app, o;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex', loaded: false });
        await load(app.page, row());
        o = await app.page.evaluate(() => {
            /* The REAL manual door: Mission Select sets _manualMission and
               calls startMission with the CHOSEN mission. Today is girth. */
            try { localStorage.setItem(getTodaySorenessKey(), 'none'); } catch (e) {}
            renderToday();
            goToStep(3);
            document.getElementById('mission-length-btn').click();
            const snap = _launchedPrescription ? JSON.parse(JSON.stringify(_launchedPrescription)) : null;
            session.exerciseIndex = 0;
            const first = getCurEx();
            try { localStorage.removeItem(getTodaySorenessKey()); } catch (e) {}
            return { launched: session.routineType, snap,
                     first: { title: first.title, sets: first.sets, duration: first.duration },
                     stepCount: executableStepCount() };
        });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('the performed mission is the chosen one, the scheduled one is the programme', () => {
        expect(o.launched).toBe('length');
        expect(o.snap.scheduledType).toBe('girth');
        expect(o.snap.performedType).toBe('length');
    });

    test('the executed dose is LENGTH work, derived independently', () => {
        /* A girth circuit cannot be applied to length and must not be. The
           performed mission gets its own dose from the current tables, which
           is the one place they may still generate one, because the programme
           prescribed nothing for a session the member chose instead. */
        expect(o.snap.executionDose.shape).toBe('sets');
        expect(o.snap.executionDose.exercises.map(e => e.title))
            .toEqual(['Directional Pulls', 'V-Stretch']);
        expect(o.first).toEqual({ title: 'Directional Pulls', sets: 3, duration: 30 });
        expect(o.stepCount).toBe(2);
    });

    test('and the PROGRAMME baseline is still preserved beside it', () => {
        /* Both truths. What was asked for, and what was chosen instead. */
        expect(o.snap.prescribedDose.shape).toBe('circuit');
        expect(o.snap.prescribedDose.stations.map(s => s.duration)).toEqual([120, 45]);
    });

    test('no girth number leaks into the length session', () => {
        const executed = JSON.stringify(o.snap.executionDose);
        expect(executed).not.toContain('Wet Jelq');
        expect(executed).not.toContain('circuit');
        expect(executed).not.toContain('rounds');
    });

    test('history records both identities and both doses', async () => {
        const e = await app.page.evaluate(() => {
            selectedEQ = 8; selectedRPE = 5;
            _sessionStartTime = Date.now() - 6e5;
            document.getElementById('input-bpel').value = '';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = '';
            finishSession();
            const x = persisted.sessionLog[persisted.sessionLog.length - 1];
            closeSessionSummary();
            return x;
        });
        expect(e.scheduledType).toBe('girth');
        expect(e.routineType).toBe('length');
        expect(e.manualOverride).toBe(true);
        expect(e.substituted).toBe(true);
        expect(e.prescribedDose.shape).toBe('circuit');
        expect(e.executedDose.shape).toBe('sets');
        expect(app.errors).toEqual([]);
    }, 60_000);
});

describe('fail closed: no reconstruction from current tables', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex', loaded: false });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    /** Break today's stored plan in one way, then read the funnel. */
    const broken = (how) => app.page.evaluate(async ({ how, r }) => {
        try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
        window.__row = r;
        await loadPersisted();
        renderDashboard();
        const key = window.BP.planDateKey(new Date());
        const errs = [];
        const realError = console.error;
        console.error = (...a) => { errs.push(a.map(String).join(' ')); };
        _planIntegrityReported = '';
        try {
            const i = persisted.dayPlans.findIndex(p => p.date === key);
            const plan = persisted.dayPlans[i];
            if (how === 'dose-missing') delete plan.primarySession.dose;
            if (how === 'dose-invalid') plan.primarySession.dose = { v: 1, shape: 'sets', exercises: [] };
            if (how === 'dose-version') plan.primarySession.dose = { ...plan.primarySession.dose, v: 99 };
            if (how === 'title-gone') plan.primarySession.dose = {
                ...plan.primarySession.dose,
                stations: [{ title: 'Renamed Jelq', duration: 120 }] };
            if (how === 'mode-protective') plan.mode = 'protective';
            if (how === 'mode-modified') plan.mode = 'modified';
            if (how === 'programme-mismatch') plan.generatedFrom = { programmeKey: 'lastLonger', version: 1 };
            renderToday();
            const res = window.BP.nextBestAction(buildResolverInput());
            const shown = id => { const e = document.getElementById(id); return e && !e.classList.contains('hidden'); };
            session.routineType = null;
            let threw = null;
            try { readyPlan(res).go(); } catch (e) { threw = String(e); }
            return {
                state: res.state, prepare: res.prepare, mission: res.mission,
                primaryType: scheduledPrimaryType(), blackout: isBlackoutDay(),
                cta: shown('launch-btn'), prepareCta: shown('today-prepare-btn'),
                launched: session.routineType || null,
                snapshot: _launchedPrescription, threw,
                reports: errs.filter(x => x.includes('integrity')).length,
            };
        } finally { console.error = realError; }
    }, { how, r: row() });

    const CASES = ['dose-missing', 'dose-invalid', 'dose-version', 'title-gone',
                   'mode-protective', 'mode-modified', 'programme-mismatch'];

    test.each(CASES.map(c => [c]))('%s prescribes nothing and launches nothing', async (how) => {
        const o = await broken(how);
        expect(o.state).toBe('PREPARE');
        expect(o.prepare).toBe('prescription-unavailable');
        expect(o.mission).toBeNull();
        expect(o.primaryType).toBeNull();
        expect(o.blackout).toBe(true);
        expect(o.launched).toBeNull();
        expect(o.snapshot).toBeNull();
    }, 90_000);

    test.each(CASES.map(c => [c]))('%s offers no repair and never reads the tables', async (how) => {
        const o = await broken(how);
        expect(o.cta).toBe(false);
        expect(o.prepareCta).toBe(false);
        /* The projection for that Thursday is girth and the tables would
           happily have produced a girth circuit. Neither reached the member. */
        expect(o.reports).toBeGreaterThanOrEqual(1);
    }, 90_000);

    test('and the mechanical missions are disabled on the manual route too', async () => {
        await broken('dose-invalid');
        const disabled = await app.page.evaluate(() => {
            goToStep(3);
            return ['mission-length-btn', 'mission-girth-btn', 'mission-stamina-btn']
                .map(id => document.getElementById(id).disabled);
        });
        expect(disabled).toEqual([true, true, true]);
        expect(app.errors).toEqual([]);
    }, 60_000);
});

describe('a legacy member keeps dynamic execution', () => {
    let app, o;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex' });        // classified custom
        o = await app.page.evaluate(() => {
            persisted.primaryGoal = 'size';
            persisted.schedule = Array(7).fill('length');
            persisted.dayPlans = [];
            persisted.difficulty = 'intermediate';
            try { localStorage.setItem(getTodaySorenessKey(), 'none'); } catch (e) {}
            renderToday();
            const r = window.BP.nextBestAction(buildResolverInput());
            readyPlan(r).go();
            const snap = _launchedPrescription ? JSON.parse(JSON.stringify(_launchedPrescription)) : null;
            session.exerciseIndex = 0;
            const atIntermediate = getCurEx().duration;
            /* Their dose IS dynamic, so a tier change moves it. That is the
               behaviour they have always had and it is not withdrawn. */
            persisted.difficulty = 'elite';
            const atElite = getCurEx().duration;
            persisted.difficulty = 'intermediate';
            try { localStorage.removeItem(getTodaySorenessKey()); } catch (e) {}
            return { source: snap && snap.source, frozen: snap && snap.executionDose,
                     atIntermediate, atElite };
        });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('their launch carries identity but no frozen dose', () => {
        expect(o.source).toBe('legacy');
        expect(o.frozen).toBeNull();
    });

    test('and their execution still follows the current tier', () => {
        expect(o.atIntermediate).toBe(30);
        expect(o.atElite).toBe(60);
        expect(app.errors).toEqual([]);
    });
});

describe('the execution survives midnight, a reload and a resume', () => {
    let app, before, after;
    beforeAll(async () => {
        app = await openApp({ clock: THU_2350, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex', loaded: false });
        await app.page.clock.setFixedTime(THU_2350);
        before = await app.page.evaluate(async (r) => {
            try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
            window.__row = r;
            await loadPersisted();
            renderDashboard();
            const res = window.BP.nextBestAction(buildResolverInput());
            readyPlan(res).go();
            session.exerciseIndex = 0;
            const first = getCurEx();
            /* Park it, which writes the draft including the frozen dose. */
            session.step = 4; goToStep(0);
            const draft = JSON.parse(localStorage.getItem('bp_session_draft_' + currentUser.id));
            return { launched: res.mission, duration: first.duration,
                     draftVersion: draft.v,
                     draftHasDose: !!(draft.prescription && draft.prescription.executionDose) };
        }, row());
        /* Cross midnight, advance the tier, and regenerate the plans. */
        await app.page.clock.setFixedTime(FRI_0010);
        after = await app.page.evaluate(() => {
            persisted.difficulty = 'elite';
            persisted.dayPlans = [];
            resumeSession();
            session.exerciseIndex = 0;
            const first = getCurEx();
            const snap = _launchedPrescription ? JSON.parse(JSON.stringify(_launchedPrescription)) : null;
            selectedEQ = 8; selectedRPE = 5;
            _sessionStartTime = Date.now() - 6e5;
            document.getElementById('input-bpel').value = '';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = '';
            finishSession();
            const e = persisted.sessionLog[persisted.sessionLog.length - 1];
            closeSessionSummary();
            return { clock: new Date().toISOString(), tier: getDiff().id,
                     duration: first.duration, rounds: session.girthTotalRounds, snap,
                     recorded: { date: e.date, prescriptionDate: e.prescriptionDate,
                                 scheduledType: e.scheduledType, xpEarned: e.xpEarned,
                                 executedDose: e.executedDose, prescribedDose: e.prescribedDose,
                                 appliedModifiers: e.appliedModifiers, doseVersion: e.doseVersion } };
        });
    }, 150_000);
    afterAll(async () => { await app?.close(); });

    test('the draft carried its schema version and the frozen dose', () => {
        expect(before.draftVersion).toBe(1);
        expect(before.draftHasDose).toBe(true);
        expect(before.duration).toBe(120);
    });

    test('the world really did move: new day, new tier, no plans', () => {
        expect(after.clock.startsWith('2026-03-13')).toBe(true);
        expect(after.tier).toBe('elite');
    });

    test('and the resumed session runs the SAME dose it launched with', () => {
        expect(after.duration).toBe(120);     // not elite's 180
        expect(after.rounds).toBe(4);         // not elite's 5
        expect(after.snap.prescriptionDate).toBe('2026-03-12');
        expect(after.snap.scheduledType).toBe('girth');
    });

    test('history records the launch truth, not Friday and not elite', () => {
        expect(after.recorded.date.startsWith('2026-03-13')).toBe(true);
        expect(after.recorded.prescriptionDate).toBe('2026-03-12');
        expect(after.recorded.scheduledType).toBe('girth');
        expect(after.recorded.doseVersion).toBe(1);
        expect(after.recorded.appliedModifiers).toEqual([]);
        expect(after.recorded.executedDose.stations.map(s => s.duration)).toEqual([120, 45]);
        /* The XP basis is frozen too: intermediate is 15, elite would be 25. */
        expect(after.recorded.xpEarned).toBe(15);
    });
});

describe('draft compatibility across the upgrade', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex', loaded: false });
        await load(app.page, row());
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    /** Write a draft by hand, resume it, and report what execution became. */
    const resumeWith = (prescription, v) => app.page.evaluate(({ prescription, v }) => {
        const d = { exerciseIndex: 0, setIndex: 1, routineType: 'girth', directionalIndex: 0,
                    xp: 0, sessionStartTime: Date.now() - 6e5, savedAt: Date.now() };
        if (v !== undefined) d.v = v;
        if (prescription !== 'OMIT') d.prescription = prescription;
        localStorage.setItem('bp_session_draft_' + currentUser.id, JSON.stringify(d));
        _launchedPrescription = null; _launchLegacyDraft = false;
        _frozenSteps = null; _frozenFor = null;
        const errs = [];
        const realError = console.error;
        console.error = (...a) => { errs.push(a.map(String).join(' ')); };
        _planIntegrityReported = '';
        try {
            resumeSession();
            session.exerciseIndex = 0;
            const ex = ROUTINES.girth[0] ? getCurEx() : null;
            return { snapshot: _launchedPrescription ? JSON.parse(JSON.stringify(_launchedPrescription)) : null,
                     legacy: _launchLegacyDraft, duration: ex && ex.duration,
                     reports: errs.filter(x => x.includes('integrity')).length };
        } finally { console.error = realError; }
    }, { prescription, v });

    const GOOD = { source: 'dated-plan', prescriptionDate: '2026-03-12', scheduledType: 'girth' };
    const DOSE = { v: 1, shape: 'circuit', tier: 'beginner', rounds: 3, restDur: 30,
                   stations: [{ title: 'Wet Jelq', duration: 60 },
                              { title: 'Uli — Manual Clamp', duration: 30 }] };

    test('a PRE-3C.5 snapshot, identity but no dose, resumes dynamically', async () => {
        /* Historical absence. The identity is good and there is no frozen
           dose to honour, so execution falls to the documented compatibility
           path rather than claiming one. Silent: absence is not a bad write. */
        const o = await resumeWith(GOOD);
        expect(o.snapshot).not.toBeNull();
        expect(o.snapshot.executionDose).toBeNull();
        expect(o.snapshot.prescriptionDate).toBe('2026-03-12');
        expect(o.duration).toBe(120);      // the current table, which is the fallback
        expect(o.reports).toBe(0);
    }, 60_000);

    test('a 3C.5 snapshot WITH a dose resumes on that dose', async () => {
        const o = await resumeWith({ ...GOOD, executionDose: DOSE, prescribedDose: DOSE,
                                     doseVersion: 1, performedType: 'girth' });
        expect(o.snapshot.executionDose.rounds).toBe(3);
        expect(o.duration).toBe(60);       // the frozen beginner dose, not the table's 120
    }, 60_000);

    test('a MALFORMED dose refuses the resume and never falls back to the tables', async () => {
        /* The strict half. Malformed new-world data must not regain the
           compatibility path, because that path rebuilds from current tables
           and would make a corrupt field a licence to do exactly that. */
        const o = await resumeWith({ ...GOOD, executionDose: { v: 1, shape: 'sets', exercises: [] } });
        expect(o.snapshot).toBeNull();
        expect(o.legacy).toBe(false);
        expect(o.reports).toBeGreaterThanOrEqual(1);
    }, 60_000);

    test('an unsupported DOSE version refuses too', async () => {
        const o = await resumeWith({ ...GOOD, executionDose: DOSE, doseVersion: 99 });
        expect(o.snapshot).toBeNull();
        expect(o.legacy).toBe(false);
    }, 60_000);

    test('an unsupported DRAFT version refuses, and nothing is migrated', async () => {
        const o = await resumeWith({ ...GOOD, executionDose: DOSE }, 99);
        expect(o.snapshot).toBeNull();
        expect(o.reports).toBeGreaterThanOrEqual(1);
    }, 60_000);

    test('a PRE-3C.4 draft with no prescription key at all keeps ITS path', async () => {
        const o = await resumeWith('OMIT');
        expect(o.snapshot).toBeNull();
        expect(o.legacy).toBe(true);       // historical absence, resolves at completion
        expect(o.reports).toBe(0);
    }, 60_000);

    test('and an explicit null is still strict, not the compatibility door', async () => {
        const o = await resumeWith(null);
        expect(o.snapshot).toBeNull();
        expect(o.legacy).toBe(false);
        expect(app.errors).toEqual([]);
    }, 60_000);
});

/**
 * THE ACCEPTANCE CRITERION, structural.
 *
 * A behavioural test can only cover the reconstruction routes somebody
 * thought of. This asserts that no function the engine runs after launch
 * reads a dose table or the tier at all, except through the frozen snapshot
 * or the one named fallback.
 */
describe('no post-launch function reconstructs dose from current state', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex', loaded: false });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('getCurEx consults the frozen step before anything else', async () => {
        const body = await app.page.evaluate(() => getCurEx.toString()
            .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' '));
        const frozenAt = body.indexOf('frozenStep(');
        expect(frozenAt).toBeGreaterThan(0);
        /* Every dynamic read sits BELOW the frozen branch, so a frozen
           session returns before any of them is reached. */
        for (const dyn of ['currentShapes(', 'GIRTH_CIRCUIT', 'applyDifficulty(', 'getDiff(']) {
            const at = body.indexOf(dyn);
            if (at >= 0) expect(at, dyn).toBeGreaterThan(frozenAt);
        }
    });

    test('every round and rest reader prefers the frozen execution', async () => {
        const bodies = await app.page.evaluate(() => ({
            reset: resetSession.toString(),
            start: startMission.toString(),
            roundRest: startGirthRoundRest.toString(),
            stepCount: executableStepCount.toString(),
        }));
        for (const [name, src] of Object.entries(bodies)) {
            expect(src, name).toMatch(/frozenExecution\(\)/);
        }
    });

    test('resolveDose is called from exactly one place, and it is named for it', async () => {
        const where = await app.page.evaluate(() => {
            const names = ['getCurEx', 'resetSession', 'startMission', 'startGirthRoundRest',
                           'startRest', 'advanceEx', 'updateExUI', 'finishSession',
                           'captureLaunchPrescription', 'substituteDoseFor'];
            const out = {};
            for (const n of names) {
                // eslint-disable-next-line no-eval
                out[n] = eval(n).toString().includes('resolveDose(');
            }
            return out;
        });
        expect(where.substituteDoseFor).toBe(true);
        for (const [n, hit] of Object.entries(where)) {
            if (n !== 'substituteDoseFor') expect(hit, n).toBe(false);
        }
    });
});

/**
 * The narrower invariants, each of which a mutation survived until it had a
 * test. They survived for the same reason: the frozen dose and the current
 * tables AGREE on these values today, so re-reading the table changed nothing
 * observable. Agreement today is not the contract. The contract is that the
 * frozen dose decides, and these fixtures make the two disagree on purpose.
 */
describe('the frozen dose decides, even where the tables would agree', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex', loaded: false });
        await load(app.page, row());
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    /** Resume onto a hand-built frozen dose that differs from the tables. */
    const resumeOn = (routineType, executionDose) => app.page.evaluate(({ routineType, executionDose }) => {
        const d = { v: 1, exerciseIndex: 0, setIndex: 1, routineType, directionalIndex: 0, xp: 0,
                    sessionStartTime: Date.now() - 6e5, savedAt: Date.now(),
                    prescription: { source: 'dated-plan', prescriptionDate: '2026-03-12',
                                    scheduledType: routineType, performedType: routineType,
                                    executionDose, prescribedDose: executionDose, doseVersion: 1 } };
        localStorage.setItem('bp_session_draft_' + currentUser.id, JSON.stringify(d));
        _launchedPrescription = null; _frozenSteps = null; _frozenFor = null;
        resumeSession();
        return { frozen: !!_launchedPrescription && !!_launchedPrescription.executionDose,
                 stepCount: executableStepCount(), rounds: session.girthTotalRounds };
    }, { routineType, executionDose });

    test('a dose with ONE exercise runs one, though the table lists two', () => {
        /* The number of exercises is part of what was prescribed. Re-reading
           ROUTINES.length here would run a second exercise nobody asked for. */
        return resumeOn('length', { v: 1, shape: 'sets', tier: 'intermediate',
            exercises: [{ title: 'Directional Pulls', sets: 2, duration: 20 }] })
            .then(async (o) => {
                expect(o.frozen).toBe(true);
                expect(o.stepCount).toBe(1);
                const tableLength = await app.page.evaluate(() => ROUTINES.length.length);
                expect(tableLength).toBe(2);
                /* And the engine really ends after it, rather than stepping
                   into the exercise the table would have offered. */
                const ended = await app.page.evaluate(() => {
                    session.exerciseIndex = 0;
                    advanceEx();
                    return { step: session.step, index: session.exerciseIndex };
                });
                expect(ended.step).toBe(5);
            });
    }, 60_000);

    test('a frozen round count and round rest beat the current tier', async () => {
        const o = await resumeOn('girth', { v: 1, shape: 'circuit', tier: 'beginner',
            rounds: 2, restDur: 90,
            stations: [{ title: 'Wet Jelq', duration: 61 }, { title: 'Uli — Manual Clamp', duration: 31 }] });
        expect(o.frozen).toBe(true);
        expect(o.rounds).toBe(2);
        const live = await app.page.evaluate(() => {
            /* The tier says 4 rounds and 45s rest; the frozen dose says 2 and
               90. Nothing may split the difference. */
            /* The rest the engine would actually count down, read off the
               overlay rather than from a private counter. */
            startGirthRoundRest();
            const shown = document.getElementById('rest-timer');
            const rest = shown ? shown.innerText : null;
            session.exerciseIndex = 0;
            return { tierRounds: GIRTH_CIRCUIT[getDiff().id].rounds,
                     tierRest: GIRTH_CIRCUIT[getDiff().id].restDur,
                     rest, firstDuration: getCurEx().duration };
        });
        expect(live.tierRounds).toBe(4);
        expect(live.tierRest).toBe(45);
        expect(live.firstDuration).toBe(61);
        /* 90 from the frozen dose, not the tier's 45. */
        if (live.rest !== null) expect(String(live.rest)).toContain('90');
    }, 60_000);

    test('a frozen dose is NOT applied to a different mission', async () => {
        /* The guard on the frozen read. A member whose running mission is not
           the one the snapshot froze is not executing that snapshot, and
           handing a circuit's numbers to a length hold would be worse than
           falling back. */
        await resumeOn('girth', { v: 1, shape: 'circuit', tier: 'beginner', rounds: 2, restDur: 90,
            stations: [{ title: 'Wet Jelq', duration: 61 }, { title: 'Uli — Manual Clamp', duration: 31 }] });
        const o = await app.page.evaluate(() => {
            session.routineType = 'length';     // not what was frozen
            session.exerciseIndex = 0;
            const ex = getCurEx();
            return { title: ex.title, duration: ex.duration, steps: executableStepCount() };
        });
        expect(o.title).toBe('Directional Pulls');
        /* The dynamic path, which for length at intermediate is 3x30s. 61
           would mean the circuit's station duration had leaked across. */
        expect(o.duration).toBe(30);
        expect(o.steps).toBe(2);
    }, 60_000);

    test('a post-modifier failure refuses the launch rather than executing', async () => {
        /* Unreachable with the shipped shapes, because 0.6 of any hold at or
           above one second stays at or above one. The guard exists for a
           future modifier, so the shape is injected to reach it. */
        const o = await app.page.evaluate(async (r) => {
            try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
            window.__row = r;
            await loadPersisted();
            renderDashboard();
            const realShape = window.BP.DELOAD_SHAPE;
            const realDeload = window.isDeloadWeek;
            window.BP.DELOAD_SHAPE = { setsOffset: 0, durationMult: 0 };   // drives duration to 0
            window.isDeloadWeek = () => true;
            const errs = [];
            const realError = console.error;
            console.error = (...a) => { errs.push(a.map(String).join(' ')); };
            _planIntegrityReported = '';
            _launchedPrescription = null; _frozenSteps = null; _frozenFor = null;
            try {
                const snap = captureLaunchPrescription('girth');
                return { snap, reports: errs.filter(x => x.includes('integrity')).length };
            } finally {
                console.error = realError;
                window.BP.DELOAD_SHAPE = realShape;
                window.isDeloadWeek = realDeload;
            }
        }, row());
        expect(o.snap).toBeNull();
        expect(o.reports).toBeGreaterThanOrEqual(1);
        expect(app.errors).toEqual([]);
    }, 60_000);
});

describe('a resumed circuit comes back to the round the member was on', () => {
    /* The fourth defect my own tests surfaced. The draft never stored the
       circuit position, because resetSession is the only place that sets
       girthRound and girthTotalRounds, and a resume skips it. So a member who
       left after round 3 of 4 came back to round 1 and was asked to repeat
       work they had already done. Nothing in the suite covered it: girthRound
       appeared in no test at all.

       Both halves of the real path run here. The save is goToStep(0) from the
       engine, which is the only writer of the draft, and the restore is
       resumeSession. The round the member reached is seeded as state; what is
       asserted is what the production save and restore do with it. */
    let app, before, after;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex', loaded: false });
        await load(app.page, row());
        before = await app.page.evaluate(() => {
            const r = window.BP.nextBestAction(buildResolverInput());
            readyPlan(r).go();
            const launchedRounds = session.girthTotalRounds;
            /* Three rounds in, mid circuit, second station, then park it.
               step 4 is the engine, and leaving the engine for HQ is the only
               thing that writes a draft. */
            session.girthRound = 3;
            session.exerciseIndex = 1;
            session.step = 4; goToStep(0);     // the real draft writer
            const raw = localStorage.getItem('bp_session_draft_' + currentUser.id);
            const d = raw ? JSON.parse(raw) : null;
            return { type: session.routineType, launchedRounds,
                     draftRound: d && d.girthRound,
                     draftTotal: d && d.girthTotalRounds };
        });
        after = await app.page.evaluate(() => {
            resumeSession();                   // the real draft reader
            return { round: session.girthRound, total: session.girthTotalRounds,
                     exerciseIndex: session.exerciseIndex, type: session.routineType };
        });
    }, 120_000);
    afterAll(async () => { await app?.close(); });

    test('the launch really was a four round girth circuit', () => {
        expect(before.type).toBe('girth');
        expect(before.launchedRounds).toBe(4);
    });

    test('THE DRAFT CARRIES THE CIRCUIT POSITION', () => {
        expect(before.draftRound).toBe(3);
        expect(before.draftTotal).toBe(4);
    });

    test('AND THE RESUME COMES BACK TO ROUND 3 OF 4, NOT ROUND 1', () => {
        expect(after.type).toBe('girth');
        expect(after.round).toBe(3);
        expect(after.total).toBe(4);
        expect(after.exerciseIndex).toBe(1);
        expect(app.errors).toEqual([]);
    });

    test('and a position past the frozen round count is not resumed into', async () => {
        /* The clamp. A draft claiming round 9 of a 4 round prescription is
           incoherent, so it restarts the circuit rather than resuming into a
           round that does not exist. */
        const o = await app.page.evaluate(() => {
            /* The resume above consumed the draft, so park again to write a
               fresh one, then corrupt only the round. */
            const k = 'bp_session_draft_' + currentUser.id;
            session.step = 4; goToStep(0);
            const d = JSON.parse(localStorage.getItem(k));
            d.girthRound = 9;
            localStorage.setItem(k, JSON.stringify(d));
            resumeSession();
            return { round: session.girthRound, total: session.girthTotalRounds };
        });
        expect(o.total).toBe(4);
        expect(o.round).toBe(1);
    }, 60_000);
});
