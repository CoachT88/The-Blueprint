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
    'preferredName', 'savePreferredName', 'commitPreferredName',
    'greetingEligible', 'renderGreeting', '_greetedToday', '_markGreeted', '_attentionBandLive',
    '_notifPrefsKey', '_pushTzKey', '_readNotifPrefs',
    // Phase 2B.3.4: existing-member capture and the Account surface
    'nameNudgeEligible', '_nameAsked', '_markNameAsked',
    'renderAccount', 'openAccount', 'closeAccount', 'openAccountEditor', 'closeAccountEditor',
    'saveAccountName', 'clearAccountName', 'handleLogout', '_closeMemberOverlays',
    // Phase 2B.3.5: onboarding structure the journeys drive directly
    'obNext', 'hideOnboarding', 'finishOnboarding', 'fetchClaude', '_greetedKey',
    // persistence
    'savePersisted', '_flushSaveNow', '_buildSavePayload', '_upsertPayload', 'loadPersisted',
    'normaliseSchedule', 'maybeApplyGoalSchedule',
    // sessions and progress
    'finishSession', 'resetSession', 'updateRecords', 'checkMilestones',
    'maybeEarnRecoveryPass', 'ownsTier', 'eliteEqConditionMet', 'currentProgression', 'syncProgression',
    'renderProgressChart', 'renderEqChart', 'drawLine', 'drawEmpty', 'getEqSummary',
    'showWeeklyReport', 'showSessionHistory', 'closeSessionSummary',
    // recovery passes
    'maybeConsumeStreakPass', 'renderPassChip', 'openPassInfo', 'closePassInfo', '_dayKey',
    // coach, membership, misc
    '_coachContext', 'askCoach', 'checkMembership', '_friendlyAuthError', 'setAuthErrorHTML',
    'maybePromptPush', 'isBlackoutDay', 'getDiff', 'getLevelInfo', 'getHydration',
    'getHydrationLitres', 'undoHydration', 'exportData', 'importData',
    'togglePhotoCompare', 'onGalleryTap', 'openPhotoLog', 'closePhotoLog', 'renderGalleryInto',
    'dayTypeIcon', 'dayTypeLabel', 'getGoal', 'getGoalKey', 'isSizeLed',
    // Phase 3C.4 retired getScheduledType(). These three replaced it: the
    // canonical record, the Primary satisfaction answer, and the display type.
    'currentTodayPrescription', 'currentPrimarySatisfied', 'scheduledPrimaryType',
    'captureLaunchPrescription',
];

const ELEMENT_IDS = [
    'launch-btn', 'progress-btn', 'weekly-report-btn', 'photos-btn', 'ai-coach-btn', 'manual-btn',
    'manual-close-btn', 'replay-intro-btn', 'replay-tour-btn', 'change-goal-btn',
    'ob-next-btn', 'ob-skip-btn', 'goal-options', 'goal-confirm',
    'ob-name-input', 'ob-name-error', 'ob-name-skip', 'hq-greeting',
    // Phase 2B.3.4: the name prompt and the Account sheet. logout-btn is
    // listed because it moved from the header into the sheet keeping its id,
    // and the relocation must not quietly drop it.
    'account-btn', 'account-modal', 'account-name-value', 'account-name-edit',
    'account-name-editor', 'account-name-input', 'account-name-error',
    'account-name-save', 'account-name-clear', 'account-name-cancel',
    'account-notif-open', 'account-close', 'logout-btn',
    'hq-name-prompt', 'hq-name-prompt-add', 'hq-name-prompt-dismiss',
    'tour-next', 'tour-skip', 'tour-layer', 'tour-hole', 'tour-card', 'tour-title', 'tour-body', 'tour-dots',
    'hq-rest-banner', 'hq-pass-used-banner', 'hq-load-failed-banner', 'hq-load-retry-btn',
    'photo-compare-btn', 'photo-compare', 'photo-compare-before', 'photo-compare-after',
    'photo-compare-gap', 'photo-compare-hint',
    'eq-chart', 'bpel-chart', 'mseg-chart', 'eq-summary-row', 'eq-avg', 'eq-trend',
    'last-measure-row', 'last-bpel', 'last-mseg', 'beginner-rec-note',
    'hydration-over', 'hydration-undo-btn', 'hydration-entry-note',
    'modal-stamina-btn', 'warmup-back-btn', 'notif-modal', 'export-btn', 'import-btn',
    // Phase 3C.3: one weekly surface. hq-stat-chips (the dot row) and
    // hq-calendar-card (the calendar below it) are both absorbed into it.
    'hq-week-card', 'hq-week-strip', 'hq-week-label', 'hq-hydration-card',
    'hq-records-card', 'hq-tools-row', 'hq-coach-row',
    // Phase 3C.1: one context slot under the header. hq-level-badge and
    // hq-tip-card are gone from the HQ; the Recovery Pass chip that was
    // nested inside the badge survives, because passes are real state.
    'hq-context', 'hq-pass-chip',
    // Phase 2A.3: the daily check-in moved off the HQ into the Ready screen,
    // where the answer actually changes the prescription. hq-checkin-card is
    // gone on purpose; these are its replacements.
    'ready-cta', 'ready-planned', 'ready-response', 'ready-response-title',
    'ready-response-body', 'ready-response-withheld', 'ready-safety',
    'ready-safety-short', 'ready-safety-long', 'soreness-btns', 'sleep-btns',
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
            captureLaunchPrescription();   /* the production launch capture: finishSession records the prescription the session LAUNCHED under, so a harness that sets routineType by hand must freeze it the same way the real startMission() does */
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

    /**
     * Onboarding structure. Phase 2B.3.1 inserted the name slide in the
     * middle of a five-slide deck, and Phase 2B.3.5 checks the seams.
     *
     * _obLastIdx() is derived from the DOM but OB_NAME_SLIDE is the literal
     * 3, so inserting a slide before it would silently point the name gate
     * at the wrong slide and nothing else would complain. openGoalPicker()
     * carries the matching assumption that the goal slide is last.
     */
    test('the name slide index actually indexes the name slide', async () => {
        const r = await app.page.evaluate(() => {
            const slides = [...document.querySelectorAll('.ob-slide')];
            return { count: slides.length, last: _obLastIdx(), nameIdx: OB_NAME_SLIDE,
                     nameSlideHasInput: !!slides[OB_NAME_SLIDE].querySelector('#ob-name-input'),
                     lastSlideHasGoals: !!slides[_obLastIdx()].querySelector('#goal-options'),
                     dots: document.querySelectorAll('#ob-dots .ob-dot').length };
        });
        expect(r.nameSlideHasInput).toBe(true);     // OB_NAME_SLIDE is not adrift
        expect(r.lastSlideHasGoals).toBe(true);     // openGoalPicker's assumption holds
        expect(r.last).toBe(r.count - 1);
        expect(r.dots).toBe(r.count);               // a dot per slide, still
        expect(r.nameIdx).toBeLessThan(r.last);
    }, 30_000);

    test('onboarding still navigates end to end, and only the name slide can refuse', async () => {
        const r = await app.page.evaluate(() => {
            showOnboarding(0);
            const seen = [];
            for (let i = 0; i < 10 && document.getElementById('onboarding-overlay').classList.contains('show'); i++) {
                seen.push(_obSlide);
                obNext();
            }
            return { seen, closed: !document.getElementById('onboarding-overlay').classList.contains('show'),
                     onboarded: localStorage.getItem('bp_onboarded_reg1') };
        });
        expect(r.seen).toEqual([0, 1, 2, 3, 4]);    // every slide, in order
        expect(r.closed).toBe(true);
        expect(r.onboarded).toBe('1');              // the completion flag is set
    }, 30_000);

    test('an over-long name is the one thing that holds onboarding up', async () => {
        const r = await app.page.evaluate(() => {
            showOnboarding(OB_NAME_SLIDE);
            document.getElementById('ob-name-input').value = 'x'.repeat(41);
            obNext();
            const stuck = _obSlide;
            document.getElementById('ob-name-input').value = '';
            obNext();                                // blank always passes
            const freed = _obSlide;
            hideOnboarding();
            return { stuck, freed };
        });
        expect(r.stuck).toBe(3);                     // refused, still on the slide
        expect(r.freed).toBe(4);                     // and never trapped there
    }, 30_000);

    test('the tier slide no longer contradicts itself about where a new account starts', async () => {
        /* app/index.html:2746 puts a brand-new account on beginner, so the
           "Start at Beginner" headline was always right and the body clause
           claiming Intermediate was the default was the stale half. */
        const r = await app.page.evaluate(() => {
            const slide = document.getElementById('ob-slide-2');
            return { text: slide.innerText || slide.textContent,
                     welcome: document.getElementById('step-welcome').textContent };
        });
        expect(r.text).not.toContain('Intermediate is the default');
        expect(r.text).toContain('starts at Beginner');
        expect(r.text).toContain('Intermediate is open from day one');
        expect(r.welcome).toContain('Beginner and Intermediate are open from day one');
    }, 30_000);

    test('the daily tip card is gone, and asking for it is harmless', async () => {
        /* Phase 3C.1 removed it: 168px, the tallest block on the HQ, and
           branded "Coach Tee" while being canned static text, which made it
           read as assistant output. renderDailyTip() is null-guarded and
           still advances the stored index, so calling it cannot throw. */
        const r = await app.page.evaluate(() => {
            persisted.lastTipDate = ''; renderDailyTip();
            return { card: !!document.getElementById('hq-tip-card'),
                     body: !!document.getElementById('daily-tip'),
                     indexMoved: typeof persisted.tipIndex === 'number' };
        });
        expect(r.card).toBe(false);
        expect(r.body).toBe(false);
        expect(r.indexMoved).toBe(true);
        expect(app.errors).toEqual([]);
    }, 30_000);
});
