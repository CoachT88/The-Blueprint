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
    /* Pinned to a Thursday, and that is load-bearing.
     *
     * These fixtures seed training days forward from Monday of the current
     * week, which silently assumes enough of the week has elapsed to hold
     * them. On a Monday it does not: three seeded sessions land on Mon, Tue
     * and Wed, two of them in the future, the week scores one qualifying
     * session against a three-session target, and the verdict comes back
     * 'missed'. The suite therefore passed six days a week and failed on
     * Mondays. Found on 2026-10-05, a Monday; the previous green run was the
     * Sunday before.
     *
     * The helper's own comment already said a Pass cannot be earned before a
     * week's third training day. That is true of the product, so rather than
     * weaken the assertions the clock is pinned mid-week, which is the
     * condition the fixtures were always written for. */
    const THURSDAY = new Date(2026, 5, 18, 12, 0, 0);   // 18 June 2026, ISO week 25
    beforeAll(async () => { app = await openApp({ clock: THURSDAY }); await signIn(app.page, { id: 'u7' }); }, 60_000);
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
        /* Distinct days inside THIS week, anchored forward from Monday so a
           run never spills into last week and gets counted against the wrong
           row. A week cannot qualify before its third training day, so a
           Pass cannot be earned on a Monday or a Tuesday at all. That is the
           real behaviour, not a test artefact, and it is why these fixtures
           cap at the days that have actually elapsed. */
        const monday = new Date(); monday.setHours(12, 0, 0, 0);
        monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        for (let i = 0; i < n; i++) {
            const d = new Date(monday); d.setDate(d.getDate() + i);
            persisted.sessionLog.push({ date: d.toISOString(), routineType: 'length', xpEarned: 15 });
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
            captureLaunchPrescription();   /* the production launch capture: finishSession records the prescription the session LAUNCHED under, so a harness that sets routineType by hand must freeze it the same way the real startMission() does */
            session.routineType = 'length';
            _sessionStartTime = Date.now() - 60000;
            selectedEQ = null; selectedRPE = null;
            document.getElementById('input-bpel').value = '';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = '';
            finishSession();
            closeSessionSummary();   // releases the one-shot finish guard, as the member does
            return { before, after: persisted.streakPasses,
                     verdict: persisted.progressionLedger.slice(-1)[0].verdict };
        });
        expect(r.verdict).toBe('qualified');
        expect(r.before).toBe(0);
        expect(r.after).toBe(1);
    }, 30_000);

    test('a missed day is covered and a Pass is spent on it', async () => {
        const r = await app.page.evaluate(() => {
            // Trained 4, 3 and 2 days ago. Yesterday missed.
            persisted.sessionLog = [4, 3, 2].map(d => ({
                date: new Date(Date.now() - d * 864e5).toISOString(),
                routineType: 'length', eq: 7, rpe: 5, xpEarned: 15,
            }));
            persisted.streakPasses = 1;
            persisted.passProtectedDates = [];
            const consumed = maybeConsumeStreakPass();
            const yest = new Date(Date.now() - 864e5).toISOString().split('T')[0];
            return { consumed, passes: persisted.streakPasses,
                     covers: persisted.passProtectedDates.includes(yest) };
        });
        expect(r.consumed).toBe(true);
        expect(r.covers).toBe(true);     // the missed day is the one covered
        expect(r.passes).toBe(0);        // and the Pass is spent
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
        // notifyRules.js decideNotification() reads passProtectedDates as
        // plain YYYY-MM-DD strings and tests them with Array.includes, to
        // stay quiet on a day a Pass is covering. Anything else silently
        // stops matching. This survived the streak retirement because it was
        // never about the streak.
        const r = await app.page.evaluate(() => {
            persisted.sessionLog = [4, 3, 2].map(d => {
                const x = new Date(); x.setDate(x.getDate() - d);
                return { date: x.toISOString(), routineType: 'length', xpEarned: 15 };
            });
            persisted.streakPasses = 1;
            persisted.passProtectedDates = [];
            maybeConsumeStreakPass();
            /* Yesterday is computed in the PAGE, not in node. The suite pins
               the page clock, so a date derived test-side would be the real
               yesterday and would never match. */
            return { dates: persisted.passProtectedDates,
                     yesterday: new Date(Date.now() - 864e5).toISOString().split('T')[0] };
        });
        expect(r.dates).toHaveLength(1);
        expect(r.dates[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(r.dates[0]).toBe(r.yesterday);
    }, 30_000);

    test('REGRESSION: earning a Pass does not inflate the week it was earned for', async () => {
        /* The hole a mutation found: earning writes streakPasses, and must
           write nothing else. If it also nudged the ledger row it would be
           manufacturing mechanical exposure out of a reward for having
           already done the work, and the next week could inherit it. */
        const r = await trainThisWeek(3);
        const after = await app.page.evaluate(() => {
            const row = persisted.progressionLedger[persisted.progressionLedger.length - 1];
            const live = getCurrentWeekKey();
            const distinctDays = new Set(persisted.sessionLog
                .filter(e => window.BP.isQualifyingSession(e) && window.BP.weekKey(new Date(e.date)) === live)
                .map(e => e.date.split('T')[0])).size;
            return { qualifying: row.qualifyingSessions, target: row.targetSessions,
                     verdict: row.verdict, distinctDays };
        });
        expect(r.earned).toBe(true);
        expect(r.passes).toBe(1);
        // The row still says exactly what the log says, and no more.
        expect(after.distinctDays).toBe(3);
        expect(after.qualifying).toBe(3);
        expect(after.qualifying).toBe(after.distinctDays);
        expect(after.target).toBe(4);
        expect(after.verdict).toBe('qualified');
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

    test('the bank is on the HQ, without entering a session', async () => {
        // Phase 2B.1 left the mechanic working and invisible: the streak chip
        // had been its only display. This is the replacement, and it has to
        // be readable from the HQ, because a Pass is spent on a day the
        // member did not open a session at all.
        await seed([2, 1, 0]);
        const r = await app.page.evaluate(() => {
            persisted.streakPasses = 1;
            goToStep(0);
            const chip = document.getElementById('hq-pass-chip');
            return {
                onHq: !!chip && !!chip.offsetParent,
                text: document.getElementById('hq-pass-count').textContent,
                step: session.step,
            };
        });
        expect(r.step).toBe(0);
        expect(r.onHq).toBe(true);
        expect(r.text).toBe('Recovery Passes: 1 / 2');
    }, 30_000);

    test.each([[0, '0 / 2'], [1, '1 / 2'], [2, '2 / 2']])
    ('a bank of %i reads as %s', async (banked, shown) => {
        const text = await app.page.evaluate((n) => {
            persisted.streakPasses = n;
            renderDashboard();
            return document.getElementById('hq-pass-count').textContent;
        }, banked);
        expect(text).toContain(shown);
    }, 30_000);

    test('the count follows a real earn through finishSession', async () => {
        const r = await app.page.evaluate(() => {
            persisted.primaryGoal = 'all';
            persisted.schedule = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
            persisted.progressionLedger = [];
            persisted.streakPasses = 0;
            persisted.lastPassEarnedDate = '';
            persisted.sessionLog = [2, 1].map(d => {
                const x = new Date(); x.setDate(x.getDate() - d);
                return { date: x.toISOString(), routineType: 'length', xpEarned: 15 };
            });
            goToStep(0);
            const before = document.getElementById('hq-pass-count').textContent;

            captureLaunchPrescription();   /* the production launch capture: finishSession records the prescription the session LAUNCHED under, so a harness that sets routineType by hand must freeze it the same way the real startMission() does */
            session.routineType = 'length';
            _sessionStartTime = Date.now() - 60000;
            selectedEQ = 8; selectedRPE = 5;
            document.getElementById('input-bpel').value = '';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = '';
            finishSession();
            const summary = document.getElementById('summary-records').textContent;
            closeSessionSummary();
            return { before, summary, after: document.getElementById('hq-pass-count').textContent,
                     banked: persisted.streakPasses };
        });
        expect(r.before).toBe('Recovery Passes: 0 / 2');
        expect(r.banked).toBe(1);
        expect(r.after).toBe('Recovery Passes: 1 / 2');
        expect(r.summary).toContain('You earned a Recovery Pass for a solid week of training');
        expect(r.summary).not.toMatch(/qualifying/i);
    }, 30_000);

    test('what a Pass does is explained before one is ever spent', async () => {
        const r = await app.page.evaluate(() => {
            persisted.streakPasses = 2;
            renderDashboard();
            document.getElementById('hq-pass-chip').click();
            const modal = document.getElementById('pass-info-modal');
            const text = modal.textContent;
            document.getElementById('pass-info-close').click();
            return { opened: true, closed: modal.classList.contains('hidden'), text };
        });
        expect(r.opened).toBe(true);
        expect(r.closed).toBe(true);
        expect(r.text).toContain('You have 2 of 2 banked.');
        // Earned for training, spent on a missed day, and not training credit.
        // The wording must not imply a perfect week: a four-session schedule
        // needs three, so "complete the training your schedule asked for"
        // asked more of the member than the mechanic does.
        expect(r.text).toMatch(/enough training to keep your week on track/i);
        expect(r.text).not.toMatch(/complete the training your schedule/i);
        expect(r.text).toMatch(/if you miss a day/i);
        expect(r.text).toMatch(/does not count as a session/i);
        expect(r.text).toMatch(/does not move you closer to the next tier/i);
    }, 30_000);

    test('no Pass copy leaks the engine vocabulary', async () => {
        const copy = await app.page.evaluate(() => {
            persisted.streakPasses = 1;
            renderDashboard();
            openPassInfo();
            const out = document.getElementById('pass-info-modal').textContent
                + ' ' + document.getElementById('hq-pass-count').textContent
                + ' ' + document.getElementById('hq-pass-used-banner').textContent;
            closePassInfo();
            return out;
        });
        // The engine's own words, not ordinary English ones: "hold two at a
        // time" is fine, the state named HOLD is not.
        expect(copy).not.toMatch(/\b(ledger|verdict|denominator|qualifying week|rolling window|streak)\b/i);
        expect(copy).not.toMatch(/\b(UNKNOWN|NOT_ELIGIBLE|ELIGIBLE|HOLD)\b/);
    }, 30_000);

    test('the mechanic itself is unchanged and the page stayed clean', async () => {
        const r = await app.page.evaluate(() => ({
            streakChipGone: !document.getElementById('hq-streak'),
            earnFnExists: typeof maybeEarnRecoveryPass === 'function',
            consumeFnExists: typeof maybeConsumeStreakPass === 'function',
            cap: RECOVERY_PASS_CAP,
        }));
        expect(r.streakChipGone).toBe(true);
        expect(r.earnFnExists).toBe(true);
        expect(r.consumeFnExists).toBe(true);
        expect(r.cap).toBe(2);
        expect(app.errors).toEqual([]);
    }, 30_000);
});
