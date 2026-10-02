import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * The Today card, driven through every state in a real browser.
 *
 * The resolver already has 83 unit tests, so none of this re-asserts the
 * decision. What it asserts is the wiring and the presentation contract:
 * the page reads the resolver rather than deciding for itself, it never
 * invents a duration the resolver withheld, and each state answers what to
 * do, why, how long and what happens next.
 *
 * Today's weekday is whatever day the suite runs on, so every case writes
 * the slot it needs at `new Date().getDay()` rather than assuming one.
 */

const WEEK = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];

/** Put `type` on today and render. Returns everything the card is showing. */
async function render(page, { type = 'length', patch = {}, soreness = null, draft = null } = {}) {
    return page.evaluate(({ type, patch, soreness, draft, WEEK }) => {
        const d = new Date().getDay();
        persisted.schedule = [...WEEK];
        persisted.schedule[d] = type;
        persisted.completedDays = [false, false, false, false, false, false, false];
        persisted.primaryGoal = 'all';
        persisted.pelvicProfile = 'standard';
        persisted.firstSessionDate = '';
        Object.assign(persisted, patch);

        const sKey = 'bp_soreness_' + (currentUser?.id || '') + '_' + new Date().toISOString().split('T')[0];
        if (soreness) localStorage.setItem(sKey, soreness); else localStorage.removeItem(sKey);

        const dKey = 'bp_session_draft_' + (currentUser?.id || '');
        if (draft) localStorage.setItem(dKey, JSON.stringify({ savedAt: Date.now(), exerciseIndex: 0, setIndex: 1, ...draft }));
        else localStorage.removeItem(dKey);

        renderDashboard();

        const txt = id => document.getElementById(id).textContent.trim();
        const shown = id => !document.getElementById(id).classList.contains('hidden');
        const band = document.getElementById('hq-attention-band');
        return {
            state: document.getElementById('hq-today-card').dataset.state,
            eyebrow: txt('today-eyebrow'),
            headline: txt('today-headline'),
            sub: shown('today-sub') ? txt('today-sub') : null,
            why: shown('today-why') ? txt('today-why') : null,
            meta: shown('today-meta') ? txt('today-meta') : null,
            // Raw, regardless of visibility. A hidden element holding a
            // number is still a number waiting to be shown by accident.
            metaRaw: txt('today-meta'),
            withheld: shown('today-withheld') ? txt('today-withheld') : null,
            changes: [...document.getElementById('today-changes').children].map(li => li.textContent.trim()),
            summary: shown('today-complete-summary') ? txt('today-complete-summary') : null,
            launch: shown('launch-btn') ? txt('launch-btn') : null,
            resume: shown('resume-btn') ? txt('resume-btn') : null,
            prepare: shown('today-prepare-btn') ? txt('today-prepare-btn') : null,
            optional: shown('today-optional-btn') ? txt('today-optional-btn') : null,
            whyBtn: shown('today-why-btn'),
            weekLabel: txt('hq-week-label'),
            weekDots: document.getElementById('hq-week-dots').children.length,
            weekDone: document.querySelectorAll('#hq-week-dots .week-dot.done').length,
            bandShown: [...band.children].filter(c => !c.classList.contains('hidden')).map(c => c.id),
        };
    }, { type, patch, soreness, draft, WEEK });
}

describe('the Today card', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'tc1' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the decision modules actually loaded', async () => {
        // If this fails nothing else in the file means anything: the card
        // would be sitting on its placeholder and so would production.
        const keys = await app.page.evaluate(() => (window.BP ? Object.keys(window.BP) : []));
        expect(keys).toContain('nextBestAction');
        expect(keys).toContain('estimateSessionMinutes');
        expect(keys).toContain('weekCompletion');
    });

    test('TRAIN says what, why and how long', async () => {
        const r = await render(app.page, { type: 'length' });
        expect(r.state).toBe('TRAIN');
        expect(r.headline).toBe('Length Day');
        expect(r.sub).toBe("Today's focus: your length protocol.");
        expect(r.why).toMatch(/Length day on your schedule/);
        expect(r.meta).toMatch(/^~\d+ min · includes warmup$/);
        expect(r.launch).toBe('START LENGTH SESSION');
        expect(r.resume).toBeNull();
        expect(r.summary).toBeNull();
    });

    test('stamina carries no warmup in its estimate', async () => {
        const r = await render(app.page, { type: 'stamina' });
        expect(r.meta).toMatch(/^~\d+ min$/);
        expect(r.meta).not.toMatch(/warmup/);
    });

    test('MODIFIED looks different from TRAIN and says the app reacted', async () => {
        const r = await render(app.page, { type: 'length', soreness: 'moderate' });
        expect(r.state).toBe('MODIFIED');
        expect(r.headline).toBe('Modified Session');
        expect(r.sub).toBe('Length training, reduced today.');
        expect(r.why).toBe('Reduced today because you reported moderate muscle soreness.');
        expect(r.launch).toBe('START MODIFIED SESSION');
        expect(r.changes.join(' ')).toMatch(/One set fewer/);
        // A product heuristic, never dressed up as a validated dose.
        expect(r.why).not.toMatch(/research|study|clinical|60%/i);
    });

    test('MODIFIED is shorter than the same session unmodified', async () => {
        const normal = await render(app.page, { type: 'length' });
        const reduced = await render(app.page, { type: 'length', soreness: 'moderate' });
        const mins = s => Number(s.match(/~(\d+)/)[1]);
        expect(mins(reduced.meta)).toBeLessThan(mins(normal.meta));
    });

    test('RECOVER withholds training without calling soreness an injury', async () => {
        const r = await render(app.page, { type: 'length', soreness: 'high' });
        expect(r.state).toBe('RECOVER');
        expect(r.headline).toBe('Recovery');
        expect(r.why).toBe('Mechanical training is on hold today because you reported high muscle soreness.');
        expect(r.why).not.toMatch(/injur|damage|scar|risk/i);
        expect(r.launch).toBe('START RECOVERY');
    });

    test('RECOVER acknowledges a withheld session and offers no way back into it', async () => {
        const r = await render(app.page, { type: 'length', soreness: 'high', draft: { routineType: 'girth' } });
        expect(r.state).toBe('RECOVER');
        expect(r.withheld).toBe('Your unfinished Girth session is paused, not deleted.');
        expect(r.resume).toBeNull();
        expect(r.launch).toBe('START RECOVERY');
        const override = await app.page.evaluate(() => currentPrescription().overrideAllowed);
        expect(override).toBe(false);
    });

    test('REST is a prescription, not a lockout', async () => {
        const r = await render(app.page, { type: 'rest' });
        expect(r.state).toBe('REST');
        expect(r.headline).toBe('Rest Day');
        expect(r.why).toBe('Rest is on the schedule today, and it is part of the programme.');
        expect(r.why).not.toMatch(/locked/i);
        // No primary call to action pressing the member into more work.
        expect(r.launch).toBeNull();
        expect(r.resume).toBeNull();
        expect(r.prepare).toBeNull();
    });

    test('REST offers Active Recovery quietly, and never calls it a bonus', async () => {
        const r = await render(app.page, { type: 'rest' });
        expect(r.optional).toMatch(/^Active Recovery/);
        expect(r.optional).not.toMatch(/bonus/i);
    });

    test('COMPLETE is closure: no primary CTA, and it shows what is next', async () => {
        const r = await render(app.page, {
            type: 'length',
            patch: { completedDays: [0, 1, 2, 3, 4, 5, 6].map(i => i === new Date().getDay()) },
        });
        expect(r.state).toBe('COMPLETE');
        expect(r.headline).toBe('Today Is Done');
        expect(r.launch).toBeNull();
        expect(r.resume).toBeNull();
        expect(r.prepare).toBeNull();
        expect(r.summary).toMatch(/This week/);
        expect(r.summary).toMatch(/Next up/);
        expect(r.optional).toMatch(/^Active Recovery/);
        // The headline already says it; the reason must not repeat it.
        expect(r.why).toBeNull();
    });

    test('COMPLETE shows the session that was finished when there is one', async () => {
        const r = await render(app.page, {
            type: 'length',
            patch: {
                completedDays: [0, 1, 2, 3, 4, 5, 6].map(i => i === new Date().getDay()),
                sessionLog: [{ date: new Date().toISOString(), type: 'length', duration: 840, eq: 8, rpe: 6 }],
            },
        });
        expect(r.summary).toMatch(/Completed/);
        expect(r.summary).toMatch(/Length/);
        expect(r.summary).toMatch(/14 min/);
        expect(r.summary).toMatch(/8\/10/);
        expect(r.summary).toMatch(/6\/10/);
    });

    test('RECOVER does not offer a path to a different session', async () => {
        // The whole point of the high-soreness rule is that there is no way
        // around it. "You can still pick a different session" would be one.
        const r = await render(app.page, { type: 'length', soreness: 'high' });
        const alt = await app.page.evaluate(() =>
            !document.getElementById('today-alt-note').classList.contains('hidden'));
        expect(r.state).toBe('RECOVER');
        expect(alt).toBe(false);
    });

    test('RESUME shows the unfinished session and no duration at all', async () => {
        // The draft holds exerciseIndex and setIndex but no remaining-time
        // calculation exists yet, and a whole-session number would overstate
        // what is actually left.
        const r = await render(app.page, { type: 'length', draft: { routineType: 'girth' } });
        expect(r.state).toBe('RESUME');
        expect(r.headline).toBe('Pick Up Where You Left Off');
        expect(r.sub).toBe('Girth session');
        expect(r.meta).toBeNull();
        // Not merely hidden: the element must not be holding a substituted
        // whole-session estimate either.
        expect(r.metaRaw).toBe('');
        expect(r.resume).toBe('RESUME SESSION');
        expect(r.launch).toBeNull();
    });

    test('PREPARE: no goal', async () => {
        const r = await render(app.page, { type: 'length', patch: { primaryGoal: '' } });
        expect(r.state).toBe('PREPARE');
        expect(r.headline).toBe('Set Your Goal');
        expect(r.prepare).toBe('CHOOSE A GOAL');
        expect(r.launch).toBeNull();
    });

    test('no state ever leaves a stale duration behind in the markup', async () => {
        // Switching from a day with a duration to one without must clear it.
        await render(app.page, { type: 'length' });
        const after = await render(app.page, { type: 'rest' });
        expect(after.metaRaw).toBe('');
    });

    test('PREPARE: an unresolved schedule shows a repair path and no training', async () => {
        const r = await render(app.page, { type: 'mystery' });
        expect(r.state).toBe('PREPARE');
        expect(r.headline).toBe('Your Week Needs A Quick Reset');
        expect(r.why).toBe('Your training week could not be read, so there is nothing to prescribe until it is set again.');
        expect(r.prepare).toBe('FIX MY WEEK');
        // Nothing may be invented from the goal.
        expect(r.launch).toBeNull();
        expect(r.meta).toBeNull();
        expect(r.optional).toBeNull();
    });

    test('PREPARE: the repair CTA opens something that can actually fix it', async () => {
        await render(app.page, { type: 'mystery' });
        const modalOpen = await app.page.evaluate(() => {
            document.getElementById('today-prepare-btn').click();
            return !document.getElementById('type-modal').classList.contains('hidden');
        });
        expect(modalOpen).toBe(true);
        await app.page.evaluate(() => document.getElementById('type-modal').classList.add('hidden'));
    });

    test('PREPARE: data not loaded', async () => {
        const r = await app.page.evaluate(() => {
            _persistedLoaded = false;
            renderDashboard();
            const out = {
                state: document.getElementById('hq-today-card').dataset.state,
                headline: document.getElementById('today-headline').textContent.trim(),
                launchHidden: document.getElementById('launch-btn').classList.contains('hidden'),
            };
            _persistedLoaded = true;
            return out;
        });
        expect(r.state).toBe('PREPARE');
        expect(r.headline).toBe('Loading');
        expect(r.launchHidden).toBe(true);
    });

    test('a tight floor is named as a change rather than silently applied', async () => {
        const r = await render(app.page, { type: 'rest', patch: { pelvicProfile: 'tight' } });
        expect(r.changes.join(' ')).toMatch(/tight floor/i);
    });

    test('"Why this today?" is a disclosure, not a Coach Tee call', async () => {
        await render(app.page, { type: 'length', soreness: 'moderate' });
        const r = await app.page.evaluate(() => {
            const before = document.getElementById('today-changes').classList.contains('hidden');
            document.getElementById('today-why-btn').click();
            return { before, after: document.getElementById('today-changes').classList.contains('hidden') };
        });
        expect(r.before).toBe(true);
        expect(r.after).toBe(false);
    });
});

describe('week completion is the primary progress signal', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'tc2' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    // render() writes today's slot, so the denominator depends on which
    // weekday the suite runs. Compute it rather than hard-coding a number
    // that is only right four days out of seven.
    const targetFor = (type) => {
        const w = [...WEEK];
        w[new Date().getDay()] = type;
        return w.filter(t => t !== 'rest').length;
    };

    test('the denominator is scheduled sessions, not seven days', async () => {
        const n = targetFor('length');
        expect(n).toBeLessThan(7);                 // rest days are excluded
        const r = await render(app.page, { type: 'length' });
        expect(r.weekDots).toBe(n);
        expect(r.weekLabel).toBe(`0 of ${n} this week`);
    });

    test('a rest day is not a failure and is not in the target', async () => {
        const r = await render(app.page, { type: 'rest' });
        expect(r.weekDots).toBe(targetFor('rest'));
        expect(r.weekDone).toBe(0);
    });

    test('finished days fill the dots', async () => {
        const n = targetFor('length');
        const r = await render(app.page, { type: 'length', patch: { completedDays: [true, true, false, false, false, false, false] } });
        expect(r.weekLabel).toMatch(new RegExp(`of ${n} this week$`));
        expect(r.weekDone).toBeGreaterThan(0);
        expect(r.weekDone).toBeLessThanOrEqual(n);
    });

    test('streak is no longer shown beside it', async () => {
        // Two counters disagreeing about the same week is the contradiction
        // this phase was meant to remove. Streak still exists; it is just not
        // sharing the headline while its own logic treats a prescribed rest
        // day as a miss.
        const r = await app.page.evaluate(() => {
            const chips = document.getElementById('hq-stat-chips');
            const streak = document.getElementById('hq-streak');
            const level = document.getElementById('hq-level-badge');
            return {
                streakInChips: chips.contains(streak),
                streakInLevel: level.contains(streak),
                streakStillRendered: streak.textContent.trim().length > 0,
                levelBelowToday: !!(document.getElementById('hq-today-card')
                    .compareDocumentPosition(level) & Node.DOCUMENT_POSITION_FOLLOWING),
            };
        });
        expect(r.streakInChips).toBe(false);
        expect(r.streakInLevel).toBe(true);
        expect(r.streakStillRendered).toBe(true);
        expect(r.levelBelowToday).toBe(true);
    });
});

describe('the attention band', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'tc3' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('never shows more than one message', async () => {
        // Every condition live at once. Before this phase that was five
        // stacked cards above the decision.
        const shown = await app.page.evaluate(() => {
            persisted.schedule = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
            persisted.primaryGoal = 'all';
            persisted.pelvicProfile = '';
            _storageFull = true;
            _passUsedThisRender = true;
            _coachNudgeLive = true;
            renderAttentionBand();
            const band = document.getElementById('hq-attention-band');
            return [...band.children].filter(c => !c.classList.contains('hidden')).map(c => c.id);
        });
        expect(shown).toHaveLength(1);
    });

    test('the worst consequence wins', async () => {
        const first = await app.page.evaluate(() => {
            _persistedLoaded = false;
            renderAttentionBand();
            const band = document.getElementById('hq-attention-band');
            const out = [...band.children].filter(c => !c.classList.contains('hidden')).map(c => c.id);
            _persistedLoaded = true;
            return out;
        });
        expect(first).toEqual(['hq-load-failed-banner']);
    });

    test('a standing invitation never starves the transient messages', async () => {
        // The pelvic prompt is true every day until it is answered. Above the
        // nudge it would mean an unscreened member never sees one.
        const shown = await app.page.evaluate(() => {
            _storageFull = false;
            _passUsedThisRender = false;
            _coachNudgeLive = true;
            persisted.pelvicProfile = '';
            renderAttentionBand();
            const band = document.getElementById('hq-attention-band');
            return [...band.children].filter(c => !c.classList.contains('hidden')).map(c => c.id);
        });
        expect(shown).toEqual(['hq-coach-nudge']);
    });

    test('rest, deload and the unfinished session are never band messages', async () => {
        // The Today card says all three. A banner repeating them is noise.
        const shown = await app.page.evaluate(() => {
            _coachNudgeLive = false;
            persisted.pelvicProfile = 'standard';
            persisted.schedule[new Date().getDay()] = 'rest';
            persisted.firstSessionDate = '2020-01-01';
            localStorage.setItem('bp_session_draft_tc3', JSON.stringify({ savedAt: Date.now(), routineType: 'girth', exerciseIndex: 0, setIndex: 1 }));
            renderDashboard();
            const band = document.getElementById('hq-attention-band');
            return [...band.children].filter(c => !c.classList.contains('hidden')).map(c => c.id);
        });
        expect(shown).toEqual([]);
    });
});
