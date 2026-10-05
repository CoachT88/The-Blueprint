import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, authSignIn } from './harness.js';

/**
 * adoptPersisted() is the one place a restored or imported state becomes
 * `persisted`, and this suite is what holds it to its two promises.
 *
 *   Missing data may default.
 *   Unread data must not be silently erased.
 *
 * The second one is the one with teeth. A build that drops a day plan it
 * cannot parse writes the loss back on the very next save, and the reader
 * that could have understood the record arrives a phase later. So absence
 * normalises to null and [], and presence is carried through exactly as it
 * arrived, including records this version refuses.
 *
 * Every test here goes through the real entry points: authSignIn() runs the
 * production onAuthStateChange chain into loadPersisted(), and the import
 * tests call importData() with a real File. Nothing seeds the answer.
 */

/** A plan src/dayPlan.js accepts. */
const READABLE = {
    date: '2026-10-05',
    mode: 'prescribed',
    status: 'pending',
    primarySession: { type: 'length', dose: { sets: 3, duration: 300 } },
    supportingWork: [],
    dailyPractice: [],
};

/**
 * A dated record src/dayPlan.js REFUSES: `mode` is not one of the four.
 * normaliseDayPlan() returns null for it and normaliseDayPlans() would drop
 * it entirely. That is correct at the point of use and would be data loss
 * here, which is the whole point of the preservation test below.
 */
const UNREADABLE = { date: '2026-10-06', mode: 'invented', status: 'pending' };

const BASE_ROW = {
    id: 'rb', total_xp: 300, difficulty: 'intermediate',
    schedule: ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'],
    session_log: [{ date: '2026-10-01', type: 'length', xp: 20 }],
    all_time_session_count: 9, xp_migrated: true,
    week_key: '', updated_at: new Date().toISOString(),
};

describe('a server row from before the day-plan migration', () => {
    /* Every row is in this state the moment supabase/day-plans-schema.sql
       runs, and so is every row on a table where it has not run at all. */
    let app, state;
    beforeAll(async () => {
        app = await openApp({ row: null });
        await app.page.evaluate(() => localStorage.clear());
        await authSignIn(app.page, { id: 'rb', email: 'rb@x.com', row: BASE_ROW });
        state = await app.page.evaluate(() => ({
            programme: persisted.programme,
            dayPlans: persisted.dayPlans,
            xp: persisted.totalXp,
            loaded: _persistedLoaded,
        }));
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('absence normalises to null and an empty list, never undefined', () => {
        expect(state.loaded).toBe(true);
        expect(state.programme).toBe(null);
        expect(state.dayPlans).toEqual([]);
    });

    test('the rest of the row is unaffected', () => {
        expect(state.xp).toBe(300);
    });

    test('the normalised empties are what gets written back', async () => {
        const w = await app.page.evaluate(async () => {
            window.__writes = [];
            _flushSaveNow();
            await new Promise(r => setTimeout(r, 500));
            return window.__writes[0];
        });
        expect(w.programme).toBe(null);
        expect(w.day_plans).toEqual([]);
        expect(app.errors).toEqual([]);
    }, 30_000);
});

describe('a server row carrying a programme and plans', () => {
    let app, state;
    beforeAll(async () => {
        app = await openApp({ row: null });
        await app.page.evaluate(() => localStorage.clear());
        await authSignIn(app.page, {
            id: 'rb2', email: 'rb2@x.com',
            row: { ...BASE_ROW, id: 'rb2',
                   programme: { programmeKey: 'size.v2', version: 2, note: 'kept' },
                   day_plans: [READABLE, UNREADABLE] },
        });
        state = await app.page.evaluate(() => ({
            programme: persisted.programme,
            dayPlans: persisted.dayPlans,
        }));
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the programme comes through field for field, unknown fields included', () => {
        expect(state.programme).toEqual({ programmeKey: 'size.v2', version: 2, note: 'kept' });
    });

    test('a record this build cannot read is still there after the load', () => {
        /* If adoption ever starts calling normaliseDayPlans(), this is the
           test that fails: UNREADABLE would be dropped and the list would
           come back with one entry. */
        expect(state.dayPlans).toHaveLength(2);
        expect(state.dayPlans[1]).toEqual(UNREADABLE);
    });

    test('and it survives the next write rather than being erased by it', async () => {
        const w = await app.page.evaluate(async () => {
            window.__writes = [];
            _flushSaveNow();
            await new Promise(r => setTimeout(r, 500));
            return window.__writes[0];
        });
        expect(w.day_plans).toHaveLength(2);
        expect(w.day_plans[1]).toEqual(UNREADABLE);
        expect(w.programme).toEqual({ programmeKey: 'size.v2', version: 2, note: 'kept' });
        expect(app.errors).toEqual([]);
    }, 30_000);
});

describe('a localStorage restore when the server read times out', () => {
    /* The path that used to write {...DEFAULT_PERSISTED,...rest} with no
       validation at all, and the one that never reached normaliseSchedule(). */
    let app, state;
    beforeAll(async () => {
        app = await openApp({ hangRead: true });
        await app.page.evaluate(() => {
            localStorage.setItem('bp_data_to1', JSON.stringify({
                totalXp: 95, difficulty: 'advanced',
                schedule: ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'],
                _savedAt: new Date().toISOString(),
            }));
        });
        await signIn(app.page, { id: 'to1', loaded: false });
        await app.page.evaluate(() => loadPersisted());
        await app.page.waitForTimeout(9_000);  // the read has an 8s timeout
        state = await app.page.evaluate(() => ({
            programme: persisted.programme,
            dayPlans: persisted.dayPlans,
            xp: persisted.totalXp,
            loaded: _persistedLoaded,
        }));
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('a backup written before the fields existed still normalises', () => {
        expect(state.loaded).toBe(true);
        expect(state.xp).toBe(95);
        expect(state.programme).toBe(null);
        expect(state.dayPlans).toEqual([]);
    });
});

describe('the legacy schedule is a container the boundary guarantees', () => {
    /* INTENTIONAL BEHAVIOUR CHANGE, pinned here. These two restores used to
       bypass normaliseSchedule() entirely, so isBlackoutDay() and
       renderDashboard() could index a short array, a non-array, or a type
       that no longer exists. The repair is the one the server-row path has
       always had; nothing about normaliseSchedule() changed. */
    const TYPES = ['length', 'girth', 'stamina', 'rest'];
    let app;
    beforeAll(async () => {
        app = await openApp({ row: null });
        await signIn(app.page, { id: 'sc1', loaded: false });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    /** Seed a backup, run the real loadPersisted(), report the schedule. */
    const restore = async (schedule) => app.page.evaluate(async (sched) => {
        localStorage.setItem('bp_data_sc1', JSON.stringify({
            totalXp: 42, schedule: sched, _savedAt: new Date().toISOString(),
        }));
        await loadPersisted();
        let threw = null;
        try { isBlackoutDay(); } catch (e) { threw = String(e); }
        return { schedule: persisted.schedule, xp: persisted.totalXp, threw };
    }, schedule);

    test('an unrecognised slot is repaired to the default for that day', async () => {
        const r = await restore(['length', 'nonsense', 'rest', 'length', 'girth', 'rest', 'rest']);
        expect(r.xp).toBe(42);                       // the restore itself still happened
        expect(r.schedule).toHaveLength(7);
        r.schedule.forEach(d => expect(TYPES).toContain(d));
        expect(r.schedule[1]).toBe('girth');         // DEFAULT_PERSISTED.schedule[1]
        expect(r.threw).toBe(null);
    }, 30_000);

    test('a schedule that is not an array comes back as seven valid days', async () => {
        const r = await restore('rest');
        expect(r.schedule).toHaveLength(7);
        r.schedule.forEach(d => expect(TYPES).toContain(d));
        expect(r.threw).toBe(null);
    }, 30_000);

    test('a schedule the member arranged themselves is left alone', async () => {
        const custom = ['girth', 'rest', 'length', 'girth', 'rest', 'stamina', 'rest'];
        const r = await restore(custom);
        expect(r.schedule).toEqual(custom);
        expect(app.errors).toEqual([]);
    }, 30_000);
});

describe('importing a backup goes through the same boundary', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ row: null });
        await signIn(app.page, { id: 'im1' });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    /** Import a real File through the real importData(), deterministically. */
    const importBackup = async (obj) => app.page.evaluate(async (backup) => {
        persisted.__marker = 'pre';   // adoption rebuilds the object, so this goes
        importData(new File([JSON.stringify(backup)], 'b.json', { type: 'application/json' }));
        const t0 = Date.now();
        while ('__marker' in persisted && Date.now() - t0 < 5000) {
            await new Promise(r => setTimeout(r, 25));
        }
        return { programme: persisted.programme, dayPlans: persisted.dayPlans, xp: persisted.totalXp };
    }, obj);

    /* ADOPTION is what these two assert, so they call it directly.
       importData() ends with renderDashboard(), and migration classification
       now fills a null programme during that render, so the state after an
       import is adoption's answer plus a classification. Asserting
       `programme === null` after an import would be asserting that
       classification never ran. The contract under test here is narrower
       than that and belongs to adoptPersisted(). */
    const adopt = async (raw) => app.page.evaluate((r) => {
        adoptPersisted(r);
        return { programme: persisted.programme, dayPlans: persisted.dayPlans, xp: persisted.totalXp };
    }, raw);

    test('adoption gives a backup without the fields the empty values', async () => {
        const r = await adopt({ sessionLog: [], totalXp: 7 });
        expect(r.xp).toBe(7);
        expect(r.programme).toBe(null);
        expect(r.dayPlans).toEqual([]);
    }, 30_000);

    test('adoption refuses a programme that is not an object, rather than carrying it', async () => {
        /* A container failure rather than unread data: a string is not a
           programme in any version of the model. */
        const r = await adopt({ sessionLog: [], totalXp: 8, programme: 'size' });
        expect(r.programme).toBe(null);
    }, 30_000);

    test('an import of a backup without the fields ends up classified, not null', async () => {
        /* The end-to-end consequence of the above, so the hand-off between
           adoption and classification is pinned rather than assumed. */
        const r = await importBackup({ sessionLog: [], totalXp: 7 });
        expect(r.xp).toBe(7);
        expect(r.dayPlans).toEqual([]);
        expect(r.programme).not.toBe(null);
        expect(r.programme.source).toBe('default');
        expect(r.programme.custom).toBe(false);
    }, 30_000);

    test('an import whose programme is a string is refused and then classified', async () => {
        const r = await importBackup({ sessionLog: [], totalXp: 8, programme: 'size' });
        expect(typeof r.programme).toBe('object');
        expect(r.programme.version).toBe(1);
        expect(r.programme.source).toBe('default');
    }, 30_000);

    test('plans in a backup are carried through, unreadable records included', async () => {
        const r = await importBackup({
            sessionLog: [], totalXp: 9,
            programme: { programmeKey: 'stamina.v1', version: 1 },
            dayPlans: [READABLE, UNREADABLE],
        });
        expect(r.programme).toEqual({ programmeKey: 'stamina.v1', version: 1 });
        expect(r.dayPlans).toHaveLength(2);
        expect(r.dayPlans[1]).toEqual(UNREADABLE);
    }, 30_000);

    test('a dayPlans value that is not an array becomes an empty list', async () => {
        const r = await importBackup({ sessionLog: [], totalXp: 10, dayPlans: { '2026-10-05': {} } });
        expect(r.dayPlans).toEqual([]);
        expect(app.errors).toEqual([]);
    }, 30_000);
});

describe('the row mapping cannot drift from the defaults', () => {
    /* _internalFromRow() stopped spreading DEFAULT_PERSISTED, which is what
       makes the mapping readable. The cost is that a field added to the
       defaults without a mapping here would silently reset to its default on
       every single load. This is the test that makes that loud instead. */
    let app;
    beforeAll(async () => { app = await openApp(); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('every DEFAULT_PERSISTED key has an explicit server-row mapping', async () => {
        const r = await app.page.evaluate(() => ({
            defaults: Object.keys(DEFAULT_PERSISTED).sort(),
            mapped: Object.keys(_internalFromRow({})).sort(),
        }));
        expect(r.mapped).toEqual(r.defaults);
    });

    test('an empty row maps to exactly the default values', async () => {
        const r = await app.page.evaluate(() =>
            Object.keys(DEFAULT_PERSISTED).filter(k =>
                JSON.stringify(_internalFromRow({})[k]) !== JSON.stringify(DEFAULT_PERSISTED[k])));
        expect(r).toEqual([]);
        expect(app.errors).toEqual([]);
    });
});
