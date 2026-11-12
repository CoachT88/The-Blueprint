import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, authSignIn } from './harness.js';

/**
 * An Erection Quality member's session day, as the member sees it.
 *
 * Three defects found by running the real buyer journey against staging, each
 * pinned here from the member's side with the real onboarding, the real Today
 * card and the real guided engine, on a phone-sized viewport (the harness
 * default, 390 x 844) and again at 360 wide:
 *
 *   1. TODAY NEVER READ COMPLETE. After the prescribed EQ session the week said
 *      "1 of 3" while Today still read TRAIN with a Start button, offering the
 *      same session again. Every new buyer is on dated plans from onboarding,
 *      and only the legacy cohort's completedDays tick made COMPLETE reachable.
 *   2. THE SESSION DAY WAS CALLED STAMINA. "Stamina Day", "Today's focus: your
 *      stamina protocol.", "START STAMINA SESSION", "On the plan today:
 *      Stamina." for a member who chose Erection quality and was about to do
 *      breathing, a pelvic floor release and a gentle movement.
 *   3. A FULL-REST DAY SAID THE PRACTICE FAILED TO LOAD. "Daily practice could
 *      not be read." on the two days the week asks nothing at all.
 *
 * The flag is flipped inside the page only. The shipped value stays false, and
 * the last describe pins what a member sees while it is.
 */
const at = (iso) => new Date(iso);
const SUN = at('2026-11-22T10:00:00Z');     // an EQ session day (weekday 0); nothing logged
const MON = at('2026-11-23T10:00:00Z');     // supporting practice
const TUE = at('2026-11-24T10:00:00Z');     // full rest
const WED = at('2026-11-25T10:00:00Z');     // an EQ session day
const FRI = at('2026-11-27T10:00:00Z');     // an EQ session day

const EQ = { headline: 'Erection Quality Day', sub: "Today's focus: your erection quality routine.",
             cta: 'START ERECTION QUALITY SESSION', ready: 'On the plan today: Erection Quality.' };
const STAMINA = { headline: 'Stamina Day', sub: "Today's focus: your stamina protocol.",
                  cta: 'START STAMINA SESSION', ready: 'On the plan today: Stamina.' };
const LENGTH = { headline: 'Length Day', sub: "Today's focus: your length protocol.",
                 cta: 'START LENGTH SESSION', ready: 'On the plan today: Length.' };

/** A brand-new paying member, through the real sign-in and the real onboarding. */
async function newMember(app, { goal, flag = true, id = 'NEW1', email = 'new@example.com' }) {
    await app.page.evaluate((email) => { window.__members = [email]; }, email);
    await authSignIn(app.page, { id, email, row: null });
    await app.page.evaluate(async ({ goal, flag }) => {
        EQ_SESSIONS_ENABLED = flag;                 // this page only, never persisted
        selectGoal(goal); finishOnboarding();
        await new Promise(r => setTimeout(r, 1200));
    }, { goal, flag });
}

/** Everything Today and the Ready screen say, read as written. */
const today = (page) => page.evaluate(() => {
    const t = (id) => { const e = document.getElementById(id); return e ? (e.textContent || '').trim().replace(/\s+/g, ' ') : null; };
    const shown = (id) => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden'); };
    const card = document.getElementById('hq-today-card');
    return {
        state: card.dataset.state, headline: t('today-headline'), sub: shown('today-sub') ? t('today-sub') : '',
        cta: t('launch-btn'), ctaShown: shown('launch-btn'),
        /* What the member can SEE: innerText leaves out anything display:none, such as the
           resolver's own reason line, which the card suppresses on a plain training day. */
        cardText: (card.innerText || '').trim().replace(/\s+/g, ' '),
        summary: shown('today-complete-summary') ? (document.getElementById('today-complete-summary').innerText || '').trim().replace(/\s+/g, ' ') : '',
        strip: [...document.querySelectorAll('#hq-week-strip .week-cell')].map(c => ({
            weekday: Number(c.dataset.weekday), aria: c.getAttribute('aria-label'), title: c.title || '', substituted: c.dataset.substituted === '1' })),
        week: (() => { const w = currentWeekCompletion(); return { completed: w.completed, target: w.target }; })(),
        authoritative: onAuthoritativePlans(),
    };
});

/** Tap Start, answer the readiness check, and read the Ready screen before going on. */
async function openReady(page) {
    return page.evaluate(() => {
        document.getElementById('launch-btn').click();
        document.querySelector('#soreness-btns [data-soreness="none"]').click();
        document.querySelector('#sleep-btns [data-sleep="good"]').click();
        const t = (id) => (document.getElementById(id).textContent || '').trim().replace(/\s+/g, ' ');
        return { step: document.querySelector('.step-content.active-step')?.id, planned: t('ready-planned'),
                 cta: t('ready-cta'), ctaDisabled: document.getElementById('ready-cta').disabled };
    });
}

/** Do the work the way a member does: from Ready, finish each set, skip the rests, end on the summary. */
const performSession = (page) => page.evaluate(() => {
    document.getElementById('ready-cta').click();
    _sessionStartTime = Date.now() - 6e5; selectedEQ = 8; selectedRPE = 5;
    const routine = session.routineType, titles = []; let last = '';
    for (let i = 0; i < 900; i++) {
        const ex = getCurEx(); if (ex && ex.title !== last) { titles.push(ex.title); last = ex.title; }
        if (session.timer) { session.timer.cancel(); session.timer = null; }
        onSetDone();
        if (!document.getElementById('rest-overlay').classList.contains('hidden')) skipRest();
        const s5 = document.getElementById('step-5');
        if (s5 && !s5.classList.contains('hidden-step')) break;
    }
    return { routine, titles, atSummary: !document.getElementById('step-5').classList.contains('hidden-step') };
});
const finish = (page) => page.evaluate(() => {
    finishSession(); closeSessionSummary();
    const e = persisted.sessionLog.at(-1);
    return { n: persisted.sessionLog.length, xp: persisted.totalXp, count: persisted.allTimeSessionCount,
             entry: { routineType: e.routineType, scheduledType: e.scheduledType, xpEarned: e.xpEarned, pelvicCare: e.pelvicCare,
                      prescriptionDate: e.prescriptionDate, completedPractice: e.pelvicPractice && e.pelvicPractice.completedIndices },
             ledger: JSON.stringify(persisted.progressionLedger), records: JSON.stringify(persisted.records) };
});
const snapshot = (page) => page.evaluate(() => ({
    n: persisted.sessionLog.length, xp: persisted.totalXp, count: persisted.allTimeSessionCount,
    ledger: JSON.stringify(persisted.progressionLedger), records: JSON.stringify(persisted.records),
}));

/** The row a second device would read back, in the server's own column names. */
const rowFor = (page, id) => page.evaluate((id) => {
    const p = _buildSavePayload(); p.sync_meta = p._sync_meta; delete p._sync_meta; return { id, ...p };
}, id);

/** Is anything on the page wider than the phone? */
const overflow = (page) => page.evaluate(() => {
    const btn = document.getElementById('launch-btn');
    return { page: document.documentElement.scrollWidth - window.innerWidth,
             cta: btn && !btn.classList.contains('hidden') ? btn.scrollWidth - btn.clientWidth : 0 };
});

// ═══ 1 and 2. The whole session day, for a new buyer ══════════════════════
describe('an EQ session day, from the Today card to done (new buyer, phone viewport)', () => {
    let app, before, ready, ran, after, done, snapBefore, member;
    beforeAll(async () => {
        app = await openApp({ row: null, clock: SUN, timezoneId: 'UTC' });
        await newMember(app, { goal: 'eq' });
        member = await app.page.evaluate(() => ({ goal: persisted.primaryGoal, schedule: persisted.schedule.slice() }));
        before = await today(app.page);
        snapBefore = await snapshot(app.page);
        ready = await openReady(app.page);
        ran = await performSession(app.page);
        done = await finish(app.page);
        after = await today(app.page);
    }, 120_000);
    afterAll(async () => { await app?.close(); });

    test('the member is on the EQ week, on dated plans, with a session to do', () => {
        expect(member).toEqual({ goal: 'eq', schedule: ['stamina', 'rest', 'rest', 'stamina', 'rest', 'stamina', 'rest'] });
        expect(before.authoritative).toBe(true);
        expect(before.state).toBe('TRAIN');
    });

    // ── The words ──────────────────────────────────────────────────────────

    test('the Today card calls the day Erection Quality: headline, focus and Start button', () => {
        expect({ headline: before.headline, sub: before.sub, cta: before.cta }).toEqual({ headline: EQ.headline, sub: EQ.sub, cta: EQ.cta });
    });

    test('nothing on the card calls the work stamina', () => {
        expect(before.cardText).not.toMatch(/stamina/i);
    });

    test('the Ready screen names the same work, and its button says so', () => {
        expect(ready.step).toBe('step-1');
        expect(ready.planned).toBe(EQ.ready);
        expect(ready.ctaDisabled).toBe(false);
        expect(ready.cta).toBe(EQ.cta);
    });

    test('the member does the three EQ steps and reaches the summary', () => {
        expect(ran.routine).toBe('eq');
        expect(ran.titles).toEqual(['Diaphragmatic breathing', 'Pelvic Floor Release', 'Cat-Cow']);
        expect(ran.atSummary).toBe(true);
    });

    // ── The state ──────────────────────────────────────────────────────────

    test('AFTER THE PRESCRIBED SESSION TODAY READS COMPLETE, not another stamina session', () => {
        expect(after.state).toBe('COMPLETE');
        expect(after.ctaShown, 'a finished day must not offer Start again').toBe(false);
    });

    test('and says the day is done, not "Recovery Complete"', () => {
        expect(after.headline).toBe('Today Is Done');
        expect(after.cardText).not.toMatch(/recovery complete/i);
        expect(after.cardText).not.toMatch(/stamina/i);
    });

    test('the week and Today agree: one session done', () => {
        expect(after.week.completed).toBe(before.week.completed + 1);
    });

    test('the week strip names the day in Erection Quality terms and does not call it a substitution', () => {
        const cell = (t) => t.strip.find(c => c.weekday === 0);
        expect(cell(before).aria).toBe('Today, Erection Quality');
        expect(cell(after).aria).toBe('Today, Erection Quality, done');
        expect(cell(after).substituted, 'the amber "instead of" mark on the day the plan asked for it').toBe(false);
        expect(cell(after).title).toBe('');
        for (const t of [before, after]) expect(t.strip.map(c => c.aria).join(' | ')).not.toMatch(/stamina/i);
    });

    test('the finished day names what comes next in Erection Quality terms', () => {
        expect(after.summary).toMatch(/Next up/i);
        expect(after.summary).toMatch(/WED · Erection Quality/);
        expect(after.summary).not.toMatch(/stamina/i);
    });

    // ── What did not change ────────────────────────────────────────────────

    test('completion, XP, history and progression are exactly what they were', () => {
        expect(done.n).toBe(snapBefore.n + 1);
        expect(done.count).toBe(snapBefore.count + 1);
        // EQ sessions are recovery content: the recovery award, once.
        expect(done.entry.xpEarned).toBe(5);
        expect(done.xp).toBe(snapBefore.xp + 5);
        expect(done.entry).toMatchObject({ routineType: 'eq', scheduledType: 'stamina', pelvicCare: true });
        // An EQ session is not mechanical work, so the progression ledger does not move...
        expect(done.ledger).toBe(snapBefore.ledger);
        // ...and the records move exactly as they always did for a first 5 XP session.
        expect(JSON.parse(snapBefore.records)).toEqual({ longestStreak: 0, bestWeekXp: 0, bestSessionXp: 0 });
        expect(JSON.parse(done.records)).toEqual({ longestStreak: 0, bestWeekXp: 5, bestSessionXp: 5 });
    });

    test('the daily practice is credited by the session, not asked for again', () => {
        expect(done.entry.completedPractice).toEqual([8, 2]);
    });

    test('no uncaught page errors', () => { expect(app.errors).toEqual([]); });
});

// ═══ 1, returning. A second device, then the days after ═══════════════════
describe('a returning EQ member: another device, then the next days', () => {
    let row;
    beforeAll(async () => {
        const first = await openApp({ row: null, clock: SUN, timezoneId: 'UTC' });
        await newMember(first, { goal: 'eq' });
        await openReady(first.page); await performSession(first.page); await finish(first.page);
        row = await rowFor(first.page, 'NEW1');
        await first.close();
    }, 120_000);

    /** A member who has been here before, on a device that has been set up already. */
    async function returning(clock) {
        const app = await openApp({ row: null, clock, timezoneId: 'UTC' });
        await app.page.evaluate(() => {
            EQ_SESSIONS_ENABLED = true;             // before sign-in, as on a device that already has the build
            window.__members = ['new@example.com'];
            localStorage.setItem('bp_welcomed_NEW1', '1'); localStorage.setItem('bp_onboarded_NEW1', '1');
        });
        await authSignIn(app.page, { id: 'NEW1', email: 'new@example.com', row });
        await app.page.waitForTimeout(600);
        return app;
    }

    test('the same day on a new device: still COMPLETE, read from the saved log', async () => {
        const app = await returning(SUN);
        try {
            const t = await today(app.page);
            expect(t.state).toBe('COMPLETE');
            expect(t.headline).toBe('Today Is Done');
            expect(t.ctaShown).toBe(false);
        } finally { await app.close(); }
    }, 90_000);

    test('Monday is a supporting day: not complete, no session offered, nothing called stamina', async () => {
        const app = await returning(MON);
        try {
            const t = await today(app.page);
            expect(['REST', 'SUPPORT_ONLY']).toContain(t.state);
            expect(t.ctaShown).toBe(false);
            expect(t.cardText).not.toMatch(/stamina/i);
        } finally { await app.close(); }
    }, 90_000);

    test('Wednesday offers the next EQ session in EQ words; Sunday\'s session does not carry over', async () => {
        const app = await returning(WED);
        try {
            const t = await today(app.page);
            expect(t.state).toBe('TRAIN');
            expect({ headline: t.headline, sub: t.sub, cta: t.cta }).toEqual({ headline: EQ.headline, sub: EQ.sub, cta: EQ.cta });
            const r = await openReady(app.page);
            const ran = await performSession(app.page);
            expect(ran.routine).toBe('eq');
            expect(r.planned).toBe(EQ.ready);
            await finish(app.page);
            const after = await today(app.page);
            expect(after.state).toBe('COMPLETE');
            expect(after.headline).toBe('Today Is Done');
            expect(after.week.completed).toBe(1);        // Wednesday opens a new ISO week: Sunday's session was last week's
        } finally { await app.close(); }
    }, 90_000);

    test('Friday, with Sunday done and Wednesday not: the Friday session is still offered', async () => {
        const app = await returning(FRI);
        try {
            const t = await today(app.page);
            expect(t.state).toBe('TRAIN');
            expect(t.cta).toBe(EQ.cta);
        } finally { await app.close(); }
    }, 90_000);
});

// ═══ 2, phones. The longer words must fit ═════════════════════════════════
describe('the Erection Quality words fit a phone', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ row: null, clock: SUN, timezoneId: 'UTC' });
        await newMember(app, { goal: 'eq' });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test.each([[390, 844], [360, 740], [320, 568]])('nothing is wider than a %i px phone, and the Start button holds its text', async (w, h) => {
        await app.page.setViewportSize({ width: w, height: h });
        await app.page.evaluate(() => { goToStep(0); renderDashboard(); });
        await app.page.waitForTimeout(150);
        const o = await overflow(app.page);
        expect(o.page, `page is ${o.page}px wider than the screen`).toBeLessThanOrEqual(0);
        expect(o.cta, `the button text overflows by ${o.cta}px`).toBeLessThanOrEqual(0);
        const t = await today(app.page);
        expect(t.cta).toBe(EQ.cta);
    });

    test('and the Ready screen button does too', async () => {
        for (const [w, h] of [[390, 844], [320, 568]]) {
            await app.page.setViewportSize({ width: w, height: h });
            await app.page.evaluate(() => { goToStep(0); renderDashboard(); });
            await openReady(app.page);
            const o = await app.page.evaluate(() => { const b = document.getElementById('ready-cta'); return { page: document.documentElement.scrollWidth - window.innerWidth, cta: b.scrollWidth - b.clientWidth, text: b.textContent.trim() }; });
            expect(o.text).toBe(EQ.cta);
            expect(o.page, `${w}px: page is wider than the screen`).toBeLessThanOrEqual(0);
            expect(o.cta, `${w}px: button text overflows`).toBeLessThanOrEqual(0);
            await app.page.evaluate(() => goToStep(0));
        }
    });
});

// ═══ 2, preserved. Everyone else keeps their own words and completion ═════
describe('Stamina, All of It and Size members keep their own words and completion (flag on)', () => {
    test.each([
        ['stamina', SUN, STAMINA, 'stamina'],
        ['all', WED, STAMINA, 'stamina'],          // All of It trains Stamina on Wednesday
        ['all', SUN, LENGTH, 'length'],
        ['size', SUN, LENGTH, 'length'],
    ])('%s member, %s: %j', async (goal, clock, words, routine) => {
        const app = await openApp({ row: null, clock, timezoneId: 'UTC' });
        try {
            await newMember(app, { goal });
            const before = await today(app.page);
            expect({ headline: before.headline, sub: before.sub, cta: before.cta }).toEqual({ headline: words.headline, sub: words.sub, cta: words.cta });
            const ready = await openReady(app.page);
            expect(ready.planned).toBe(words.ready);
            expect(ready.cta).toBe(words.cta);
            const ran = await performSession(app.page);
            expect(ran.routine).toBe(routine);
            const done = await finish(app.page);
            expect(done.entry.routineType).toBe(routine);
            const after = await today(app.page);
            expect(after.state).toBe('COMPLETE');
            expect(after.headline).toBe('Today Is Done');
            expect(app.errors).toEqual([]);
        } finally { await app.close(); }
    }, 120_000);
});

describe('with EQ switched off (what ships today) an EQ-goal member sees exactly what shipped', () => {
    test('Stamina words, the legacy stamina routine, and a completed day', async () => {
        const app = await openApp({ row: null, clock: SUN, timezoneId: 'UTC' });
        try {
            await newMember(app, { goal: 'eq', flag: false });
            expect(await app.page.evaluate(() => EQ_SESSIONS_ENABLED)).toBe(false);
            const before = await today(app.page);
            expect({ headline: before.headline, sub: before.sub, cta: before.cta }).toEqual({ headline: STAMINA.headline, sub: STAMINA.sub, cta: STAMINA.cta });
            expect((await openReady(app.page)).planned).toBe(STAMINA.ready);
            const ran = await performSession(app.page);
            expect(ran.routine).toBe('stamina');
            await finish(app.page);
            expect((await today(app.page)).state).toBe('COMPLETE');
        } finally { await app.close(); }
    }, 120_000);
});

// ═══ 3. Full rest ═════════════════════════════════════════════════════════
describe('a full-rest day says so, and does not suggest anything failed to load', () => {
    const NOTE = 'Full rest today. Nothing is asked of you, and recovery is part of the plan.';
    const ERROR = 'Daily practice could not be read. No extra work is assigned.';
    const card = (page) => page.evaluate(() => {
        const shown = (id) => !document.getElementById(id).classList.contains('hidden');
        return { shown: shown('daily-pelvic-card'), note: document.getElementById('daily-pelvic-note').textContent.trim(),
                 start: shown('daily-pelvic-start'), busy: shown('daily-pelvic-busy'), details: shown('daily-pelvic-details'),
                 review: shown('daily-pelvic-review'), state: document.getElementById('hq-today-card').dataset.state,
                 overflow: document.documentElement.scrollWidth - window.innerWidth };
    });
    /** Make the practice plan unreadable, the way a real fault would: the builder is not there. */
    const withoutBuilder = (page, fn) => page.evaluate(async (src) => {
        const saved = window.BP;
        window.BP = { ...saved, buildPelvicPracticePlan: undefined };
        try { renderDashboard(); return await eval(`(${src})()`); } finally { window.BP = saved; renderDashboard(); }
    }, fn.toString());

    test('Tuesday: a clear, positive message, no practice offered, and nothing about an error', async () => {
        const app = await openApp({ row: null, clock: TUE, timezoneId: 'UTC' });
        try {
            await newMember(app, { goal: 'eq' });
            const c = await card(app.page);
            expect(c.state).toBe('REST');
            expect(c.shown).toBe(true);
            expect(c.note).toBe(NOTE);
            expect(c.note).not.toMatch(/could not be read/i);
            expect([c.start, c.busy, c.details, c.review]).toEqual([false, false, false, false]);
            expect(c.overflow).toBeLessThanOrEqual(0);
            await app.page.setViewportSize({ width: 320, height: 568 });
            await app.page.evaluate(() => renderDashboard());
            expect((await card(app.page)).overflow).toBeLessThanOrEqual(0);
            expect(app.errors).toEqual([]);
        } finally { await app.close(); }
    }, 90_000);

    test('Saturday reads the same, as a returning member on a new device', async () => {
        const first = await openApp({ row: null, clock: TUE, timezoneId: 'UTC' });
        let row;
        try { await newMember(first, { goal: 'eq' }); row = await rowFor(first.page, 'NEW1'); } finally { await first.close(); }
        const app = await openApp({ row: null, clock: at('2026-11-28T10:00:00Z'), timezoneId: 'UTC' });
        try {
            await app.page.evaluate(() => { EQ_SESSIONS_ENABLED = true; window.__members = ['new@example.com']; localStorage.setItem('bp_welcomed_NEW1', '1'); localStorage.setItem('bp_onboarded_NEW1', '1'); });
            await authSignIn(app.page, { id: 'NEW1', email: 'new@example.com', row });
            await app.page.waitForTimeout(600);
            const c = await card(app.page);
            expect(c.state).toBe('REST');
            expect(c.note).toBe(NOTE);
        } finally { await app.close(); }
    }, 120_000);

    test('a supporting day is not a rest day: Monday still offers the practice', async () => {
        const app = await openApp({ row: null, clock: MON, timezoneId: 'UTC' });
        try {
            await newMember(app, { goal: 'eq' });
            const c = await card(app.page);
            expect(c.shown).toBe(true);
            expect(c.start).toBe(true);
            expect(c.note).toMatch(/Breathing, release/);
            expect(c.note).not.toBe(NOTE);
        } finally { await app.close(); }
    }, 90_000);

    test('a plan that genuinely cannot be read still says so, on a day that asks for practice', async () => {
        const app = await openApp({ row: null, clock: MON, timezoneId: 'UTC' });
        try {
            await newMember(app, { goal: 'eq' });
            const c = await withoutBuilder(app.page, () => ({
                note: document.getElementById('daily-pelvic-note').textContent.trim(),
                shown: !document.getElementById('daily-pelvic-card').classList.contains('hidden'),
            }));
            expect(c.shown).toBe(true);
            expect(c.note).toBe(ERROR);
        } finally { await app.close(); }
    }, 90_000);

    test('other goals\' rest days are unchanged: practice offered, no full-rest message', async () => {
        const app = await openApp({ row: null, clock: TUE, timezoneId: 'UTC' });
        try {
            await newMember(app, { goal: 'size' });              // Tuesday is a rest day in the Size week
            const c = await card(app.page);
            expect(c.state).toBe('REST');
            expect(c.note).not.toBe(NOTE);
            expect(c.note).not.toMatch(/could not be read/i);
            expect(c.start).toBe(true);
        } finally { await app.close(); }
    }, 90_000);

    test('pain still outranks everything: a reported pain pause is shown on a full-rest day too', async () => {
        const app = await openApp({ row: null, clock: TUE, timezoneId: 'UTC' });
        try {
            await newMember(app, { goal: 'eq' });
            const c = await app.page.evaluate(() => {
                persisted.sessionLog = [{ date: new Date().toISOString(), routineType: 'recovery', pelvicCare: true,
                    pelvicPractice: { v: 1, date: window.BP.planDateKey(new Date()), mode: 'daily', completedIndices: [8], feedback: 'painful' } }];
                try { localStorage.removeItem(pelvicReviewKey()); } catch (e) {}
                renderDashboard();
                return { note: document.getElementById('daily-pelvic-note').textContent.trim(),
                         review: !document.getElementById('daily-pelvic-review').classList.contains('hidden') };
            });
            expect(c.note).toMatch(/^You reported pain\. Pause pelvic exercises\./);
            expect(c.review).toBe(true);
        } finally { await app.close(); }
    }, 90_000);
});
