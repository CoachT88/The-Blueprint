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
            today: getScheduledType(),
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
        const todayIdx = new Date().getDay();
        expect(state.today).toBe(state.schedule[todayIdx]);
        expect(state.blackout).toBe(state.schedule[todayIdx] === 'rest');
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
            const asRest = { today: getScheduledType(), blackout: isBlackoutDay() };

            plan.mode = 'prescribed';
            plan.primarySession = { type: 'girth', tier: 'intermediate' };
            const asGirth = { today: getScheduledType(), blackout: isBlackoutDay() };

            Object.assign(plan, was);
            return { asRest, asGirth, column, columnUnchanged: persisted.schedule };
        });
        expect(r.asRest).toEqual({ today: 'rest', blackout: true });
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
            today: getScheduledType(),
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

    test('Today still falls back to the legacy column for them', () => {
        /* No plans, so the switched reader has nothing to read and must not
           invent a rest day. */
        expect(state.today).toBe(HANDMADE[new Date().getDay()]);
        expect(app.errors).toEqual([]);
    });
});

describe('a broken authoritative Today falls back, loudly', () => {
    /* The programme says dated plans are authoritative and today's is
       missing or unreadable. The member must stay usable, so the
       compatibility column is read, but that is an EMERGENCY path after an
       integrity failure and not normal dual authority, so it is reported.
       Nothing about programme authority is touched by a read.

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
            const today = getScheduledType();
            const blackout = isBlackoutDay();
            const again = getScheduledType();          // many calls per render
            const thrice = getScheduledType();
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
        expect(r.today).toBe(ALL_WEEK[new Date().getDay()]);
    }, 30_000);

    test('a missing Today keeps the member usable and is reported once', async () => {
        const r = await probe('missing');
        /* Usable: Today still answers, from the compatibility column. */
        expect(r.today).toBe(ALL_WEEK[new Date().getDay()]);
        expect(r.blackout).toBe(ALL_WEEK[new Date().getDay()] === 'rest');
        expect(r.again).toBe(r.today);
        /* Reported, once, across four reader calls. */
        expect(r.reports).toBe(1);
        expect(r.reportText).toContain('missing');
        /* And authority is untouched by a read. */
        expect(r.keyAfter).toBe('everything');
        expect(r.keyAfter).toBe(r.keyBefore);
    }, 30_000);

    test('an unreadable Today is reported rather than treated as a prescription', async () => {
        const r = await probe('corrupt');
        expect(r.today).toBe(ALL_WEEK[new Date().getDay()]);
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
                getScheduledType();
                const afterFirst = errs.length;
                for (let n = 0; n < 20; n++) getScheduledType();
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
        /* Completion is still theirs to record. */
        expect(r.toggleAvailable).toBe(true);
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
            persisted.programme = null;
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
            persisted.programme = null;
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
        const run = () => app.page.evaluate(async () => {
            window.__row = {
                id: 'idem', total_xp: 100, difficulty: 'intermediate', schedule:
                    ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'],
                primary_goal: 'size', programme: persisted.programme, day_plans: persisted.dayPlans,
                completed_days: [false, false, false, false, false, false, false],
                session_log: [], all_time_session_count: 5, xp_migrated: true,
                week_key: '', updated_at: new Date().toISOString(),
            };
            await loadPersisted();
            renderDashboard();
            return JSON.parse(JSON.stringify({ plans: persisted.dayPlans, schedule: persisted.schedule }));
        });
        first = await run();
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
