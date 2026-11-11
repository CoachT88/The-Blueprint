import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { openApp, signIn } from './harness.js';

/**
 * The Erection Quality website copy, checked against the RUNNING programme.
 *
 * tools/launch/eq-bridge.live.html is the copy that replaces the current
 * #for-erections section when EQ is switched on. It describes a week and the
 * activities in it. This file derives that week and those activities from the
 * actual implementation (the schedule, the routine builder and the daily
 * practice) with the flag flipped inside the page only, and fails when the copy
 * says something the programme does not do. tests/goalBridge.test.js holds the
 * schedule and the gate; this holds the activities.
 */
const LIVE = readFileSync('tools/launch/eq-bridge.live.html', 'utf8')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/* The phrase the copy uses for each exercise the programme can show. A title
   with no entry here means the programme gained an exercise the copy does not
   mention: update the copy and this table together. */
const COPY_PHRASE = {
    'Diaphragmatic breathing': /easy breathing at a slow pace/i,
    'Pelvic Floor Release': /pelvic floor release exercise/i,
    'Cat-Cow': /Cat-Cow/,
    'Deep Squat — Malasana': /deep squat/i,
    'Happy Baby': /Happy Baby/,
};

describe('the activation copy describes what the EQ programme actually does', () => {
    let app, facts;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'eqcopy' });
        facts = await app.page.evaluate(() => {
            EQ_SESSIONS_ENABLED = true;                      // in this page only, never persisted
            persisted.primaryGoal = 'eq'; persisted.schedule = goalSchedule('eq').slice();
            persisted.dayPlans = []; persisted.sessionLog = [];
            persisted.programme = {custom: false, migration: {source: 'preset'}, adoptedAt: '2026-01-01T00:00:00.000Z'};
            const sunday = new Date(2026, 10, 8);
            const key = (d, weeks = 0) => { const dt = new Date(sunday); dt.setDate(sunday.getDate() + d + 7 * weeks); return window.BP.planDateKey(dt); };
            const week = [];
            for (let d = 0; d < 7; d++) {
                const slot = goalSchedule('eq')[d];
                const isSession = eqSatisfiableDays().includes(d);
                week.push({
                    d, slot, fullRest: isFullRestDate(key(d)), isSession,
                    steps: isSession ? buildEqRoutine(key(d)).map(x => ({title: x.title, sets: x.sets, duration: x.duration})) : null,
                    nextWeekSteps: isSession ? buildEqRoutine(key(d, 1)).map(x => ({title: x.title, sets: x.sets, duration: x.duration})) : null,
                    practice: plannedPelvicItems(key(d), slot).length,
                });
            }
            // The member reports pain and has not cleared it.
            persisted.sessionLog = [{date: new Date().toISOString(), routineType: 'recovery', pelvicPractice: {feedback: 'painful'}}];
            try { localStorage.removeItem(pelvicReviewKey()); } catch (e) {}
            const withPain = buildEqRoutine(key(0)).map(x => x.title);
            return {week, withPain, hours: null};
        });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('each session day is breathing, a release exercise and one mobility movement, and the copy names all of them', () => {
        const sessions = facts.week.filter(w => w.isSession);
        expect(sessions.length, 'the copy says three sessions').toBe(3);
        const mobility = new Set();
        for (const s of sessions) {
            expect(s.steps.map(x => x.title).slice(0, 2), 'every session opens with breathing, then release')
                .toEqual(['Diaphragmatic breathing', 'Pelvic Floor Release']);
            expect(s.steps, 'and ends with exactly one mobility movement').toHaveLength(3);
            mobility.add(s.steps[2].title);
            for (const x of s.steps) {
                expect(COPY_PHRASE[x.title], `the programme shows "${x.title}" but the copy does not name it`).toBeDefined();
                expect(LIVE, `the copy no longer names "${x.title}"`).toMatch(COPY_PHRASE[x.title]);
            }
        }
        expect(mobility.size, 'the copy says the movement changes through the week').toBe(3);
    });

    test('the copy says the sessions stay the same from week to week, and they do', () => {
        for (const s of facts.week.filter(w => w.isSession)) expect(s.nextWeekSteps).toEqual(s.steps);
        expect(LIVE).toMatch(/stay the same from week to week/i);
    });

    test('supporting days ask for a practice and full-rest days ask for nothing, as the copy says', () => {
        for (const w of facts.week) {
            if (w.fullRest) expect(w.practice, `day ${w.d} is full rest but asks for something`).toBe(0);
            else if (!w.isSession) expect(w.practice, `day ${w.d} is a supporting day but asks for nothing`).toBeGreaterThan(0);
        }
        expect(facts.week.filter(w => w.fullRest).map(w => w.d)).toEqual([2, 6]);
        expect(LIVE).toMatch(/full rest with nothing asked of you/i);
    });

    test('if the member reports pain, the release is paused and the breathing and movement stay, as the copy says', () => {
        expect(facts.withPain).not.toContain('Pelvic Floor Release');
        expect(facts.withPain).toContain('Diaphragmatic breathing');
        expect(facts.withPain.length).toBe(2);
        expect(LIVE).toMatch(/pauses the pelvic floor release and keeps the breathing and the movement/i);
    });
});
