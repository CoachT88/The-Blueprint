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
        /* Phase 3C.3. Stay on the LEGACY authority path, where the column IS
           the programme. This helper writes today's slot directly, and every
           test here is about the Today card and the completion engine rather
           than about authority. Without the reset, the first render
           classifies and cuts the member over, and from then on the week is
           read from dated plans that start at the cutover date, so a midweek
           run silently measures a smaller week than the one being seeded.
           The authority-aware week has its own coverage. */
        persisted.programme = window.__legacyProgramme();
        persisted.dayPlans = [];
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
        const crit = document.getElementById('hq-attention-band');
        const nudges = document.getElementById('hq-nudge-band');
        const live = el => [...el.children].filter(c => !c.classList.contains('hidden')).map(c => c.id);
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
            /* The dot row is gone. The strip is always seven cells, so the
               target is no longer a count of elements: it is read off the
               label, which is the only place it is now stated, and the
               finished days are the satisfied cells. Per day rather than
               anonymous, which is what absorbing the calendar bought. */
            weekCells: window.__weekStrip().days.length,
            weekDone: window.__weekStrip().satisfied,
            criticalShown: live(crit),
            nudgesShown: live(nudges),
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

    test('REST offers nothing at all, not even quietly', async () => {
        // A few minutes of optional work beside a rest day teaches that
        // following the programme is never quite enough.
        const r = await render(app.page, { type: 'rest' });
        expect(r.optional).toBeNull();
        expect(r.meta).toBeNull();
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
        // Closure, so nothing follows it. "Today is done" plus a suggestion
        // is not done.
        expect(r.optional).toBeNull();
        // The headline already says it; the reason must not repeat it.
        expect(r.why).toBeNull();
    });

    /**
     * Driven through the real finishSession(), per the Phase 2B test policy.
     *
     * The version this replaced seeded `{ type: 'length', duration: 840 }`,
     * a payload production has never written, and asserted "14 min" against
     * a reader that divided by 60. It passed for years while the real card
     * showed no mission at all and a duration 60x too small, because nothing
     * in it ever touched the writer.
     */
    const finishRealSession = (page, { minutes, routineType = 'length', eq = 8, rpe = 6 }) =>
        page.evaluate(({ minutes, routineType, eq, rpe, WEEK }) => {
            const d = new Date().getDay();
            persisted.schedule = [...WEEK];
            persisted.schedule[d] = routineType;
            persisted.completedDays = [false, false, false, false, false, false, false];
            persisted.sessionLog = [];
            persisted.primaryGoal = 'all';
            persisted.pelvicProfile = 'standard';

            session.routineType = routineType;
            _sessionStartTime = Date.now() - minutes * 60000;
            selectedEQ = eq; selectedRPE = rpe;
            document.getElementById('input-bpel').value = '';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = '';
            finishSession();                      // the production path
            closeSessionSummary();                // which returns to the HQ
            renderDashboard();

            const entry = persisted.sessionLog[persisted.sessionLog.length - 1];
            return {
                summary: document.getElementById('today-complete-summary').textContent,
                state: document.getElementById('hq-today-card').dataset.state,
                stored: { routineType: entry.routineType, duration: entry.duration,
                          hasLegacyType: 'type' in entry },
            };
        }, { minutes, routineType, eq, rpe, WEEK });

    test('COMPLETE names the session finished through the real path', async () => {
        const r = await finishRealSession(app.page, { minutes: 45 });
        expect(r.state).toBe('COMPLETE');
        // The writer's shape, asserted so the reader can never drift from it
        // again without this failing.
        expect(r.stored.routineType).toBe('length');
        expect(r.stored.hasLegacyType).toBe(false);
        expect(r.stored.duration).toBe(45);
        expect(r.summary).toMatch(/Completed/);
        expect(r.summary).toMatch(/Length/);
    }, 30_000);

    test.each([[45, '45 min'], [14, '14 min']])
    ('a %i minute session renders %s', async (minutes, shown) => {
        const r = await finishRealSession(app.page, { minutes });
        expect(r.summary).toContain(shown);
        // The bug was dividing stored minutes by 60.
        expect(r.summary).not.toContain(`${Math.round(minutes / 60)} min`);
    }, 30_000);

    test('EQ and RPE still render alongside', async () => {
        const r = await finishRealSession(app.page, { minutes: 30, eq: 8, rpe: 6 });
        expect(r.summary).toMatch(/8\/10/);
        expect(r.summary).toMatch(/6\/10/);
        expect(r.summary).toMatch(/This week/);
    }, 30_000);

    test('REGRESSION: the legacy fixture shape cannot make this pass', async () => {
        // Exactly what the old test seeded. The card must show no mission
        // and no duration for it, because production never writes it.
        const r = await render(app.page, {
            type: 'length',
            patch: {
                completedDays: [0, 1, 2, 3, 4, 5, 6].map(i => i === new Date().getDay()),
                sessionLog: [{ date: new Date().toISOString(), type: 'length', duration: 840, eq: 8, rpe: 6 }],
            },
        });
        // No mission chip: `type` is not a field production writes.
        expect(r.summary).not.toMatch(/Completed/);
        // And 840 is not silently reinterpreted as 14 minutes. It renders as
        // the 840 minutes it claims to be, which is nonsense in, nonsense
        // out, and strictly better than a plausible wrong number.
        expect(r.summary).not.toMatch(/14 min/);
        expect(r.summary).toMatch(/840 min/);
    });

    test('RECOVER does not offer a path to a different session', async () => {
        // The whole point of the high-soreness rule is that there is no way
        // around it. "You can still pick a different session" would be one.
        const r = await render(app.page, { type: 'length', soreness: 'high' });
        const alt = await app.page.evaluate(() =>
            !document.getElementById('today-alt-btn').classList.contains('hidden'));
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
        expect(r.headline).toBe('Your Plan Needs Attention');
        expect(r.why).toBe("We couldn't determine today's session from your current schedule.");
        // The CTA opens the day-type picker for today, so it promises that
        // and not a repair of the whole week.
        expect(r.prepare).toBe("FIX TODAY'S PLAN");
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
        // On a day that actually prescribes recovery. A rest day prescribes
        // nothing, so there is no plan to narrow and nothing to say.
        const r = await render(app.page, { type: 'length', soreness: 'high', patch: { pelvicProfile: 'tight' } });
        expect(r.state).toBe('RECOVER');
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
        expect(r.weekLabel).toBe(`0 of ${n} this week`);
        /* Seven cells always, because a week has seven days. The denominator
           lives in the label; what the cells carry is which days. */
        expect(r.weekCells).toBe(7);
    });

    test('a rest day is not a failure and is not in the target', async () => {
        const r = await render(app.page, { type: 'rest' });
        expect(r.weekLabel).toBe(`0 of ${targetFor('rest')} this week`);
        expect(r.weekDone).toBe(0);
    });

    test('finished days are the cells that are marked', async () => {
        const n = targetFor('length');
        const r = await render(app.page, { type: 'length', patch: { completedDays: [true, true, false, false, false, false, false] } });
        expect(r.weekLabel).toMatch(new RegExp(`of ${n} this week$`));
        expect(r.weekDone).toBeGreaterThan(0);
        expect(r.weekDone).toBeLessThanOrEqual(n);
    });

    test('the streak is gone, not merely hidden', async () => {
        // Phase 2A.2 demoted it to the level block, 2B.1 removed the display
        // and the mechanics, and 2B.2 removed the calculation along with the
        // server warning that was its last consumer. It broke on any day
        // without a session, a prescribed rest day included, so it
        // contradicted the weekly target by construction.
        //
        // records.longestStreak stays. It is frozen history, nothing reads it
        // for a decision, and deleting it would destroy data for no gain.
        const r = await app.page.evaluate(() => ({
            hqChip: !!document.getElementById('hq-streak'),
            recordChip: !!document.getElementById('record-streak'),
            summaryStat: !!document.getElementById('summary-streak'),
            calcExists: typeof getCurrentStreak !== 'undefined',
            recordStillStored: typeof (persisted.records || {}).longestStreak === 'number',
            // The XP/level badge left the HQ in 3C.1. What this was really
            // checking is that gamification sits below the prescription, so
            // it now checks the demoted secondary block instead.
            secondaryBelowToday: !!(document.getElementById('hq-today-card')
                .compareDocumentPosition(document.getElementById('hq-secondary'))
                & Node.DOCUMENT_POSITION_FOLLOWING),
        }));
        expect(r.hqChip).toBe(false);
        expect(r.recordChip).toBe(false);
        expect(r.summaryStat).toBe(false);
        expect(r.calcExists).toBe(false);
        expect(r.recordStillStored).toBe(true);
        expect(r.secondaryBelowToday).toBe(true);
    });

    test('no visible surface still says "streak"', async () => {
        const hits = await app.page.evaluate(() =>
            [...document.querySelectorAll('#step-0, #step-5, #session-summary-modal, #chart-modal')]
                .flatMap(root => [...root.querySelectorAll('*')])
                .filter(el => el.children.length === 0 && /streak/i.test(el.textContent))
                .map(el => el.textContent.trim().slice(0, 60)));
        expect(hits).toEqual([]);
    });
});

describe('the two bands', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'tc3' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    const bands = (page) => page.evaluate(() => {
        const live = id => [...document.getElementById(id).children]
            .filter(c => !c.classList.contains('hidden')).map(c => c.id);
        return { critical: live('hq-attention-band'), nudges: live('hq-nudge-band') };
    });

    test('the hierarchy is header, critical, Today, week, nudges, secondary', async () => {
        const order = await app.page.evaluate(() => {
            /* 3C.1 order: context under the header, then critical, Today,
               week, nudges, and the demoted secondary block last. */
            /* 3C.3: one weekly surface between Today and the nudges, where
               the dot row used to be, with the calendar absorbed into it. */
            const ids = ['hq-context', 'hq-attention-band', 'hq-today-card', 'hq-week-card',
                         'hq-nudge-band', 'hq-secondary'];
            const nodes = ids.map(i => document.getElementById(i));
            const ok = nodes.every((n, k) => k === 0 ||
                !!(nodes[k - 1].compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING));
            return { ok, missing: ids.filter((i, k) => !nodes[k]) };
        });
        expect(order.missing).toEqual([]);
        expect(order.ok).toBe(true);
    });

    test('nothing non-critical can render above the Today card', async () => {
        // The failure this guards: a standing reminder or a nudge taking the
        // position that belongs to today's prescription.
        const above = await app.page.evaluate(() => {
            const today = document.getElementById('hq-today-card');
            return ['hq-pelvic-prompt', 'hq-coach-nudge', 'hq-pass-used-banner'].filter(id =>
                !!(document.getElementById(id).compareDocumentPosition(today) & Node.DOCUMENT_POSITION_FOLLOWING));
        });
        expect(above).toEqual([]);
    });

    test('only data-safety messages are eligible for the critical band', async () => {
        const ids = await app.page.evaluate(() =>
            [...document.getElementById('hq-attention-band').children].map(c => c.id));
        // deload, rest and resume live here historically but are never
        // promoted; the Today card says all three.
        expect(ids).toEqual([
            'hq-load-failed-banner', 'hq-storage-full-banner',
            'deload-banner', 'hq-rest-banner', 'resume-banner',
        ]);
    });

    test('each band shows at most one message, even with everything live', async () => {
        await app.page.evaluate(() => {
            persisted.schedule = ['length', 'girth', 'rest', 'stamina', 'length', 'rest', 'rest'];
            persisted.primaryGoal = 'all';
            persisted.pelvicProfile = '';
            _storageFull = true; _passUsedThisRender = true; _coachNudgeLive = true;
            renderAttentionBand();
        });
        const b = await bands(app.page);
        expect(b.critical).toHaveLength(1);
        expect(b.nudges).toHaveLength(1);
    });

    test('the worst consequence wins in the critical band', async () => {
        const b = await app.page.evaluate(() => {
            _persistedLoaded = false;
            renderAttentionBand();
            const live = [...document.getElementById('hq-attention-band').children]
                .filter(c => !c.classList.contains('hidden')).map(c => c.id);
            _persistedLoaded = true;
            return live;
        });
        expect(b).toEqual(['hq-load-failed-banner']);
    });

    test('a standing invitation never starves the transient nudges', async () => {
        // The pelvic prompt is true every day until it is answered. Above the
        // nudge it would mean an unscreened member never sees one.
        await app.page.evaluate(() => {
            _storageFull = false; _passUsedThisRender = false; _coachNudgeLive = true;
            persisted.pelvicProfile = '';
            renderAttentionBand();
        });
        expect((await bands(app.page)).nudges).toEqual(['hq-coach-nudge']);
    });

    test('the screener prompt appears once nothing more immediate is live', async () => {
        await app.page.evaluate(() => {
            _coachNudgeLive = false; persisted.pelvicProfile = '';
            renderAttentionBand();
        });
        expect((await bands(app.page)).nudges).toEqual(['hq-pelvic-prompt']);
    });

    test('rest, deload and the unfinished session are never band messages', async () => {
        // The Today card says all three. A banner repeating them is noise.
        const b = await app.page.evaluate(() => {
            _coachNudgeLive = false;
            persisted.pelvicProfile = 'standard';
            persisted.schedule[new Date().getDay()] = 'rest';
            persisted.firstSessionDate = '2020-01-01';
            localStorage.setItem('bp_session_draft_tc3', JSON.stringify({ savedAt: Date.now(), routineType: 'girth', exerciseIndex: 0, setIndex: 1 }));
            renderDashboard();
            const live = id => [...document.getElementById(id).children]
                .filter(c => !c.classList.contains('hidden')).map(c => c.id);
            return { critical: live('hq-attention-band'), nudges: live('hq-nudge-band') };
        });
        expect(b.critical).toEqual([]);
        expect(b.nudges).toEqual([]);
    });
});
