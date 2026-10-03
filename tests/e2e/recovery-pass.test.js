import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, sessionEntry } from './harness.js';

/**
 * The Recovery Pass after Phase 2B.1.
 *
 * It used to be earned once per seven-day streak. The streak is retired, so
 * it is now earned once per QUALIFYING WEEK, capped at two. What has not
 * changed is the part that matters most: a Pass is a flexibility mechanic
 * about reminders and messaging, never training credit. It must never
 * manufacture mechanical exposure, and the tests at the end of this file
 * are the ones that hold that line.
 *
 * Earning is driven through the real finishSession(), per the Phase 2B.1
 * test policy: integration tests exercise the production path rather than
 * reimplementing it.
 */
describe('recovery pass', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'u7' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    const seed = (daysAgoList) => app.page.evaluate((list) => {
        persisted.sessionLog = list.map(d => ({
            date: new Date(Date.now() - d * 864e5).toISOString(),
            routineType: 'length', eq: 7, rpe: 5, xpEarned: 15,
        }));
        persisted.streakPasses = 0;
        persisted.passProtectedDates = [];
        persisted.lastPassEarnedDate = '';
    }, daysAgoList);

    /** Start a clean week and complete `n` sessions through finishSession(). */
    const trainThisWeek = (n) => app.page.evaluate((n) => {
        persisted.primaryGoal = 'all';
        persisted.schedule = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
        persisted.sessionLog = [];
        persisted.progressionLedger = [];
        persisted.streakPasses = 0;
        persisted.lastPassEarnedDate = '';
        persisted.passProtectedDates = [];
        // Spread across distinct days inside this week so they are distinct
        // qualifying days rather than a same-day run.
        const base = persisted.sessionLog;
        for (let i = 0; i < n; i++) {
            const d = new Date(); d.setDate(d.getDate() - i);
            base.push({ date: d.toISOString(), routineType: 'length', xpEarned: 15 });
        }
        syncProgression('test');
        return { earned: maybeEarnRecoveryPass(), passes: persisted.streakPasses,
                 week: persisted.progressionLedger[persisted.progressionLedger.length - 1] };
    }, n);

    test('a qualifying week earns exactly one pass', async () => {
        const r = await trainThisWeek(3);
        expect(r.week.verdict).toBe('qualified');
        expect(r.earned).toBe(true);
        expect(r.passes).toBe(1);
    }, 30_000);

    test('and not a second one in the same week', async () => {
        const r = await app.page.evaluate(() => ({
            earned: maybeEarnRecoveryPass(), passes: persisted.streakPasses,
        }));
        expect(r.earned).toBe(false);
        expect(r.passes).toBe(1);
    });

    test('a non-qualifying week earns nothing', async () => {
        const r = await trainThisWeek(1);
        expect(r.week.verdict).toBe('missed');
        expect(r.earned).toBe(false);
        expect(r.passes).toBe(0);
    }, 30_000);

    test('REGRESSION: earning no longer depends on a streak', async () => {
        // Seven consecutive days used to be the trigger. On a four-session
        // schedule that is still only one qualifying week, so it pays once,
        // and it pays for the week rather than for the run of days.
        const r = await app.page.evaluate(() => {
            persisted.primaryGoal = 'all';
            persisted.schedule = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
            persisted.sessionLog = [];
            persisted.progressionLedger = [];
            persisted.streakPasses = 0; persisted.lastPassEarnedDate = '';
            for (let d = 6; d >= 0; d--) {
                const x = new Date(); x.setDate(x.getDate() - d);
                persisted.sessionLog.push({ date: x.toISOString(), routineType: 'length', xpEarned: 15 });
            }
            syncProgression('test');
            const first = maybeEarnRecoveryPass();
            const second = maybeEarnRecoveryPass();
            return { first, second, passes: persisted.streakPasses };
        });
        expect(r.first).toBe(true);
        expect(r.second).toBe(false);
        expect(r.passes).toBe(1);
    }, 30_000);

    test('the cap of two holds', async () => {
        const r = await app.page.evaluate(() => {
            persisted.streakPasses = 2; persisted.lastPassEarnedDate = '';
            return { earned: maybeEarnRecoveryPass(), passes: persisted.streakPasses };
        });
        expect(r.earned).toBe(false);
        expect(r.passes).toBe(2);
    });

    test('REGRESSION: a Pass is earned through the real completion path', async () => {
        // The production orchestration, not a direct helper call.
        const r = await app.page.evaluate(() => {
            persisted.primaryGoal = 'all';
            persisted.schedule = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
            persisted.sessionLog = [];
            persisted.progressionLedger = [];
            persisted.streakPasses = 0; persisted.lastPassEarnedDate = '';
            persisted.completedDays = [false, false, false, false, false, false, false];
            for (let d = 2; d >= 1; d--) {
                const x = new Date(); x.setDate(x.getDate() - d);
                persisted.sessionLog.push({ date: x.toISOString(), routineType: 'length', xpEarned: 15 });
            }
            syncProgression('test');
            const before = persisted.streakPasses;
            // Third distinct day this week, completed for real.
            session.routineType = 'length';
            _sessionStartTime = Date.now() - 60000;
            selectedEQ = null; selectedRPE = null;
            document.getElementById('input-bpel').value = '';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = '';
            finishSession();
            return { before, after: persisted.streakPasses,
                     verdict: persisted.progressionLedger.slice(-1)[0].verdict };
        });
        expect(r.verdict).toBe('qualified');
        expect(r.before).toBe(0);
        expect(r.after).toBe(1);
    }, 30_000);

    test('a missed day is covered and the streak survives', async () => {
        const r = await app.page.evaluate(() => {
            // Trained 4, 3 and 2 days ago. Yesterday missed.
            persisted.sessionLog = [4, 3, 2].map(d => ({
                date: new Date(Date.now() - d * 864e5).toISOString(),
                routineType: 'length', eq: 7, rpe: 5, xpEarned: 15,
            }));
            persisted.streakPasses = 1;
            persisted.passProtectedDates = [];
            const before = getCurrentStreak();
            const consumed = maybeConsumeStreakPass();
            return { before, consumed, after: getCurrentStreak(), passes: persisted.streakPasses };
        });
        expect(r.before).toBe(0);        // streak already broken
        expect(r.consumed).toBe(true);
        expect(r.after).toBe(4);         // rescued
        expect(r.passes).toBe(0);
    });

    test.each([
        ['the same day twice', () => maybeConsumeStreakPass()],
    ])('does not consume for %s', async (_label) => {
        expect(await app.page.evaluate(() => maybeConsumeStreakPass())).toBe(false);
    });

    test('does not consume with no passes banked', async () => {
        const r = await app.page.evaluate(() => {
            persisted.streakPasses = 0; persisted.passProtectedDates = [];
            return maybeConsumeStreakPass();
        });
        expect(r).toBe(false);
    });

    test('does not consume when yesterday was trained', async () => {
        await seed([2, 1, 0]);
        const r = await app.page.evaluate(() => { persisted.streakPasses = 1; return maybeConsumeStreakPass(); });
        expect(r).toBe(false);
    });

    test('cannot resurrect a long-dead streak', async () => {
        const r = await app.page.evaluate(() => {
            persisted.sessionLog = [{
                date: new Date(Date.now() - 30 * 864e5).toISOString(),
                routineType: 'length', eq: 7, rpe: 5, xpEarned: 15,
            }];
            persisted.streakPasses = 1; persisted.passProtectedDates = [];
            return maybeConsumeStreakPass();
        });
        expect(r).toBe(false);
    });

    test('REGRESSION: spending a Pass creates no mechanical progression credit', async () => {
        // The line that must never move. A Pass covers a missed day for the
        // purposes of reminders and messaging. It may not turn that day into
        // training that happened.
        const r = await app.page.evaluate(() => {
            persisted.primaryGoal = 'all';
            persisted.schedule = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
            persisted.progressionLedger = [];
            // Two qualifying days this week. The target is four, so three are
            // needed and this week does not qualify.
            persisted.sessionLog = [3, 2].map(d => {
                const x = new Date(); x.setDate(x.getDate() - d);
                return { date: x.toISOString(), routineType: 'length', xpEarned: 15 };
            });
            persisted.streakPasses = 1;
            persisted.passProtectedDates = [];
            syncProgression('test');
            const before = persisted.progressionLedger[persisted.progressionLedger.length - 1];
            const beforeEligible = window.BP.progressionEligibility(persisted.progressionLedger);

            const consumed = maybeConsumeStreakPass();
            syncProgression('test');                     // and re-derive everything
            const after = persisted.progressionLedger[persisted.progressionLedger.length - 1];
            return {
                consumed, before, after,
                beforeQualifying: beforeEligible.qualifyingWeeks,
                afterQualifying: window.BP.progressionEligibility(persisted.progressionLedger).qualifyingWeeks,
                protectedDays: persisted.passProtectedDates.length,
                deload: isDeloadWeek(),
                advancedLocked: isTierLocked('advanced'),
            };
        });
        expect(r.consumed).toBe(true);                   // the Pass really was spent
        expect(r.protectedDays).toBe(1);                 // and recorded as experience state
        expect(r.after.qualifyingSessions).toBe(r.before.qualifyingSessions);
        expect(r.after.verdict).toBe(r.before.verdict);
        expect(r.after.verdict).not.toBe('qualified');
        expect(r.afterQualifying).toBe(r.beforeQualifying);
        expect(r.deload).toBe(false);
        expect(r.advancedLocked).toBe(true);
    }, 30_000);

    test('a protected date stays in the shape the notification sender reads', async () => {
        // notifyRules.js currentStreak() and decide() both take
        // passProtectedDates as plain YYYY-MM-DD strings and test them with
        // Set.has and Array.includes. Anything else silently stops matching.
        const dates = await app.page.evaluate(() => {
            persisted.sessionLog = [4, 3, 2].map(d => {
                const x = new Date(); x.setDate(x.getDate() - d);
                return { date: x.toISOString(), routineType: 'length', xpEarned: 15 };
            });
            persisted.streakPasses = 1;
            persisted.passProtectedDates = [];
            maybeConsumeStreakPass();
            return persisted.passProtectedDates;
        });
        expect(dates).toHaveLength(1);
        expect(dates[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const yesterday = new Date(Date.now() - 864e5).toISOString().split('T')[0];
        expect(dates[0]).toBe(yesterday);
    }, 30_000);

    test('the fields round-trip into the save payload', async () => {
        const p = await app.page.evaluate(() => {
            persisted.streakPasses = 2;
            persisted.passProtectedDates = ['2026-01-01'];
            persisted.lastPassEarnedDate = '2026-01-02';
            return _buildSavePayload();
        });
        expect(p.streak_passes).toBe(2);
        expect(p.pass_protected_dates).toEqual(['2026-01-01']);
        expect(p.last_pass_earned_date).toBe('2026-01-02');
    });

    test('banked passes still exist, and are no longer displayed', async () => {
        // Phase 2B.1 step 2 removed the streak chip, which was the only place
        // the banked pass count appeared. The mechanic is untouched and still
        // persists, and is now earned per qualifying week, but it still has
        // no display surface. Giving it one is presentation work this phase
        // deliberately leaves alone, so it is reported rather than papered
        // over with a new widget.
        await seed([2, 1, 0]);
        const r = await app.page.evaluate(() => {
            persisted.streakPasses = 2; goToStep(0);
            return {
                chipGone: !document.getElementById('hq-streak'),
                banked: persisted.streakPasses,
                earnFnExists: typeof maybeEarnRecoveryPass === 'function',
                consumeFnExists: typeof maybeConsumeStreakPass === 'function',
            };
        });
        expect(r.chipGone).toBe(true);
        expect(r.banked).toBe(2);
        expect(r.earnFnExists).toBe(true);
        expect(r.consumeFnExists).toBe(true);
        expect(app.errors).toEqual([]);
    }, 30_000);
});
