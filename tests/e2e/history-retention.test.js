import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * History retention, trim observability, and rollback DATA compatibility.
 *
 * Three separate questions, deliberately not mixed:
 *
 *   1. When trimming removes history, is that observable? It used to be
 *      completely silent.
 *   2. Can a 3C.4 reader still read 3C.5-shaped data without crashing or
 *      destroying it? This is a DATA compatibility question. It is NOT a
 *      claim that reverted code preserves execution-dose authority, which by
 *      definition it cannot: rollback restores dynamic execution.
 *   3. Can a malformed historical entry reach into current prescription or
 *      execution authority? It must not.
 *
 * Cross-tab and multi-device conflict resolution are 3C.6 and are not here.
 */

const THU = new Date(Date.UTC(2026, 2, 12, 12));
const SIZE = ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'];

/** A 3C.4-shaped entry: every field that existed before 3C.5, and no more. */
const entry34 = (i, note = '') => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
    routineType: 'girth',
    prescriptionDate: '2026-01-05',
    scheduledType: 'girth',
    manualOverride: false,
    xpEarned: 15, note, eq: 8, rpe: 5, duration: 22,
});

/** The same entry as 3C.5 writes it: the six new fields, and nothing else. */
const NEW_FIELDS = ['doseVersion', 'prescribedDose', 'executedDose',
                    'appliedModifiers', 'planMode', 'readinessInput'];
const entry35 = (i, note = '') => ({
    ...entry34(i, note),
    doseVersion: 1,
    prescribedDose: { v: 1, shape: 'circuit', tier: 'intermediate', rounds: 4, restDur: 45,
                      stations: [{ title: 'Wet Jelq', duration: 120 }] },
    executedDose: { v: 1, shape: 'circuit', tier: 'intermediate', rounds: 4, restDur: 45,
                    stations: [{ title: 'Wet Jelq', duration: 120 }] },
    appliedModifiers: [], planMode: 'prescribed', readinessInput: 'none',
});

const row = (over = {}) => ({
    id: 'ex', total_xp: 500, difficulty: 'intermediate', schedule: SIZE,
    completed_days: [false, false, false, false, false, false, false],
    session_log: [], measurements: [], seen_milestones: [],
    all_time_session_count: 20, xp_migrated: true, week_key: '',
    primary_goal: 'size', programme: null, day_plans: [], pelvic_profile: 'standard',
    updated_at: '2026-03-12T00:00:00.000Z', ...over,
});

/** Complete one real session and report any trim telemetry it emitted. */
const completeAndReadTelemetry = (page, serverRow) => page.evaluate(async (r) => {
    try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
    try { localStorage.setItem(getTodaySorenessKey(), 'none'); } catch (e) {}
    window.__row = r;
    await loadPersisted();
    _launchedPrescription = null; _frozenSteps = null; _frozenFor = null;
    renderDashboard();
    _analyticsBuffer.length = 0;                 // only this completion's events
    const res = window.BP.nextBestAction(buildResolverInput());
    readyPlan(res).go();
    const before = persisted.sessionLog.length;
    selectedEQ = 8; selectedRPE = 5;
    _sessionStartTime = Date.now() - 6e5;
    document.getElementById('input-bpel').value = '';
    document.getElementById('input-mseg').value = '';
    document.getElementById('session-note-input').value = '';
    finishSession();
    const ev = _analyticsBuffer.filter(e => e.event === 'session_log_trimmed');
    closeSessionSummary();
    return {
        launched: !!session.routineType,
        logBefore: before, logAfter: persisted.sessionLog.length,
        events: ev.map(e => e.props),
        eventCount: ev.length,
        allEventNames: _analyticsBuffer.map(e => e.event),
    };
}, serverRow);

describe('trimming is observable', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex', loaded: false });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('a log under the budget emits NO trim event', async () => {
        const o = await completeAndReadTelemetry(app.page, row({
            session_log: Array.from({ length: 5 }, (_, i) => entry35(i)),
        }));
        expect(o.launched).toBe(true);
        expect(o.eventCount).toBe(0);
        expect(o.logAfter).toBe(o.logBefore + 1);      // the new session, nothing lost
    }, 120_000);

    test('A LOG OVER THE BUDGET EMITS EXACTLY ONE TRIM EVENT', async () => {
        /* Padded entries so the budget is genuinely exceeded. Seeding the
           state is fine; the trim itself is the real production code. */
        const o = await completeAndReadTelemetry(app.page, row({
            session_log: Array.from({ length: 620 }, (_, i) => entry34(i, 'x'.repeat(450))),
        }));
        expect(o.launched).toBe(true);
        expect(o.eventCount).toBe(1);
        const p = o.events[0];
        expect(p.entries_removed).toBeGreaterThan(0);
        expect(p.entries_after).toBeLessThan(p.entries_before);
        expect(p.entries_before - p.entries_after).toBe(p.entries_removed);
        expect(p.bytes_after).toBeLessThan(p.bytes_before);
        expect(p.bytes_after).toBeLessThanOrEqual(p.budget);
        expect(p.trigger).toBe('session_complete');
        /* The 10% chunk rule, made visible: trimming is a sawtooth, not a
           one-entry-at-a-time erosion. */
        expect(p.entries_removed).toBeGreaterThan(1);
    }, 120_000);

    test('and the event carries NO member content of any kind', async () => {
        const o = await completeAndReadTelemetry(app.page, row({
            session_log: Array.from({ length: 620 }, (_, i) =>
                entry34(i, 'SECRET-NOTE-' + 'x'.repeat(440))),
        }));
        const p = o.events[0];
        const serialised = JSON.stringify(p);
        expect(serialised).not.toContain('SECRET-NOTE');
        expect(serialised).not.toContain('Wet Jelq');
        /* Every value is a number or a short enum, which is also what
           _cleanProps would have enforced anyway. */
        for (const [k, v] of Object.entries(p)) {
            expect(['number', 'string']).toContain(typeof v);
            if (typeof v === 'string') expect(v.length).toBeLessThanOrEqual(40);
        }
        expect(Object.keys(p).sort()).toEqual(['budget', 'bytes_after', 'bytes_before',
            'entries_after', 'entries_before', 'entries_removed', 'trigger']);
    }, 120_000);

    test('telemetry failure never blocks the completion', async () => {
        const o = await app.page.evaluate(async (r) => {
            try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
            try { localStorage.setItem(getTodaySorenessKey(), 'none'); } catch (e) {}
            window.__row = r;
            await loadPersisted();
            _launchedPrescription = null; _frozenSteps = null; _frozenFor = null;
            renderDashboard();
            /* Fail ONLY the trim event. Stubbing track() wholesale would
               break the pre-existing unguarded call sites in this path and
               prove nothing about the one added here. */
            const realTrack = window.track;
            window.track = (ev, props) => {
                if (ev === 'session_log_trimmed') throw new Error('telemetry is down');
                return realTrack(ev, props);
            };
            let threw = null;
            try {
                const res = window.BP.nextBestAction(buildResolverInput());
                readyPlan(res).go();
                selectedEQ = 8; selectedRPE = 5;
                _sessionStartTime = Date.now() - 6e5;
                document.getElementById('input-bpel').value = '';
                document.getElementById('input-mseg').value = '';
                document.getElementById('session-note-input').value = '';
                finishSession();
            } catch (e) { threw = String(e); }
            window.track = realTrack;
            const last = persisted.sessionLog[persisted.sessionLog.length - 1];
            try { closeSessionSummary(); } catch (e) {}
            return { threw, xp: persisted.totalXp, count: persisted.allTimeSessionCount,
                     recorded: !!last && last.routineType === 'girth' };
        }, row({ session_log: Array.from({ length: 620 }, (_, i) => entry34(i, 'x'.repeat(450))) }));
        expect(o.threw).toBeNull();
        expect(o.recorded).toBe(true);
        expect(o.count).toBe(21);
    }, 120_000);
});

describe('rollback: a 3C.4 reader on 3C.5 data', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex', loaded: false });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('the six new fields are purely ADDITIVE', () => {
        /* Strip exactly what 3C.5 added and what remains must be, field for
           field, the record 3C.4 wrote. That is what makes an old reader
           safe: it sees precisely what it always saw. */
        const full = entry35(1, 'a note');
        const stripped = { ...full };
        for (const f of NEW_FIELDS) delete stripped[f];
        expect(stripped).toEqual(entry34(1, 'a note'));
        for (const f of NEW_FIELDS) expect(full[f]).not.toBeUndefined();
    });

    test('LOADING 3C.5 HISTORY DOES NOT REWRITE OR DROP ANYTHING', async () => {
        const o = await app.page.evaluate(async (r) => {
            try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
            window.__row = r;
            const sent = JSON.parse(JSON.stringify(r.session_log));
            await loadPersisted();
            renderDashboard();
            return { sent, got: JSON.parse(JSON.stringify(persisted.sessionLog)) };
        }, row({ session_log: [entry35(1, 'keep me'), entry34(2, 'old shape')] }));
        /* Byte-for-byte: no normalisation, no coercion, no field dropped.
           A rollback therefore cannot destroy data merely by loading it. */
        expect(o.got).toEqual(o.sent);
    }, 120_000);

    test('prescription identity stays readable on an old-shaped read', async () => {
        const o = await app.page.evaluate(async (r) => {
            try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
            window.__row = r;
            await loadPersisted();
            const e = persisted.sessionLog[0];
            /* The fields 3C.4 read for attribution, read the 3C.4 way. */
            return { prescriptionDate: e.prescriptionDate, scheduledType: e.scheduledType,
                     routineType: e.routineType, date: e.date, xpEarned: e.xpEarned };
        }, row({ session_log: [entry35(1)] }));
        expect(o.prescriptionDate).toBe('2026-01-05');
        expect(o.scheduledType).toBe('girth');
        expect(o.routineType).toBe('girth');
        expect(typeof o.xpEarned).toBe('number');
    }, 120_000);

    test('a field NEITHER version understands is ignored, not dropped', async () => {
        /* The mechanism behind old-reader safety: the log is passed through
           field-agnostically. If an unknown key survives untouched, then
           3C.5's keys survive untouched in an old reader too. */
        const o = await app.page.evaluate(async (r) => {
            try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
            window.__row = r;
            await loadPersisted();
            renderDashboard();
            return JSON.parse(JSON.stringify(persisted.sessionLog[0]));
        }, row({ session_log: [{ ...entry35(1), someFutureField: { nested: [1, 2, 3] } }] }));
        expect(o.someFutureField).toEqual({ nested: [1, 2, 3] });
        expect(o.executedDose).not.toBeUndefined();
    }, 120_000);

    test('a 3C.5 DRAFT resumes without crashing and keeps its identity', async () => {
        const o = await app.page.evaluate(async (r) => {
            try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
            window.__row = r;
            await loadPersisted();
            renderDashboard();
            localStorage.setItem('bp_session_draft_' + currentUser.id, JSON.stringify({
                v: 1, exerciseIndex: 1, setIndex: 2, routineType: 'girth',
                directionalIndex: 0, xp: 10, girthRound: 3, girthTotalRounds: 4,
                sessionStartTime: Date.now() - 6e5, savedAt: Date.now(),
                prescription: { source: 'dated-plan', prescriptionDate: '2026-03-12',
                    scheduledType: 'girth', performedType: 'girth', planMode: 'prescribed',
                    doseVersion: 1, appliedModifiers: [], readinessInput: 'none',
                    executionDose: { v: 1, shape: 'circuit', tier: 'intermediate',
                        rounds: 4, restDur: 45,
                        stations: [{ title: 'Wet Jelq', duration: 120 }] },
                    prescribedDose: { v: 1, shape: 'circuit', tier: 'intermediate',
                        rounds: 4, restDur: 45,
                        stations: [{ title: 'Wet Jelq', duration: 120 }] },
                    someFutureField: 'ignored' },
            }));
            let threw = null;
            try { resumeSession(); } catch (e) { threw = String(e); }
            return { threw, type: session.routineType, round: session.girthRound,
                     identity: _launchedPrescription
                         ? _launchedPrescription.prescriptionDate : null };
        }, row());
        expect(o.threw).toBeNull();
        expect(o.type).toBe('girth');
        expect(o.identity).toBe('2026-03-12');
        expect(app.errors).toEqual([]);
    }, 120_000);
});

describe('malformed history cannot reach current authority', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THU, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ex', loaded: false });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    /** Load a deliberately broken log, then ask the authoritative questions. */
    const withLog = (session_log) => app.page.evaluate(async (r) => {
        try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
        window.__row = r;
        let threw = null;
        try {
            await loadPersisted();
            renderDashboard();
            renderToday();
        } catch (e) { threw = String(e); }
        const pres = typeof currentTodayPrescription === 'function'
            ? currentTodayPrescription() : null;
        return {
            threw,
            prescriptionOk: !!(pres && pres.ok === true),
            primaryType: pres && pres.ok === true ? pres.primaryType : null,
            scheduled: scheduledPrimaryType(),
            logIsArray: Array.isArray(persisted.sessionLog),
        };
    }, row({ session_log }));

    const CASES = {
        'null':              null,
        'missing':           undefined,
        'not an array':      { nope: true },
        'a string':          'not a log',
        'entries that are null':      [null, null],
        'entries that are primitives': [1, 'two', true],
        'an entry with no date':      [{ routineType: 'girth', xpEarned: 5 }],
        'an entry with a null dose':  [{ ...entry35(1), executedDose: null }],
        'an entry with a broken dose': [{ ...entry35(1), executedDose: { v: 1, shape: 'nope' } }],
        'an entry with legacy types': [{ ...entry34(1), xpEarned: '15', eq: null, duration: 'x' }],
        'a duplicated entry':         [entry35(1), entry35(1)],
    };

    for (const [label, log] of Object.entries(CASES)) {
        test(`${label}: today still resolves and nothing throws`, async () => {
            const o = await withLog(log);
            expect(o.threw).toBeNull();
            /* The authoritative question is unaffected by broken history:
               Thursday is girth because the PLAN says so. */
            expect(o.prescriptionOk).toBe(true);
            expect(o.primaryType).toBe('girth');
            expect(o.scheduled).toBe('girth');
            expect(o.logIsArray).toBe(true);
        }, 120_000);
    }
});
