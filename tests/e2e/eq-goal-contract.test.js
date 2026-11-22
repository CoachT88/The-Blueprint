/**
 * Characterization, NOT an endorsement, of the EQ goal P0 (#184).
 *
 * These tests exercise the actual selected-goal -> dated prescription ->
 * calendar/edit and substitution paths. They intentionally describe the
 * CURRENT defect so the first corrective PR must rewrite the expectation
 * to the desired non-mechanical EQ programme. Do not mistake a passing test
 * here for clinical validation or for permission to sell an EQ treatment.
 *
 * No real member state, no exercise/dose change, no checkout or Coach Tee.
 */
import { describe, test, expect } from 'vitest';
import { openApp, signIn } from './harness.js';

const TUESDAY = new Date('2026-03-17T12:00:00Z');

async function eqMember(id) {
    const app = await openApp({ clock: TUESDAY, timezoneId: 'UTC' });
    await signIn(app.page, { id });
    await app.page.evaluate(() => {
        // Real goal-selection path, not a hand-seeded answer.
        goToStep(0); hideOnboarding(); dismissUpdateNotice();
        selectGoal('eq');
        renderDashboard();
    });
    return app;
}

describe('EQ-only goal contract before the corrected programme ships', () => {
    test('P0: the real EQ selection currently generates an unwanted Length primary', async () => {
        const app = await eqMember('eq-consent-prescription');
        try {
            const state = await app.page.evaluate(() => {
                const date = window.BP.planDateKey(new Date());
                const plan = (persisted.dayPlans || []).find(p => p.date === date);
                const today = currentTodayPrescription();
                return {
                    goal: persisted.primaryGoal,
                    programme: persisted.programme && persisted.programme.key,
                    authoritative: onAuthoritativePlans(),
                    schedule: persisted.schedule.slice(),
                    dayMode: plan && plan.mode,
                    dayPrimary: plan && plan.primarySession && plan.primarySession.type,
                    todayOk: today && today.ok,
                    todayPrimary: today && today.primaryType,
                };
            });
            expect(state.goal).toBe('eq');
            expect(state.programme).toBe('erectionQuality');
            expect(state.authoritative).toBe(true);
            expect(state.schedule[2]).toBe('length'); // Tuesday, defect to remove
            expect(state.dayMode).toBe('prescribed');
            expect(state.dayPrimary).toBe('length');
            expect(state.todayOk).toBe(true);
            expect(state.todayPrimary).toBe('length');
            expect(app.errors).toEqual([]);
        } finally { await app.close(); }
    }, 60_000);

    test('P0: authoritative EQ day types are not editable through the calendar or day modal', async () => {
        const app = await eqMember('eq-consent-calendar');
        try {
            const out = await app.page.evaluate(() => {
                renderWeekStrip();
                const cell = document.querySelector('#hq-week-strip .week-cell[data-weekday="2"]');
                const before = JSON.stringify({
                    schedule: persisted.schedule,
                    dayPlans: persisted.dayPlans,
                    goal: persisted.primaryGoal,
                });
                openDayModal(2);
                const types = document.getElementById('type-modal-types');
                const notice = document.getElementById('type-modal-locked');
                const hidden = !!types && types.classList.contains('hidden');
                const noticeShown = !!notice && !notice.classList.contains('hidden');
                // Even a direct stale call refuses to rewrite authoritative plans.
                assignDay('rest');
                return {
                    isAuthoritative: onAuthoritativePlans(),
                    cellFound: !!cell,
                    cellRole: cell && cell.getAttribute('role'),
                    cellFocusable: cell && cell.hasAttribute('tabindex'),
                    hidden, noticeShown,
                    noticeText: notice && notice.textContent,
                    unchanged: before === JSON.stringify({
                        schedule: persisted.schedule,
                        dayPlans: persisted.dayPlans,
                        goal: persisted.primaryGoal,
                    }),
                };
            });
            expect(out.isAuthoritative).toBe(true);
            expect(out.cellFound).toBe(true);
            expect(out.cellRole).toBeNull();
            expect(out.cellFocusable).toBe(false);
            expect(out.hidden).toBe(true);
            expect(out.noticeShown).toBe(true);
            expect(out.noticeText).toMatch(/week is set by your program now/i);
            expect(out.unchanged).toBe(true);
        } finally { await app.close(); }
    }, 60_000);

    test('a different session choice does not rewrite the prescribed Length day', async () => {
        const app = await eqMember('eq-consent-substitution');
        try {
            const out = await app.page.evaluate(() => {
                const before = JSON.stringify({
                    schedule: persisted.schedule,
                    dayPlans: persisted.dayPlans,
                });
                const prescribed = currentTodayPrescription();
                // The same launch-authority function used by startMission().
                // Do NOT finish a fictitious session or award XP in this test.
                const snapshot = captureLaunchPrescription('stamina');
                return {
                    prescribedType: prescribed && prescribed.primaryType,
                    scheduled: snapshot && snapshot.scheduledType,
                    performed: snapshot && snapshot.performedType,
                    unchanged: before === JSON.stringify({
                        schedule: persisted.schedule,
                        dayPlans: persisted.dayPlans,
                    }),
                };
            });
            expect(out.prescribedType).toBe('length');
            expect(out.scheduled).toBe('length');
            expect(out.performed).toBe('stamina');
            expect(out.unchanged).toBe(true);
        } finally { await app.close(); }
    }, 60_000);
});
