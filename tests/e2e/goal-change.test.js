import { describe, test, expect } from 'vitest';
import { openApp, signIn } from './harness.js';

const THURSDAY = new Date('2026-03-12T12:00:00Z');
async function setup(opts = {}) {
    const app = await openApp({ clock:THURSDAY, timezoneId:'UTC', ...opts });
    await signIn(app.page, { id:'goal-change' });
    await app.page.evaluate(() => {
        persisted.programme=null;
        persisted.primaryGoal='size';
        persisted.schedule=GOALS.size.schedule.slice();
        persisted.allTimeSessionCount=12;
        persisted.totalXp=1234;
        persisted.sessionLog=[{date:'2026-03-11T12:00:00Z',routineType:'length',duration:20}];
        persisted.measurements=[{date:'2026-03-10',bpel:6,mseg:5}];
        persisted.seenMilestones=['first-session'];
        persisted.streakPasses=2;
        renderDashboard();
    });
    return app;
}
const snapshot = page => page.evaluate(() => JSON.stringify({
    sessions:persisted.sessionLog, xp:persisted.totalXp, count:persisted.allTimeSessionCount,
    measurements:persisted.measurements, milestones:persisted.seenMilestones,
    passes:persisted.streakPasses, ledger:persisted.progressionLedger,
    start:persisted.programmeStartDate,
}));

describe('goal change uses the real picker and generation', () => {
    test('all four options remain above Done on a small phone', async () => {
        const app=await setup();
        try {
            await app.page.setViewportSize({width:320,height:568});
            await app.page.evaluate(() => openGoalPicker());
            await app.page.waitForFunction(() => document.getElementById('onboarding-overlay').classList.contains('show'));
            const boxes=await app.page.evaluate(() => ({
                options:document.getElementById('goal-options').getBoundingClientRect().bottom,
                done:document.getElementById('ob-next-btn').getBoundingClientRect().top,
                label:document.getElementById('ob-next-btn').textContent,
            }));
            expect(boxes.options).toBeLessThan(boxes.done);
            expect(boxes.label).toBe('Done');
        } finally {await app.close();}
    });
    test('Account opens the existing picker, confirms, saves and activates next Monday', async () => {
        const app=await setup();
        try {
            const before=await snapshot(app.page);
            const week=await app.page.evaluate(() => persisted.dayPlans.filter(p=>p.date<'2026-03-16'));
            await app.page.evaluate(() => { goToStep(0); hideOnboarding(); dismissUpdateNotice(); openAccount(); });
            await app.page.click('#account-goal-change');
            await app.page.waitForFunction(() => document.getElementById('onboarding-overlay').classList.contains('show'));
            await app.page.click('.goal-opt[data-goal="stamina"]');
            expect(await snapshot(app.page)).toBe(before);
            const state=await app.page.evaluate(() => ({key:persisted.programme.key,
                pending:persisted.programme.pendingChange,
                week:persisted.dayPlans.filter(p=>p.date<'2026-03-16'),
                today:currentTodayPrescription(), note:document.getElementById('goal-confirm').textContent}));
            expect(state.key).toBe('size');
            expect(state.pending).toMatchObject({key:'lastLonger',effectiveDate:'2026-03-16'});
            expect(state.week).toEqual(week);
            expect(state.note).toContain('Monday, Mar 16');
            expect(state.today.ok).toBe(true);
            expect(await app.page.evaluate(() => _coachContext())).toContain('the new program begins 2026-03-16');
            // Persist through the production writer, then load the returned row.
            await app.page.evaluate(async () => { await _flushSaveNow();
                window.__row=window.__writes.at(-1); await loadPersisted(); renderDashboard(); });
            expect(await app.page.evaluate(() => persisted.programme.pendingChange.key)).toBe('lastLonger');
            await app.page.clock.setFixedTime(new Date('2026-03-16T12:00:00Z'));
            const monday=await app.page.evaluate(() => {renderDashboard();return {
                key:persisted.programme.key, pending:persisted.programme.pendingChange,
                schedule:persisted.schedule, expected:GOALS.stamina.schedule,
                today:currentTodayPrescription(),};});
            expect(monday.key).toBe('lastLonger');
            expect(monday.pending).toBeNull();
            expect(monday.schedule).toEqual(monday.expected);
            expect(monday.today.ok).toBe(true);
            expect(monday.today.dayKind).toBe('rest');
            expect(app.errors).toEqual([]);
        } finally { await app.close(); }
    });
    test('declining the transition leaves the whole account unchanged', async () => {
        const app=await setup({acceptDialogs:false});
        app.page.on('dialog', d => d.dismiss());
        try {
            const before=await app.page.evaluate(() => JSON.stringify(persisted));
            await app.page.evaluate(() => selectGoal('stamina'));
            expect(await app.page.evaluate(() => JSON.stringify(persisted))).toBe(before);
        } finally {await app.close();}
    });
    test('replaces a queued goal and choosing the current program cancels it', async () => {
        const app=await setup();
        try {
            const r=await app.page.evaluate(() => {
                selectGoal('stamina'); selectGoal('eq');
                const replacement=persisted.programme.pendingChange;
                selectGoal('size');
                openAccount();
                return {replacement,goal:persisted.primaryGoal,pending:persisted.programme.pendingChange,
                    noteHidden:document.getElementById('account-goal-pending').classList.contains('hidden')};
            });
            expect(r.replacement.key).toBe('erectionQuality');
            expect(r.goal).toBe('size');
            expect(r.pending).toBeUndefined();
            expect(r.noteHidden).toBe(true);
        } finally {await app.close();}
    });
    test('a session draft prevents an immediate rewrite on a zero-session account', async () => {
        const app=await setup();
        try {
            const r=await app.page.evaluate(() => {
                persisted.allTimeSessionCount=0; persisted.sessionLog=[];
                localStorage.setItem('bp_session_draft_'+currentUser.id,
                    JSON.stringify({savedAt:Date.now(),routineType:'length',exerciseIndex:0,setIndex:1}));
                const draft=localStorage.getItem('bp_session_draft_'+currentUser.id);
                selectGoal('eq');
                return {pending:persisted.programme.pendingChange,
                    draftUnchanged:draft===localStorage.getItem('bp_session_draft_'+currentUser.id)};
            });
            expect(r.pending.effectiveDate).toBe('2026-03-16');
            expect(r.draftUnchanged).toBe(true);
        } finally {await app.close();}
    });
});
