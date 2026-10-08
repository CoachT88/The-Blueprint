import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * The WeekStrip, through the real HQ.
 *
 * tests/weekStrip.test.js proves the view model. This proves the things it
 * cannot: that renderDashboard paints seven real cells from it, that the
 * interaction boundary between the two cohorts actually holds in the DOM, and
 * that "Next up" after a real finished session reads dated plans rather than
 * walking the recurring column round the end of the week.
 *
 * The clock is pinned wherever the answer depends on the day, because a strip
 * is entirely about where today sits and a suite that runs on a Tuesday must
 * not prove something different on a Sunday.
 */

/* 2026-03-12 is a Thursday, 2026-03-15 the Sunday that ends its ISO week. */
const THURSDAY = new Date(Date.UTC(2026, 2, 12, 12));
const SUNDAY   = new Date(Date.UTC(2026, 2, 15, 12));
const SIZE     = ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'];

const row = (over = {}) => ({
    id: 'ws', total_xp: 500, difficulty: 'intermediate',
    schedule: SIZE, completed_days: [false, false, false, false, false, false, false],
    session_log: [], measurements: [], seen_milestones: [],
    all_time_session_count: 20, xp_migrated: true, week_key: '',
    primary_goal: 'size', programme: null, day_plans: [],
    updated_at: '2026-03-12T00:00:00.000Z',
    ...over,
});

/**
 * Load a server row through the real loadPersisted, then render once.
 *
 * The local backup is cleared first, and that is not tidiness. loadPersisted
 * compares the server row's updated_at against the localStorage copy and
 * keeps whichever is newer, which is correct: it is what stops a stale server
 * read overwriting work done offline. It also means a second load in the same
 * page silently keeps the FIRST fixture, because rendering saved a backup
 * stamped now. One of these tests spent a while proving the opposite of what
 * it said for exactly that reason.
 */
const load = (page, serverRow) => page.evaluate(async (r) => {
    try { localStorage.removeItem('bp_data_' + currentUser.id); } catch (e) {}
    window.__row = r;
    await loadPersisted();
    renderDashboard();
    return window.__weekStrip();
}, serverRow);

describe('seven cells, the member\'s week, Monday first', () => {
    let app, strip;
    beforeAll(async () => {
        app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ws', loaded: false });
        strip = await load(app.page, row());
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('it renders, and it is the only weekly surface left', async () => {
        expect(strip.exists).toBe(true);
        const gone = await app.page.evaluate(() => ['dashboard-grid', 'hq-week-dots',
            'hq-stat-chips', 'hq-calendar-card'].filter(id => !!document.getElementById(id)));
        expect(gone).toEqual([]);
    });

    test('Monday is leftmost and Sunday is last', () => {
        /* The storage column is Sunday-indexed because notifyRules needs it
           to be. Rendering in storage order put the ISO week's LAST day in
           the leftmost cell, so a future Sunday sat to the left of today on
           six days out of seven. */
        expect(strip.order).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
        expect(strip.days.map(d => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    });

    test('the dates are consecutive and are the member\'s own calendar dates', () => {
        expect(strip.days.map(d => d.date)).toEqual([
            '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12',
            '2026-03-13', '2026-03-14', '2026-03-15',
        ]);
    });

    test('exactly one cell is today, and it is the right one', () => {
        const today = strip.days.filter(d => d.today);
        expect(today).toHaveLength(1);
        expect(today[0].name).toBe('THU');
        expect(today[0].date).toBe('2026-03-12');
    });

    test('past and future are marked, and today is neither', () => {
        expect(strip.days.filter(d => d.past).map(d => d.name)).toEqual(['MON', 'TUE', 'WED']);
        const today = strip.days.find(d => d.today);
        expect(today.past).toBe(false);
    });

    test('the member really is on dated plans, generated from today', () => {
        /* Everything below describes the authoritative cohort, so the
           fixture has to actually be one rather than be assumed to be. */
        expect(strip.authority).toBe('programme');
    });
});

describe('the four states, and nothing resembling a fifth', () => {
    let app, strip;
    beforeAll(async () => {
        app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ws', loaded: false });
        strip = await load(app.page, row());
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    const cell = (name) => strip.days.find(d => d.name === name);

    test('every cell is one of exactly four states', () => {
        const allowed = ['satisfied', 'pending', 'rest', 'unknown'];
        for (const d of strip.days) expect(allowed, d.name).toContain(d.state);
    });

    test('a prescribed training day reads as pending, with its own colour', () => {
        /* Thursday is girth in the size week, and the plan for it was
           generated at cutover. */
        expect(cell('THU').state).toBe('pending');
        expect(cell('THU').cls).toContain('type-girth');
        expect(cell('THU').icon).toContain('fa-expand');
        expect(cell('THU').aria).toBe('Today, Girth');
    });

    test('a prescribed rest day reads as rest and never as unfinished', () => {
        /* THE RULE. Rest was prescribed and resting met it, so the cell must
           borrow nothing from the day that still owes a session. It carries
           no tick, because there was nothing to satisfy, and it is not the
           pending treatment either. */
        const fri = cell('FRI');
        expect(fri.state).toBe('rest');
        expect(fri.cls).toContain('type-rest');
        expect(fri.icon).toContain('fa-bed');
        expect(fri.aria).toBe('FRI, rest day');
        expect(fri.state).not.toBe('pending');
    });

    test('a date with no attributable plan reads as unknown, not as rest', () => {
        /* The midweek-cutover case. Generation starts at today, so Monday
           through Wednesday have no plan at all. Calling them rest would
           suppress a notification for a day nobody prescribed, and calling
           them pending would invent a session the member owes. */
        for (const name of ['MON', 'TUE', 'WED']) {
            const d = cell(name);
            expect(d.state, name).toBe('unknown');
            expect(d.cls, name).toContain('type-unknown');
            expect(d.icon, name).toContain('fa-minus');
            expect(d.aria, name).toBe(`${name}, nothing planned`);
        }
    });

    test('a past unsatisfied day is pending, with no missed treatment anywhere', async () => {
        /* There is deliberately no MISSED state. A past unfinished day says
           the same thing as a future planned one without a fifth visual
           language and without the strip passing a judgement the day may not
           deserve. Monday here has a plan AND nothing logged against it. */
        const s = await load(app.page, row({
            day_plans: [
                { date: '2026-03-09', mode: 'prescribed',
                  primarySession: { type: 'length', title: 'Length', durationSec: 900 } },
            ],
            programme: {
                key: 'size', version: 1, adoptedAt: '2026-03-09', custom: false,
                cyclePosition: null,
                migration: { source: 'preset', presetKey: 'size',
                             reason: 'preset_shape_matches_stated_goal',
                             classifiedAt: '2026-03-09' },
            },
        }));
        const mon = s.days.find(d => d.name === 'MON');
        expect(mon.past).toBe(true);
        expect(mon.state).toBe('pending');
        expect(mon.aria).toBe('MON, Length');
        expect(JSON.stringify(s)).not.toMatch(/missed/i);
    });

    test('an unreadable stored plan is unknown, and is never repaired into one', async () => {
        const s = await load(app.page, row({
            day_plans: [{ date: '2026-03-12', mode: 'who knows',
                          primarySession: { type: 'girth' } }],
            programme: {
                key: 'size', version: 1, adoptedAt: '2026-03-09', custom: false,
                cyclePosition: null,
                migration: { source: 'preset', presetKey: 'size',
                             reason: 'preset_shape_matches_stated_goal',
                             classifiedAt: '2026-03-09' },
            },
        }));
        const thu = s.days.find(d => d.name === 'THU');
        expect(thu.state).toBe('unknown');
        /* And the record is still there. A corrupt Today is preserved rather
           than replaced; see the retention rules. */
        const kept = await app.page.evaluate(() => persisted.dayPlans.map(p => p.mode));
        expect(kept).toContain('who knows');
    });

    test('nothing threw across any of it', () => {
        expect(app.errors).toEqual([]);
    });
});

describe('a finished session marks its own day and no other', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ws', loaded: false });
        await load(app.page, row());
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('through the real finishSession, Thursday ticks and the label moves', async () => {
        /* The REAL session path, not a seeded log entry: the point is that
           what the member does writes the thing the strip reads. */
        const after = await app.page.evaluate(() => {
            session.routineType = 'girth';
            _sessionStartTime = Date.now() - 30 * 60000;
            selectedEQ = 8; selectedRPE = 5;
            document.getElementById('input-bpel').value = '';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = '';
            finishSession();
            closeSessionSummary();
            renderDashboard();
            return window.__weekStrip();
        });
        const thu = after.days.find(d => d.name === 'THU');
        expect(thu.state).toBe('satisfied');
        expect(thu.aria).toBe('Today, Girth, done');
        /* One day, not the week. Sunday is the other training day and it is
           still owed. */
        expect(after.satisfied).toBe(1);
        expect(after.days.find(d => d.name === 'SUN').state).toBe('pending');
        expect(after.label).toBe('1 of 2 this week');
        expect(after.complete).toBe(false);
    }, 60_000);

    test('and finishing the second one completes the week, quietly', async () => {
        const after = await app.page.evaluate(() => {
            /* Sunday's session, logged on Sunday's date. weekCompletion
               cross-checks the log by date, so this is the honest way to say
               "the other prescribed session happened". */
            persisted.sessionLog.push({ date: '2026-03-15T12:00:00.000Z',
                routineType: 'length', duration: 30 });
            renderDashboard();
            return window.__weekStrip();
        });
        expect(after.satisfied).toBe(2);
        expect(after.label).toBe('Week complete · 2 of 2');
        expect(after.complete).toBe(true);
        /* Rest days are still rest. Completing the week does not tick them. */
        expect(after.days.filter(d => d.state === 'rest')).toHaveLength(2);
        expect(app.errors).toEqual([]);
    }, 60_000);
});

/**
 * THE INTERACTION BOUNDARY.
 *
 *   authoritative  the strip is orientation. Nothing on it is a control.
 *   legacy/custom  their column IS their programme, so nothing is withdrawn.
 *
 * This is the part of the phase that is easy to get wrong by being helpful:
 * leaving a tap in place for the first cohort would let them edit a derived
 * projection, and the next load would overwrite the edit in front of them.
 */
describe('an authoritative strip is orientation, not a control', () => {
    let app, strip;
    beforeAll(async () => {
        app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ws', loaded: false });
        strip = await load(app.page, row());
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('no cell is a button, a tab stop, or offers a pointer', () => {
        expect(strip.authority).toBe('programme');
        for (const d of strip.days) {
            expect(d.role, d.name).toBe(null);
            expect(d.tabbable, d.name).toBe(false);
        }
    });

    test('clicking a cell opens nothing', async () => {
        const r = await app.page.evaluate(async () => {
            const cell = document.querySelector('#hq-week-strip .week-cell');
            cell.click();
            return {
                modal: document.getElementById('type-modal').classList.contains('hidden'),
                schedule: persisted.schedule.join(','),
            };
        });
        expect(r.modal).toBe(true);                    // still hidden
        expect(r.schedule).toBe(SIZE.join(','));       // and nothing written
    });

    test('pressing Enter on a cell opens nothing either', async () => {
        const open = await app.page.evaluate(() => {
            const cell = document.querySelector('#hq-week-strip .week-cell');
            cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            return !document.getElementById('type-modal').classList.contains('hidden');
        });
        expect(open).toBe(false);
    });

    test('no cell offers a completion control of any kind', () => {
        /* Generic manual completion is the specific thing that must not be
           exposed here: a tick with nothing behind it would make the strip
           assert a prescribed session was satisfied when no session happened. */
        for (const d of strip.days) {
            expect(d.aria, d.name).not.toMatch(/mark|complete|tick|tap/i);
        }
    });

    test('and the modal it used to open withholds both writers', async () => {
        const r = await app.page.evaluate(() => {
            openDayModal(4);
            const hidden = id => document.getElementById(id).classList.contains('hidden');
            return { types: hidden('type-modal-types'), toggle: hidden('modal-toggle-btn'),
                     note: !hidden('type-modal-locked') };
        });
        expect(r.types).toBe(true);
        expect(r.toggle).toBe(true);
        expect(r.note).toBe(true);
    });
});

describe('a legacy strip keeps every bit of its editing', () => {
    let app, strip;
    beforeAll(async () => {
        app = await openApp({ clock: THURSDAY, timezoneId: 'UTC' });
        /* signIn seeds the classified-custom sentinel, which is what a member
           whose column IS their programme looks like. */
        await signIn(app.page, { id: 'ws' });
        strip = await app.page.evaluate(() => {
            persisted.schedule = ['girth', 'girth', 'rest', 'girth', 'rest', 'stamina', 'rest'];
            persisted.completedDays = [false, false, false, false, false, false, false];
            persisted.sessionLog = [];
            renderDashboard();
            return window.__weekStrip();
        });
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('their column is still the prescription, slot for slot', () => {
        expect(strip.authority).toBe('legacy');
        /* Sunday-indexed column, Monday-first strip, and the mapping has to
           be right in both directions. */
        expect(strip.bySunday).toMatchObject({
            0: 'pending',  // Sun girth
            1: 'pending',  // Mon girth
            2: 'rest',
            3: 'pending',  // Wed girth
            4: 'rest',
            5: 'pending',  // Fri stamina
            6: 'rest',
        });
        expect(strip.days.find(d => d.name === 'FRI').cls).toContain('type-stamina');
    });

    test('every cell is a button and a tab stop', () => {
        for (const d of strip.days) {
            expect(d.role, d.name).toBe('button');
            expect(d.tabbable, d.name).toBe(true);
        }
    });

    test('clicking Wednesday opens the day picker on Wednesday, with types', async () => {
        const r = await app.page.evaluate(() => {
            const cell = [...document.querySelectorAll('#hq-week-strip .week-cell')]
                .find(c => Number(c.dataset.weekday) === 3);
            cell.click();
            return {
                open: !document.getElementById('type-modal').classList.contains('hidden'),
                idx: session.selectedDayIdx,
                types: !document.getElementById('type-modal-types').classList.contains('hidden'),
                toggle: !document.getElementById('modal-toggle-btn').classList.contains('hidden'),
            };
        });
        /* The index is the Sunday-indexed weekday, which is what
           persisted.schedule is indexed by. A Monday-first position would
           have opened the wrong day. */
        expect(r.idx).toBe(3);
        expect(r.open).toBe(true);
        expect(r.types).toBe(true);
        expect(r.toggle).toBe(true);
    });

    test('and assigning a type from there really changes their week', async () => {
        const after = await app.page.evaluate(() => {
            assignDay('stamina');
            return { slot: persisted.schedule[3], strip: window.__weekStrip() };
        });
        expect(after.slot).toBe('stamina');
        expect(after.strip.days.find(d => d.name === 'WED').cls).toContain('type-stamina');
    });

    test('the keyboard path works too', async () => {
        const r = await app.page.evaluate(() => {
            closeModal();
            const cell = [...document.querySelectorAll('#hq-week-strip .week-cell')]
                .find(c => Number(c.dataset.weekday) === 5);
            cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            return { open: !document.getElementById('type-modal').classList.contains('hidden'),
                     idx: session.selectedDayIdx };
        });
        expect(r.open).toBe(true);
        expect(r.idx).toBe(5);
    });

    test('and the completion tick still writes, because it always has', async () => {
        const r = await app.page.evaluate(() => {
            session.selectedDayIdx = 6;
            const before = persisted.completedDays[6];
            toggleDayCompletion();
            return { before, after: persisted.completedDays[6] };
        });
        expect(r.before).toBe(false);
        expect(r.after).toBe(true);
        expect(app.errors).toEqual([]);
    });
});

/**
 * "NEXT UP", AND THE SUNDAY THAT USED TO LIE.
 *
 * The old surface walked the seven-slot column and wrapped. Asked on a
 * Sunday it read index 0 again and announced whatever the recurring week
 * prescribed, which for a member on dated plans is an answer with no plan
 * behind it. It sounded plausible, because a week repeats.
 */
describe('Next up on a Sunday reads the week that was generated', () => {
    let app;
    beforeAll(async () => {
        app = await openApp({ clock: SUNDAY, timezoneId: 'UTC' });
        await signIn(app.page, { id: 'ws', loaded: false });
        await load(app.page, row({ updated_at: '2026-03-15T00:00:00.000Z' }));
    }, 90_000);
    afterAll(async () => { await app?.close(); });

    test('the fixture really is a Sunday cutover with next week generated', async () => {
        const r = await app.page.evaluate(() => ({
            weekday: new Date().getDay(),
            key: persisted.programme && persisted.programme.key,
            dates: persisted.dayPlans.map(p => p.date),
        }));
        expect(r.weekday).toBe(0);
        expect(r.key).toBe('size');
        /* Generation reaches the end of NEXT ISO week, so from a Sunday that
           is today plus the whole following week. */
        expect(r.dates[0]).toBe('2026-03-15');
        expect(r.dates).toContain('2026-03-16');
        expect(r.dates[r.dates.length - 1]).toBe('2026-03-22');
    });

    test('it names Monday of the next week, from the plan that exists', async () => {
        const summary = await app.page.evaluate(() => {
            session.routineType = 'length';
            _sessionStartTime = Date.now() - 30 * 60000;
            selectedEQ = 8; selectedRPE = 5;
            document.getElementById('input-bpel').value = '';
            document.getElementById('input-mseg').value = '';
            document.getElementById('session-note-input').value = '';
            finishSession();
            closeSessionSummary();
            renderDashboard();
            return document.getElementById('today-complete-summary').textContent;
        });
        expect(summary).toContain('Next up');
        /* The size week is girth on Monday. The recurring column would have
           wrapped to index 0, which is 'length', so the two answers differ
           and the chip proves which source was read. */
        expect(summary).toContain('MON');
        expect(summary).toContain('Girth');
        expect(summary).not.toContain('Length · ');
    }, 60_000);

    test('with next week absent the chip is dropped, not invented', async () => {
        /* Same Sunday, same member, and the plans deliberately stop at
           today. The recurring column would still have answered here, which
           is exactly the manufactured answer this replaces. */
        const summary = await app.page.evaluate(() => {
            persisted.dayPlans = persisted.dayPlans.filter(p => p.date <= '2026-03-15');
            /* No renderDashboard here, deliberately: syncProgression would
               regenerate the week this test just removed, which is the
               generator doing its job and would hide what is being asked. */
            document.getElementById('today-complete-summary').innerHTML = completeSummaryHtml();
            return document.getElementById('today-complete-summary').textContent;
        });
        expect(summary).not.toContain('Next up');
        /* And the rest of the summary is still there, so this is a dropped
           chip rather than a broken surface. */
        expect(summary).toContain('This week');
        expect(app.errors).toEqual([]);
    }, 60_000);

    test('a legacy member still gets the recurring answer, because it is theirs', async () => {
        const summary = await app.page.evaluate(() => {
            persisted.programme = window.__legacyProgramme();
            persisted.dayPlans = [];
            persisted.schedule = ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'];
            renderDashboard();
            document.getElementById('today-complete-summary').innerHTML = completeSummaryHtml();
            return document.getElementById('today-complete-summary').textContent;
        });
        /* Sunday plus one is Monday, index 1, which is girth. For this cohort
           a recurring week is exactly what they were promised. */
        expect(summary).toContain('Next up');
        expect(summary).toContain('MON');
        expect(summary).toContain('Girth');
    }, 60_000);
});
