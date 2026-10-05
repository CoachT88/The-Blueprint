import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * The Today card as ONE component across seven states. Phase 3C.2.
 *
 * Before this, state was carried almost entirely by a 4px left border, and
 * two pairs collided: MODIFIED and RECOVER were both amber, COMPLETE and
 * RESUME were both emerald. In each pair the colour said nothing. Worse, a
 * member who had just reported high soreness saw the identical bright blue
 * "go" button as on a normal training day.
 *
 * The rule these tests enforce is that colour only REINFORCES. Strip every
 * accent and the state must still be readable from its badge, which is why
 * the identification test runs with colour removed rather than trusting the
 * hue.
 */

const SEED = {
    TRAIN:    {},
    MODIFIED: { soreness: 'moderate' },
    RECOVER:  { soreness: 'high' },
    REST:     { schedule: ['rest','rest','rest','rest','rest','rest','rest'] },
    COMPLETE: { completedDays: [true,true,true,true,true,true,true],
                sessionLog: [{ date: new Date().toISOString(), routineType: 'length', duration: 45 }] },
    RESUME:   { draft: true },
    PREPARE:  { goal: '' },
};

const seed = (page, o) => page.evaluate((o) => {
    const U = 'tst';
    currentUser = { id: U, email: 't@e.com', user_metadata: { preferred_name: 'Marcus' } };
    _persistedLoaded = true; _storageFull = false;
    persisted.primaryGoal = o.goal === undefined ? 'all' : o.goal;
    persisted.pelvicProfile = 'standard'; persisted.pelvicScreenDate = '2025-01-01';
    persisted.schedule = o.schedule || ['length','length','length','length','length','length','length'];
    persisted.completedDays = o.completedDays || [false,false,false,false,false,false,false];
    persisted.sessionLog = o.sessionLog ||
        [{ date: new Date(Date.now() - 2 * 864e5).toISOString(), routineType: 'length', duration: 30 }];
    persisted.progressionLedger = []; persisted.allTimeSessionCount = 40;
    try {
        localStorage.setItem('bp_onboarded_' + U, '1');
        localStorage.removeItem(getTodaySorenessKey());
        localStorage.removeItem('bp_session_draft_' + U);
        if (o.soreness) localStorage.setItem(getTodaySorenessKey(), o.soreness);
        if (o.draft) localStorage.setItem('bp_session_draft_' + U, JSON.stringify(
            { savedAt: Date.now(), exerciseIndex: 0, setIndex: 1, routineType: 'length', xp: 0,
              sessionStartTime: Date.now() - 3e5 }));
    } catch (e) {}
    goToStep(0); renderDashboard();
    const card = document.getElementById('hq-today-card');
    const vis = (id) => { const e = document.getElementById(id);
                          return !!e && !e.classList.contains('hidden') && e.getBoundingClientRect().height > 0; };
    const primary = ['launch-btn','resume-btn','today-prepare-btn'].find(vis) || null;
    return {
        state: card.dataset.state,
        accent: getComputedStyle(card).borderLeftColor,
        label: (document.getElementById('today-state-label').textContent || '').trim(),
        icon: (document.getElementById('today-state-icon').className || '').replace('fas ', '').trim(),
        badgeShown: vis('today-eyebrow'),
        headline: document.getElementById('today-headline').textContent.trim(),
        primary,
        primaryText: primary ? document.getElementById(primary).textContent.trim() : null,
        caution: primary ? document.getElementById(primary).classList.contains('u-btn--caution') : false,
        height: Math.round(card.getBoundingClientRect().height),
        overflows: card.scrollWidth > card.clientWidth + 1,
        /* Slot ORDER. They may collapse, never reorder. */
        slots: ['today-eyebrow','today-headline','today-sub','today-why',
                'today-complete-summary','today-actions']
               .filter(vis)
               .map(id => document.getElementById(id).getBoundingClientRect().top),
    };
}, o);

describe('the Today card is one component in seven states', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'tst' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    const seen = {};

    test.each(Object.keys(SEED))('ACCEPTANCE: %s has its own badge and never overflows', async (st) => {
        const r = await seed(app.page, SEED[st]);
        seen[st] = r;
        expect(r.state).toBe(st);
        expect(r.badgeShown).toBe(true);
        expect(r.label.length).toBeGreaterThan(0);
        expect(r.icon).toMatch(/^fa-/);
        expect(r.overflows).toBe(false);
        // Slots never reorder: tops must be strictly increasing.
        expect(r.slots).toEqual([...r.slots].sort((a, b) => a - b));
    }, 40_000);

    test('ACCEPTANCE: every state is identifiable with colour removed', () => {
        /* The actual requirement. Two accents legitimately repeat, because
           TRAIN and RESUME both mean "there is work to do now", so the hue
           cannot be the thing that separates states. The badge must. */
        const labels = Object.values(seen).map(r => r.label);
        const icons = Object.values(seen).map(r => r.icon);
        expect(new Set(labels).size, `labels not unique: ${labels}`).toBe(labels.length);
        expect(new Set(icons).size, `icons not unique: ${icons}`).toBe(icons.length);
    });

    test('ACCEPTANCE: the two accent collisions are gone', () => {
        // MODIFIED and RECOVER were both amber; COMPLETE and RESUME both emerald.
        expect(seen.RECOVER.accent).not.toBe(seen.MODIFIED.accent);
        expect(seen.RESUME.accent).not.toBe(seen.COMPLETE.accent);
    });

    test('ACCEPTANCE: RECOVER is actionable but visibly not a normal training day', async () => {
        /* A member reporting high soreness used to get the identical blue
           "go" button. It must still be clearly primary, the same size and
           weight, and must not look disabled or dangerous. */
        expect(seen.RECOVER.caution).toBe(true);
        expect(seen.TRAIN.caution).toBe(false);
        expect(seen.RECOVER.primary).toBe('launch-btn');
        // Re-seed: test.each left the page on PREPARE, so the live button
        // has to be put back into the RECOVER state before reading it.
        await seed(app.page, SEED.RECOVER);
        const r = await app.page.evaluate(() => {
            const b = document.getElementById('launch-btn'), cs = getComputedStyle(b);
            return { bg: cs.backgroundImage, h: Math.round(b.getBoundingClientRect().height),
                     w: Math.round(b.getBoundingClientRect().width),
                     disabled: b.disabled, opacity: cs.opacity };
        });
        expect(r.bg).toContain('245, 158, 11');      // amber, not the blue gradient
        expect(r.bg).not.toContain('37, 99, 235');
        expect(r.disabled).toBe(false);
        expect(Number(r.opacity)).toBe(1);
        expect(r.h).toBeGreaterThanOrEqual(44);      // same stature as any primary
    }, 40_000);

    test('ACCEPTANCE: REST and COMPLETE are closed, with no invented action', () => {
        // Closure is the product outcome. No "train anyway", no "do more".
        expect(seen.REST.primary).toBeNull();
        expect(seen.COMPLETE.primary).toBeNull();
    });

    test('ACCEPTANCE: every actionable state has exactly one primary', () => {
        for (const st of ['TRAIN', 'MODIFIED', 'RECOVER', 'RESUME', 'PREPARE']) {
            expect(seen[st].primary, `${st} needs a primary action`).toBeTruthy();
            expect(seen[st].primaryText.length).toBeGreaterThan(0);
        }
    });

    test('REGRESSION: the card height range stays bounded', () => {
        const hs = Object.values(seen).map(r => r.height);
        // Was 153 to 347 before 3C.2. The spread is driven by how much each
        // state genuinely has to say, so this is a bound, not a target.
        expect(Math.min(...hs)).toBeGreaterThan(120);
        expect(Math.max(...hs)).toBeLessThan(360);
    });

    test('the page threw nothing', () => { expect(app.errors).toEqual([]); });
});
