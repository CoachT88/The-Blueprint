import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, authSignIn } from './harness.js';

/**
 * The authority transition, through the real load.
 *
 * The unit suite proves the arithmetic. This proves the things it cannot: that
 * the page hands the generator the real routine tables, that a cutover member
 * ends up with their week derived from their plans, and that the two paths
 * which used to write the seven-slot column directly can no longer create a
 * second programme truth.
 *
 * The property that matters most in version 1 is that the compatibility write
 * is a NO-OP on the column. The generated week is the member's existing week,
 * so the seven slots written back are the seven already there, which is why
 * the server-side notification contract cannot break for the migrated cohort.
 */

const DEFAULT_WEEK = ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'];
const STAMINA_WEEK = ['stamina', 'rest', 'stamina', 'rest', 'stamina', 'rest', 'rest'];
const EQ_WEEK      = ['stamina', 'rest', 'length', 'rest', 'stamina', 'rest', 'rest'];
const ALL_WEEK     = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
const HANDMADE     = ['girth', 'girth', 'rest', 'girth', 'rest', 'stamina', 'rest'];

const row = (over = {}) => ({
    id: 'c', total_xp: 500, difficulty: 'intermediate',
    schedule: DEFAULT_WEEK, completed_days: [false, false, false, false, false, false, false],
    session_log: [], measurements: [], seen_milestones: [],
    all_time_session_count: 20, xp_migrated: true, week_key: '',
    programme: null, day_plans: [],
    updated_at: new Date().toISOString(),
    ...over,
});

describe('the page hands over the real routine tables', () => {
    /* The generator takes its tables as arguments so there is only one
       definition of every dose. That only holds while the page passes the
       real ones, and the unit suite's copies only mean something while they
       match the page. */
    let app, real;
    beforeAll(async () => {
        app = await openApp();
        real = await app.page.evaluate(() => ({
            length: ROUTINES.length.map(e => ({ title: e.title, sets: e.sets, duration: e.duration, dir: !!e.isDirectional })),
            girthTitles: ROUTINES.girth.map(e => e.title),
            stamina: ROUTINES.stamina.map(e => ({ title: e.title, sets: e.sets, duration: e.duration, restDur: e.restDur })),
            circuit: GIRTH_CIRCUIT,
            tiers: DIFFICULTIES.map(d => ({ id: d.id, setsOffset: d.setsOffset, durationMult: d.durationMult })),
            directionals: DIRECTIONALS.length,
            exExperience: Object.keys(EX_EXPERIENCE).length,
        }));
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the set-based doses are what the unit suite asserts against', () => {
        expect(real.length).toEqual([
            { title: 'Directional Pulls', sets: 3, duration: 30, dir: true },
            { title: 'V-Stretch', sets: 3, duration: 30, dir: false },
        ]);
        expect(real.stamina[0].sets).toBe(3);
        expect(real.stamina[0].duration).toBe(120);
        expect(real.stamina[1].restDur).toBe(30);
    });

    test('the girth circuit table is what the unit suite asserts against', () => {
        expect(real.circuit.intermediate).toEqual({ rounds: 4, jelqDur: 120, uliDur: 45, restDur: 45 });
        expect(real.circuit.elite).toEqual({ rounds: 5, jelqDur: 180, uliDur: 60, restDur: 60 });
    });

    test('the girth station titles still discriminate the two durations', () => {
        /* getCurEx picks jelqDur by title. If a title changes, the dose
           silently swaps, so this says so first. */
        expect(real.girthTitles[0]).toBe('Wet Jelq');
        expect(real.girthTitles).toHaveLength(2);
    });

    test('the tier offsets are what the unit suite asserts against', () => {
        expect(real.tiers).toEqual([
            { id: 'beginner', setsOffset: -1, durationMult: 0.5 },
            { id: 'intermediate', setsOffset: 0, durationMult: 1 },
            { id: 'advanced', setsOffset: 1, durationMult: 1.5 },
            { id: 'elite', setsOffset: 2, durationMult: 2 },
        ]);
        expect(real.directionals).toBe(5);
        expect(real.exExperience).toBe(0);     // empty in the page today
    });
});

describe('a preset member cuts over on load', () => {
    let app, state;
    beforeAll(async () => {
        app = await openApp({ row: null });
        await app.page.evaluate(() => localStorage.clear());
        await authSignIn(app.page, {
            id: 'st', email: 'st@x.com',
            row: row({ id: 'st', schedule: STAMINA_WEEK, primary_goal: 'stamina' }),
        });
        await app.page.evaluate(() => renderDashboard());
        state = await app.page.evaluate(() => ({
            programme: persisted.programme,
            schedule: persisted.schedule,
            plans: persisted.dayPlans,
            today: scheduledPrimaryType(),
            blackout: isBlackoutDay(),
        }));
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('they are on the Last Longer programme at content version 1', () => {
        expect(state.programme.key).toBe('lastLonger');
        expect(state.programme.version).toBe(1);
        expect(state.programme.cyclePosition).toBe(null);
    });

    test('automatic migration is not adoption, and provenance is untouched', () => {
        expect(state.programme.adoptedAt).toBe(null);
        expect(state.programme.custom).toBe(false);
        expect(state.programme.migration.source).toBe('preset');
        expect(state.programme.migration.presetKey).toBe('stamina');
        expect(state.programme.migration.reason).toBe('preset_shape_matches_stated_goal');
    });

    test('their week is derived from plans and is byte-identical to what it was', () => {
        /* VERSION 1. The generated week IS their week, so the compatibility
           write changes nothing. The day a programme varies week to week this
           stops being true, and this test is where that shows up. */
        expect(state.schedule).toEqual(STAMINA_WEEK);
    });

    test('the plans start today and run to the end of next week', () => {
        const today = new Date();
        const key = (d) => d.toISOString().slice(0, 10);
        expect(state.plans.length).toBeGreaterThanOrEqual(8);
        expect(state.plans.length).toBeLessThanOrEqual(14);
        expect(state.plans[0].date).toBe(key(today));
        /* No date before today: the no-backfill invariant, through the real
           load rather than in the arithmetic. */
        state.plans.forEach(p => expect(p.date >= key(today), p.date).toBe(true));
    });

    test('every plan carries resolved provenance and a resolved dose', () => {
        state.plans.forEach(p => {
            expect(p.generatedFrom).toEqual({ programmeKey: 'lastLonger', version: 1 });
            expect(p.status).toBe('pending');
            expect(p.supportingWork).toEqual([]);
            expect(p.dailyPractice).toEqual([]);
            expect(['prescribed', 'rest']).toContain(p.mode);
            if (p.primarySession) {
                expect(p.primarySession.dose.shape).toBe('sets');
                expect(p.primarySession.dose.tier).toBe('intermediate');
            }
        });
    });

    test('Today agrees with the projection, as it must', () => {
        /* PRE-EXISTING, DATE DEPENDENT, and a 3C.4 oversight of mine: this
           compared scheduledPrimaryType() against the raw projection slot,
           which agree on a training day and differ on a rest day, because the
           reader reports the PRIMARY type and a rest day has none. Two other
           sites were corrected when the reader was introduced and this one was
           missed, so the suite was green on a Thursday and red on a Friday.
           The rest/null rule is the assertion now. */
        const slot = state.schedule[new Date().getDay()];
        expect(state.today).toBe(slot === 'rest' ? null : slot);
        expect(state.blackout).toBe(slot === 'rest');
    });

    test('and Today really is read from the plan, not from the column', async () => {
        /* The two agree by construction, so the test above would pass whether
           or not the reader was switched. This one diverges them on purpose:
           edit today's PLAN only, and Today has to follow the plan. Reverted
           afterwards so the rest of the block is unaffected. */
        const r = await app.page.evaluate(() => {
            const key = window.BP.planDateKey(new Date());
            const plan = persisted.dayPlans.find(p => p.date === key);
            const was = JSON.parse(JSON.stringify(plan));
            const column = JSON.parse(JSON.stringify(persisted.schedule));

            plan.mode = 'rest';
            plan.primarySession = null;
            const asRest = { today: scheduledPrimaryType(), blackout: isBlackoutDay() };

            plan.mode = 'prescribed';
            /* A dose, because as of Phase 3C.5 a Primary without one fails
               closed rather than being rebuilt from the current tables. Real
               station titles: the dose-to-definition join is exact. */
            plan.primarySession = { type: 'girth', tier: 'intermediate',
                dose: { v: 1, shape: 'circuit', tier: 'intermediate', rounds: 4, restDur: 45,
                        stations: [{ title: 'Wet Jelq', duration: 120 },
                                   { title: 'Uli — Manual Clamp', duration: 45 }] } };
            const asGirth = { today: scheduledPrimaryType(), blackout: isBlackoutDay() };

            Object.assign(plan, was);
            return { asRest, asGirth, column, columnUnchanged: persisted.schedule };
        });
        /* scheduledPrimaryType() is the PRIMARY type or null, so a rest day
           answers null rather than the string 'rest'. The old reader returned
           'rest' for three different conditions at once, which is why it was
           retired; blackout is the question that actually matters here and it
           is still answered from the plan. */
        expect(r.asRest).toEqual({ today: null, blackout: true });
        expect(r.asGirth).toEqual({ today: 'girth', blackout: false });
        /* And editing the plan did not touch the compatibility column. */
        expect(r.columnUnchanged).toEqual(r.column);
        expect(app.errors).toEqual([]);
    });
});

describe('every migrated cohort keeps the week it already had', () => {
    /* The notification contract depends on this: notifyRules reads the
       column, Sunday-indexed, and suppresses on 'rest'. If cutover moved a
       slot, a reminder would start or stop arriving on the wrong day. */
    const CASES = [
        ['default week, no goal', DEFAULT_WEEK, '', 'size'],
        ['size preset',           DEFAULT_WEEK, 'size', 'size'],
        ['stamina preset',        STAMINA_WEEK, 'stamina', 'lastLonger'],
        ['eq preset',             EQ_WEEK, 'eq', 'erectionQuality'],
        ['all preset',            ALL_WEEK, 'all', 'everything'],
    ];
    let app, results;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'c', loaded: false });
        results = await app.page.evaluate(async (cases) => {
            const out = [];
            for (const [label, schedule, goal, key] of cases) {
                window.__row = {
                    id: 'c', total_xp: 500, difficulty: 'intermediate', schedule,
                    primary_goal: goal, programme: null, day_plans: [],
                    completed_days: [false, false, false, false, false, false, false],
                    session_log: [], all_time_session_count: 20, xp_migrated: true,
                    week_key: '', updated_at: new Date().toISOString(),
                };
                await loadPersisted();
                const before = JSON.parse(JSON.stringify(persisted.schedule));
                renderDashboard();
                window.__writes = [];
                _flushSaveNow();
                await new Promise(r => setTimeout(r, 60));
                out.push({
                    label, key, before, after: persisted.schedule,
                    written: (window.__writes[0] || {}).schedule,
                    gotKey: persisted.programme && persisted.programme.key,
                    plans: persisted.dayPlans.length,
                });
            }
            return out;
        }, CASES);
    }, 120_000);
    afterAll(async () => { await app?.close(); });

    test('all five cohorts cut over', () => {
        expect(results).toHaveLength(5);
        results.forEach(r => {
            expect(r.gotKey, r.label).toBe(r.key);
            expect(r.plans, r.label).toBeGreaterThanOrEqual(8);
        });
    });

    test('the column is identical in memory after cutover', () => {
        const moved = results.filter(r => JSON.stringify(r.before) !== JSON.stringify(r.after));
        expect(moved.map(r => r.label)).toEqual([]);
    });

    test('and the column the next upsert sends is identical too', () => {
        const wrong = results.filter(r => JSON.stringify(r.written) !== JSON.stringify(r.before));
        expect(wrong.map(r => r.label)).toEqual([]);
        expect(app.errors).toEqual([]);
    });
});

describe('a custom member is left entirely alone', () => {
    let app, state;
    beforeAll(async () => {
        app = await openApp({ row: null });
        await app.page.evaluate(() => localStorage.clear());
        await authSignIn(app.page, {
            id: 'cu', email: 'cu@x.com',
            row: row({ id: 'cu', schedule: HANDMADE, primary_goal: 'size' }),
        });
        await app.page.evaluate(() => renderDashboard());
        state = await app.page.evaluate(() => ({
            programme: persisted.programme,
            schedule: persisted.schedule,
            plans: persisted.dayPlans,
            mayGenerate: window.BP.mayGenerateOver(persisted.programme),
            today: scheduledPrimaryType(),
            blackout: isBlackoutDay(),
        }));
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('nothing is generated and nothing is projected', () => {
        expect(state.mayGenerate).toBe(false);
        expect(state.programme.custom).toBe(true);
        expect(state.programme.key).toBe(null);
        expect(state.plans).toEqual([]);
    });

    test('their week is exactly the week they built', () => {
        expect(state.schedule).toEqual(HANDMADE);
    });

    test('Today reads their own column, because for them it IS the programme', () => {
        /* Not a fallback. A custom member is never on dated plans, so the
           adapter's legacy branch is their normal path and the column is
           authoritative for them. scheduledPrimaryType() reports the PRIMARY
           type, so a rest slot answers null while blackout answers true. */
        const want = HANDMADE[new Date().getDay()];
        expect(state.today).toBe(want === 'rest' ? null : want);
        expect(state.blackout).toBe(want === 'rest');
        expect(app.errors).toEqual([]);
    });
});

describe('a broken authoritative Today fails closed, loudly', () => {
    /* REWRITTEN IN PHASE 3C.4, and the change is the point of that phase.
       This block used to assert that a missing or unreadable dated plan fell
       back to the compatibility column: the integrity failure was reported
       and then the member was prescribed whatever the recurring projection
       said. That is the authority leak 3C.4 closes. The programme claims
       dated plans are authoritative, so when today's cannot be read the
       honest answer is that we do not know, not a mechanical session invented
       from a derived array.

       The report stays, and so does everything about not touching authority
       from a read.

       renderDashboard is stubbed around each probe, and that is the point
       rather than a convenience: the cutover would regenerate a missing
       Today before the assertion could see it, and a corrupt Today is
       deliberately preserved so the evidence survives. */
    let app;
    beforeAll(async () => {
        app = await openApp({ row: null });
        await app.page.evaluate(() => localStorage.clear());
        await authSignIn(app.page, {
            id: 'brk', email: 'brk@x.com',
            row: row({ id: 'brk', schedule: ALL_WEEK, primary_goal: 'all' }),
        });
        await app.page.evaluate(() => renderDashboard());
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    const probe = (mutate) => app.page.evaluate((how) => {
        const realRender = window.renderDashboard;
        window.renderDashboard = () => {};
        const key = window.BP.planDateKey(new Date());
        const plansBefore = JSON.parse(JSON.stringify(persisted.dayPlans));
        const keyBefore = persisted.programme.key;
        const errs = [];
        const realError = console.error;
        console.error = (...a) => { errs.push(a.map(String).join(' ')); };
        window.__writes = [];
        /* Reset the once-per-date guard so each probe is independent rather
           than quietly depending on which ran first. A top-level `let` in the
           app's script is a global lexical binding, assignable by bare name
           from here, same as currentUser in the harness. */
        _planIntegrityReported = '';
        try {
            const i = persisted.dayPlans.findIndex(p => p.date === key);
            if (how === 'missing') persisted.dayPlans.splice(i, 1);
            if (how === 'corrupt') persisted.dayPlans[i] = { date: key, mode: 'invented' };
            if (how === 'healthy') { /* leave it alone */ }
            const today = scheduledPrimaryType();
            const blackout = isBlackoutDay();
            const again = scheduledPrimaryType();          // many calls per render
            const thrice = scheduledPrimaryType();
            return {
                today, blackout, again, thrice,
                reports: errs.filter(e => e.includes('integrity')).length,
                reportText: errs.find(e => e.includes('integrity')) || '',
                keyAfter: persisted.programme.key,
                keyBefore,
                plansLen: persisted.dayPlans.length,
                plansBeforeLen: plansBefore.length,
                stored: persisted.dayPlans.find(p => p.date === key) || null,
                column: persisted.schedule,
            };
        } finally {
            console.error = realError;
            window.renderDashboard = realRender;
            persisted.dayPlans = plansBefore;
        }
    }, mutate);

    test('a healthy Today never takes the fallback and reports nothing', async () => {
        const r = await probe('healthy');
        expect(r.reports).toBe(0);
        const want = ALL_WEEK[new Date().getDay()];
        expect(r.today).toBe(want === 'rest' ? null : want);
    }, 30_000);

    test('a missing Today prescribes NOTHING and is reported once', async () => {
        const r = await probe('missing');
        /* THE LEAK, CLOSED. This asserted the column's value. The projection
           is derived output for this member, so reading it here manufactured
           a prescription out of an integrity failure. */
        expect(r.today).toBeNull();
        /* And no mechanical work may run, which is the consequence that
           matters: blackout is true because there is no Primary we can prove. */
        expect(r.blackout).toBe(true);
        expect(r.again).toBeNull();
        /* Reported, once, across four reader calls. */
        expect(r.reports).toBe(1);
        expect(r.reportText).toContain('missing');
        /* And authority is untouched by a read. */
        expect(r.keyAfter).toBe('everything');
        expect(r.keyAfter).toBe(r.keyBefore);
    }, 30_000);

    test('an unreadable Today prescribes nothing and is reported', async () => {
        const r = await probe('corrupt');
        expect(r.today).toBeNull();
        expect(r.blackout).toBe(true);
        expect(r.reports).toBe(1);
        expect(r.reportText).toContain('unreadable');
        expect(r.keyAfter).toBe('everything');
        /* Preserved, not replaced: the record is still the corrupt one, so
           the evidence that it became corrupt survives. */
        expect(r.stored).toEqual({ date: expect.any(String), mode: 'invented' });
        expect(r.plansLen).toBe(r.plansBeforeLen);
    }, 30_000);

    test('a second read on the same date does not report again', async () => {
        /* Once per local date per kind. The guard resets by itself when the
           date rolls, and the composite key is why a missing Today and an
           unreadable one are both heard. */
        const r = await app.page.evaluate(() => {
            const realRender = window.renderDashboard;
            window.renderDashboard = () => {};
            const key = window.BP.planDateKey(new Date());
            const plansBefore = JSON.parse(JSON.stringify(persisted.dayPlans));
            const errs = [];
            const realError = console.error;
            console.error = (...a) => { errs.push(a.map(String).join(' ')); };
            _planIntegrityReported = '';
            try {
                const i = persisted.dayPlans.findIndex(p => p.date === key);
                persisted.dayPlans.splice(i, 1);
                scheduledPrimaryType();
                const afterFirst = errs.length;
                for (let n = 0; n < 20; n++) scheduledPrimaryType();
                return { afterFirst, afterMany: errs.length };
            } finally {
                console.error = realError;
                window.renderDashboard = realRender;
                persisted.dayPlans = plansBefore;
            }
        });
        expect(r.afterFirst).toBe(1);
        expect(r.afterMany).toBe(1);
    }, 30_000);

    test('the fallback does not rewrite the compatibility column either', async () => {
        const r = await probe('corrupt');
        expect(r.column).toEqual(ALL_WEEK);
        expect(app.errors).toEqual([]);
    }, 30_000);
});

describe('the gate is what protects a contradictory programme', () => {
    /* custom true with preset provenance. The key mapping names a programme
       for it quite happily, because naming which programme is not its job, so
       mayGenerateOver() is the ONLY thing that refuses this member. Without
       this test, a mutation that bypasses the gate survives: every other
       custom member is incidentally protected by having no preset to map. */
    let app, state;
    beforeAll(async () => {
        app = await openApp({ row: null });
        await app.page.evaluate(() => localStorage.clear());
        await authSignIn(app.page, {
            id: 'contra', email: 'contra@x.com',
            row: row({
                id: 'contra', schedule: HANDMADE, primary_goal: 'eq',
                programme: {
                    key: null, version: 1, adoptedAt: null, custom: true, cyclePosition: null,
                    migration: { source: 'preset', presetKey: 'eq', reason: 'hand_edited', classifiedAt: '2026-01-01' },
                },
            }),
        });
        await app.page.evaluate(() => renderDashboard());
        state = await app.page.evaluate(() => ({
            mayGenerate: window.BP.mayGenerateOver(persisted.programme),
            mappedKey: window.BP.programmeKeyFor(persisted.programme),
            key: persisted.programme.key,
            plans: persisted.dayPlans,
            schedule: persisted.schedule,
        }));
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the mapping would name a programme for them', () => {
        expect(state.mappedKey).toBe('erectionQuality');
    });

    test('but the gate refuses, so nothing is generated or projected', () => {
        expect(state.mayGenerate).toBe(false);
        expect(state.key).toBe(null);
        expect(state.plans).toEqual([]);
        expect(state.schedule).toEqual(HANDMADE);
        expect(app.errors).toEqual([]);
    });
});

describe('after cutover the week cannot be edited directly', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ row: null });
        await app.page.evaluate(() => localStorage.clear());
        await authSignIn(app.page, {
            id: 'ro', email: 'ro@x.com',
            row: row({ id: 'ro', schedule: ALL_WEEK, primary_goal: 'all' }),
        });
        await app.page.evaluate(() => renderDashboard());
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the member really is on authoritative plans', async () => {
        const r = await app.page.evaluate(() => ({
            key: persisted.programme.key, auth: onAuthoritativePlans(),
        }));
        expect(r.key).toBe('everything');
        expect(r.auth).toBe(true);
    });

    test('the day picker offers no types, and says why', async () => {
        const r = await app.page.evaluate(() => {
            openDayModal(2);
            return {
                typesHidden: document.getElementById('type-modal-types').classList.contains('hidden'),
                noteShown: !document.getElementById('type-modal-locked').classList.contains('hidden'),
                note: document.getElementById('type-modal-locked').textContent,
                toggleAvailable: !document.getElementById('modal-toggle-btn').classList.contains('hidden'),
            };
        });
        expect(r.typesHidden).toBe(true);
        expect(r.noteShown).toBe(true);
        expect(r.note).toContain('programme');
        /* Phase 3C.3 withdraws the completion tick with the day types, which
           reverses the cutover's call that "completion is still theirs to
           record". It is, but a generic tick against a dated prescription
           claims that specific session was satisfied with no record of it,
           and the strip reads satisfaction from the session log. Recording
           work done elsewhere needs a surface that captures WHAT was done. */
        expect(r.toggleAvailable).toBe(false);
    });

    test('and toggleDayCompletion refuses even when called directly', async () => {
        /* The button is hidden, so this is only reachable from a stale shell
           or a console. It must not be able to assert a satisfied session
           either way. */
        const r = await app.page.evaluate(() => {
            const before = JSON.stringify(persisted.completedDays);
            session.selectedDayIdx = 2;
            toggleDayCompletion();
            return { before, after: JSON.stringify(persisted.completedDays) };
        });
        expect(r.after).toBe(r.before);
    });

    test('assignDay refuses even when called directly', async () => {
        /* The buttons are gone, so this is only reachable from a stale shell
           or a console. It must still not create a second authority.

           renderDashboard is stubbed for the duration of the call, and that
           is the whole point of the test rather than a convenience: without
           the stub, assignDay's own render runs the cutover, which projects
           the plans back over the illegal write and restores the slot. The
           schedule then looks untouched whether assignDay refused or wrote
           and was corrected, and a mutation deleting the refusal survived
           exactly that. Stubbing the render isolates assignDay's own
           behaviour, which is what the design requires of it. */
        const r = await app.page.evaluate(() => {
            const before = JSON.parse(JSON.stringify(persisted.schedule));
            const realRender = window.renderDashboard;
            let rendered = 0;
            window.renderDashboard = () => { rendered += 1; };
            session.selectedDayIdx = 2;
            try { assignDay('stamina'); } finally { window.renderDashboard = realRender; }
            return { before, after: persisted.schedule, rendered };
        });
        expect(r.after).toEqual(r.before);
        expect(r.after).toEqual(ALL_WEEK);
        /* It short-circuited before doing any of its normal work. */
        expect(r.rendered).toBe(0);
    });

    test('selecting a goal records the goal and does not move the week', async () => {
        const r = await app.page.evaluate(() => {
            const before = JSON.parse(JSON.stringify(persisted.schedule));
            let asked = 0;
            window.confirm = () => { asked++; return true; };   // say yes to everything
            selectGoal('stamina');
            return { asked, before, after: persisted.schedule, goal: persisted.primaryGoal };
        });
        expect(r.goal).toBe('stamina');        // the stated preference is still recorded
        expect(r.asked).toBe(0);               // and no prompt was shown
        expect(r.after).toEqual(r.before);     // the week is derived, so it did not move
        expect(r.after).toEqual(ALL_WEEK);
    });

    test('the confirmation does not claim their programme changed', async () => {
        /* "Focus set to lasting longer." would imply the app's focus moved
           when programme.key and the plans did not. primaryGoal is not inert
           for them, since Coach Tee reads it, so the note says what did
           happen and promises no feature that does not exist. */
        const r = await app.page.evaluate(() => {
            window.confirm = () => true;
            selectGoal('stamina');
            const note = document.getElementById('goal-confirm');
            return {
                text: note.textContent,
                hidden: note.classList.contains('hidden'),
                key: persisted.programme.key,
                goal: persisted.primaryGoal,
            };
        });
        expect(r.hidden).toBe(false);
        expect(r.text).toBe('Noted. This does not change your programme.');
        expect(r.text).not.toContain('schedule set');
        expect(r.text).not.toContain('Focus set');
        /* The preference was recorded; the programme was not touched. */
        expect(r.goal).toBe('stamina');
        expect(r.key).toBe('everything');
    }, 30_000);

    test('a legacy member still gets the old confirmation', async () => {
        const r = await app.page.evaluate(() => {
            persisted.programme = window.__legacyProgramme();
            persisted.dayPlans = [];
            persisted.allTimeSessionCount = 0;
            persisted.schedule = DEFAULT_PERSISTED.schedule.slice();
            persisted.primaryGoal = '';
            selectGoal('stamina');
            return document.getElementById('goal-confirm').textContent;
        });
        expect(r).toBe('Weekly schedule set for lasting longer.');
    }, 30_000);

    test('the picker still works for a member who has not cut over', async () => {
        /* The feature is withdrawn for cutover members, not deleted. */
        const r = await app.page.evaluate(() => {
            persisted.programme = window.__legacyProgramme();
            persisted.dayPlans = [];
            openDayModal(2);
            const typesHidden = document.getElementById('type-modal-types').classList.contains('hidden');
            session.selectedDayIdx = 2;
            assignDay('stamina');
            return { typesHidden, slot: persisted.schedule[2] };
        });
        expect(r.typesHidden).toBe(false);
        expect(r.slot).toBe('stamina');
        expect(app.errors).toEqual([]);
    });
});

describe('cutover is write-once per local date', () => {
    let app, first, second;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'idem', loaded: false });
        /* `first` has to start UNCLASSIFIED, because this test is about the
           cutover happening and then not happening twice. signIn seeds the
           legacy-custom sentinel, which would refuse generation outright, so
           the first row carries null and later rows carry whatever the
           previous load settled on. */
        let carry = null;
        const run = () => app.page.evaluate(async (programme) => {
            window.__row = {
                id: 'idem', total_xp: 100, difficulty: 'intermediate', schedule:
                    ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'],
                primary_goal: 'size', programme, day_plans: persisted.dayPlans,
                completed_days: [false, false, false, false, false, false, false],
                session_log: [], all_time_session_count: 5, xp_migrated: true,
                week_key: '', updated_at: new Date().toISOString(),
            };
            await loadPersisted();
            renderDashboard();
            return JSON.parse(JSON.stringify({
                plans: persisted.dayPlans, schedule: persisted.schedule,
                programme: persisted.programme,
            }));
        }, carry);
        first = await run();
        carry = first.programme;
        second = await run();
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('the first load generated', () => {
        expect(first.plans.length).toBeGreaterThanOrEqual(8);
    });

    test('the second load changes nothing, including generatedAt', () => {
        expect(second.schedule).toEqual(first.schedule);
        expect(JSON.stringify(second.plans)).toBe(JSON.stringify(first.plans));
        expect(app.errors).toEqual([]);
    });
});

/**
 * One canonical week answer, from the truthful prescription source.
 *
 * Phase 3C.3 step 1. weekCompletion's engine is untouched; what changed is
 * which seven-slot array it is handed. For an authoritative member that is
 * the dated plans, with `undefined` for any date no plan can be attributed
 * to, which is what keeps a midweek cutover from counting commitments the
 * projection merely recurs.
 *
 * Every caller of currentWeekCompletion is communication rather than
 * prescription, verified by call graph at 9322676: weekComplete enters the
 * resolver and is echoed straight back at nextBestAction.js:324 with no
 * branch reading it. These tests hold that property rather than trusting it.
 */
describe('the week denominator follows authority, not the projection', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'wk', loaded: false });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    /** Load a member, render, and report every week-derived surface. */
    const observe = (over) => app.page.evaluate(async (o) => {
        window.__row = {
            id: 'wk', total_xp: 100, difficulty: 'intermediate',
            schedule: o.schedule, primary_goal: o.goal,
            programme: o.programme === undefined ? null : o.programme,
            day_plans: o.dayPlans || [],
            completed_days: [false, false, false, false, false, false, false],
            session_log: o.sessionLog || [], all_time_session_count: 9,
            xp_migrated: true, week_key: '', updated_at: new Date().toISOString(),
        };
        await loadPersisted();
        renderDashboard();
        const w = currentWeekCompletion();
        const r = window.BP.nextBestAction(buildResolverInput());
        return {
            target: w.target, completed: w.completed, remaining: w.remaining,
            allDone: w.allDone, label: w.label, satisfied: w.satisfied,
            /* The dot row is absorbed into the strip. Seven cells always, so
               what the surface now says about the denominator is the label,
               and what it says per day is the state of each cell. */
            cells: window.__weekStrip().days.length,
            pending: window.__weekStrip().days.filter(d => d.state === 'pending').length,
            unknown: window.__weekStrip().days.filter(d => d.state === 'unknown').length,
            weekLabel: document.getElementById('hq-week-label').textContent,
            key: persisted.programme && persisted.programme.key,
            plans: persisted.dayPlans.length,
            schedule: persisted.schedule,
            /* The prescription, so a change in the denominator can be shown
               NOT to have moved it. */
            state: r.state, mission: r.mission, duration: r.duration,
            modifiers: r.modifiers, weekComplete: r.weekComplete,
        };
    }, over);

    const SIZE = ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'];

    test('a legacy member is byte-identical to the old behaviour', async () => {
        /* The slots ARE the column for them, so nothing about their week
           moves. This is the regression guard for the whole change. */
        const hand = ['girth', 'girth', 'rest', 'girth', 'rest', 'stamina', 'rest'];
        const r = await observe({ schedule: hand, goal: 'size' });
        expect(r.key).toBe(null);                   // custom, never cut over
        expect(r.plans).toBe(0);
        expect(r.schedule).toEqual(hand);
        /* Four non-rest days in that hand-built week. */
        expect(r.target).toBe(4);
        expect(r.cells).toBe(7);
        /* Their column IS their programme, so every day is attributable and
           nothing reads as unknown. The four non-rest days are still to do. */
        expect(r.unknown).toBe(0);
        expect(r.pending).toBe(4);
        expect(r.weekLabel).toBe('0 of 4 this week');
    }, 30_000);

    test('a cutover member counts only dates with an attributable plan', async () => {
        const r = await observe({ schedule: SIZE, goal: 'size' });
        expect(r.key).toBe('size');
        /* Generation runs from today, so the current week holds a plan only
           from today onward. The denominator is the non-rest subset of
           those, which is at most the four the projection would claim. */
        const projectionTarget = SIZE.filter(t => t !== 'rest').length;
        expect(projectionTarget).toBe(4);
        expect(r.target).toBeLessThanOrEqual(projectionTarget);
        expect(r.pending).toBe(r.target);
        expect(r.weekLabel).toBe(`${r.completed} of ${r.target} this week`);
    }, 30_000);

    test('no date before cutover is counted, which is the whole point', async () => {
        /* The projection recurs a full week; the plans do not reach back.
           Any day before today must be absent from the denominator. */
        const r = await observe({ schedule: SIZE, goal: 'size' });
        const todayIdx = await app.page.evaluate(() => new Date().getDay());
        const model = await app.page.evaluate(() => window.BP.buildWeekStripModel({
            now: new Date(), authoritative: true, dayPlans: persisted.dayPlans,
            legacySchedule: persisted.schedule, sessionLog: persisted.sessionLog,
            satisfied: currentWeekCompletion().satisfied,
        }));
        const pastKnown = model.days.filter(d => d.isPast && d.prescriptionKnown);
        expect(pastKnown).toEqual([]);              // nothing historical attributed
        /* And the satisfied array cannot mark a day the denominator excludes. */
        model.days.filter(d => !d.prescriptionKnown).forEach(d =>
            expect(r.satisfied[d.weekdayIndex], d.weekday).toBe(false));
        expect(todayIdx).toBeGreaterThanOrEqual(0);
    }, 30_000);

    test('the denominator moving does not move the prescription', async () => {
        /* The proof the audit rests on, asserted rather than reasoned: the
           same member, read as legacy and as authoritative, gets different
           week numbers and the SAME mission, duration and modifiers. */
        const legacy = await app.page.evaluate(async (sched) => {
            window.__row = {
                id: 'wk', total_xp: 100, difficulty: 'intermediate', schedule: sched,
                primary_goal: 'size', programme: null, day_plans: [],
                completed_days: [false, false, false, false, false, false, false],
                session_log: [], all_time_session_count: 9, xp_migrated: true,
                week_key: '', updated_at: new Date().toISOString(),
            };
            await loadPersisted();
            /* Hold them on the legacy path by clearing what the render wrote. */
            renderDashboard();
            persisted.programme = window.__legacyProgramme(); persisted.dayPlans = [];
            const w = currentWeekCompletion();
            const r = window.BP.nextBestAction(buildResolverInput());
            return { target: w.target, state: r.state, mission: r.mission,
                     duration: r.duration, modifiers: r.modifiers };
        }, SIZE);

        const auth = await observe({ schedule: SIZE, goal: 'size' });

        expect(auth.state).toBe(legacy.state);
        expect(auth.mission).toBe(legacy.mission);
        expect(auth.duration).toBe(legacy.duration);
        expect(auth.modifiers).toEqual(legacy.modifiers);
    }, 30_000);

    test('weekComplete is echoed by the resolver and nothing else', async () => {
        const r = await observe({ schedule: SIZE, goal: 'size' });
        expect(r.weekComplete).toBe(r.allDone);
        expect(app.errors).toEqual([]);
    }, 30_000);
});

/**
 * One render, one settled authority state.
 *
 * Phase 3C.3 pins this as a product invariant rather than a fixture repair.
 * syncProgression commits the authority transition, which writes programme,
 * dayPlans and the projected schedule. It used to run AFTER renderToday and
 * renderWeekProgress and BEFORE the calendar, so on the single render where a
 * member cut over, the dot row was computed from pre-cutover state while the
 * calendar below it read post-cutover state: two surfaces disagreeing about
 * the same week. PR C hid it because its projection write was a no-op on the
 * column; an authority-aware denominator makes it visible.
 *
 * It now runs first, so every HQ surface in a pass sees the same state.
 */
describe('every week surface in one render sees the same authority state', () => {
    let app, obs;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'ord', loaded: false });
        obs = await app.page.evaluate(async () => {
            /* Unclassified, so THIS render is the cutover render: the only
               pass where a mixed state was ever possible. */
            window.__row = {
                id: 'ord', total_xp: 100, difficulty: 'intermediate',
                schedule: ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'],
                primary_goal: 'size', programme: null, day_plans: [],
                completed_days: [false, false, false, false, false, false, false],
                session_log: [], all_time_session_count: 9, xp_migrated: true,
                week_key: '', updated_at: new Date().toISOString(),
            };
            await loadPersisted();
            const keyBefore = persisted.programme && persisted.programme.key;
            renderDashboard();
            /* Read the surfaces as the DOM left them, plus the canonical
               answer, all after the one render. */
            const label = document.getElementById('hq-week-label').textContent;
            const w = currentWeekCompletion();
            const r = window.BP.nextBestAction(buildResolverInput());
            return {
                keyBefore,
                keyAfter: persisted.programme && persisted.programme.key,
                plans: persisted.dayPlans.length,
                label,
                target: w.target, completed: w.completed, allDone: w.allDone,
                satisfiedLen: w.satisfied.length,
                weekComplete: r.weekComplete,
                /* ONE surface now, which is why there is one read. The dot
                   row and the calendar below it are the two things that
                   could read different states on this render; the strip is
                   what they became. */
                strip: window.__weekStrip(),
            };
        });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('the cutover really happened on that render', () => {
        expect(obs.keyBefore).toBe(null);
        expect(obs.keyAfter).toBe('size');
        expect(obs.plans).toBeGreaterThanOrEqual(8);
    });

    test('the strip matches the canonical target, not the projection', () => {
        /* THE REGRESSION THIS PINS. Before the reorder these differed on the
           cutover render: four dots from the recurring projection beside a
           target counted from the dated plans. Nothing completed on this
           fixture, so every attributable non-rest day reads as pending and
           their count is the denominator. */
        expect(obs.strip.days.filter(d => d.state === 'pending').length).toBe(obs.target);
        expect(obs.label).toBe(`${obs.completed} of ${obs.target} this week`);
    });

    test('the resolver and the week agree in the same pass', () => {
        expect(obs.weekComplete).toBe(obs.allDone);
    });

    test('the cells come from the same satisfied array', () => {
        expect(obs.strip.days.length).toBe(7);
        expect(obs.satisfiedLen).toBe(7);
        expect(obs.strip.satisfied).toBe(obs.completed);
    });

    test('nothing threw across the cutover render', () => {
        expect(app.errors).toEqual([]);
    });
});

/**
 * Moving syncProgression earlier must change WHEN the settled state is seen
 * and nothing else. These four paths were the ones worth checking by name.
 */
describe('the earlier sync changes no behaviour but the ordering', () => {
    let app, r;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'eq', loaded: false });
        r = await app.page.evaluate(async () => {
            window.__row = {
                id: 'eq', total_xp: 400, difficulty: 'intermediate',
                schedule: ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'],
                primary_goal: 'size', programme: null, day_plans: [],
                completed_days: [false, false, false, false, false, false, false],
                session_log: [{ date: new Date(Date.now() - 2 * 864e5).toISOString(), routineType: 'length' }],
                progression_ledger: [], streak_passes: 2, pass_protected_dates: [],
                all_time_session_count: 40, xp_migrated: true, week_key: '',
                updated_at: new Date().toISOString(),
            };
            await loadPersisted();
            const ledgerBefore = JSON.stringify(persisted.progressionLedger);
            renderDashboard();
            const ledgerAfter = JSON.stringify(persisted.progressionLedger);
            /* Reconciling again must be a fixed point: if moving sync earlier
               changed what the ledger sees, a second reconcile would move. */
            const again = JSON.stringify(window.BP.reconcileLedger(persisted.progressionLedger, {
                weekKey: getCurrentWeekKey(), schedule: persisted.schedule,
                sessionLog: persisted.sessionLog, now: new Date(),
            }));
            const band = (id) => !document.getElementById(id).classList.contains('hidden');
            return {
                ledgerBefore, ledgerAfter, again,
                /* Storage and load failure still surface: renderAttentionBand
                   now runs after sync rather than before. */
                attentionRendered: !!document.getElementById('hq-attention-band'),
                loadFailedHidden: !band('hq-load-failed-banner'),
                storageFullHidden: !band('hq-storage-full-banner'),
                /* Recovery Pass machinery still reachable and still visible.
                   renderPassChip writes #hq-pass-count, so its text is the
                   evidence the surface ran after the reorder. */
                passLabel: (document.getElementById('hq-pass-count') || {}).innerText || '',
                passes: persisted.streakPasses,
                protectedDays: (persisted.passProtectedDates || []).length,
                /* Coach nudge still chosen, and the nudge band still renders. */
                nudgeBand: !!document.getElementById('hq-nudge-band'),
            };
        });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('ledger reconciliation is a fixed point after the render', () => {
        expect(r.again).toBe(r.ledgerAfter);
    });

    test('storage and load failure banners still render in their band', () => {
        expect(r.attentionRendered).toBe(true);
        /* Healthy member, so both are correctly hidden rather than missing. */
        expect(r.loadFailedHidden).toBe(true);
        expect(r.storageFullHidden).toBe(true);
    });

    test('Recovery Pass consumption still fires after the reorder', () => {
        /* The fixture is the consumption case on purpose: trained two days
           ago, nothing yesterday, two passes banked. One is spent during the
           render, which is stronger evidence than the surface merely being
           present. 2 -> 1 proves maybeConsumeStreakPass still runs and still
           reaches renderPassChip in the new order. */
        expect(r.passes).toBe(1);
        expect(r.protectedDays).toBe(1);
        expect(r.passLabel).toContain('Recovery Passes: 1 / 2');
    });

    test('the nudge band still renders after the reorder', () => {
        expect(r.nudgeBand).toBe(true);
        expect(app.errors).toEqual([]);
    });
});

/**
 * The denominator on a KNOWN midweek cutover, with exact numbers.
 *
 * The first version of this coverage asserted `target <= projectionTarget`,
 * which passes when the two are equal, so a mutation that ignored authority
 * entirely and handed the projection straight back survived it. Weak
 * assertion, not a weak subject.
 *
 * The clock is pinned to a Thursday so the arithmetic is fixed rather than
 * depending on the day the suite runs:
 *
 *   size preset, Sunday-indexed: [length, girth, rest, length, girth, rest, rest]
 *   projection would count       Sun, Mon, Wed, Thu              = 4
 *   plans exist from Thursday    Thu girth, Fri rest, Sat rest, Sun length
 *   attributable non-rest        Thu, Sun                        = 2
 */
describe('a Thursday cutover counts exactly two sessions, not four', () => {
    const THURSDAY = new Date(Date.UTC(2026, 2, 12, 12));   // 2026-03-12 is a Thursday
    const SIZE = ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'];
    let app, obs;
    beforeAll(async () => {
        app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'thu', loaded: false });
        obs = await app.page.evaluate(async (schedule) => {
            window.__row = {
                id: 'thu', total_xp: 100, difficulty: 'intermediate', schedule,
                primary_goal: 'size', programme: null, day_plans: [],
                completed_days: [false, false, false, false, false, false, false],
                session_log: [], all_time_session_count: 9, xp_migrated: true,
                week_key: '', updated_at: new Date().toISOString(),
            };
            await loadPersisted();
            renderDashboard();
            const w = currentWeekCompletion();
            const slots = window.BP.weekStripSlots({
                now: new Date(), authoritative: true,
                dayPlans: persisted.dayPlans, legacySchedule: persisted.schedule,
            });
            return {
                weekday: new Date().getDay(),
                key: persisted.programme && persisted.programme.key,
                target: w.target,
                strip: window.__weekStrip(),
                label: document.getElementById('hq-week-label').textContent,
                slots: slots.slots,
                planDates: persisted.dayPlans.map(p => p.date),
            };
        }, SIZE);
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('the clock really is pinned to the Thursday', () => {
        expect(obs.weekday).toBe(4);
        expect(obs.key).toBe('size');
        expect(obs.planDates[0]).toBe('2026-03-12');
    });

    test('Monday, Tuesday and Wednesday have no attributable prescription', () => {
        /* Sunday-indexed: 1 Mon, 2 Tue, 3 Wed. */
        expect(obs.slots[1]).toBeUndefined();
        expect(obs.slots[2]).toBeUndefined();
        expect(obs.slots[3]).toBeUndefined();
        expect(obs.slots[4]).toBe('girth');      // Thu
        expect(obs.slots[0]).toBe('length');     // Sun
    });

    test('the target is EXACTLY two, where the projection would say four', () => {
        /* The assertion that kills "ignore authority, use the projection". */
        const projectionTarget = SIZE.filter(t => t !== 'rest').length;
        expect(projectionTarget).toBe(4);
        expect(obs.target).toBe(2);
        expect(obs.target).toBeLessThan(projectionTarget);
    });

    test('the strip and the label carry the same two', () => {
        /* Thursday and Sunday are the attributable training days, so exactly
           two cells read as pending. The three days before cutover read as
           unknown, which is the strip refusing to claim a prescription for a
           date that has no plan, and Friday and Saturday are rest. */
        expect(obs.strip.days.filter(d => d.state === 'pending').length).toBe(2);
        expect(obs.strip.days.filter(d => d.state === 'unknown').length).toBe(3);
        expect(obs.strip.days.filter(d => d.state === 'rest').length).toBe(2);
        expect(obs.strip.bySunday).toMatchObject({
            1: 'unknown', 2: 'unknown', 3: 'unknown',
            4: 'pending', 5: 'rest', 6: 'rest', 0: 'pending',
        });
        expect(obs.label).toBe('0 of 2 this week');
        expect(app.errors).toEqual([]);
    });
});
