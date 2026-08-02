import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Broad smoke test. In a single 5,000-line file with no build step, the common
 * way to break things is a function or element id that no longer exists, which
 * throws at click time rather than load time. These checks catch that class of
 * breakage in seconds.
 */
const FUNCTIONS = [
    // navigation and rendering
    'goToStep', 'nextStep', 'renderDashboard', 'renderDailyTip', 'renderHydration',
    // tour and onboarding
    'startTour', 'tourNext', 'endTour', 'maybeStartTour', 'oneTimeTip', 'replayTour',
    'replayIntro', 'closeManual', 'showOnboarding', 'hideOnboarding', 'finishOnboarding',
    'obNext', 'goToObSlide', '_obLastIdx', 'renderGoalOptions', 'selectGoal', 'openGoalPicker',
    // persistence
    'savePersisted', '_flushSaveNow', '_buildSavePayload', '_upsertPayload', 'loadPersisted',
    'normaliseSchedule', 'maybeApplyGoalSchedule',
    // sessions and progress
    'finishSession', 'resetSession', 'getCurrentStreak', 'updateRecords', 'checkMilestones',
    'renderProgressChart', 'renderEqChart', 'drawLine', 'drawEmpty', 'getEqSummary',
    'showWeeklyReport', 'showSessionHistory', 'closeSessionSummary',
    // streak passes
    'maybeEarnStreakPass', 'maybeConsumeStreakPass', '_dayKey',
    // coach, membership, misc
    '_coachContext', 'askCoach', 'checkMembership', '_friendlyAuthError', 'setAuthErrorHTML',
    'maybePromptPush', 'isBlackoutDay', 'getDiff', 'getLevelInfo', 'getHydration',
    'getHydrationLitres', 'undoHydration', 'exportData', 'importData',
    'togglePhotoCompare', 'onGalleryTap', 'openPhotoLog', 'closePhotoLog', 'renderGalleryInto',
    'dayTypeIcon', 'dayTypeLabel', 'getGoal', 'getGoalKey', 'isSizeLed', 'getScheduledType',
];

const ELEMENT_IDS = [
    'launch-btn', 'progress-btn', 'weekly-report-btn', 'photos-btn', 'ai-coach-btn', 'manual-btn',
    'manual-close-btn', 'replay-intro-btn', 'replay-tour-btn', 'change-goal-btn',
    'ob-next-btn', 'ob-skip-btn', 'goal-options', 'goal-confirm',
    'tour-next', 'tour-skip', 'tour-layer', 'tour-hole', 'tour-card', 'tour-title', 'tour-body', 'tour-dots',
    'hq-rest-banner', 'hq-pass-used-banner', 'hq-load-failed-banner', 'hq-load-retry-btn',
    'photo-compare-btn', 'photo-compare', 'photo-compare-before', 'photo-compare-after',
    'photo-compare-gap', 'photo-compare-hint',
    'eq-chart', 'bpel-chart', 'mseg-chart', 'eq-summary-row', 'eq-avg', 'eq-trend',
    'last-measure-row', 'last-bpel', 'last-mseg', 'beginner-rec-note',
    'hydration-over', 'hydration-undo-btn', 'hydration-entry-note',
    'modal-stamina-btn', 'warmup-back-btn', 'notif-modal', 'export-btn', 'import-btn',
    'hq-stat-chips', 'hq-level-badge', 'hq-calendar-card', 'hq-tip-card', 'hq-hydration-card',
    'hq-checkin-card', 'hq-records-card', 'hq-tools-row', 'hq-coach-row',
];

describe('app wiring', () => {
    let app;
    beforeAll(async () => { app = await openApp(); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('every function referenced by a handler exists', async () => {
        const missing = await app.page.evaluate(
            names => names.filter(n => {
                try { return typeof eval(n) !== 'function'; } catch { return true; }
            }), FUNCTIONS);
        expect(missing).toEqual([]);
    });

    test('every wired element id exists', async () => {
        const missing = await app.page.evaluate(
            ids => ids.filter(i => !document.getElementById(i)), ELEMENT_IDS);
        expect(missing).toEqual([]);
    });

    test('every step navigates without throwing', async () => {
        await signIn(app.page, { id: 'reg1' });
        for (const step of [0, 1, 2, 3, 4, 5]) {
            await app.page.evaluate(s => goToStep(s), step);
            await app.page.waitForTimeout(200);
        }
        expect(app.errors).toEqual([]);
    }, 40_000);

    test('a full session logs XP, an entry, a measurement and a summary', async () => {
        const after = await app.page.evaluate(() => {
            persisted.sessionLog = []; persisted.totalXp = 0; persisted.allTimeSessionCount = 0;
            persisted.measurements = []; persisted.records = { longestStreak: 0, bestWeekXp: 0, bestSessionXp: 0 };
            persisted.streakPasses = 0; persisted.passProtectedDates = [];
            session.routineType = 'length'; selectedEQ = 7; selectedRPE = 5;
            _sessionStartTime = Date.now() - 600000;
            document.getElementById('input-bpel').value = '6.25';
            document.getElementById('input-mseg').value = '4.75';
            document.getElementById('session-note-input').value = 'regression run';
            finishSession();
            return {
                xp: persisted.totalXp, logged: persisted.sessionLog.length,
                count: persisted.allTimeSessionCount, meas: persisted.measurements.length,
                summaryShown: document.getElementById('session-summary-modal').classList.contains('show'),
            };
        });
        expect(after.xp).toBeGreaterThan(0);
        expect(after.logged).toBe(1);
        expect(after.count).toBe(1);
        expect(after.meas).toBe(1);
        expect(after.summaryShown).toBe(true);
    }, 30_000);

    test('the save payload carries every synced column', async () => {
        const p = await app.page.evaluate(() => _buildSavePayload());
        for (const col of [
            'total_xp', 'session_log', 'measurements', 'schedule', 'completed_days',
            'all_time_session_count', 'xp_migrated',
            'streak_passes', 'pass_protected_dates', 'last_pass_earned_date', 'primary_goal',
        ]) expect(p, `missing ${col}`).toHaveProperty(col);
    });

    test('reports, history and charts all open', async () => {
        await app.page.evaluate(() => closeSessionSummary());
        await app.page.waitForTimeout(300);

        await app.page.evaluate(() => showWeeklyReport());
        await app.page.waitForTimeout(250);
        expect(await app.page.evaluate(
            () => document.getElementById('weekly-report-modal').classList.contains('show'))).toBe(true);

        await app.page.evaluate(() => {
            document.getElementById('weekly-report-modal').classList.remove('show');
            renderProgressChart();
        });
        await app.page.waitForTimeout(250);
        const charts = await app.page.evaluate(
            () => ['bpel-chart', 'mseg-chart', 'eq-chart'].every(i => document.getElementById(i).innerHTML.length > 20));
        expect(charts).toBe(true);

        await app.page.evaluate(() => showSessionHistory());
        await app.page.waitForTimeout(200);
        expect(await app.page.evaluate(
            () => document.getElementById('history-modal').style.display)).not.toBe('none');
    }, 40_000);

    test('the daily tip renders and the run produced no JS errors', async () => {
        await app.page.evaluate(() => { persisted.lastTipDate = ''; renderDailyTip(); });
        await app.page.waitForTimeout(200);
        const tip = await app.page.evaluate(() => document.getElementById('daily-tip').textContent);
        expect(tip.length).toBeGreaterThan(10);
        expect(app.errors).toEqual([]);
    }, 30_000);
});
