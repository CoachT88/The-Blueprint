import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, sessionEntry } from './harness.js';

/**
 * An established member must come through any change with everything intact.
 *
 * The row below is deliberately shaped like a real veteran account AND the
 * newest columns are rejected, reproducing the state on deploy day when the
 * ALTER TABLE has not been run yet. Supabase rejects an entire upsert when one
 * column is unknown, so without the schema fallback this member would silently
 * stop syncing.
 */
const CUSTOM_SCHEDULE = ['girth', 'rest', 'length', 'girth', 'rest', 'length', 'rest'];

const VETERAN = {
    id: 'vet', total_xp: 1840, difficulty: 'advanced',
    schedule: CUSTOM_SCHEDULE,
    completed_days: [true, true, false, true, false, false, false],
    session_log: Array.from({ length: 12 }, (_, i) => sessionEntry(11 - i, { type: i % 2 ? 'girth' : 'length', eq: 6 + (i % 3), xp: 20 })),
    measurements: [
        { date: new Date(Date.now() - 60 * 864e5).toISOString(), bpel: 6.0, mseg: 4.5 },
        { date: new Date(Date.now() - 5 * 864e5).toISOString(), bpel: 6.3, mseg: 4.8 },
    ],
    seen_milestones: ['first_session', 'xp_500', 'streak_7'],
    diff_unlocked_date: { intermediate: '2026-01-05', advanced: '2026-03-01', elite: '' },
    first_session_date: '2026-01-01', week_key: '',
    records: { longestStreak: 14, bestWeekXp: 140, bestSessionXp: 25 },
    tip_index: 9, last_tip_date: '2026-01-01',
    all_time_session_count: 87, xp_migrated: true,
    updated_at: new Date(Date.now() - 3600e3).toISOString(),
};

describe('an existing member keeps everything', () => {
    let app, state;
    beforeAll(async () => {
        // Reject the newest columns: the pre-migration state.
        app = await openApp({ row: VETERAN, rejectColumns: ['streak_passes', 'primary_goal'] });
        await app.page.evaluate(() => localStorage.clear());
        await signIn(app.page, { id: 'vet', email: 'v@v.com', loaded: false });
        await app.page.evaluate(() => loadPersisted());
        await app.page.waitForTimeout(600);
        state = await app.page.evaluate(() => ({
            xp: persisted.totalXp, diff: persisted.difficulty,
            sessions: persisted.sessionLog.length, meas: persisted.measurements.length,
            milestones: persisted.seenMilestones.length, records: persisted.records,
            count: persisted.allTimeSessionCount, unlocked: persisted.diffUnlockedDate,
            first: persisted.firstSessionDate, tipIdx: persisted.tipIndex,
            schedule: persisted.schedule, goal: persisted.primaryGoal,
            passes: persisted.streakPasses, protectedDates: persisted.passProtectedDates,
            loaded: _persistedLoaded,
        }));
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('XP, tier and history survive the load', () => {
        expect(state.xp).toBe(1840);
        expect(state.diff).toBe('advanced');       // never silently downgraded
        expect(state.sessions).toBe(12);
        expect(state.meas).toBe(2);
        expect(state.milestones).toBe(3);
        expect(state.count).toBe(87);
        expect(state.loaded).toBe(true);
    });

    test('records, unlock dates and first-session date survive', () => {
        expect(state.records.longestStreak).toBe(14);
        expect(state.records.bestSessionXp).toBe(25);
        expect(state.unlocked.advanced).toBe('2026-03-01');
        expect(state.first).toBe('2026-01-01');
    });

    test('a customised schedule is untouched, byte for byte', () => {
        expect(state.schedule).toEqual(CUSTOM_SCHEDULE);
    });

    test('fields the row predates default safely', () => {
        expect(state.goal).toBe('');           // unset behaves as "all"
        expect(state.passes).toBe(0);
        expect(Array.isArray(state.protectedDates)).toBe(true);
    });

    test('saving keeps all of it, dropping only the unmigrated columns', async () => {
        await app.page.evaluate(() => { window.__writes = []; _flushSaveNow(); });
        await app.page.waitForTimeout(800);
        const writes = await app.page.evaluate(() => window.__writes);

        expect(writes).toHaveLength(1);
        const w = writes[0];
        expect(w.total_xp).toBe(1840);
        expect(w.session_log).toHaveLength(12);
        expect(w.measurements).toHaveLength(2);
        expect(w.difficulty).toBe('advanced');
        expect(w.all_time_session_count).toBe(87);
        expect(w.schedule).toEqual(CUSTOM_SCHEDULE);
        expect('streak_passes' in w).toBe(false);
        expect('primary_goal' in w).toBe(false);
    }, 30_000);

    test('a new session appends to history rather than replacing it', async () => {
        await app.page.evaluate(() => { goToStep(0); });
        await app.page.waitForTimeout(300);
        await app.page.evaluate(() => {
            session.routineType = 'length'; selectedEQ = 8; selectedRPE = 5;
            _sessionStartTime = Date.now() - 6e5;
            document.getElementById('input-bpel').value = '';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = '';
            finishSession();
        });
        await app.page.waitForTimeout(1_000);
        const after = await app.page.evaluate(() => ({
            xp: persisted.totalXp, sessions: persisted.sessionLog.length, count: persisted.allTimeSessionCount,
        }));
        expect(after.sessions).toBe(13);
        expect(after.count).toBe(88);
        expect(after.xp).toBeGreaterThan(1840);
        expect(app.errors).toEqual([]);
    }, 30_000);
});
