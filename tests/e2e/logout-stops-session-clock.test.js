import {beforeAll, afterAll, describe, test, expect} from 'vitest';
import {openApp, authSignIn, authSignOut} from './harness.js';

/**
 * A running exercise must not outlive the account it belongs to.
 *
 * handleLogout() releases the wake lock, shows the auth screen, calls
 * _closeMemberOverlays() and hides every .step-content — but it never
 * cancelled session.timer and never stopped the Wet Jelq stroke pacer.
 * goToStep(), which does cancel the timer, is not on the logout path.
 *
 * The leak matters at the NEXT sign-in, not during sign-out. savePersisted()
 * returns early while currentUser is null, so a stale completion cannot write
 * to the account that just left. But the timer is driven by requestAnimationFrame
 * and keeps counting, so if the member signs back in before it elapses,
 * onSetDone() -> advanceEx() -> finishSession() can award XP and log a session
 * against the newly loaded account for work that was never finished.
 */
describe('signing out stops the session clock', () => {
    let app;
    beforeAll(async () => { app = await openApp(); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('a running exercise timer and its stroke pacer do not survive sign-out', async () => {
        await authSignIn(app.page, {id: 'leaver', email: 'leaver@example.com'});

        // Wet Jelq is the one exercise that also arms the 3-second stroke
        // pacer, so it exercises both handles in one pass. startSet() is the
        // production entry point; only the navigation to it is programmatic.
        const running = await app.page.evaluate(() => {
            session.routineType = 'girth';
            session.exerciseIndex = ROUTINES.girth.findIndex(e => e.title === 'Wet Jelq');
            session.setIndex = 1;
            session.directionalIndex = 0;
            session.dailyPelvicPhase = false;
            session.dailyPracticeOnly = false;
            startSet();
            return {
                title: getCurEx().title,
                timerRunning: !!session.timer && session.timer.isRunning(),
                pacerArmed: _jelqStrokeInterval !== null,
            };
        });
        // Guard the setup itself: if either handle were not live, the
        // assertions below would pass for the wrong reason.
        expect(running).toEqual({title: 'Wet Jelq', timerRunning: true, pacerArmed: true});

        await authSignOut(app.page);

        const after = await app.page.evaluate(() => ({
            timer: session.timer,
            pacerArmed: _jelqStrokeInterval !== null,
        }));
        expect(after).toEqual({timer: null, pacerArmed: false});
    }, 60_000);
});
