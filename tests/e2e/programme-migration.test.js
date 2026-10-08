import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, authSignIn } from './harness.js';

/**
 * Classification runs against real member state, through the real load.
 *
 * The unit suite proves the rules. This suite proves two things it cannot:
 * that the page hands the classifier the real presets rather than a copy
 * that has drifted, and that classifying a member never moves a single slot
 * of their week.
 *
 * The second one is the whole reason PR D exists. Generation will project
 * onto the legacy schedule, and a projection over a week somebody arranged
 * themselves is data loss. So the overwrite guard below drives every shape
 * and goal combination through a real load and checks the stored week before
 * and after, and checks what the next upsert would send.
 */

const DEFAULT_WEEK = ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'];
const STAMINA_WEEK = ['stamina', 'rest', 'stamina', 'rest', 'stamina', 'rest', 'rest'];
const EQ_WEEK      = ['stamina', 'rest', 'length', 'rest', 'stamina', 'rest', 'rest'];
const ALL_WEEK     = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
const HANDMADE     = ['girth', 'girth', 'rest', 'girth', 'rest', 'stamina', 'rest'];

const row = (over = {}) => ({
    id: 'm', total_xp: 400, difficulty: 'intermediate',
    schedule: DEFAULT_WEEK, completed_days: [false, false, false, false, false, false, false],
    session_log: [], measurements: [], seen_milestones: [],
    all_time_session_count: 12, xp_migrated: true, week_key: '',
    updated_at: new Date().toISOString(),
    ...over,
});

describe('the page hands over the real presets', () => {
    /* The classifier takes its presets as an argument so there is only one
       definition of them. That only holds while the page passes the real
       ones, and the unit suite's copies only mean something while they match
       the page. This is the test that keeps all three honest. */
    let app, real;
    beforeAll(async () => {
        app = await openApp();
        real = await app.page.evaluate(() => ({
            presets: Object.fromEntries(Object.keys(GOALS).map(k => [k, GOALS[k].schedule])),
            def: DEFAULT_PERSISTED.schedule,
            keys: Object.keys(GOALS),
        }));
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the four preset arrays are what the unit suite asserts against', () => {
        expect(real.keys).toEqual(['size', 'stamina', 'eq', 'all']);
        expect(real.presets.size).toEqual(DEFAULT_WEEK);
        expect(real.presets.stamina).toEqual(STAMINA_WEEK);
        expect(real.presets.eq).toEqual(EQ_WEEK);
        expect(real.presets.all).toEqual(ALL_WEEK);
    });

    test('the size preset is still byte-identical to the default', () => {
        /* The collision the whole table is built around. If this changes,
           reread rules 4, 5 and 6 before touching anything else. */
        expect(real.presets.size).toEqual(real.def);
    });

    test('the default is what the unit suite asserts against', () => {
        expect(real.def).toEqual(DEFAULT_WEEK);
    });
});

describe('classification never moves a slot of a members week', () => {
    /* THE HEADLINE TEST OF THIS PR. Every shape against every goal, each one
       driven through a real loadPersisted() and a real renderDashboard(),
       asserting the stored week is identical before and after AND that the
       next upsert would send that same array. */
    const SHAPES = {
        default: DEFAULT_WEEK, stamina: STAMINA_WEEK, eq: EQ_WEEK,
        all: ALL_WEEK, handmade: HANDMADE,
        oldThreeTypes: ['length', 'rest', 'girth', 'rest', 'length', 'girth', 'rest'],
    };
    const GOALS = ['', 'size', 'stamina', 'eq', 'all'];

    let app, results;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'm', loaded: false });
        results = await app.page.evaluate(async ({ shapes, goals }) => {
            const out = [];
            for (const [name, schedule] of Object.entries(shapes)) {
                for (const goal of goals) {
                    /* A fresh unclassified row each time, through the real
                       read path. __row is what the stub serves when no
                       session-scoped row is registered. */
                    window.__row = {
                        id: 'm', total_xp: 400, difficulty: 'intermediate',
                        schedule, primary_goal: goal, programme: null, day_plans: [],
                        session_log: [], measurements: [], seen_milestones: [],
                        all_time_session_count: 12, xp_migrated: true, week_key: '',
                        completed_days: [false, false, false, false, false, false, false],
                        updated_at: new Date().toISOString(),
                    };
                    await loadPersisted();
                    const before = JSON.parse(JSON.stringify(persisted.schedule));
                    renderDashboard();
                    window.__writes = [];
                    _flushSaveNow();
                    await new Promise(r => setTimeout(r, 60));
                    out.push({
                        name, goal,
                        before,
                        after: persisted.schedule,
                        written: (window.__writes[0] || {}).schedule,
                        source: persisted.programme && persisted.programme.migration.source,
                        reason: persisted.programme && persisted.programme.migration.reason,
                        presetKey: persisted.programme && persisted.programme.migration.presetKey,
                        custom: persisted.programme && persisted.programme.custom,
                        key: persisted.programme && persisted.programme.key,
                        adoptedAt: persisted.programme && persisted.programme.adoptedAt,
                    });
                }
            }
            return out;
        }, { shapes: SHAPES, goals: GOALS });
    }, 180_000);
    afterAll(async () => { await app?.close(); });

    test('all thirty combinations ran and each one was classified', () => {
        expect(results).toHaveLength(30);
        results.forEach(r => {
            expect(r.source, `${r.name}/${r.goal}`).toBeTruthy();
        });
    });

    test('the stored week is identical after classification, in every case', () => {
        const moved = results.filter(r => JSON.stringify(r.before) !== JSON.stringify(r.after));
        expect(moved.map(r => `${r.name}/${r.goal || 'none'}`)).toEqual([]);
    });

    test('the week the next upsert sends is identical too, in every case', () => {
        /* Not changing it in memory is half the promise. The other half is
           that nothing writes a different one back to the row. */
        const wrong = results.filter(r => JSON.stringify(r.written) !== JSON.stringify(r.before));
        expect(wrong.map(r => `${r.name}/${r.goal || 'none'}`)).toEqual([]);
    });

    test('no combination writes an adoption date', () => {
        /* Automatic migration is not member adoption, in any class. */
        results.forEach(r => expect(r.adoptedAt, `${r.name}/${r.goal}`).toBe(null));
    });

    test('a programme key is written for exactly the members the gate permits', () => {
        /* The key is the cutover marker and it comes from provenance, never
           from a goal we invented. A custom member is never generated for, so
           theirs stays null; a default or preset member is, so theirs is set.
           This pins the gate across all thirty combinations rather than at
           one example.

           Classification on its own writes no key, which is asserted against
           migrationProgramme directly in tests/programmeMigration.test.js. By
           the time a render has finished, the authority transition has run. */
        const KEYS = { size: 'size', stamina: 'lastLonger', eq: 'erectionQuality', all: 'everything' };
        results.forEach(r => {
            if (r.custom) expect(r.key, `custom ${r.name}/${r.goal}`).toBe(null);
            else expect(r.key, `${r.name}/${r.goal}`)
                .toBe(r.source === 'default' ? 'size' : KEYS[r.presetKey]);
        });
    });

    test('a hand-made week is always custom, whatever the stated goal', () => {
        ['handmade', 'oldThreeTypes'].forEach(name => {
            results.filter(r => r.name === name).forEach(r => {
                expect(r.custom, `${name}/${r.goal}`).toBe(true);
                expect(r.reason, `${name}/${r.goal}`).toBe('no_recognised_shape');
            });
        });
    });

    test('a preset week is attributable only to its own goal', () => {
        const cases = [['stamina', 'stamina'], ['eq', 'eq'], ['all', 'all']];
        cases.forEach(([name, key]) => {
            results.filter(r => r.name === name).forEach(r => {
                if (r.goal === key) {
                    expect(r.source).toBe('preset');
                    expect(r.presetKey).toBe(key);
                    expect(r.custom).toBe(false);
                } else {
                    expect(r.custom, `${name}/${r.goal}`).toBe(true);
                    expect(r.reason, `${name}/${r.goal}`).toBe('preset_shape_without_matching_goal');
                }
            });
        });
    });

    test('the default week splits three ways on the stated goal', () => {
        const byGoal = {};
        results.filter(r => r.name === 'default').forEach(r => { byGoal[r.goal] = r; });
        expect(byGoal[''].source).toBe('default');
        expect(byGoal[''].reason).toBe('default_shape_no_goal_ever_answered');
        expect(byGoal.size.source).toBe('preset');
        expect(byGoal.size.presetKey).toBe('size');
        ['stamina', 'eq', 'all'].forEach(g => {
            expect(byGoal[g].custom, g).toBe(true);
            expect(byGoal[g].reason, g).toBe('default_shape_contradicts_stated_goal');
        });
        expect(app.errors).toEqual([]);
    });
});

describe('a veteran with a week they built themselves', () => {
    let app, state;
    beforeAll(async () => {
        app = await openApp({ row: null });
        await app.page.evaluate(() => localStorage.clear());
        await authSignIn(app.page, {
            id: 'vet', email: 'vet@x.com',
            row: row({ id: 'vet', schedule: HANDMADE, primary_goal: 'size',
                       all_time_session_count: 180, total_xp: 3600 }),
        });
        await app.page.evaluate(() => renderDashboard());
        state = await app.page.evaluate(() => ({
            programme: persisted.programme,
            schedule: persisted.schedule,
            mayGenerate: window.BP.mayGenerateOver(persisted.programme),
        }));
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('they are custom, with no preset attributed', () => {
        expect(state.programme.custom).toBe(true);
        expect(state.programme.migration.source).toBe('custom');
        expect(state.programme.migration.presetKey).toBe(null);
    });

    test('their week is untouched', () => {
        expect(state.schedule).toEqual(HANDMADE);
    });

    test('generation may not touch them until they adopt', () => {
        expect(state.mayGenerate).toBe(false);
        expect(state.programme.adoptedAt).toBe(null);
    });

    test('the stored programme is programme state with provenance nested in it', () => {
        /* And no copy of their week: the schedule column is already that. */
        expect(Object.keys(state.programme).sort()).toEqual(
            ['adoptedAt', 'custom', 'cyclePosition', 'key', 'migration', 'version']);
        expect(Object.keys(state.programme.migration).sort()).toEqual(
            ['classifiedAt', 'presetKey', 'reason', 'source']);
        expect(app.errors).toEqual([]);
    });
});

describe('a member whose week matches the goal they chose', () => {
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
            mayGenerate: window.BP.mayGenerateOver(persisted.programme),
        }));
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('they are a preset member and generation may proceed', () => {
        expect(state.programme.migration.source).toBe('preset');
        expect(state.programme.migration.presetKey).toBe('stamina');
        expect(state.programme.custom).toBe(false);
        expect(state.mayGenerate).toBe(true);
        /* Cut over in the same render: the key is the marker, and it is the
           future-vocabulary name for the legacy stamina preset. */
        expect(state.programme.key).toBe('lastLonger');
    });

    test('their week is still untouched', () => {
        expect(state.schedule).toEqual(STAMINA_WEEK);
        expect(app.errors).toEqual([]);
    });
});

describe('a repaired schedule is never attributable', () => {
    /* The reason the repair signal exists. A five-element backup is repaired
       by adoption into the default seven, which equals the size preset, and
       that coincidence must not make the member auto-migratable. */
    let app, state;
    beforeAll(async () => {
        app = await openApp({ row: null });
        await app.page.evaluate(() => {
            localStorage.setItem('bp_data_rp', JSON.stringify({
                totalXp: 60, primaryGoal: 'size',
                schedule: ['length', 'girth', 'rest', 'length', 'girth'],
                _savedAt: new Date().toISOString(),
            }));
        });
        await signIn(app.page, { id: 'rp', loaded: false });
        await app.page.evaluate(async () => { await loadPersisted(); renderDashboard(); });
        state = await app.page.evaluate(() => ({
            repaired: _scheduleRepairedOnAdopt,
            schedule: persisted.schedule,
            programme: persisted.programme,
            xp: persisted.totalXp,
        }));
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the repair happened and the schedule is seven valid days', () => {
        expect(state.xp).toBe(60);           // the restore itself worked
        expect(state.repaired).toBe(true);
        expect(state.schedule).toEqual(DEFAULT_WEEK);
    });

    test('and the member is custom, not the size preset their goal implies', () => {
        expect(state.programme.custom).toBe(true);
        expect(state.programme.migration.reason).toBe('repaired_before_classification');
        expect(state.programme.migration.presetKey).toBe(null);
        expect(app.errors).toEqual([]);
    });
});

describe('an imported goal from a vocabulary this build does not know', () => {
    let app, state;
    beforeAll(async () => {
        app = await openApp({ row: null });
        await signIn(app.page, { id: 'imp' });
        state = await app.page.evaluate(async () => {
            /* DELIBERATELY null, not legacyProgramme(): this test exercises
               classification itself, so the account must be unclassified and
               production must be the thing that classifies the imported
               week. */
            persisted.programme = null;
            const backup = {
                sessionLog: [], totalXp: 15, primaryGoal: 'girth-focus',
                schedule: ['stamina', 'rest', 'stamina', 'rest', 'stamina', 'rest', 'rest'],
            };
            persisted.__marker = 'pre';
            importData(new File([JSON.stringify(backup)], 'b.json', { type: 'application/json' }));
            const t0 = Date.now();
            while ('__marker' in persisted && Date.now() - t0 < 5000) {
                await new Promise(r => setTimeout(r, 25));
            }
            renderDashboard();
            return { programme: persisted.programme, schedule: persisted.schedule };
        });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('an exact preset shape is still custom, because the goal is unreadable', () => {
        expect(state.programme.custom).toBe(true);
        expect(state.programme.migration.reason).toBe('unrecognised_goal_vocabulary');
    });

    test('the imported week is kept exactly', () => {
        expect(state.schedule).toEqual(STAMINA_WEEK);
        expect(app.errors).toEqual([]);
    });
});

describe('classification happens once', () => {
    let app, first, second;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'once', loaded: false });
        first = await app.page.evaluate(async ({ week }) => {
            window.__row = { id: 'once', schedule: week, primary_goal: 'stamina',
                             programme: null, total_xp: 10, xp_migrated: true, week_key: '',
                             updated_at: new Date().toISOString() };
            await loadPersisted();
            renderDashboard();
            return JSON.parse(JSON.stringify(persisted.programme));
        }, { week: STAMINA_WEEK });
        second = await app.page.evaluate(async ({ week, prev }) => {
            /* Same account, a different week, and the classification that is
               already on the row. A second verdict must not be written. */
            window.__row = { id: 'once', schedule: week, primary_goal: 'all',
                             programme: prev, total_xp: 10, xp_migrated: true, week_key: '',
                             updated_at: new Date().toISOString() };
            await loadPersisted();
            renderDashboard();
            return JSON.parse(JSON.stringify(persisted.programme));
        }, { week: ALL_WEEK, prev: first });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('the first load classified', () => {
        expect(first.migration.source).toBe('preset');
        expect(first.migration.presetKey).toBe('stamina');
    });

    test('the second load left the verdict exactly as it was', () => {
        expect(second).toEqual(first);
        expect(app.errors).toEqual([]);
    });
});
