import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Prescription identity, through the real funnel.
 *
 * The pure suites prove the rules. This proves the things they cannot: that
 * Today, Ready and the launched session share ONE identity, that a session
 * keeps the identity it launched under across midnight, a week rollover, a
 * reload and a resume, and that the compatibility projection can no longer
 * decide what an authoritative member trains.
 *
 * Every divergent case installs its disagreement AFTER the real cutover
 * render, then exercises the real readers, which is exactly what production
 * does between renders.
 */

const THURSDAY = new Date(Date.UTC(2026, 2, 12, 12));          // 2026-03-12
const THU_2350 = new Date(Date.UTC(2026, 2, 12, 23, 50));
const FRI_0010 = new Date(Date.UTC(2026, 2, 13, 0, 10));
const SUN_2350 = new Date(Date.UTC(2026, 2, 15, 23, 50));      // last day of its ISO week
const MON_0010 = new Date(Date.UTC(2026, 2, 16, 0, 10));       // a new ISO week
const SIZE = ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'];

const row = (over = {}) => ({
    id: 'pa', total_xp: 500, difficulty: 'intermediate',
    schedule: SIZE, completed_days: [false, false, false, false, false, false, false],
    session_log: [], measurements: [], seen_milestones: [],
    all_time_session_count: 20, xp_migrated: true, week_key: '',
    primary_goal: 'size', programme: null, day_plans: [], pelvic_profile: 'standard',
    updated_at: '2026-03-12T00:00:00.000Z',
    ...over,
});

/** Load a row through the real loadPersisted, then render once. */
const load = (page, serverRow) => page.evaluate(async (r) => {
    try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
    try { localStorage.removeItem(getTodaySorenessKey()); } catch (e) {}
    try { localStorage.removeItem('bp_session_draft_' + currentUser.id); } catch (e) {}
    window.__row = r;
    await loadPersisted();
    renderDashboard();
    return { key: persisted.programme && persisted.programme.key,
             dates: persisted.dayPlans.map(p => p.date) };
}, serverRow);

/**
 * Install a divergence on today, then read every surface in the funnel.
 *
 * `plan` replaces today's dated record and `slot` replaces today's projection
 * slot, so the two sources disagree on purpose. renderToday is called rather
 * than renderDashboard, because renderDashboard would regenerate the week and
 * erase the disagreement before anything could read it.
 */
const diverge = (page, plan, slot) => page.evaluate(({ plan, slot }) => {
    const key = window.BP.planDateKey(new Date());
    persisted.dayPlans = persisted.dayPlans.map(p =>
        p.date === key ? { date: key, ...plan } : p);
    persisted.schedule = persisted.schedule.slice();
    persisted.schedule[new Date().getDay()] = slot;
    renderToday();
    const r = window.BP.nextBestAction(buildResolverInput());
    const shown = id => { const e = document.getElementById(id); return e && !e.classList.contains('hidden'); };
    const txt = id => (document.getElementById(id) || {}).textContent || '';
    const out = {
        prescription: currentTodayPrescription(),
        primaryType: scheduledPrimaryType(),
        blackout: isBlackoutDay(),
        state: r.state,
        prepare: r.prepare,
        mission: r.mission,
        headline: txt('today-headline').trim(),
        sub: shown('today-sub') ? txt('today-sub').trim() : null,
        cta: shown('launch-btn') ? txt('launch-btn').trim() : null,
        prepareCta: shown('today-prepare-btn') ? txt('today-prepare-btn').trim() : null,
        readyLabel: readyPlan(r).label,
    };
    /* Then take whatever door Ready offers and see what actually launches.
       routineType is cleared first because `session` is created with a
       default of 'length', so without this a test could read the default and
       call it a launch. */
    session.routineType = null;
    try { readyPlan(r).go(); } catch (e) { out.threw = String(e); }
    out.launched = session.routineType || null;
    out.snapshot = _launchedPrescription ? { ...(_launchedPrescription) } : null;
    return out;
}, { plan, slot });

const PRIMARY = (type) => ({ mode: 'prescribed', primarySession: { type, title: type } });
const REST = { mode: 'rest' };
const SUPPORT = { mode: 'prescribed', supportingWork: [{ type: 'mobility', title: 'Hips' }] };
const CORRUPT = { mode: 'not-a-mode', primarySession: { type: 'girth' } };

describe('A. dated Girth against a projected Length', () => {
    let app, obs;
    beforeAll(async () => {
        app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'pa', loaded: false });
        await load(app.page, row());
        obs = await diverge(app.page, PRIMARY('girth'), 'length');
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('Today, Ready and the launched session are all Girth', () => {
        expect(obs.state).toBe('TRAIN');
        expect(obs.mission).toBe('girth');
        expect(obs.headline).toBe('Girth Day');
        expect(obs.cta).toBe('START GIRTH SESSION');
        expect(obs.readyLabel).toBe('START GIRTH SESSION');
        expect(obs.launched).toBe('girth');
    });

    test('the projection decided nothing', () => {
        expect(obs.prescription.source).toBe('dated-plan');
        expect(obs.primaryType).toBe('girth');
        expect(JSON.stringify(obs)).not.toContain('Length Day');
    });

    test('and the launch snapshot is the dated identity', () => {
        expect(obs.snapshot).toMatchObject({
            source: 'dated-plan', prescriptionDate: '2026-03-12', scheduledType: 'girth',
        });
    });
});

describe('B. dated Rest against a projected Length, the safety case', () => {
    let app, obs;
    beforeAll(async () => {
        app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'pa', loaded: false });
        await load(app.page, row());
        obs = await diverge(app.page, REST, 'length');
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('it resolves REST, and the projection is irrelevant', () => {
        /* Before this phase: "Length Day" with a START LENGTH SESSION button,
           on a day the programme prescribed rest. */
        expect(obs.state).toBe('REST');
        expect(obs.headline).toBe('Rest Day');
        expect(obs.mission).toBeNull();
    });

    test('no Primary is launchable by the prescribed route', () => {
        expect(obs.cta).toBeNull();
        expect(obs.readyLabel).toBe('Back home');
        expect(obs.launched).toBeNull();
    });

    test('and the manual route is blocked too', async () => {
        /* isBlackoutDay() used to be the ONLY rest enforcement in the app and
           it gated step 3 alone, which is the route a member takes to
           DISOBEY the prescription rather than to follow it. */
        expect(obs.blackout).toBe(true);
        const r = await app.page.evaluate(() => {
            goToStep(3);
            return ['mission-length-btn', 'mission-girth-btn', 'mission-stamina-btn']
                .map(id => document.getElementById(id).disabled);
        });
        expect(r).toEqual([true, true, true]);
    });

    test('high soreness on that rest day still reads REST', async () => {
        /* Readiness withholds work and there is no work to withhold, so it
           must not manufacture a Recovery day the programme never prescribed. */
        const s = await app.page.evaluate(() => {
            try { localStorage.setItem(getTodaySorenessKey(), 'high'); } catch (e) {}
            renderToday();
            const out = window.BP.nextBestAction(buildResolverInput()).state;
            try { localStorage.removeItem(getTodaySorenessKey()); } catch (e) {}
            return out;
        });
        expect(s).toBe('REST');
    });
});

describe('C. dated support-only against a projected Girth', () => {
    let app, obs;
    beforeAll(async () => {
        app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'pa', loaded: false });
        await load(app.page, row());
        obs = await diverge(app.page, SUPPORT, 'girth');
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('it is a state of its own: valid, non-Rest, non-Primary, non-corrupt', () => {
        expect(obs.prescription.dayKind).toBe('support-only');
        expect(obs.prescription.ok).toBe(true);            // valid, not an integrity failure
        expect(obs.state).toBe('SUPPORT_ONLY');
        expect(obs.state).not.toBe('REST');
        expect(obs.state).not.toBe('TRAIN');
        expect(obs.state).not.toBe('PREPARE');
    });

    test('it is not fabricated into Girth from the projection', () => {
        expect(obs.mission).toBeNull();
        expect(obs.primaryType).toBeNull();
        expect(obs.launched).toBeNull();
        expect(JSON.stringify(obs)).not.toContain('Girth Day');
    });

    test('it is non-launching, by either route', async () => {
        expect(obs.cta).toBeNull();
        expect(obs.prepareCta).toBeNull();
        expect(obs.readyLabel).toBe('Back home');
        expect(obs.blackout).toBe(true);
        const disabled = await app.page.evaluate(() => {
            goToStep(3);
            return ['mission-length-btn', 'mission-girth-btn', 'mission-stamina-btn']
                .map(id => document.getElementById(id).disabled);
        });
        expect(disabled).toEqual([true, true, true]);
    });

    test('the copy says there is no main session, and nothing about breakage', () => {
        expect(obs.headline).toBe('No Main Session Today');
        expect(obs.sub).toBe("There's no primary training session scheduled for today.");
        /* Not routed through the integrity language. This is a valid
           programme state, so it must not read as something to fix. */
        const all = `${obs.headline} ${obs.sub}`.toLowerCase();
        for (const word of ['unavailable', 'attention', 'could not', 'error', 'fix', 'rest']) {
            expect(all, word).not.toContain(word);
        }
    });

    test('and high soreness does not turn it into a Recovery day', async () => {
        const s = await app.page.evaluate(() => {
            try { localStorage.setItem(getTodaySorenessKey(), 'high'); } catch (e) {}
            renderToday();
            const out = window.BP.nextBestAction(buildResolverInput()).state;
            try { localStorage.removeItem(getTodaySorenessKey()); } catch (e) {}
            return out;
        });
        expect(s).toBe('SUPPORT_ONLY');
    });
});

describe('D and E. a missing or corrupt plan fails closed', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'pa', loaded: false });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    const broken = (how) => app.page.evaluate(async (how) => {
        try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
        window.__row = { id: 'pa', total_xp: 500, difficulty: 'intermediate',
            schedule: ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'],
            completed_days: [false, false, false, false, false, false, false],
            session_log: [], measurements: [], seen_milestones: [],
            all_time_session_count: 20, xp_migrated: true, week_key: '',
            primary_goal: 'size', programme: null, day_plans: [], pelvic_profile: 'standard',
            updated_at: '2026-03-12T00:00:00.000Z' };
        await loadPersisted();
        renderDashboard();
        const key = window.BP.planDateKey(new Date());
        const errs = [];
        const realError = console.error;
        console.error = (...a) => { errs.push(a.map(String).join(' ')); };
        _planIntegrityReported = '';
        try {
            const i = persisted.dayPlans.findIndex(p => p.date === key);
            if (how === 'missing') persisted.dayPlans.splice(i, 1);
            if (how === 'corrupt') persisted.dayPlans[i] = { date: key, mode: 'not-a-mode',
                                                             primarySession: { type: 'girth' } };
            renderToday();
            const r = window.BP.nextBestAction(buildResolverInput());
            const shown = id => { const e = document.getElementById(id); return e && !e.classList.contains('hidden'); };
            const out = {
                state: r.state, prepare: r.prepare, mission: r.mission,
                primaryType: scheduledPrimaryType(),
                blackout: isBlackoutDay(),
                cta: shown('launch-btn') ? document.getElementById('launch-btn').textContent.trim() : null,
                prepareCta: shown('today-prepare-btn')
                    ? document.getElementById('today-prepare-btn').textContent.trim() : null,
                reports: errs.filter(e => e.includes('integrity')).length,
                column: persisted.schedule.slice(),
                stored: persisted.dayPlans.find(p => p.date === key) || null,
            };
            session.routineType = null;     // the default is 'length'; see above
            try { readyPlan(r).go(); } catch (e) { out.threw = String(e); }
            out.launched = session.routineType || null;
            return out;
        } finally { console.error = realError; }
    }, how);

    test.each([['missing'], ['corrupt']])('%s: prescribes nothing and says so', async (how) => {
        const r = await broken(how);
        expect(r.state).toBe('PREPARE');
        expect(r.prepare).toBe('prescription-unavailable');
        expect(r.mission).toBeNull();
        expect(r.primaryType).toBeNull();
        /* THE LEAK, CLOSED. The projection for that Thursday is girth and
           none of it reached the member. */
        expect(r.column[new Date(Date.UTC(2026, 2, 12)).getUTCDay()]).toBe('girth');
        expect(r.launched).toBeNull();
        expect(r.blackout).toBe(true);
    }, 60_000);

    test.each([['missing'], ['corrupt']])('%s: reported, and offers no false repair', async (how) => {
        const r = await broken(how);
        expect(r.reports).toBe(1);
        /* No day-picker CTA. A missing dated plan is not something the member
           can fix by assigning a type, and offering it would invite an edit
           the next load overwrites. */
        expect(r.cta).toBeNull();
        expect(r.prepareCta).toBeNull();
    }, 60_000);

    test('a corrupt record is preserved, not replaced', async () => {
        const r = await broken('corrupt');
        expect(r.stored).toMatchObject({ mode: 'not-a-mode' });
    }, 60_000);

    test('and support-only is NOT routed through this condition', async () => {
        /* The distinction requirement 14 asked for. A valid support-only day
           and a broken plan mean different things and must not share a
           user-facing state. */
        const r = await broken('missing');
        expect(r.state).toBe('PREPARE');
        expect(r.state).not.toBe('SUPPORT_ONLY');
    }, 60_000);
});

describe('F. the legacy cohort is untouched', () => {
    let app, obs;
    beforeAll(async () => {
        app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        /* signIn seeds the classified-custom sentinel: their column IS their
           programme, so the dated path never applies to them. */
        await signIn(app.page, { id: 'pa' });
        obs = await app.page.evaluate(() => {
            persisted.primaryGoal = 'size';          // every prescription below needs one
            persisted.schedule = ['girth', 'girth', 'rest', 'girth', 'stamina', 'rest', 'rest'];
            persisted.completedDays = [false, false, false, false, false, false, false];
            persisted.sessionLog = [];
            persisted.dayPlans = [];
            renderToday();
            const r = window.BP.nextBestAction(buildResolverInput());
            return { prescription: currentTodayPrescription(), state: r.state,
                     mission: r.mission, primaryType: scheduledPrimaryType() };
        });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('their source is the column and their mission comes from it', () => {
        expect(obs.prescription.source).toBe('legacy');
        expect(obs.state).toBe('TRAIN');
        expect(obs.mission).toBe('stamina');          // Thursday, index 4
        expect(obs.primaryType).toBe('stamina');
    });

    test('their completion still comes from the compatibility tick', async () => {
        const r = await app.page.evaluate(() => {
            persisted.completedDays[new Date().getDay()] = true;
            renderToday();
            return window.BP.nextBestAction(buildResolverInput()).state;
        });
        expect(r).toBe('COMPLETE');
    });

    test('and finishing writes that tick, where an authoritative member does not', async () => {
        const r = await app.page.evaluate(() => {
            persisted.completedDays = [false, false, false, false, false, false, false];
            persisted.sessionLog = [];
            startMission('stamina', 'test');
            selectedEQ = 8; selectedRPE = 5;
            _sessionStartTime = Date.now() - 6e5;
            document.getElementById('input-bpel').value = '';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = '';
            finishSession();
            const e = persisted.sessionLog[persisted.sessionLog.length - 1];
            closeSessionSummary();
            return { tick: persisted.completedDays[new Date().getDay()],
                     source: e.scheduledType, prescriptionDate: e.prescriptionDate,
                     override: e.manualOverride };
        });
        expect(r.tick).toBe(true);
        expect(r.source).toBe('stamina');
        expect(r.prescriptionDate).toBe('2026-03-12');
        expect(r.override).toBe(false);
    }, 60_000);
});

/* ═══════════════════════════════════════════════════════════════════════════
   IDENTITY ACROSS BOUNDARIES
   ═══════════════════════════════════════════════════════════════════════════ */

/** Launch on `from`, move the clock to `to`, finish. */
const acrossBoundary = async (app, { from, to, reload }) => {
    await app.page.clock.setFixedTime(from);
    const before = await app.page.evaluate(async (r) => {
        try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
        window.__row = r;
        await loadPersisted();
        renderDashboard();
        const res = window.BP.nextBestAction(buildResolverInput());
        readyPlan(res).go();
        return { state: res.state, launched: session.routineType,
                 snapshot: { ..._launchedPrescription } };
    }, row({ updated_at: '2026-03-12T00:00:00.000Z' }));

    if (reload) {
        /* Park the session, which writes the draft, then resume it. */
        await app.page.evaluate(() => { session.step = 4; goToStep(0); });
    }
    await app.page.clock.setFixedTime(to);
    const after = await app.page.evaluate((didReload) => {
        if (didReload) resumeSession();
        const st = { clock: new Date().toISOString(), planKeyNow: window.BP.planDateKey(new Date()),
                     snapshot: _launchedPrescription ? { ..._launchedPrescription } : null,
                     running: session.routineType };
        selectedEQ = 8; selectedRPE = 5;
        _sessionStartTime = Date.now() - 6e5;
        document.getElementById('input-bpel').value = '';
        document.getElementById('input-mseg').value = '';
        document.getElementById('session-note-input').value = '';
        finishSession();
        const e = persisted.sessionLog[persisted.sessionLog.length - 1];
        const w = currentWeekCompletion();
        /* Render BEFORE reading the strip. The DOM still holds the pre-session
           paint until something repaints it, and closeSessionSummary (which
           does) runs after this read. */
        renderDashboard();
        const strip = window.__weekStrip();
        const resolved = window.BP.nextBestAction(buildResolverInput());
        closeSessionSummary();
        return { ...st,
                 recorded: { date: e.date, prescriptionDate: e.prescriptionDate,
                             scheduledType: e.scheduledType, routineType: e.routineType,
                             manualOverride: e.manualOverride },
                 completedDays: persisted.completedDays.map((v, i) => v ? i : null).filter(v => v !== null),
                 weekCompleted: w.completed, weekTarget: w.target,
                 satisfied: w.satisfied, stripBySunday: strip.bySunday,
                 stateNow: resolved.state };
    }, !!reload);
    return { before, after };
};

describe('midnight, no reload: the launch prescription keeps the credit', () => {
    let app, r;
    beforeAll(async () => {
        app = await openApp({ clock: THU_2350, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'pa', loaded: false });
        r = await acrossBoundary(app, { from: THU_2350, to: FRI_0010 });
    }, 120_000);
    afterAll(async () => { await app?.close(); });

    test('it launched Thursday Girth', () => {
        expect(r.before.state).toBe('TRAIN');
        expect(r.before.launched).toBe('girth');
        expect(r.before.snapshot.prescriptionDate).toBe('2026-03-12');
    });

    test('the clock really crossed into Friday', () => {
        expect(r.after.clock.startsWith('2026-03-13')).toBe(true);
        expect(r.after.planKeyNow).toBe('2026-03-13');
    });

    test('the completion timestamp is Friday and the prescription date is Thursday', () => {
        /* Two separate truths. The timestamp is never rewritten. */
        expect(r.after.recorded.date.startsWith('2026-03-13')).toBe(true);
        expect(r.after.recorded.prescriptionDate).toBe('2026-03-12');
    });

    test('scheduledType is Thursday\'s Girth, not Friday\'s rest', () => {
        expect(r.after.recorded.scheduledType).toBe('girth');
        expect(r.after.recorded.routineType).toBe('girth');
    });

    test('and perfect compliance is not recorded as a substitution', () => {
        /* The old behaviour recorded scheduledType 'rest' and
           manualOverride true, so a member who followed the programme
           exactly had a deviation in their history forever. */
        expect(r.after.recorded.manualOverride).toBe(false);
    });

    test('Thursday gets the week credit, by prescription date', () => {
        /* Sunday-indexed: Thursday is 4. */
        expect(r.after.satisfied[4]).toBe(true);
        expect(r.after.stripBySunday['4']).toBe('satisfied');
        expect(r.after.weekCompleted).toBeGreaterThanOrEqual(1);
    });

    test('Friday does not read COMPLETE because a session finished on it', () => {
        expect(r.after.stateNow).not.toBe('COMPLETE');
        expect(r.after.satisfied[5]).toBe(false);
    });

    test('and completedDays is not written for this cohort at all', () => {
        expect(r.after.completedDays).toEqual([]);
    });
});

describe('midnight with a draft and a resume', () => {
    let app, r;
    beforeAll(async () => {
        app = await openApp({ clock: THU_2350, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'pa', loaded: false });
        r = await acrossBoundary(app, { from: THU_2350, to: FRI_0010, reload: true });
    }, 120_000);
    afterAll(async () => { await app?.close(); });

    test('the resumed session still carries Thursday\'s identity', () => {
        expect(r.after.snapshot).toMatchObject({
            source: 'dated-plan', prescriptionDate: '2026-03-12', scheduledType: 'girth',
        });
        expect(r.after.running).toBe('girth');
    });

    test('and records it, not Friday\'s prescription', () => {
        expect(r.after.recorded.prescriptionDate).toBe('2026-03-12');
        expect(r.after.recorded.scheduledType).toBe('girth');
        expect(r.after.recorded.manualOverride).toBe(false);
        expect(r.after.recorded.date.startsWith('2026-03-13')).toBe(true);
    });

    test('Thursday still gets the credit', () => {
        expect(r.after.satisfied[4]).toBe(true);
    });
});

describe('a week rollover, which completedDays could not have survived', () => {
    let app, r;
    beforeAll(async () => {
        app = await openApp({ clock: SUN_2350, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'pa', loaded: false });
        r = await acrossBoundary(app, { from: SUN_2350, to: MON_0010 });
    }, 120_000);
    afterAll(async () => { await app?.close(); });

    test('it launched Sunday\'s Primary', () => {
        /* Sunday is index 0 in the size week: length. */
        expect(r.before.launched).toBe('length');
        expect(r.before.snapshot.prescriptionDate).toBe('2026-03-15');
    });

    test('the completion is Monday and the prescription is Sunday', () => {
        expect(r.after.recorded.date.startsWith('2026-03-16')).toBe(true);
        expect(r.after.recorded.prescriptionDate).toBe('2026-03-15');
        expect(r.after.recorded.scheduledType).toBe('length');
        expect(r.after.recorded.manualOverride).toBe(false);
    });

    test('Monday does not become COMPLETE because the session finished on it', () => {
        expect(r.after.stateNow).not.toBe('COMPLETE');
    });

    test('THE REASON OPTION A WAS REJECTED: no future weekday is marked', () => {
        /* completedDays has weekday identity and no week identity, and it
           resets on rollover. Writing the prescription's Sunday index after
           the reset would have marked the NEW week's upcoming Sunday
           complete. Nothing is written, so nothing can. */
        expect(r.after.completedDays).toEqual([]);
        expect(r.after.satisfied[0]).toBe(false);     // the new week's Sunday
    });

    test('and the new week starts clean', () => {
        expect(r.after.weekCompleted).toBe(0);
        expect(app.errors).toEqual([]);
    });
});

describe('a malformed stored snapshot keeps the work and withholds the claim', () => {
    let app, r;
    beforeAll(async () => {
        app = await openApp({ clock: THU_2350, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'pa', loaded: false });
        await app.page.clock.setFixedTime(THU_2350);
        await app.page.evaluate(async (serverRow) => {
            try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
            window.__row = serverRow;
            await loadPersisted();
            renderDashboard();
            const res = window.BP.nextBestAction(buildResolverInput());
            readyPlan(res).go();
            session.step = 4; goToStep(0);
            /* Corrupt the stored identity, the way a bad write or a hand edit
               would. The exercise position is left intact. */
            const k = 'bp_session_draft_' + currentUser.id;
            const d = JSON.parse(localStorage.getItem(k));
            d.prescription = { source: 'dated-plan', prescriptionDate: '2026-3-12',
                               scheduledType: 'girth' };
            localStorage.setItem(k, JSON.stringify(d));
        }, row({ updated_at: '2026-03-12T00:00:00.000Z' }));
        /* ACROSS MIDNIGHT, which is the point: a refused snapshot must not
           quietly pick up the new day's prescription instead. */
        await app.page.clock.setFixedTime(FRI_0010);
        r = await app.page.evaluate(() => {
            const errs = [];
            const realError = console.error;
            console.error = (...a) => { errs.push(a.map(String).join(' ')); };
            _planIntegrityReported = '';
            try {
                resumeSession();
                const snapshot = _launchedPrescription;
                selectedEQ = 8; selectedRPE = 5;
                _sessionStartTime = Date.now() - 6e5;
                document.getElementById('input-bpel').value = '';
                document.getElementById('input-mseg').value = '';
                document.getElementById('session-note-input').value = '';
                finishSession();
                const e = persisted.sessionLog[persisted.sessionLog.length - 1];
                const w = currentWeekCompletion();
                closeSessionSummary();
                return { snapshot, reports: errs.filter(x => x.includes('integrity')).length,
                         recorded: { date: e.date, prescriptionDate: e.prescriptionDate,
                                     scheduledType: e.scheduledType, routineType: e.routineType,
                                     manualOverride: e.manualOverride, xpEarned: e.xpEarned },
                         logLen: persisted.sessionLog.length,
                         satisfied: w.satisfied, weekCompleted: w.completed };
            } finally { console.error = realError; }
        });
    }, 120_000);
    afterAll(async () => { await app?.close(); });

    test('the snapshot is refused rather than adopted or repaired', () => {
        expect(r.snapshot).toBeNull();
        expect(r.reports).toBe(1);
    });

    test('the performed work is kept in full', () => {
        /* Not data loss. The session happened and it is in the history with
           its type, its timestamp and its XP. */
        expect(r.logLen).toBe(1);
        expect(r.recorded.routineType).toBe('girth');
        expect(r.recorded.xpEarned).toBeGreaterThan(0);
        expect(r.recorded.date.startsWith('2026-03-13')).toBe(true);
    });

    test('the identity is recorded as explicitly unknown', () => {
        expect(r.recorded.prescriptionDate).toBeNull();
        expect(r.recorded.scheduledType).toBeNull();
        /* And it is not called a substitution, because there is nothing to
           have substituted for. */
        expect(r.recorded.manualOverride).toBe(false);
    });

    test('it did NOT silently adopt the new day\'s prescription', () => {
        expect(r.recorded.prescriptionDate).not.toBe('2026-03-13');
        expect(r.recorded.scheduledType).not.toBe('rest');
    });

    test('and it satisfies no dated Primary, Thursday or Friday', () => {
        /* The deliberate cost of the conservative rule. The member trained,
           and because the identity cannot be proven the programme does not
           credit it. The alternative credits Friday for Thursday's work. */
        expect(r.satisfied[4]).toBe(false);
        expect(r.satisfied[5]).toBe(false);
        expect(r.weekCompleted).toBe(0);
    });
});

describe('completion is committed once', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'pa', loaded: false });
        await load(app.page, row());
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    const launch = () => app.page.evaluate(() => {
        persisted.sessionLog = []; persisted.totalXp = 0; persisted.allTimeSessionCount = 0;
        const res = window.BP.nextBestAction(buildResolverInput());
        readyPlan(res).go();
        selectedEQ = 8; selectedRPE = 5;
        _sessionStartTime = Date.now() - 6e5;
        document.getElementById('input-bpel').value = '';
        document.getElementById('input-mseg').value = '';
        document.getElementById('session-note-input').value = '';
    });

    test('a synchronous double submission writes one entry', async () => {
        await launch();
        const r = await app.page.evaluate(() => {
            finishSession();
            finishSession();
            finishSession();
            const out = { log: persisted.sessionLog.length, xp: persisted.totalXp,
                          lifetime: persisted.allTimeSessionCount };
            closeSessionSummary();
            return out;
        });
        expect(r.log).toBe(1);
        expect(r.lifetime).toBe(1);
    }, 60_000);

    test('a second submission after an async yield also writes one', async () => {
        await launch();
        const r = await app.page.evaluate(async () => {
            finishSession();
            await new Promise(res => setTimeout(res, 30));
            finishSession();
            const out = { log: persisted.sessionLog.length, lifetime: persisted.allTimeSessionCount };
            closeSessionSummary();
            return out;
        });
        expect(r.log).toBe(1);
        expect(r.lifetime).toBe(1);
    }, 60_000);

    test('clicking the real button twice writes one', async () => {
        await launch();
        await app.page.evaluate(() => {
            const b = document.getElementById('finish-session-btn');
            b.click(); b.click();
        });
        const r = await app.page.evaluate(() => {
            const out = { log: persisted.sessionLog.length };
            closeSessionSummary();
            return out;
        });
        expect(r.log).toBe(1);
    }, 60_000);

    test('a throw BEFORE the commit boundary can be retried', async () => {
        /* A permanent lock is its own bug. Nothing is committed yet, so the
           member must be able to try again. */
        await launch();
        const r = await app.page.evaluate(() => {
            const el = document.getElementById('input-bpel');
            const realGet = document.getElementById;
            let thrown = false;
            document.getElementById = (id) => {
                if (id === 'session-note-input' && !thrown) { thrown = true; throw new Error('boom'); }
                return realGet.call(document, id);
            };
            let first = null;
            try { finishSession(); } catch (e) { first = String(e); }
            document.getElementById = realGet;
            const afterFail = persisted.sessionLog.length;
            finishSession();                       // the retry
            const out = { first, afterFail, afterRetry: persisted.sessionLog.length };
            closeSessionSummary();
            void el;
            return out;
        });
        expect(r.first).toContain('boom');
        expect(r.afterFail).toBe(0);               // nothing committed
        expect(r.afterRetry).toBe(1);              // and the retry worked
    }, 60_000);

    test('a save failure AFTER the commit boundary does not append a second', async () => {
        await launch();
        const r = await app.page.evaluate(async () => {
            /* The upload is a whole-row upsert of session_log, so a failed
               save retries the row rather than re-appending a completion. */
            window.__failUpsert = true;
            finishSession();
            const afterFinish = persisted.sessionLog.length;
            window.__failUpsert = false;
            await savePersisted();
            await new Promise(res => setTimeout(res, 60));
            const out = { afterFinish, afterRetry: persisted.sessionLog.length,
                          lifetime: persisted.allTimeSessionCount };
            closeSessionSummary();
            return out;
        });
        expect(r.afterFinish).toBe(1);
        expect(r.afterRetry).toBe(1);
        expect(r.lifetime).toBe(1);
    }, 60_000);

    test('a rerender after completion does not create a second record', async () => {
        await launch();
        const r = await app.page.evaluate(() => {
            finishSession();
            renderDashboard(); renderToday(); renderReady();
            const out = { log: persisted.sessionLog.length };
            closeSessionSummary();
            return out;
        });
        expect(r.log).toBe(1);
    }, 60_000);

    test('and resume after completion has no draft to resume', async () => {
        const r = await app.page.evaluate(() => {
            const before = persisted.sessionLog.length;
            resumeSession();
            return { before, after: persisted.sessionLog.length,
                     draft: localStorage.getItem('bp_session_draft_' + currentUser.id) };
        });
        expect(r.draft).toBeNull();
        expect(r.after).toBe(r.before);
        expect(app.errors).toEqual([]);
    }, 60_000);
});

describe('the Weekly Report reads the canonical week', () => {
    let app, r;
    beforeAll(async () => {
        app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'pa', loaded: false });
        await load(app.page, row());
        r = await app.page.evaluate(() => {
            showWeeklyReport();
            const text = document.getElementById('weekly-report-content').textContent;
            const w = currentWeekCompletion();
            const tiles = [...document.querySelectorAll('#weekly-report-content .summary-stat')]
                .map(t => t.textContent.trim());
            closeWeeklyReport();
            return { text, tiles, completed: w.completed, target: w.target,
                     ticks: persisted.completedDays.filter(Boolean).length };
        });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('the programme tile is the canonical numerator and denominator', () => {
        const tile = r.tiles.find(t => t.startsWith('Programme Sessions'));
        expect(tile).toBeTruthy();
        expect(tile).toContain(`${r.completed} / ${r.target}`);
    });

    test('the old label and the invented denominator are both gone', () => {
        expect(r.text).not.toContain('Active Days');
        const tile = r.tiles.find(t => t.startsWith('Programme Sessions'));
        expect(tile).not.toContain('/ 7');
    });

    test('the Sessions tile is a count, not a fraction of seven', () => {
        const tile = r.tiles.find(t => t.startsWith('Sessions'));
        expect(tile).toBeTruthy();
        expect(tile).not.toContain('/7');
        expect(tile).not.toContain('/ 7');
    });

    test('no completedDays read remains in the report path', async () => {
        /* Source level, not a rendered value: the tile could coincidentally
           agree on a day when both numbers matched. */
        const body = await app.page.evaluate(() =>
            showWeeklyReport.toString().replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' '));
        expect(body).not.toContain('completedDays');
        expect(body).toContain('currentWeekCompletion');
    });

    test('a report window with history but no current prescription still renders', async () => {
        const out = await app.page.evaluate(() => {
            /* Historical sessions inside the window, and an all-rest week, so
               the canonical target is zero. */
            persisted.dayPlans = persisted.dayPlans.map(p => ({ date: p.date, mode: 'rest' }));
            persisted.sessionLog = [{ date: new Date(Date.now() - 2 * 864e5).toISOString(),
                                      routineType: 'length', xpEarned: 15 }];
            showWeeklyReport();
            const text = document.getElementById('weekly-report-content').textContent;
            const w = currentWeekCompletion();
            closeWeeklyReport();
            return { text, completed: w.completed, target: w.target };
        });
        expect(out.target).toBe(0);
        expect(out.completed).toBe(0);
        expect(out.text).toContain('Programme Sessions');
        expect(out.text).toContain('0 / 0');
        expect(app.errors).toEqual([]);
    }, 60_000);
});

/**
 * THE NO-FALLBACK INVARIANT, as a test rather than a grep I ran once.
 *
 * Once onAuthoritativePlans() is true, persisted.schedule may not manufacture
 * today's Primary prescription. It stays present, it stays a projection, and
 * it stays required by consumers outside this path: notifyRules server side,
 * the progression ledger's live-week target, the legacy cohort's own
 * programme, the goal preset writer and the day picker.
 *
 * Structural, because a behavioural test can only cover the divergences
 * somebody thought of. If a future change reintroduces a read inside the
 * funnel, this fails whether or not a fixture happens to expose it.
 */
describe('nothing in the Today or session funnel reads the projection', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'pa', loaded: false });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    const FUNNEL = ['currentTodayPrescription', 'currentPrimarySatisfied', 'scheduledPrimaryType',
                    'isBlackoutDay', 'buildResolverInput', 'captureLaunchPrescription',
                    'startMission', 'finishSession', 'renderToday', 'renderReady', 'readyPlan',
                    'effectiveMission', 'resumeSession', 'getCurEx'];

    test.each(FUNNEL.map(n => [n]))('%s does not read persisted.schedule', async (name) => {
        const body = await app.page.evaluate((n) => {
            // eslint-disable-next-line no-eval
            return eval(n).toString().replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
        }, name);
        const reads = body.split('\n').filter(l => l.includes('persisted.schedule'));
        /* The ONE permitted mention: handing the column to the single
           interpreter as its LEGACY input. The adapter discards it when the
           member is authoritative, which is the boundary this phase built,
           and the mutation gate proves it discards it. Anything else is the
           projection deciding something. */
        for (const line of reads) {
            expect(line.trim(), `${name}: ${line.trim()}`).toMatch(/^legacySchedule:persisted\.schedule,$/);
        }
    });

    test('the compatibility consumers OUTSIDE the funnel still read it', async () => {
        /* The other half of the invariant. Removing the column is not the
           goal and would break the notification contract, the ledger's live
           target and the legacy cohort's programme. */
        const present = await app.page.evaluate(() => ({
            ledger: syncProgression.toString().includes('schedule:persisted.schedule'),
            savePayload: _buildSavePayload.toString().includes('persisted.schedule'),
            legacyWeek: renderWeekStrip.toString().includes('legacySchedule:persisted.schedule'),
            dayPicker: assignDay.toString().includes('persisted.schedule'),
            goalPreset: maybeApplyGoalSchedule.toString().includes('persisted.schedule'),
        }));
        expect(present).toEqual({ ledger: true, savePayload: true, legacyWeek: true,
                                  dayPicker: true, goalPreset: true });
    });
});

/**
 * A DRAFT FROM BEFORE THE SNAPSHOT EXISTED.
 *
 * Kept apart from the malformed-snapshot block on purpose, because these are
 * the two halves of a distinction that collapsed once already and must not
 * collapse again.
 *
 *   no `prescription` key      historical absence. The behaviour that existed
 *                              before 3C.4 applies, which was to resolve the
 *                              prescription at completion. The member keeps
 *                              their programme credit.
 *   `prescription: null`       a deliberate 3C.4 statement that the identity
 *                              could not be proven. Strict.
 *   a malformed snapshot       strict, and reported.
 *
 * The first draft of this phase turned absence into the second case, which
 * silently took credit away from any session in flight across the upgrade.
 */
describe('a genuine pre-3C.4 draft keeps the compatibility path', () => {
    let app, r;
    beforeAll(async () => {
        app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'pa', loaded: false });
        await load(app.page, row());
        r = await app.page.evaluate(() => {
            persisted.sessionLog = [];
            /* EXACTLY the shape an older shell wrote: the six fields it had,
               and no `prescription` key at all. Hand-built on purpose, because
               the point is a record this build never produces. */
            const legacyDraft = {
                /* A REAL position: the girth circuit has two stations, so an
                   index of 2 would make resumeSession throw inside the engine
                   before the identity question was ever reached. */
                exerciseIndex: 0, setIndex: 1, routineType: 'girth',
                directionalIndex: 0, xp: 0,
                sessionStartTime: Date.now() - 6e5, savedAt: Date.now(),
            };
            expect_hasNoKey = !('prescription' in legacyDraft);
            localStorage.setItem('bp_session_draft_' + currentUser.id, JSON.stringify(legacyDraft));
            /* Nothing in memory, as after a reload. */
            _launchedPrescription = null;
            _launchLegacyDraft = false;
            const errs = [];
            const realError = console.error;
            console.error = (...a) => { errs.push(a.map(String).join(' ')); };
            _planIntegrityReported = '';
            try {
                resumeSession();
                const afterResume = { snapshot: _launchedPrescription, legacy: _launchLegacyDraft };
                selectedEQ = 8; selectedRPE = 5;
                document.getElementById('input-bpel').value = '';
                document.getElementById('input-mseg').value = '';
                document.getElementById('session-note-input').value = '';
                finishSession();
                const e = persisted.sessionLog[persisted.sessionLog.length - 1];
                const w = currentWeekCompletion();
                closeSessionSummary();
                return { hasNoKey: expect_hasNoKey, afterResume,
                         reports: errs.filter(x => x.includes('integrity')).length,
                         recorded: { date: e.date, prescriptionDate: e.prescriptionDate,
                                     scheduledType: e.scheduledType, routineType: e.routineType,
                                     manualOverride: e.manualOverride },
                         satisfied: w.satisfied, weekCompleted: w.completed };
            } finally { console.error = realError; }
        });
    }, 120_000);
    afterAll(async () => { await app?.close(); });

    test('the fixture really has no prescription key', () => {
        expect(r.hasNoKey).toBe(true);
    });

    test('resume marks it as a legacy draft rather than adopting a snapshot', () => {
        expect(r.afterResume.snapshot).toBeNull();
        expect(r.afterResume.legacy).toBe(true);
    });

    test('and it is NOT reported, because absence is not a bad write', () => {
        expect(r.reports).toBe(0);
    });

    test('the completion resolves the prescription, exactly as it did before 3C.4', () => {
        /* Thursday in the size week is girth, and the resumed draft is girth,
           so the programme is followed and recorded as followed. */
        expect(r.recorded.prescriptionDate).toBe('2026-03-12');
        expect(r.recorded.scheduledType).toBe('girth');
        expect(r.recorded.routineType).toBe('girth');
        expect(r.recorded.manualOverride).toBe(false);
    });

    test('so the member keeps their programme credit', () => {
        /* The behaviour the first draft of this phase removed. Thursday is
           Sunday-index 4. */
        expect(r.satisfied[4]).toBe(true);
        expect(r.weekCompleted).toBeGreaterThanOrEqual(1);
    });

    test('an explicit null draft does NOT take this door', async () => {
        /* The guard. Same resume path, same session, and the only difference
           is that the key is present and says null. */
        const n = await app.page.evaluate(() => {
            persisted.sessionLog = [];
            const d = { exerciseIndex: 0, setIndex: 1, routineType: 'girth',
                        directionalIndex: 0, xp: 0,
                        sessionStartTime: Date.now() - 6e5, savedAt: Date.now(),
                        prescription: null };
            localStorage.setItem('bp_session_draft_' + currentUser.id, JSON.stringify(d));
            _launchedPrescription = null; _launchLegacyDraft = false;
            resumeSession();
            const legacy = _launchLegacyDraft;
            selectedEQ = 8; selectedRPE = 5;
            document.getElementById('input-bpel').value = '';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = '';
            finishSession();
            const e = persisted.sessionLog[persisted.sessionLog.length - 1];
            const w = currentWeekCompletion();
            closeSessionSummary();
            return { legacy, prescriptionDate: e.prescriptionDate,
                     scheduledType: e.scheduledType, routineType: e.routineType,
                     satisfied: w.satisfied };
        });
        expect(n.legacy).toBe(false);
        expect(n.prescriptionDate).toBeNull();
        expect(n.scheduledType).toBeNull();
        /* The work is still kept. */
        expect(n.routineType).toBe('girth');
        /* And it still satisfies nothing. */
        expect(n.satisfied[4]).toBe(false);
    }, 60_000);

    test('a malformed snapshot does not take it either, and IS reported', async () => {
        const m = await app.page.evaluate(() => {
            persisted.sessionLog = [];
            const d = { exerciseIndex: 0, setIndex: 1, routineType: 'girth',
                        directionalIndex: 0, xp: 0,
                        sessionStartTime: Date.now() - 6e5, savedAt: Date.now(),
                        prescription: { source: 'dated-plan', prescriptionDate: '2026-3-12',
                                        scheduledType: 'girth' } };
            localStorage.setItem('bp_session_draft_' + currentUser.id, JSON.stringify(d));
            _launchedPrescription = null; _launchLegacyDraft = false;
            const errs = [];
            const realError = console.error;
            console.error = (...a) => { errs.push(a.map(String).join(' ')); };
            _planIntegrityReported = '';
            try {
                resumeSession();
                const legacy = _launchLegacyDraft;
                selectedEQ = 8; selectedRPE = 5;
                document.getElementById('input-bpel').value = '';
                document.getElementById('input-mseg').value = '';
                document.getElementById('session-note-input').value = '';
                finishSession();
                const e = persisted.sessionLog[persisted.sessionLog.length - 1];
                closeSessionSummary();
                return { legacy, reports: errs.filter(x => x.includes('integrity')).length,
                         prescriptionDate: e.prescriptionDate, routineType: e.routineType };
            } finally { console.error = realError; }
        });
        expect(m.legacy).toBe(false);
        expect(m.reports).toBe(1);
        expect(m.prescriptionDate).toBeNull();
        expect(m.routineType).toBe('girth');
        expect(app.errors).toEqual([]);
    }, 60_000);
});

/**
 * THE COMMIT BOUNDARY IS REAL, not a comment above a line.
 *
 * It used to sit above sessionLog.push() with the XP award and the lifetime
 * count already applied, so a throw between the increment and the push left
 * durable state moved and the guard still unset. The retry then awarded XP
 * twice for one session. A boundary you can throw inside is not a boundary.
 *
 * Every pre-commit seam is forced to throw in turn, and after each one the
 * five durable facts must be untouched and the finish must still work.
 */
describe('a throw at any pre-commit seam leaves nothing behind', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'pa', loaded: false });
        await load(app.page, row());
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    /* The DOM reads and the one function call that happen before the commit.
       Each is made to throw once. */
    const SEAMS = ['input-bpel', 'input-mseg', 'session-note-input'];

    test.each(SEAMS.map(s => [s]))('a throw reading %s leaves state untouched', async (seam) => {
        const r = await app.page.evaluate((id) => {
            persisted.sessionLog = []; persisted.totalXp = 100;
            persisted.allTimeSessionCount = 5; persisted.measurements = [];
            persisted.completedDays = [false, false, false, false, false, false, false];
            const res = window.BP.nextBestAction(buildResolverInput());
            readyPlan(res).go();
            selectedEQ = 8; selectedRPE = 5;
            _sessionStartTime = Date.now() - 6e5;
            document.getElementById('input-bpel').value = '1.5';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = 'note';

            const before = { log: persisted.sessionLog.length, xp: persisted.totalXp,
                             count: persisted.allTimeSessionCount,
                             meas: persisted.measurements.length,
                             ticks: persisted.completedDays.filter(Boolean).length };
            const realGet = document.getElementById.bind(document);
            let fired = false;
            document.getElementById = (x) => {
                if (x === id && !fired) { fired = true; throw new Error('seam:' + x); }
                return realGet(x);
            };
            let threw = null;
            try { finishSession(); } catch (e) { threw = String(e); }
            document.getElementById = realGet;
            const after = { log: persisted.sessionLog.length, xp: persisted.totalXp,
                            count: persisted.allTimeSessionCount,
                            meas: persisted.measurements.length,
                            ticks: persisted.completedDays.filter(Boolean).length };
            /* And the retry must work, which is the other half of the rule. */
            finishSession();
            const retried = { log: persisted.sessionLog.length, xp: persisted.totalXp,
                              count: persisted.allTimeSessionCount,
                              meas: persisted.measurements.length };
            closeSessionSummary();
            return { threw, before, after, retried };
        }, seam);

        expect(r.threw).toContain('seam:' + seam);
        /* NOTHING durable moved. */
        expect(r.after).toEqual(r.before);
        /* And exactly one completion on the retry. */
        expect(r.retried.log).toBe(1);
        expect(r.retried.xp).toBe(r.before.xp + 15);        // intermediate tier
        expect(r.retried.count).toBe(r.before.count + 1);
        expect(r.retried.meas).toBe(1);
    }, 90_000);

    test('a throw resolving the prescription leaves state untouched too', async () => {
        /* The one non-DOM pre-commit call, reached on the legacy-draft path. */
        const r = await app.page.evaluate(() => {
            persisted.sessionLog = []; persisted.totalXp = 100;
            persisted.allTimeSessionCount = 5; persisted.measurements = [];
            const res = window.BP.nextBestAction(buildResolverInput());
            readyPlan(res).go();
            selectedEQ = 8; selectedRPE = 5;
            _sessionStartTime = Date.now() - 6e5;
            document.getElementById('input-bpel').value = '';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = '';
            /* Force the legacy-draft branch, then break what it calls. */
            _launchedPrescription = null;
            _launchLegacyDraft = true;
            const real = window.BP.launchSnapshotFrom;
            window.BP.launchSnapshotFrom = () => { throw new Error('seam:resolve'); };
            const before = { log: persisted.sessionLog.length, xp: persisted.totalXp,
                             count: persisted.allTimeSessionCount };
            let threw = null;
            try { finishSession(); } catch (e) { threw = String(e); }
            window.BP.launchSnapshotFrom = real;
            const after = { log: persisted.sessionLog.length, xp: persisted.totalXp,
                            count: persisted.allTimeSessionCount };
            finishSession();
            const retried = { log: persisted.sessionLog.length, xp: persisted.totalXp };
            closeSessionSummary();
            return { threw, before, after, retried };
        });
        expect(r.threw).toContain('seam:resolve');
        expect(r.after).toEqual(r.before);
        expect(r.retried.log).toBe(1);
        expect(r.retried.xp).toBe(r.before.xp + 15);
    }, 90_000);

    test('a throw AFTER the lists are built still leaves nothing behind', async () => {
        /* The last derivation seam, and the one that makes the "build a copy"
           rule observable rather than merely tidy. trimToByteBudget runs
           after the compatibility array has been assembled, so if that
           assembly ticked the LIVE array instead of a copy, a throw here
           would leave the member's week changed with nothing committed. */
        const r = await app.page.evaluate(() => {
            persisted.sessionLog = []; persisted.totalXp = 100;
            persisted.allTimeSessionCount = 5; persisted.measurements = [];
            persisted.completedDays = [false, false, false, false, false, false, false];
            /* A LEGACY member, because they are the only cohort whose
               compatibility array is written at all. */
            persisted.programme = window.__legacyProgramme();
            persisted.dayPlans = [];
            persisted.schedule = Array(7).fill('length');
            renderToday();
            const res = window.BP.nextBestAction(buildResolverInput());
            readyPlan(res).go();
            selectedEQ = 8; selectedRPE = 5;
            _sessionStartTime = Date.now() - 6e5;
            document.getElementById('input-bpel').value = '';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = '';

            const before = { log: persisted.sessionLog.length, xp: persisted.totalXp,
                             count: persisted.allTimeSessionCount,
                             ticks: persisted.completedDays.filter(Boolean).length };
            const real = trimToByteBudget;
            let fired = false;
            trimToByteBudget = (...a) => {
                if (!fired) { fired = true; throw new Error('seam:trim'); }
                return real(...a);
            };
            let threw = null;
            try { finishSession(); } catch (e) { threw = String(e); }
            trimToByteBudget = real;
            const after = { log: persisted.sessionLog.length, xp: persisted.totalXp,
                            count: persisted.allTimeSessionCount,
                            ticks: persisted.completedDays.filter(Boolean).length };
            finishSession();
            const retried = { log: persisted.sessionLog.length,
                              ticks: persisted.completedDays.filter(Boolean).length };
            closeSessionSummary();
            return { threw, before, after, retried };
        });
        expect(r.threw).toContain('seam:trim');
        /* Including the compatibility array, which is the point. */
        expect(r.after).toEqual(r.before);
        expect(r.after.ticks).toBe(0);
        expect(r.retried.log).toBe(1);
        expect(r.retried.ticks).toBe(1);
    }, 90_000);

    test('the commit itself is five writes and one guard, in one place', async () => {
        /* Structural, because the invariant is about ORDER and a behavioural
           test can only catch the seams somebody thought to force. The guard
           must be raised before the first durable write, so a re-entrant call
           cannot land between them. */
        const body = await app.page.evaluate(() => finishSession.toString()
            .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' '));
        const idx = (needle) => body.indexOf(needle);
        const guard = idx("_finishState='committed'");
        expect(guard).toBeGreaterThan(0);
        for (const write of ['persisted.sessionLog=', 'persisted.totalXp=',
                             'persisted.allTimeSessionCount=', 'persisted.measurements=',
                             'persisted.completedDays=']) {
            expect(idx(write), write).toBeGreaterThan(guard);
        }
        /* And every one of them is installed by REPLACEMENT or scalar
           assignment, never assembled in place on the far side of the
           boundary. completedDays was the last holdout: an in-place
           persisted.completedDays[i]=true inside the commit still built
           durable state after the guard, which is the shape of defect this
           split exists to make impossible rather than merely unlikely. The
           weekday write now happens on a local copy during derivation. */
        expect(body, 'in-place completedDays write').not.toMatch(/persisted\.completedDays\s*\[/);
        expect(body).toMatch(/persisted\.completedDays\s*=\s*_nextCompletedDays/);
        for (const push of [/persisted\.sessionLog\.push\(/, /persisted\.measurements\.push\(/]) {
            expect(body, String(push)).not.toMatch(push);
        }
        /* And no durable MUTATION sneaks in above the guard. Mutations only:
           the derivation half reads persisted.totalXp and persisted.sessionLog
           to compute the next values, which is the whole point of splitting
           the function in two. */
        const head = body.slice(0, guard);
        const MUTATIONS = [
            [/persisted\.totalXp\s*(\+?=)/, 'totalXp assignment'],
            [/persisted\.allTimeSessionCount\s*(\+?=)/, 'allTimeSessionCount assignment'],
            [/persisted\.sessionLog\s*=/, 'sessionLog assignment'],
            [/persisted\.sessionLog\.push\(/, 'sessionLog.push'],
            [/persisted\.measurements\s*=/, 'measurements assignment'],
            [/persisted\.measurements\.push\(/, 'measurements.push'],
            [/persisted\.completedDays\[/, 'completedDays write'],
        ];
        for (const [re, label] of MUTATIONS) {
            expect(head, `${label} before the guard`).not.toMatch(re);
        }
    });
});
