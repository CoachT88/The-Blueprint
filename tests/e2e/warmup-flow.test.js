import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, visibleStep } from './harness.js';

/**
 * The warmup used to sit at step 2 and mission select at step 3, so the app did
 * not know what a member had picked until after they had warmed up. Everyone sat
 * through it, including people doing recovery work. The flow is now
 * Pre-Flight → Mission Select → Warmup (Length/Girth only) → Engine.
 *
 * The girth-round assertions guard a separate bug found in the same path:
 * resetSession() hardcoded girthTotalRounds to 3 and ran when the engine opened,
 * overwriting the tier's real count. Intermediate members were doing 3 rounds
 * instead of 4, Advanced and Elite 3 instead of 5.
 */
describe('warmup routing', () => {
    let app;
    const noRestDays = ['length', 'length', 'length', 'length', 'length', 'length', 'length'];

    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'flow', persisted: { schedule: noRestDays } });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    const toMissionSelect = async () => {
        await app.page.evaluate(() => { session._aborting = true; goToStep(0); session._aborting = false; });
        await app.page.waitForTimeout(200);
        await app.page.evaluate(() => document.getElementById('launch-btn').click());
        await app.page.waitForTimeout(200);
        await app.page.evaluate(() => document.getElementById('primed-btn').click());
        await app.page.waitForTimeout(300);
    };

    test('pre-flight now leads to mission select, not the warmup', async () => {
        await app.page.evaluate(() => goToStep(0));
        await app.page.waitForTimeout(250);
        await app.page.evaluate(() => document.getElementById('launch-btn').click());
        await app.page.waitForTimeout(250);
        expect(await visibleStep(app.page)).toBe('step-1');
        await app.page.evaluate(() => document.getElementById('primed-btn').click());
        await app.page.waitForTimeout(300);
        expect(await visibleStep(app.page)).toBe('step-3');
    }, 30_000);

    test('Length warms up, then skipping lands in the engine', async () => {
        await app.page.evaluate(() => document.getElementById('mission-length-btn').click());
        await app.page.waitForTimeout(300);
        expect(await visibleStep(app.page)).toBe('step-2');
        expect(await app.page.evaluate(() => session.routineType)).toBe('length');

        await app.page.evaluate(() => document.getElementById('warmup-skip-btn').click());
        await app.page.waitForTimeout(400);
        expect(await visibleStep(app.page)).toBe('step-4');
    }, 30_000);

    test('back from the engine returns to mission select', async () => {
        await app.page.evaluate(() => document.getElementById('ex-back-btn').click());
        await app.page.waitForTimeout(300);
        expect(await visibleStep(app.page)).toBe('step-3');
    }, 30_000);

    test.each([
        ['beginner', 3], ['intermediate', 4], ['advanced', 5], ['elite', 5],
    ])('Girth on %s warms up and carries %i rounds into the engine', async (tier, expected) => {
        await app.page.evaluate(t => { persisted.difficulty = t; goToStep(3); }, tier);
        await app.page.waitForTimeout(250);
        await app.page.evaluate(() => document.getElementById('mission-girth-btn').click());
        await app.page.waitForTimeout(300);
        expect(await visibleStep(app.page)).toBe('step-2');

        await app.page.evaluate(() => document.getElementById('warmup-skip-btn').click());
        await app.page.waitForTimeout(400);
        expect(await visibleStep(app.page)).toBe('step-4');
        expect(await app.page.evaluate(() => session.girthTotalRounds)).toBe(expected);

        await app.page.evaluate(() => { session._aborting = true; goToStep(3); session._aborting = false; });
        await app.page.waitForTimeout(150);
    }, 40_000);

    test('Stamina goes straight to the engine, no warmup', async () => {
        await app.page.evaluate(() => goToStep(3));
        await app.page.waitForTimeout(200);
        await app.page.evaluate(() => document.getElementById('mission-stamina-btn').click());
        await app.page.waitForTimeout(400);
        expect(await visibleStep(app.page)).toBe('step-4');
    }, 30_000);

    test('Recovery goes to its picker, no warmup', async () => {
        await app.page.evaluate(() => { session._aborting = true; goToStep(3); session._aborting = false; });
        await app.page.waitForTimeout(200);
        await app.page.evaluate(() => document.getElementById('mission-recovery-btn').click());
        await app.page.waitForTimeout(400);
        expect(await visibleStep(app.page)).toBe('step-3b');
    }, 30_000);

    test('the warmup can go back to mission select', async () => {
        await app.page.evaluate(() => goToStep(3));
        await app.page.waitForTimeout(200);
        await app.page.evaluate(() => document.getElementById('mission-length-btn').click());
        await app.page.waitForTimeout(250);
        await app.page.evaluate(() => document.getElementById('warmup-back-btn').click());
        await app.page.waitForTimeout(250);
        expect(await visibleStep(app.page)).toBe('step-3');
    }, 30_000);

    test('a completed warmup timer advances to the engine, not back to mission select', async () => {
        await app.page.evaluate(() => document.getElementById('mission-length-btn').click());
        await app.page.waitForTimeout(250);
        await app.page.evaluate(() => { session.step = 2; nextStep(); });
        await app.page.waitForTimeout(350);
        expect(await visibleStep(app.page)).toBe('step-4');
    }, 30_000);

    test('a rest day is blocked at mission select, before any warmup', async () => {
        await app.page.evaluate(() => {
            const d = new Date().getDay();
            persisted.schedule = persisted.schedule.slice();
            persisted.schedule[d] = 'rest';
        });
        await toMissionSelect();
        const r = await app.page.evaluate(() => ({
            lengthDisabled: document.getElementById('mission-length-btn').disabled,
            bannerShown: !document.getElementById('blackout-banner').classList.contains('hidden'),
        }));
        expect(await visibleStep(app.page)).toBe('step-3');
        expect(r.lengthDisabled).toBe(true);
        expect(r.bannerShown).toBe(true);
    }, 40_000);

    test('resume still jumps straight to the engine', async () => {
        await app.page.evaluate(() => {
            session._aborting = true; goToStep(0); session._aborting = false;
            localStorage.setItem('bp_session_draft_flow', JSON.stringify({
                exerciseIndex: 0, setIndex: 1, routineType: 'length',
                directionalIndex: 0, xp: 0, sessionStartTime: Date.now(), savedAt: Date.now(),
            }));
        });
        await app.page.waitForTimeout(200);
        await app.page.evaluate(() => resumeSession());
        await app.page.waitForTimeout(400);
        expect(await visibleStep(app.page)).toBe('step-4');
        expect(app.errors).toEqual([]);
    }, 30_000);
});
