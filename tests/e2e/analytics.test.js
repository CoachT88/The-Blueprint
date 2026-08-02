import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * First-party funnel analytics. The privacy assertions matter more than the
 * funnel ones: this is a sexual-health app, and the promise made in the Manual
 * is that nothing a member types is ever recorded.
 *
 * The harness stub records inserts on window.__writes only for `user_data`
 * upserts, so these tests read the client-side buffer directly, which is the
 * exact object that would be sent.
 */
const buffer = (page) => page.evaluate(() => _analyticsBuffer.map(e => ({ ...e })));
const clear = (page) => page.evaluate(() => {
    _analyticsBuffer = [];
    try { localStorage.setItem(_analyticsKey(), '[]'); } catch (e) {}
});

describe('privacy guarantees', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'priv', email: 'someone@example.com' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('a completed session records numbers, never the note', async () => {
        await clear(app.page);
        await app.page.evaluate(() => {
            persisted.sessionLog = []; persisted.allTimeSessionCount = 0;
            session.routineType = 'length'; selectedEQ = 8; selectedRPE = 6;
            _sessionStartTime = Date.now() - 12e5;
            document.getElementById('input-bpel').value = '6.25';
            document.getElementById('input-mseg').value = '4.75';
            document.getElementById('session-note-input').value = 'felt a sharp pain on the left side today';
            finishSession();
        });
        const events = await buffer(app.page);
        const done = events.find(e => e.event === 'session_completed');

        expect(done).toBeTruthy();
        expect(done.props.mission).toBe('length');
        expect(done.props.eq).toBe(8);
        expect(done.props.rpe).toBe(6);
        expect(done.props.duration).toBeGreaterThan(0);

        const serialised = JSON.stringify(events);
        expect(serialised).not.toMatch(/sharp pain/);   // the note
        expect(serialised).not.toMatch(/6\.25/);        // the measurement
        expect(serialised).not.toMatch(/4\.75/);
        expect(serialised).not.toMatch(/example\.com/); // the email
    }, 40_000);

    test('asking Coach Tee records that it happened, never the question', async () => {
        await clear(app.page);
        await app.page.evaluate(() => {
            document.getElementById('coach-input').value = 'my erections have gotten weaker, is that serious';
            askCoach();
        });
        await app.page.waitForTimeout(300);
        const events = await buffer(app.page);
        expect(events.some(e => e.event === 'coach_asked')).toBe(true);
        expect(JSON.stringify(events)).not.toMatch(/erections/);
    }, 30_000);

    test('free text passed as a property is stripped, not stored', async () => {
        await clear(app.page);
        await app.page.evaluate(() => track('test_event', {
            ok: 5, flag: true, short: 'length',
            prose: 'this is a long sentence a member might have typed which should never be stored anywhere',
            nested: { note: 'secret' },
        }));
        const [e] = await buffer(app.page);
        expect(e.props).toEqual({ ok: 5, flag: true, short: 'length' });
        expect(JSON.stringify(e)).not.toMatch(/secret|long sentence/);
    });

    test('events carry the account UUID, never the email', async () => {
        const [e] = await buffer(app.page);
        expect(e.user_id).toBe('priv');
        expect(JSON.stringify(e)).not.toMatch(/@/);
    });

    test('nothing is recorded with no signed-in member', async () => {
        const count = await app.page.evaluate(() => {
            const saved = currentUser;
            currentUser = null;
            _analyticsBuffer = [];
            track('should_not_record');
            const n = _analyticsBuffer.length;
            currentUser = saved;
            return n;
        });
        expect(count).toBe(0);
    });
});

describe('buffering and delivery', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'buf' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('events buffer to localStorage so a reload does not lose them', async () => {
        await clear(app.page);
        await app.page.evaluate(() => { track('a'); track('b'); });
        const stored = await app.page.evaluate(() => JSON.parse(localStorage.getItem(_analyticsKey()) || '[]'));
        expect(stored.map(e => e.event)).toEqual(['a', 'b']);
    });

    test('a failed flush keeps events for the next attempt', async () => {
        const r = await app.page.evaluate(async () => {
            _analyticsBuffer = [];
            track('will_retry');
            const origFrom = sb.from.bind(sb);
            sb.from = (t) => t === 'analytics_events'
                ? { insert: () => Promise.resolve({ error: { message: 'offline' } }) }
                : origFrom(t);
            await flushAnalytics();
            const afterFail = _analyticsBuffer.length;
            sb.from = (t) => t === 'analytics_events'
                ? { insert: () => Promise.resolve({ error: null }) }
                : origFrom(t);
            await flushAnalytics();
            const afterSuccess = _analyticsBuffer.length;
            sb.from = origFrom;
            return { afterFail, afterSuccess };
        });
        expect(r.afterFail).toBe(1);      // kept
        expect(r.afterSuccess).toBe(0);   // delivered and cleared
    }, 30_000);

    test('the buffer is capped so it cannot grow without bound', async () => {
        const len = await app.page.evaluate(() => {
            _analyticsBuffer = [];
            for (let i = 0; i < ANALYTICS_MAX_BUFFER + 50; i++) track('spam', { i });
            return _analyticsBuffer.length;
        });
        expect(len).toBe(200);
    });

    test('one-time events fire once, not on every visit', async () => {
        const r = await app.page.evaluate(() => {
            _analyticsBuffer = [];
            try { localStorage.removeItem('bp_ev_demo_buf'); } catch (e) {}
            trackOnce('demo', 'demo_event');
            trackOnce('demo', 'demo_event');
            trackOnce('demo', 'demo_event');
            return _analyticsBuffer.filter(e => e.event === 'demo_event').length;
        });
        expect(r).toBe(1);
    });
});

describe('funnel correctness', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'fun' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    const names = async () => (await buffer(app.page)).map(e => e.event);

    test('replaying the intro from the Manual does not re-emit completion', async () => {
        await clear(app.page);
        await app.page.evaluate(() => {
            try { localStorage.removeItem('bp_ev_intro_done_fun'); } catch (e) {}
            finishOnboarding();          // genuine first completion
            finishOnboarding();          // a replay
            finishOnboarding();
        });
        const completed = (await names()).filter(n => n === 'intro_completed');
        expect(completed).toHaveLength(1);
    }, 30_000);

    test('skipping the intro is distinguishable from finishing it', async () => {
        await clear(app.page);
        await app.page.evaluate(() => {
            showOnboarding(); goToObSlide(1);
            document.getElementById('ob-skip-btn').click();
        });
        await app.page.waitForTimeout(300);
        const events = await buffer(app.page);
        const skip = events.find(e => e.event === 'intro_skipped');
        expect(skip).toBeTruthy();
        expect(skip.props.slide).toBe(1);          // how far they got
        expect(events.some(e => e.event === 'intro_completed')).toBe(false);
    }, 30_000);

    test('tour skip records the stop reached; a one-time tip records neither', async () => {
        await clear(app.page);
        await app.page.evaluate(() => {
            goToStep(0);
            try { localStorage.removeItem('bp_tour_done_fun'); } catch (e) {}
            startTour();
        });
        await app.page.waitForTimeout(700);
        await app.page.evaluate(() => { _tourIdx = 3; document.getElementById('tour-skip').click(); });
        await app.page.waitForTimeout(200);

        let events = await buffer(app.page);
        expect(events.some(e => e.event === 'tour_started')).toBe(true);
        const skip = events.find(e => e.event === 'tour_skipped');
        expect(skip.props.stop).toBe(3);
        expect(events.some(e => e.event === 'tour_completed')).toBe(false);

        // A one-time tip reuses the same layer and must not pollute the funnel.
        await clear(app.page);
        await app.page.evaluate(() => {
            try { localStorage.removeItem('bp_tip_x_fun'); } catch (e) {}
            oneTimeTip('x', '#launch-btn', 'T', 'B');
        });
        await app.page.waitForTimeout(400);
        await app.page.evaluate(() => document.getElementById('tour-skip').click());
        await app.page.waitForTimeout(200);
        events = await buffer(app.page);
        expect(events.some(e => ['tour_started', 'tour_skipped', 'tour_completed'].includes(e.event))).toBe(false);
    }, 40_000);

    test('abandoning mid-session records how far in they got', async () => {
        await clear(app.page);
        await app.page.evaluate(() => {
            goToStep(4);
            session.exerciseIndex = 2; session.setIndex = 3; session.routineType = 'girth';
            goToStep(0);
        });
        const ev = (await buffer(app.page)).find(e => e.event === 'session_abandoned');
        expect(ev).toBeTruthy();
        expect(ev.props.exerciseIndex).toBe(2);
        expect(ev.props.setIndex).toBe(3);
        expect(ev.props.routineType).toBe('girth');
    }, 30_000);

    test('choosing a goal records the goal and whether the schedule changed', async () => {
        await clear(app.page);
        await app.page.evaluate(() => {
            persisted.allTimeSessionCount = 0;
            persisted.schedule = DEFAULT_PERSISTED.schedule.slice();
            selectGoal('stamina');
        });
        const ev = (await buffer(app.page)).find(e => e.event === 'goal_selected');
        expect(ev.props.goal).toBe('stamina');
        expect(ev.props.schedule_applied).toBe(true);
        expect(app.errors).toEqual([]);
    }, 30_000);
});

describe('membership denial is still recorded', () => {
    let app;
    beforeAll(async () => { app = await openApp({ row: null }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the event survives the sign-out that immediately follows it', async () => {
        // checkMembership signs the user out before returning, which would take
        // the JWT with it, so the event has to be emitted before that happens.
        const events = await app.page.evaluate(async () => {
            _analyticsBuffer = [];
            await checkMembership({ id: 'denied-user', email: 'nobody@example.com' });
            return _analyticsBuffer.map(e => ({ ...e }));
        });
        const denial = events.find(e => e.event === 'membership_denied');
        expect(denial).toBeTruthy();
        expect(denial.props.reason).toBe('no_row');
        expect(JSON.stringify(events)).not.toMatch(/nobody@example\.com/);
    }, 30_000);
});

describe('existing members are not counted as new signups', () => {
    let app;
    const VETERAN = {
        id: 'oldtimer', total_xp: 3000, difficulty: 'elite',
        session_log: [{ date: new Date(Date.now() - 864e5).toISOString(), routineType: 'length', xpEarned: 20, note: '', eq: 7, rpe: 5, duration: 12 }],
        all_time_session_count: 200, first_session_date: '2025-01-01',
        measurements: [], seen_milestones: [], records: {}, week_key: '',
        schedule: ['length', 'girth', 'rest', 'length', 'girth', 'rest', 'rest'],
        completed_days: [false, false, false, false, false, false, false],
        updated_at: new Date().toISOString(),
    };
    beforeAll(async () => { app = await openApp({ row: VETERAN }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('a member with history signing in records a signin, not a signup', async () => {
        // Without the gate, everyone already using the app would appear as a
        // fresh signup the first time they opened it after this shipped.
        const events = await app.page.evaluate(async () => {
            currentUser = { id: 'oldtimer', email: 'old@example.com' };
            _persistedLoaded = false;
            _analyticsBuffer = [];
            try { localStorage.removeItem('bp_ev_signup_oldtimer'); } catch (e) {}
            await loadPersisted();
            const looksNew = (persisted.allTimeSessionCount || 0) === 0
                && !persisted.firstSessionDate && !(persisted.sessionLog || []).length;
            if (looksNew) trackOnce('signup', 'signup');
            else { try { localStorage.setItem('bp_ev_signup_oldtimer', '1'); } catch (e) {} }
            track('signin');
            return {
                names: _analyticsBuffer.map(e => e.event),
                suppressed: localStorage.getItem('bp_ev_signup_oldtimer'),
                count: persisted.allTimeSessionCount,
            };
        });
        expect(events.count).toBe(200);
        expect(events.names).toContain('signin');
        expect(events.names).not.toContain('signup');
        expect(events.suppressed).toBe('1');   // and permanently excluded from now on
    }, 40_000);

    test('a genuinely empty account still counts as a signup', async () => {
        const names = await app.page.evaluate(() => {
            _analyticsBuffer = [];
            currentUser = { id: 'brandnew', email: 'new@example.com' };
            persisted.allTimeSessionCount = 0;
            persisted.firstSessionDate = '';
            persisted.sessionLog = [];
            try { localStorage.removeItem('bp_ev_signup_brandnew'); } catch (e) {}
            const looksNew = (persisted.allTimeSessionCount || 0) === 0
                && !persisted.firstSessionDate && !(persisted.sessionLog || []).length;
            if (looksNew) trackOnce('signup', 'signup');
            return _analyticsBuffer.map(e => e.event);
        });
        expect(names).toContain('signup');
    }, 30_000);
});
