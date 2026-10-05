import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, visibleStep } from './harness.js';

/**
 * PI1. MODIFIED promised a reduction it never delivered.
 *
 * The resolver had set modifiers.moderateSoreness since Phase 2A.1. The
 * Today card said "One set fewer and shorter holds than a normal session".
 * Ready said "You reported moderate muscle soreness, so today's volume is
 * reduced", and tests/e2e/ready.test.js asserted that sentence.
 * estimateSessionSeconds() applied MODERATE_SORENESS_SHAPE, so the minutes
 * on screen really did drop.
 *
 * And getCurEx() applied difficulty and deload and nothing else. The member
 * reported a symptom, was told the app had responded, and then got the full
 * prescribed volume. The copy, the estimate and the engine disagreed, and
 * nothing in the suite looked at the engine, so nothing caught it.
 *
 * These tests read the REAL engine through the REAL funnel: the soreness
 * button is clicked, the Ready CTA is clicked, and getCurEx() is called in
 * the page. Nothing here recomputes a shape. The last block is the part
 * that matters most: it asserts the engine and the estimator arrive at the
 * same number of seconds, which is the thing that was untrue before.
 */

const UID = 'sore';
const ALL = type => [type, type, type, type, type, type, type];

describe('moderate soreness reduces the session the member is actually given', () => {
    let app;
    const page = () => app.page;

    beforeAll(async () => {
        app = await openApp();
        await signIn(page(), {
            id: UID,
            persisted: {
                primaryGoal: 'all',
                difficulty: 'intermediate',
                schedule: ALL('length'),
                completedDays: [false, false, false, false, false, false, false],
            },
        });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    /** Back to the HQ with no draft left behind and no answer remembered. */
    const reset = async (mission, { soreness = null, difficulty = 'intermediate' } = {}) => {
        await page().evaluate(([m, d]) => {
            session._aborting = true; goToStep(0); session._aborting = false;
            localStorage.removeItem('bp_session_draft_' + currentUser.id);
            localStorage.removeItem(getTodaySorenessKey());
            persisted.difficulty = d;
            persisted.schedule[new Date().getDay()] = m;
            renderDashboard();
        }, [mission, difficulty]);
        await page().waitForTimeout(200);
        if (soreness) {
            // Through the real control, so setSoreness -> renderReady -> _today
            // all run. Writing the key directly would skip the resolver.
            await page().evaluate(() => document.getElementById('launch-btn').click());
            await page().waitForTimeout(200);
            await page().evaluate(s => {
                document.querySelector(`[data-soreness="${s}"]`).click();
                document.getElementById('ready-cta').click();
            }, soreness);
            await page().waitForTimeout(350);
            // Length and Girth warm up first; Stamina goes straight in.
            if (await visibleStep(page()) === 'step-2') {
                await page().evaluate(() => document.getElementById('warmup-skip-btn').click());
                await page().waitForTimeout(400);
            }
        }
    };

    /**
     * Every exercise in the current session, as the engine will actually
     * serve it. Calls the production getCurEx(); the test does no shaping
     * of its own.
     */
    const prescription = () => page().evaluate(() => {
        const list = ROUTINES[session.routineType] || [];
        const saved = session.exerciseIndex;
        const out = list.map((_, i) => {
            session.exerciseIndex = i;
            const e = getCurEx();
            return { title: e.title, sets: e.sets, duration: e.duration };
        });
        session.exerciseIndex = saved;
        return out;
    });

    const run = async (mission, soreness, opts) => {
        await reset(mission, { soreness, ...opts });
        expect(await visibleStep(page())).toBe('step-4');
        return prescription();
    };

    // ── The defect itself ──────────────────────────────────────────────

    test('moderate soreness reduces the live prescription', async () => {
        const normal = await run('length', 'none');
        const reduced = await run('length', 'moderate');

        expect(reduced).toHaveLength(normal.length);
        for (let i = 0; i < normal.length; i++) {
            expect(reduced[i].title).toBe(normal[i].title);
            expect(reduced[i].sets).toBeLessThan(normal[i].sets);
            expect(reduced[i].duration).toBeLessThan(normal[i].duration);
        }
        // Intermediate Length is 3 sets x 30s. One set fewer, holds at 0.6,
        // which is exactly what the Today card has been promising.
        expect(normal[0]).toMatchObject({ sets: 3, duration: 30 });
        expect(reduced[0]).toMatchObject({ sets: 2, duration: 18 });
    }, 60_000);

    test('the reduction reaches the screen, not just the object', async () => {
        const face = () => page().evaluate(() => ({
            timer: document.getElementById('ex-timer').innerText,
            pips: document.getElementById('pip-container').children.length,
        }));

        // The timer, on Length. 30s per hold at intermediate, 18s reduced.
        await reset('length', { soreness: 'none' });
        expect((await face()).timer).toBe('30');
        await reset('length', { soreness: 'moderate' });
        expect((await face()).timer).toBe('18');

        // The set pips, on Stamina. Length cannot show them: Directional
        // Pulls is isDirectional, so its pip row is the five directions and
        // has nothing to do with the set count. Stamina is 3 sets x 120s at
        // intermediate, 2 x 72s reduced.
        await reset('stamina', { soreness: 'none' });
        expect(await face()).toEqual({ timer: '2:00', pips: 3 });
        await reset('stamina', { soreness: 'moderate' });
        expect(await face()).toEqual({ timer: '1:12', pips: 2 });
    }, 90_000);

    test('the same reduction reaches stamina', async () => {
        const normal = await run('stamina', 'none');
        const reduced = await run('stamina', 'moderate');
        for (let i = 0; i < normal.length; i++) {
            expect(reduced[i].sets).toBeLessThan(normal[i].sets);
            expect(reduced[i].duration).toBeLessThan(normal[i].duration);
        }
    }, 60_000);

    test('girth work intervals shorten but the rounds do not', async () => {
        await reset('girth', { soreness: 'none' });
        const normal = await prescription();
        const normalRounds = await page().evaluate(() => session.girthTotalRounds);

        await reset('girth', { soreness: 'moderate' });
        const reduced = await prescription();
        const reducedRounds = await page().evaluate(() => session.girthTotalRounds);

        for (let i = 0; i < normal.length; i++) {
            expect(reduced[i].duration).toBeLessThan(normal[i].duration);
        }
        // A reduced girth session is the same circuit with shorter work, not
        // a shorter circuit. girthCircuitSeconds() does not shape rounds
        // either, so shaping them here would break the estimate.
        expect(reducedRounds).toBe(normalRounds);
        expect(reducedRounds).toBe(4);
    }, 60_000);

    // ── What must NOT change ───────────────────────────────────────────

    /**
     * A Recovery session started on a day the resolver has actually put in
     * MODIFIED.
     *
     * The scheduled day has to be mechanical, because on a rest day the
     * ladder returns REST and clears the soreness modifier, so a Recovery
     * session there would be unshaped for the wrong reason and the test
     * would pass even if recovery were being shaped. Here the modifier is
     * genuinely true and recovery must still come back untouched.
     */
    const recoveryUnderModified = async soreness => {
        await reset('length');
        await page().evaluate(s => {
            persisted.pelvicProfile = 'standard';   // nothing withheld, all 8 selectable
            localStorage.setItem(getTodaySorenessKey(), s);
            renderDashboard();
            goToRecoveryPicker();
            startRecoverySession();
        }, soreness);
        await page().waitForTimeout(350);
        return page().evaluate(() => ({
            state: currentPrescription().state,
            sore: sorenessReduced(),
            shapes: currentShapes().filter(Boolean).length,
        }));
    };

    test('recovery is unshaped under moderate soreness', async () => {
        await recoveryUnderModified('none');
        const normal = await prescription();

        const ctx = await recoveryUnderModified('moderate');
        const sore = await prescription();

        // The modifier really is live, so this is not passing by accident.
        expect(ctx).toEqual({ state: 'MODIFIED', sore: true, shapes: 1 });
        expect(sore).toEqual(normal);
        // Recovery is served exactly as written in ROUTINES, by both the
        // engine and estimateSessionSeconds(). Scaling an already low
        // prescription would mostly mean scaling it away.
        expect(normal[0]).toMatchObject({ title: 'Kegel Contractions', sets: 3, duration: 60 });
    }, 90_000);

    test('a resumed session is not reduced', async () => {
        // RESUME outranks soreness in the resolver ladder, so the modifier
        // is false there and a draft finishes at the volume it started at.
        // This is the test that fails if the engine ever reads raw
        // localStorage soreness instead of the resolver's answer.
        await reset('length');
        await page().evaluate(() => {
            localStorage.setItem(getTodaySorenessKey(), 'moderate');
            localStorage.setItem('bp_session_draft_' + currentUser.id, JSON.stringify({
                exerciseIndex: 0, setIndex: 1, routineType: 'length',
                directionalIndex: 0, xp: 0, sessionStartTime: Date.now(), savedAt: Date.now(),
            }));
            renderDashboard();
        });
        await page().waitForTimeout(250);

        const state = await page().evaluate(() => currentPrescription().state);
        expect(state).toBe('RESUME');

        const shaped = await page().evaluate(() => {
            session.routineType = 'length'; session.exerciseIndex = 0;
            const e = getCurEx();
            return { sets: e.sets, duration: e.duration, shapes: currentShapes().filter(Boolean).length };
        });
        expect(shaped).toEqual({ sets: 3, duration: 30, shapes: 0 });

        await page().evaluate(() => localStorage.removeItem('bp_session_draft_' + currentUser.id));
    }, 60_000);

    /**
     * A real deload week, built the way progression-wiring.test.js builds
     * one: four qualifying weeks of logged mechanical work finishing last
     * week, which is deloadEveryQualifyingWeeks - 1, so this calendar week
     * is the deload. Seeded as state and then read back through the real
     * isDeloadWeek(), never stubbed.
     */
    const seedDeloadWeek = () => page().evaluate(() => {
        persisted.sessionLog = [];
        persisted.progressionLedger = [];
        /* The weeks are recorded against a four-session week, not against
           this suite's all-mission schedule. A seven-session week with
           three logged misses four, which is not a qualifying week, so the
           count would never reach the deload trigger. The ledger stores the
           target that was true at the time, which is exactly what lets a
           past week be recorded against a different shape from today's. */
        const PAST = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
        const mondayOf = d => { const x = new Date(d); x.setHours(12, 0, 0, 0);
            x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
        for (let w = 4; w >= 1; w--) {
            const monday = mondayOf(new Date(Date.now() - w * 7 * 86400000));
            for (let i = 0; i < 3; i++) {
                const d = new Date(monday); d.setDate(d.getDate() + i);
                persisted.sessionLog.push({ date: d.toISOString(), routineType: 'length' });
            }
            persisted.progressionLedger = window.BP.reconcileLedger(persisted.progressionLedger, {
                weekKey: window.BP.weekKey(monday), schedule: PAST,
                sessionLog: persisted.sessionLog, now: monday,
            });
        }
        renderDashboard();
        return isDeloadWeek();
    });

    const clearLedger = () => page().evaluate(() => {
        persisted.sessionLog = []; persisted.progressionLedger = []; renderDashboard();
    });

    test('sets never fall below one', async () => {
        // Three shapes stack here and only here: beginner is -1, the deload
        // week is -1 and moderate soreness is -1, against exercises of 3
        // sets. Without the floor in applyShape() that is zero sets, which
        // is an exercise the member is shown and can never finish.
        expect(await seedDeloadWeek()).toBe(true);
        const reduced = await run('stamina', 'moderate', { difficulty: 'beginner' });
        const ctx = await page().evaluate(() => currentShapes().filter(Boolean).length);
        expect(ctx).toBe(2);                                  // deload + soreness, plus difficulty
        for (const ex of reduced) expect(ex.sets).toBe(1);
        await clearLedger();
    }, 90_000);

    test('a deload week and moderate soreness stack, and both are named', async () => {
        expect(await seedDeloadWeek()).toBe(true);

        const deloadOnly = await run('length', 'none');
        const both = await run('length', 'moderate');
        for (let i = 0; i < both.length; i++) {
            expect(both[i].duration).toBeLessThan(deloadOnly[i].duration);
        }
        // Intermediate Length: 3x30 normally, 2x18 on deload, 1x11 with
        // soreness on top. Rounding happens after each shape, which is why
        // it is 11 and not 10.8 or 10.
        expect(deloadOnly[0]).toMatchObject({ sets: 2, duration: 18 });
        expect(both[0]).toMatchObject({ sets: 1, duration: 11 });

        const badges = await page().evaluate(() => ({
            soreness: !document.getElementById('soreness-ex-badge').classList.contains('hidden'),
            deload: !document.getElementById('deload-ex-badge').classList.contains('hidden'),
        }));
        expect(badges).toEqual({ soreness: true, deload: true });
        await clearLedger();
    }, 90_000);

    // ── The member can see it ──────────────────────────────────────────

    test('the reduced-volume badge appears only when the reduction applies', async () => {
        const badge = () => page().evaluate(() => ({
            soreness: !document.getElementById('soreness-ex-badge').classList.contains('hidden'),
            deload: !document.getElementById('deload-ex-badge').classList.contains('hidden'),
        }));

        await reset('length', { soreness: 'none' });
        expect(await badge()).toEqual({ soreness: false, deload: false });

        await reset('length', { soreness: 'moderate' });
        expect(await badge()).toEqual({ soreness: true, deload: false });

        // Never on a Recovery session, even on a day the resolver has put
        // in MODIFIED. Recovery takes no shape at all, so a badge there
        // would claim a reduction that did not happen.
        const ctx = await recoveryUnderModified('moderate');
        expect(ctx.sore).toBe(true);
        expect(await badge()).toEqual({ soreness: false, deload: false });
    }, 90_000);

    // ── The two screens that preview the prescription ──────────────────

    /**
     * Mission Select and the girth circuit card both print volume before
     * the session starts, and both used to print the tier's raw numbers.
     * On a reduced day they told the member one thing and the engine then
     * did another, which is the same defect as PI1 one screen earlier.
     * It was equally true of a deload week before this.
     */
    test('the Mission Select subtext previews what the engine will give', async () => {
        const subtext = async soreness => {
            await reset('length');
            await page().evaluate(s => {
                localStorage.setItem(getTodaySorenessKey(), s);
                renderDashboard();
                session.routineType = 'length';
                goToStep(3);
            }, soreness);
            await page().waitForTimeout(250);
            return page().evaluate(() => document.getElementById('diff-detail').innerHTML);
        };
        // Intermediate Length is 3 x 30s normally, 2 x 18s reduced, and
        // those are exactly the numbers getCurEx() returns above.
        expect(await subtext('none')).toContain('30s per set · 3 sets');
        expect(await subtext('moderate')).toContain('18s per set · 2 sets');
    }, 90_000);

    test('the girth circuit card previews the shaped work intervals', async () => {
        const card = async soreness => {
            await reset('girth', { soreness });
            return page().evaluate(() => document.getElementById('circuit-overview-steps').innerText);
        };
        const normal = await card('none');
        const reduced = await card('moderate');
        // Intermediate: 120s jelq / 45s uli, reduced to 72s / 27s. The round
        // count is in the label and is not shaped on either side.
        expect(normal).toContain('2m');
        expect(normal).toContain('45s');
        expect(reduced).toContain('72s');
        expect(reduced).toContain('27s');
    }, 90_000);

    // ── The guard: the estimate and the engine may not drift apart ─────

    /**
     * This is the mechanism that stops PI1 happening again.
     *
     * Both sides are production functions from src/sessionDuration.js,
     * reached over window.BP. exerciseSeconds() is the same one
     * estimateSessionSeconds() uses internally, so the test is comparing
     * two real paths rather than checking either against arithmetic of its
     * own. It would have failed on the day the soreness shape was added to
     * the estimator and not to the engine.
     */
    const agrees = async (mission, soreness, difficulty) => {
        await reset(mission, { soreness, difficulty });
        expect(await visibleStep(page())).toBe('step-4');
        return page().evaluate(m => {
            const list = ROUTINES[session.routineType] || [];
            const saved = session.exerciseIndex;
            const shaped = list.map((_, i) => { session.exerciseIndex = i; return getCurEx(); });
            session.exerciseIndex = saved;

            const engineWork = shaped.reduce((s, e) => s + window.BP.exerciseSeconds(e), 0);
            const warmup = (m === 'length' || m === 'girth') ? 600 : 0;
            const cfg = GIRTH_CIRCUIT[getDiff().id];
            // Girth is a circuit: the engine serves one round's worth, and
            // the circuit repeats. Rounds and the inter-round rest are not
            // shaped by either side, which is what makes this expansion
            // structural rather than a second copy of the volume rule.
            const engine = m === 'girth'
                ? warmup + session.girthTotalRounds * engineWork
                        + (session.girthTotalRounds - 1) * cfg.restDur
                : warmup + engineWork;

            const estimate = window.BP.estimateSessionSeconds(m, {
                routines: ROUTINES, difficulties: DIFFICULTIES, girthCircuit: GIRTH_CIRCUIT,
                difficulty: getDiff().id,
                deload: isDeloadWeek(),
                moderateSoreness: sorenessReduced(),
            });
            return { engine, estimate };
        }, mission);
    };

    for (const mission of ['length', 'stamina', 'girth']) {
        for (const difficulty of ['beginner', 'intermediate', 'advanced', 'elite']) {
            for (const soreness of ['none', 'moderate']) {
                test(`${mission} / ${difficulty} / soreness ${soreness}: the engine and the estimate agree`,
                    async () => {
                        const { engine, estimate } = await agrees(mission, soreness, difficulty);
                        expect(estimate).toBeGreaterThan(0);
                        expect(engine).toBe(estimate);
                    }, 60_000);
            }
        }
    }

    /**
     * The same guard with a deload week underneath, which is the only
     * place the ORDER of the shapes is observable.
     *
     * Difficulty, deload and soreness all round after themselves, so
     * composing them in a different order changes the answer wherever the
     * rounding falls differently. Applying difficulty last instead of
     * first moves five of the sixty-four tier-by-shape combinations by a
     * second: Directional Pulls and V-Stretch at beginner and advanced,
     * and Lateral Compression at elite. Every one of them needs deload AND
     * soreness together, which is why the matrix above could not see it.
     *
     * One second is nothing to a member. It is not nothing to the claim
     * that these two paths cannot drift, so it is pinned.
     */
    test('with a deload week underneath, the engine and the estimate still agree', async () => {
        expect(await seedDeloadWeek()).toBe(true);
        for (const mission of ['length', 'stamina', 'girth']) {
            for (const difficulty of ['beginner', 'intermediate', 'advanced', 'elite']) {
                const { engine, estimate } = await agrees(mission, 'moderate', difficulty);
                expect(await page().evaluate(() => isDeloadWeek())).toBe(true);
                expect(estimate, `${mission}/${difficulty}`).toBeGreaterThan(0);
                expect(engine, `${mission}/${difficulty}`).toBe(estimate);
            }
        }
        await clearLedger();
    }, 180_000);
});
