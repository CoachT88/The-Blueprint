import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * A hypertonic (chronically tight) pelvic floor is made worse by kegels. The
 * difficulty is that almost nobody knows they have one — it is not something you
 * can feel — and the men most likely to have one are exactly the men this app
 * attracts. So the app screens on symptoms rather than asking a question nobody
 * can answer, then removes contraction work rather than warning about it.
 *
 * Two exercises are contraction work: index 0 (Kegel Contractions) and index 3
 * (Pelvic Floor Endurance Hold). The second is easy to overlook because the
 * title says "Endurance", and for a tight floor a sustained tonic hold is
 * arguably the worse of the two.
 */
describe('screening logic', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'pf1' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('three or more symptoms reads as tight', async () => {
        const r = await app.page.evaluate(() => scorePelvicScreen({
            urgency: true, ache: true, tension: true, postejac: false, kegeling: false, relax: false,
        }));
        expect(r.yes).toBe(3);
        expect(r.profile).toBe('tight');
    });

    test('two or fewer does not', async () => {
        const r = await app.page.evaluate(() => scorePelvicScreen({
            urgency: true, ache: false, tension: true, postejac: false, kegeling: false, relax: false,
        }));
        expect(r.profile).toBe('standard');
    });

    test('all six is still tight', async () => {
        const r = await app.page.evaluate(() => scorePelvicScreen(
            Object.fromEntries(PELVIC_SCREEN_QUESTIONS.map(q => [q.id, true]))));
        expect(r.yes).toBe(6);
        expect(r.profile).toBe('tight');
    });

    test('both contraction exercises are classified, releases are not', async () => {
        const r = await app.page.evaluate(() => ({
            contraction: CONTRACTION_RECOVERY_IDX,
            titles: CONTRACTION_RECOVERY_IDX.map(i => ROUTINES.recovery[i].title),
            releaseTitles: [1, 2].map(i => ROUTINES.recovery[i].title),
        }));
        expect(r.contraction).toEqual([0, 3]);
        expect(r.titles[0]).toMatch(/Kegel/i);
        expect(r.titles[1]).toMatch(/Endurance Hold/i);   // the easy one to miss
        expect(r.releaseTitles.join(' ')).toMatch(/Reverse Kegel/i);
    });
});

describe('a tight result actually changes the protocol', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'pf2' });
        await app.page.evaluate(() => { persisted.pelvicProfile = 'tight'; });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the daily recommendation never includes contraction work', async () => {
        const r = await app.page.evaluate(() => getDailyRecommended());
        expect(r).not.toContain(0);
        expect(r).not.toContain(3);
    });

    test('Select All cannot hand back the blocked exercises', async () => {
        const r = await app.page.evaluate(() => { selectAllRecovery(); return selectedRecoveryIndices; });
        expect(r).not.toContain(0);
        expect(r).not.toContain(3);
        expect(r.length).toBe(6);
    });

    test("Today's Pick cannot either, including via its fallback", async () => {
        const r = await app.page.evaluate(() => { selectDailyRecommended(); return selectedRecoveryIndices; });
        expect(r).not.toContain(0);
        expect(r).not.toContain(3);
    });

    test('tapping a locked card does nothing', async () => {
        const r = await app.page.evaluate(() => {
            selectedRecoveryIndices = [1, 2];
            toggleRecoveryEx(0);
            toggleRecoveryEx(3);
            return selectedRecoveryIndices;
        });
        expect(r).toEqual([1, 2]);
    });

    test('the engine is gated even if a selection is forced through', async () => {
        const r = await app.page.evaluate(() => {
            selectedRecoveryIndices = [0, 1, 3];   // bypass the UI entirely
            startRecoverySession();
            return { queue: session.recoveryQueue, selected: selectedRecoveryIndices };
        });
        expect(r.queue).not.toContain(0);
        expect(r.queue).not.toContain(3);
        expect(r.queue).toEqual([1]);
    }, 30_000);

    test('the picker renders them locked, with a reason', async () => {
        const r = await app.page.evaluate(() => {
            buildRecoveryPicker();
            const cards = [...document.querySelectorAll('.ex-pick-card')];
            const kegel = cards.find(c => c.dataset.idx === '0');
            const endurance = cards.find(c => c.dataset.idx === '3');
            const release = cards.find(c => c.dataset.idx === '1');
            return {
                kegelLocked: kegel.className.includes('pick-locked'),
                enduranceLocked: endurance.className.includes('pick-locked'),
                releaseLocked: release.className.includes('pick-locked'),
                reason: kegel.querySelector('.ex-pick-benefit').textContent,
            };
        });
        expect(r.kegelLocked).toBe(true);
        expect(r.enduranceLocked).toBe(true);
        expect(r.releaseLocked).toBe(false);
        expect(r.reason).toMatch(/already tight/i);
    });

    test('Coach Tee is told not to recommend contraction work', async () => {
        const ctx = await app.page.evaluate(() => {
            persisted.sessionLog = [{ date: new Date().toISOString(), routineType: 'recovery', eq: 6, rpe: 4, xpEarned: 5 }];
            return _coachContext();
        });
        expect(ctx).toMatch(/HYPERTONIC/);
        expect(ctx).toMatch(/Do NOT recommend kegels/i);
    });

    test('and a brand-new member gets the same instruction', async () => {
        const ctx = await app.page.evaluate(() => { persisted.sessionLog = []; return _coachContext(); });
        expect(ctx).toMatch(/brand new/i);
        expect(ctx).toMatch(/HYPERTONIC/);
    });
});

describe('a standard result leaves the protocol intact', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'pf3' });
        await app.page.evaluate(() => { persisted.pelvicProfile = 'standard'; });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('all eight remain available', async () => {
        const r = await app.page.evaluate(() => { selectAllRecovery(); return selectedRecoveryIndices; });
        expect(r.length).toBe(8);
        expect(r).toContain(0);
        expect(r).toContain(3);
    });

    test('nothing is locked', async () => {
        const locked = await app.page.evaluate(() => {
            buildRecoveryPicker();
            return [...document.querySelectorAll('.ex-pick-card')].filter(c => c.className.includes('pick-locked')).length;
        });
        expect(locked).toBe(0);
    });

    test('Coach Tee is told to watch for it turning tight', async () => {
        const ctx = await app.page.evaluate(() => _coachContext());
        expect(ctx).toMatch(/no signs of a tight floor/i);
    });
});

describe('the answer buttons actually look selected', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'pfv' });
        await app.page.evaluate(() => { persisted.pelvicProfile = ''; openPelvicScreen(); });
        await app.page.waitForTimeout(300);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    // The original bug: the screener toggled `.selected`, but .quick-tap only
    // styles `.active`. The answer was stored and the submit button enabled
    // while nothing changed on screen, so the check looked broken. Asserting
    // the class name would NOT have caught it — assert the computed style.
    //
    // .quick-tap carries `transition: all .2s`, so the computed value has to be
    // read after the transition settles, not on the same tick as the click.
    const bgOf = (sel) => app.page.evaluate(
        s => getComputedStyle(document.querySelector(s)).backgroundColor, sel);

    test('tapping Yes visibly changes the button', async () => {
        const sel = '#pelvic-screen-questions [data-screen-q] [data-screen-a="yes"]';
        const before = await bgOf(sel);
        await app.page.evaluate(s => document.querySelector(s).click(), sel);
        await app.page.waitForTimeout(400);          // let the .2s transition finish
        const after = await bgOf(sel);
        expect(after).not.toBe(before);
    }, 30_000);

    test('choosing the other option moves the highlight rather than lighting both', async () => {
        const row = '#pelvic-screen-questions [data-screen-q]';
        await app.page.evaluate(r => document.querySelector(`${r} [data-screen-a="no"]`).click(), row);
        await app.page.waitForTimeout(400);
        const r = await app.page.evaluate(rw => {
            const el = document.querySelector(rw);
            return {
                yesBg: getComputedStyle(el.querySelector('[data-screen-a="yes"]')).backgroundColor,
                noBg: getComputedStyle(el.querySelector('[data-screen-a="no"]')).backgroundColor,
                stored: _pelvicAnswers[el.dataset.screenQ],
            };
        }, row);
        expect(r.noBg).not.toBe(r.yesBg);
        expect(r.stored).toBe(false);   // the later tap wins
    }, 30_000);

    test('the goal picker has real styling behind its selected state too', async () => {
        // Same class of bug, other tappable surface.
        const sel = '.goal-opt[data-goal="size"]';
        await app.page.evaluate(() => {
            closePelvicScreen();
            persisted.primaryGoal = '';
            showOnboarding(); goToObSlide(3);
        });
        await app.page.waitForTimeout(400);
        const before = await bgOf(sel);
        await app.page.evaluate(s => document.querySelector(s).click(), sel);
        await app.page.waitForTimeout(400);
        const after = await bgOf(sel);
        expect(after).not.toBe(before);
        await app.page.evaluate(() => hideOnboarding());
    }, 30_000);
});

describe('the check is offered on the HQ, not only in the Manual', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'pfh' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('an unscreened member sees the prompt, above the calendar', async () => {
        const r = await app.page.evaluate(() => {
            persisted.pelvicProfile = '';
            goToStep(0);
            const prompt = document.getElementById('hq-pelvic-prompt');
            const cal = document.getElementById('hq-calendar-card');
            return {
                shown: !prompt.classList.contains('hidden'),
                // compareDocumentPosition: 4 means prompt precedes calendar
                aboveCalendar: !!(prompt.compareDocumentPosition(cal) & Node.DOCUMENT_POSITION_FOLLOWING),
            };
        });
        expect(r.shown).toBe(true);
        expect(r.aboveCalendar).toBe(true);
    }, 30_000);

    test('it opens the check', async () => {
        const shown = await app.page.evaluate(() => {
            document.getElementById('hq-pelvic-start').click();
            return !document.getElementById('pelvic-screen-modal').classList.contains('hidden');
        });
        expect(shown).toBe(true);
    }, 30_000);

    test.each([['tight'], ['standard']])('it disappears once screened (%s)', async (profile) => {
        const hidden = await app.page.evaluate(p => {
            closePelvicScreen();
            persisted.pelvicProfile = p;
            goToStep(0);
            return document.getElementById('hq-pelvic-prompt').classList.contains('hidden');
        }, profile);
        expect(hidden).toBe(true);
    }, 30_000);

    test('the Why link opens the Manual at the recovery chapter, expanded', async () => {
        const r = await app.page.evaluate(async () => {
            persisted.pelvicProfile = '';
            goToStep(0);
            document.getElementById('hq-pelvic-learn').click();
            await new Promise(res => setTimeout(res, 500));
            return {
                manualOpen: document.getElementById('manual-modal').classList.contains('show'),
                sectionOpen: document.getElementById('m-recovery').classList.contains('open'),
            };
        });
        expect(r.manualOpen).toBe(true);
        expect(r.sectionOpen).toBe(true);
        expect(app.errors).toEqual([]);
    }, 30_000);
});

describe('unscreened members', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'pf4' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the picker still opens, so release work is never blocked behind a quiz', async () => {
        // Someone who only wants hip openers should not be made to answer six
        // questions first. Only the contraction work is held back.
        const r = await app.page.evaluate(() => {
            persisted.pelvicProfile = '';
            goToRecoveryPicker();
            const cards = [...document.querySelectorAll('.ex-pick-card')];
            return {
                pickerShown: !document.getElementById('step-3b').classList.contains('hidden-step'),
                screenShown: !document.getElementById('pelvic-screen-modal').classList.contains('hidden'),
                lockedIdx: cards.filter(c => c.className.includes('pick-locked')).map(c => c.dataset.idx),
                reason: cards.find(c => c.dataset.idx === '0').querySelector('.ex-pick-benefit').textContent,
            };
        });
        expect(r.pickerShown).toBe(true);
        expect(r.screenShown).toBe(false);
        expect(r.lockedIdx).toEqual(['0', '3']);
        expect(r.reason).toMatch(/30-second/i);
    }, 30_000);

    test('unscreened contraction work never reaches the engine', async () => {
        const queue = await app.page.evaluate(() => {
            selectedRecoveryIndices = [0, 1, 3];
            startRecoverySession();
            return session.recoveryQueue;
        });
        expect(queue).toEqual([1]);
    }, 30_000);

    test('tapping a locked card opens the check that unlocks it', async () => {
        const r = await app.page.evaluate(() => {
            goToRecoveryPicker();
            toggleRecoveryEx(0);
            return {
                screenShown: !document.getElementById('pelvic-screen-modal').classList.contains('hidden'),
                questions: document.querySelectorAll('#pelvic-screen-questions [data-screen-q]').length,
                stillUnselected: !selectedRecoveryIndices.includes(0),
            };
        });
        expect(r.screenShown).toBe(true);
        expect(r.questions).toBe(6);
        expect(r.stillUnselected).toBe(true);
    }, 30_000);

    test('the submit button stays disabled until every question is answered', async () => {
        const r = await app.page.evaluate(() => {
            const rows = [...document.querySelectorAll('#pelvic-screen-questions [data-screen-q]')];
            rows.slice(0, 5).forEach(row => row.querySelector('[data-screen-a="no"]').click());
            const partway = document.getElementById('pelvic-screen-submit').disabled;
            rows[5].querySelector('[data-screen-a="no"]').click();
            return { partway, complete: document.getElementById('pelvic-screen-submit').disabled };
        });
        expect(r.partway).toBe(true);
        expect(r.complete).toBe(false);
    }, 30_000);

    test('submitting stores the result and shows an explanation', async () => {
        const r = await app.page.evaluate(() => {
            const rows = [...document.querySelectorAll('#pelvic-screen-questions [data-screen-q]')];
            rows.forEach((row, i) => row.querySelector(`[data-screen-a="${i < 4 ? 'yes' : 'no'}"]`).click());
            submitPelvicScreen();
            return {
                profile: persisted.pelvicProfile,
                dated: !!persisted.pelvicScreenDate,
                screenClosed: document.getElementById('pelvic-screen-modal').classList.contains('hidden'),
                resultShown: !document.getElementById('pelvic-result-modal').classList.contains('hidden'),
                title: document.getElementById('pelvic-result-title').textContent,
                msg: document.getElementById('pelvic-result-msg').textContent,
            };
        });
        expect(r.profile).toBe('tight');
        expect(r.dated).toBe(true);
        expect(r.screenClosed).toBe(true);
        expect(r.resultShown).toBe(true);
        expect(r.title).toMatch(/Skip The Squeezing/i);
        expect(r.msg).toMatch(/would make that worse/i);
    }, 30_000);

    test('the result is persisted like every other synced field', async () => {
        const p = await app.page.evaluate(() => ({
            payload: _buildSavePayload(),
            inFallback: _NEWER_COLUMNS.includes('pelvic_profile'),
        }));
        expect(p.payload.pelvic_profile).toBe('tight');
        expect(p.payload).toHaveProperty('pelvic_screen_date');
        expect(p.inFallback).toBe(true);
        expect(app.errors).toEqual([]);
    });

    test('once screened, the locks reflect the result rather than the gap', async () => {
        const r = await app.page.evaluate(() => {
            document.getElementById('pelvic-result-modal').classList.add('hidden');
            goToRecoveryPicker();
            const kegel = [...document.querySelectorAll('.ex-pick-card')].find(c => c.dataset.idx === '0');
            return {
                pickerShown: !document.getElementById('step-3b').classList.contains('hidden-step'),
                reason: kegel.querySelector('.ex-pick-benefit').textContent,
            };
        });
        expect(r.pickerShown).toBe(true);
        // Screened tight, so the reason is the result, not an invitation to screen.
        expect(r.reason).toMatch(/already tight/i);
        expect(r.reason).not.toMatch(/30-second/i);
    }, 30_000);
});
