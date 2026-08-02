import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn, sessionEntry } from './harness.js';

/**
 * Coach Tee was a button that waited. To use it a member had to already have a
 * question, remember the feature existed, and type it into an empty box. These
 * two changes remove those barriers.
 *
 * Both are free to run: the chips and the nudge are chosen in plain code from
 * data the app already has, and the model is only called when someone actually
 * engages.
 */
const chipTexts = (page) => page.evaluate(
    () => [...document.querySelectorAll('#coach-chips [data-chip]')].map(b => b.dataset.chip));

describe('suggested questions', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'cc1' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('a brand-new member gets orientation questions, never an empty row', async () => {
        await app.page.evaluate(() => {
            persisted.sessionLog = []; persisted.allTimeSessionCount = 0;
            persisted.primaryGoal = ''; persisted.pelvicProfile = '';
            openCoach();
        });
        const chips = await chipTexts(app.page);
        expect(chips).toHaveLength(3);
        expect(chips.join(' ')).toMatch(/brand new|first week/i);
    }, 30_000);

    test('someone who screened tight is steered away from kegels', async () => {
        const chips = await app.page.evaluate(() => {
            persisted.pelvicProfile = 'tight';
            renderCoachChips();
            return [...document.querySelectorAll('#coach-chips [data-chip]')].map(b => b.dataset.chip);
        });
        expect(chips[0]).toMatch(/kegels/i);
        expect(chips.join(' ')).toMatch(/instead|release/i);
    }, 30_000);

    test('the questions track the goal', async () => {
        const byGoal = {};
        for (const goal of ['stamina', 'eq', 'size']) {
            byGoal[goal] = await app.page.evaluate(g => {
                persisted.pelvicProfile = 'standard';
                persisted.allTimeSessionCount = 10;
                persisted.sessionLog = [{ date: new Date().toISOString(), routineType: 'length', eq: 7, rpe: 5, xpEarned: 15 }];
                persisted.primaryGoal = g;
                renderCoachChips();
                return [...document.querySelectorAll('#coach-chips [data-chip]')].map(b => b.dataset.chip).join(' ');
            }, goal);
        }
        expect(byGoal.stamina).toMatch(/last longer/i);
        expect(byGoal.eq).toMatch(/erection quality/i);
        expect(byGoal.size).toMatch(/length or girth/i);
        // And they are genuinely different from one another.
        expect(new Set(Object.values(byGoal)).size).toBe(3);
    }, 40_000);

    test('the row is never empty even with nothing notable about the member', async () => {
        const chips = await app.page.evaluate(() => {
            persisted.primaryGoal = ''; persisted.pelvicProfile = 'standard';
            persisted.allTimeSessionCount = 50;
            persisted.sessionLog = [{ date: new Date().toISOString(), routineType: 'length', eq: 7, rpe: 5, xpEarned: 15 }];
            renderCoachChips();
            return [...document.querySelectorAll('#coach-chips [data-chip]')].map(b => b.dataset.chip);
        });
        expect(chips).toHaveLength(3);
        expect(chips.every(c => c.length > 0)).toBe(true);
    }, 30_000);

    test('tapping one asks it and clears the suggestions', async () => {
        const r = await app.page.evaluate(async () => {
            renderCoachChips();
            const first = document.querySelector('#coach-chips [data-chip]');
            const question = first.dataset.chip;
            first.click();
            await new Promise(res => setTimeout(res, 200));
            return {
                question,
                sent: document.getElementById('coach-input').value === question
                    || document.getElementById('coach-chat-area').textContent.includes(question),
                chipsCleared: document.querySelectorAll('#coach-chips [data-chip]').length === 0,
            };
        });
        expect(r.sent).toBe(true);
        expect(r.chipsCleared).toBe(true);
    }, 30_000);

    test('tapping is recorded without storing the question itself', async () => {
        const events = await app.page.evaluate(() => {
            _analyticsBuffer = [];
            renderCoachChips();
            document.querySelector('#coach-chips [data-chip]').click();
            return _analyticsBuffer.map(e => ({ ...e }));
        });
        expect(events.some(e => e.event === 'coach_chip_tapped')).toBe(true);
        // The question is a member-facing string, not something to log.
        expect(JSON.stringify(events)).not.toMatch(/kegels|erection|girth/i);
        expect(app.errors).toEqual([]);
    }, 30_000);
});

describe('the nudge fires only when there is something to notice', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'cn1' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    const reset = () => app.page.evaluate(() => {
        COACH_NUDGES.forEach(n => { try { localStorage.removeItem(_nudgeKey(n.id)); } catch (e) {} });
        for (let i = 0; i < 5; i++) {
            const d = new Date(); d.setDate(d.getDate() - i);
            try { localStorage.removeItem('bp_sleep_cn1_' + d.toISOString().split('T')[0]); } catch (e) {}
        }
        persisted.sessionLog = []; persisted.difficulty = 'intermediate';
    });

    test('a member with no history sees nothing', async () => {
        await reset();
        const id = await app.page.evaluate(() => (pickCoachNudge() || {}).id || null);
        expect(id).toBeNull();
    });

    test('near-maximum effort three sessions running', async () => {
        await reset();
        const id = await app.page.evaluate(log => { persisted.sessionLog = log; return (pickCoachNudge() || {}).id; },
            [2, 1, 0].map(d => sessionEntry(d, { rpe: 9 })));
        expect(id).toBe('hard_rpe');
    });

    test('but not on ordinary effort', async () => {
        await reset();
        const id = await app.page.evaluate(log => { persisted.sessionLog = log; return (pickCoachNudge() || {}).id || null; },
            [2, 1, 0].map(d => sessionEntry(d, { rpe: 5 })));
        expect(id).toBeNull();
    });

    test('three poor nights running', async () => {
        await reset();
        const id = await app.page.evaluate(log => {
            persisted.sessionLog = log;
            for (let i = 0; i < 3; i++) {
                const d = new Date(); d.setDate(d.getDate() - i);
                localStorage.setItem('bp_sleep_cn1_' + d.toISOString().split('T')[0], 'poor');
            }
            return (pickCoachNudge() || {}).id;
        }, [2, 1, 0].map(d => sessionEntry(d, { rpe: 5 })));
        expect(id).toBe('poor_sleep');
    });

    test('EQ sliding', async () => {
        await reset();
        const id = await app.page.evaluate(log => { persisted.sessionLog = log; return (pickCoachNudge() || {}).id; },
            [9, 9, 8, 6, 5, 4].map((eq, i) => sessionEntry(5 - i, { eq, rpe: 5 })));
        expect(id).toBe('eq_declining');
    });

    test('coming back after more than a week away', async () => {
        await reset();
        const id = await app.page.evaluate(log => { persisted.sessionLog = log; return (pickCoachNudge() || {}).id; },
            [20, 15, 10].map(d => sessionEntry(d, { rpe: 5, eq: 7 })));
        expect(id).toBe('returning');
    });

    test('two weeks consistent and still on a lower tier', async () => {
        await reset();
        const id = await app.page.evaluate(() => {
            persisted.sessionLog = Array.from({ length: 15 }, (_, i) => ({
                date: new Date(Date.now() - i * 864e5).toISOString(),
                routineType: 'length', eq: 7, rpe: 5, xpEarned: 15, note: '',
            })).reverse();
            persisted.difficulty = 'intermediate';
            return (pickCoachNudge() || {}).id;
        });
        expect(id).toBe('tier_ready');
    });

    test('only the highest priority shows when two conditions are true', async () => {
        await reset();
        const id = await app.page.evaluate(log => {
            // Both hard effort AND declining EQ.
            persisted.sessionLog = log;
            return (pickCoachNudge() || {}).id;
        }, [9, 8, 7, 6, 5, 4].map((eq, i) => sessionEntry(5 - i, { eq, rpe: 9 })));
        expect(id).toBe('hard_rpe');   // effort outranks EQ
    });
});

describe('the nudge does not nag', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'cn2' });
        await app.page.evaluate(log => {
            COACH_NUDGES.forEach(n => { try { localStorage.removeItem(_nudgeKey(n.id)); } catch (e) {} });
            persisted.sessionLog = log;
            goToStep(0);
        }, [2, 1, 0].map(d => ({
            date: new Date(Date.now() - d * 864e5).toISOString(),
            routineType: 'length', eq: 7, rpe: 9, xpEarned: 15, note: '',
        })));
        await app.page.waitForTimeout(300);
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('it shows on the HQ, above the calendar', async () => {
        const r = await app.page.evaluate(() => {
            const card = document.getElementById('hq-coach-nudge');
            const cal = document.getElementById('hq-calendar-card');
            return {
                shown: !card.classList.contains('hidden'),
                text: document.getElementById('hq-coach-nudge-text').textContent,
                aboveCalendar: !!(card.compareDocumentPosition(cal) & Node.DOCUMENT_POSITION_FOLLOWING),
            };
        });
        expect(r.shown).toBe(true);
        expect(r.text).toMatch(/maximum effort/i);
        expect(r.aboveCalendar).toBe(true);
    }, 30_000);

    test('dismissing hides it and it does not come back', async () => {
        const r = await app.page.evaluate(() => {
            document.getElementById('hq-coach-nudge-dismiss').click();
            const hiddenNow = document.getElementById('hq-coach-nudge').classList.contains('hidden');
            renderCoachNudge();                       // as a fresh render would
            return { hiddenNow, stillHidden: document.getElementById('hq-coach-nudge').classList.contains('hidden') };
        });
        expect(r.hiddenNow).toBe(true);
        expect(r.stillHidden).toBe(true);
    }, 30_000);

    test('the cool-off expires rather than suppressing forever', async () => {
        const id = await app.page.evaluate(() => {
            // Backdate the suppression beyond the window.
            localStorage.setItem(_nudgeKey('hard_rpe'), String(Date.now() - (NUDGE_COOLOFF_DAYS + 1) * 864e5));
            return (pickCoachNudge() || {}).id;
        });
        expect(id).toBe('hard_rpe');
    }, 30_000);

    test('acting on it opens the chat with the question already asked', async () => {
        const r = await app.page.evaluate(async () => {
            _analyticsBuffer = [];
            renderCoachNudge();
            document.getElementById('hq-coach-nudge-ask').click();
            await new Promise(res => setTimeout(res, 250));
            return {
                modalOpen: !document.getElementById('coach-modal').classList.contains('hidden'),
                chat: document.getElementById('coach-chat-area').textContent,
                nudgeHidden: document.getElementById('hq-coach-nudge').classList.contains('hidden'),
                events: _analyticsBuffer.map(e => e.event),
            };
        });
        expect(r.modalOpen).toBe(true);
        expect(r.chat).toMatch(/maximum effort/i);   // the question is in the transcript
        expect(r.nudgeHidden).toBe(true);
        expect(r.events).toContain('nudge_tapped');
    }, 30_000);

    test('shown and dismissed are recorded, identified only by nudge id', async () => {
        const events = await app.page.evaluate(() => {
            localStorage.removeItem(_nudgeKey('hard_rpe'));
            _analyticsBuffer = [];
            renderCoachNudge();
            document.getElementById('hq-coach-nudge-dismiss').click();
            return _analyticsBuffer.map(e => ({ event: e.event, props: e.props }));
        });
        expect(events.map(e => e.event)).toEqual(['nudge_shown', 'nudge_dismissed']);
        expect(events[0].props.nudge).toBe('hard_rpe');
        expect(app.errors).toEqual([]);
    }, 30_000);

    test('repainting the HQ does not log the same appearance again', async () => {
        // renderDashboard runs on eight different state changes. Counting each
        // repaint would make one nudge look like eight.
        const shown = await app.page.evaluate(() => {
            localStorage.removeItem(_nudgeKey('hard_rpe'));   // the previous test dismissed it
            _analyticsBuffer = [];
            renderCoachNudge(); renderCoachNudge(); renderCoachNudge();
            return _analyticsBuffer.filter(e => e.event === 'nudge_shown').length;
        });
        expect(shown).toBe(1);
        expect(app.errors).toEqual([]);
    }, 30_000);
});
