import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STARTING_TIER, MARKER_COLUMNS, MARKER_KINDS, isUntouchedSignupRow, applyStartingTier } from '../src/startingTier.js';

/**
 * The tier a genuinely new account starts at, and how the app knows the
 * account is genuinely new.
 *
 * The signup trigger creates a user_data row holding only the id, so the row's
 * `difficulty` is whatever the column defaults to. That used to be
 * 'intermediate', which the app read as a choice the member never made. This
 * module answers one question about a row the server returned: has the app, or
 * the member, EVER put anything in it? If not, the tier it carries is only a
 * default, and the account starts at the starting tier.
 *
 * The cost of being wrong is asymmetric, and so is the rule. Reading a real
 * member as new would move their tier on their next load. Reading a new
 * account as established leaves them at Intermediate, the state every new
 * account was in before this module existed. So every doubt resolves to
 * "established", and a row is new only when EVERY marker is blank, never on
 * the session count alone.
 */

/** What the signup trigger leaves, with the database's own defaults. */
const signup = (over = {}) => ({
    id: 'u', difficulty: 'intermediate',
    total_xp: 0, all_time_session_count: 0, session_log: [], measurements: [], seen_milestones: [],
    progress_checkins: [], progression_ledger: [], primary_goal: '', programme: null, day_plans: null,
    week_key: '', xp_migrated: false, first_session_date: '', pelvic_profile: '', pelvic_screen_date: '',
    programme_start_date: null, diff_unlocked_date: null, schedule: null, completed_days: null, records: null,
    ...over,
});
const AT = '2026-11-10T10:00:00.000Z';

describe('the starting tier', () => {
    test('is Beginner, the tier the intro promises', () => {
        expect(STARTING_TIER).toBe('beginner');
    });
});

describe('an untouched signup row', () => {
    test('is the row the signup trigger creates', () => {
        expect(isUntouchedSignupRow(signup())).toBe(true);
    });

    test('is recognised whichever way the database leaves a blank column: NULL, empty, zero, false, empty list', () => {
        expect(isUntouchedSignupRow(signup({
            total_xp: null, all_time_session_count: null, session_log: null, measurements: null, seen_milestones: null,
            progress_checkins: null, progression_ledger: null, primary_goal: null, day_plans: [], week_key: null,
            xp_migrated: null, first_session_date: null, pelvic_profile: null, pelvic_screen_date: null,
        }))).toBe(true);
        expect(isUntouchedSignupRow(signup({ week_key: undefined, xp_migrated: undefined, total_xp: undefined }))).toBe(true);
    });

    test('a recorded tier slot with nothing in it is still blank', () => {
        expect(isUntouchedSignupRow(signup({ diff_unlocked_date: { intermediate: '', advanced: '', elite: '' } }))).toBe(true);
        expect(isUntouchedSignupRow(signup({ diff_unlocked_date: { intermediate: null, advanced: undefined, elite: '' } }))).toBe(true);
        expect(isUntouchedSignupRow(signup({ diff_unlocked_date: {} }))).toBe(true);
    });

    test('is recognised on a table with the revision guard, and with columns this module has never heard of', () => {
        expect(isUntouchedSignupRow(signup({ rev: 0, base_rev: null, last_write_id: null, sync_meta: null,
            updated_at: AT, created_at: AT, some_future_column: 'x' }))).toBe(true);
    });

    test('says nothing about the tier it carries: that is applyStartingTier\'s question', () => {
        for (const difficulty of ['intermediate', 'beginner', 'advanced', 'elite', null, '']) {
            expect(isUntouchedSignupRow(signup({ difficulty }))).toBe(true);
        }
    });
});

describe('a row anything has touched is not untouched: each marker ALONE is enough', () => {
    const MARKERS = [
        ['week_key (the app writes it on its first load)', { week_key: '2026-W47' }],
        ['xp_migrated (the app writes it on its first load)', { xp_migrated: true }],
        ['first_session_date (set when a tier is tapped or a session starts)', { first_session_date: AT }],
        ['a tier choice recorded in diff_unlocked_date', { diff_unlocked_date: { intermediate: AT, advanced: '', elite: '' } }],
        ['any tier slot in diff_unlocked_date, not just the first', { diff_unlocked_date: { intermediate: '', advanced: AT, elite: '' } }],
        ['total_xp', { total_xp: 15 }],
        ['all_time_session_count', { all_time_session_count: 1 }],
        ['a logged session', { session_log: [{ sid: 's', date: AT, routineType: 'length' }] }],
        ['a measurement', { measurements: [{ sid: 'm', date: AT, bpel: 6.5 }] }],
        ['a seen milestone', { seen_milestones: ['first_session'] }],
        ['a progress check-in', { progress_checkins: [{ date: AT }] }],
        ['a progression entry', { progression_ledger: [{ weekKey: '2026-W46' }] }],
        ['a chosen goal', { primary_goal: 'size' }],
        ['a programme', { programme: { key: 'size' } }],
        ['an empty programme object (a programme exists and says nothing)', { programme: {} }],
        ['a dated plan', { day_plans: [{ date: '2026-11-23' }] }],
        ['a programme start date', { programme_start_date: '2026-11-23' }],
        ['a pelvic check', { pelvic_profile: 'standard' }],
        ['a pelvic check date', { pelvic_screen_date: AT }],
    ];
    test.each(MARKERS)('%s', (_name, over) => {
        expect(isUntouchedSignupRow(signup(over))).toBe(false);
    });

    test('the 17: Intermediate, saved by the app, never trained, is touched by the app\'s own first save', () => {
        // Zero sessions is what they have in common with a new account. It is not what separates them.
        const seventeen = signup({ week_key: '2026-W46', xp_migrated: true });
        expect(seventeen.all_time_session_count).toBe(0);
        expect(isUntouchedSignupRow(seventeen)).toBe(false);
    });

    test('a member with sessions and nothing else the app writes is still touched', () => {
        expect(isUntouchedSignupRow(signup({ all_time_session_count: 40, total_xp: 600 }))).toBe(false);
    });
});

describe('doubt resolves to "established"', () => {
    const WEIRD = [
        ['a week_key that is not text', { week_key: 5 }],
        ['an xp_migrated that is text', { xp_migrated: 'false' }],
        ['a total_xp that is text', { total_xp: '0' }],
        ['a total_xp that is not a number', { total_xp: Number.NaN }],
        ['a negative total_xp', { total_xp: -1 }],
        ['a session_log that is an object', { session_log: {} }],
        ['a session_log that is text', { session_log: '[]' }],
        ['a measurements that is an object', { measurements: {} }],
        ['a diff_unlocked_date that is text', { diff_unlocked_date: 'none' }],
        ['a diff_unlocked_date that is a list', { diff_unlocked_date: [''] }],
        ['a diff_unlocked_date slot that is not a string', { diff_unlocked_date: { intermediate: 1 } }],
        ['a day_plans that is an object', { day_plans: {} }],
        ['a primary_goal that is not text', { primary_goal: 1 }],
        ['a programme that is text', { programme: 'size' }],
        ['a first_session_date that is a date object', { first_session_date: new Date(0) }],
        // Falsy values of the WRONG type. A looser "is it falsy?" test would read each of these as blank.
        ['a week_key that is zero', { week_key: 0 }],
        ['a week_key that is false', { week_key: false }],
        ['a first_session_date that is zero', { first_session_date: 0 }],
        ['a primary_goal that is zero', { primary_goal: 0 }],
        ['a pelvic_profile that is false', { pelvic_profile: false }],
        ['an xp_migrated that is zero', { xp_migrated: 0 }],
        ['an xp_migrated that is empty text', { xp_migrated: '' }],
        ['a total_xp that is empty text', { total_xp: '' }],
        ['an all_time_session_count that is empty text', { all_time_session_count: '' }],
        ['a session_log that is empty text', { session_log: '' }],
        ['a session_log that is an object with a zero length', { session_log: { length: 0 } }],
        ['a measurements that is empty text', { measurements: '' }],
        ['a day_plans that is empty text', { day_plans: '' }],
    ];
    test.each(WEIRD)('%s', (_name, over) => {
        expect(isUntouchedSignupRow(signup(over))).toBe(false);
    });

    test.each([null, undefined, [], [signup()], 'row', 7, true])('a value that is not a row (%j) is not a signup row', (v) => {
        expect(isUntouchedSignupRow(v)).toBe(false);
    });
});

describe('applyStartingTier', () => {
    test('moves the default tier of an untouched signup row to Beginner, and changes nothing else', () => {
        const row = signup();
        const out = applyStartingTier(row);
        expect(out.difficulty).toBe('beginner');
        expect(out).toEqual({ ...row, difficulty: 'beginner' });
    });

    test('does so for a row whose tier is empty or NULL as well', () => {
        expect(applyStartingTier(signup({ difficulty: null })).difficulty).toBe('beginner');
        expect(applyStartingTier(signup({ difficulty: '' })).difficulty).toBe('beginner');
        expect(applyStartingTier(signup({ difficulty: undefined })).difficulty).toBe('beginner');
    });

    test('never mutates the row it was given', () => {
        const row = signup();
        const frozen = JSON.parse(JSON.stringify(row));
        Object.freeze(row);
        const out = applyStartingTier(row);
        expect(row).toEqual(frozen);
        expect(out).not.toBe(row);
    });

    test('returns the very same row, unchanged, whenever it has nothing to say', () => {
        const touched = signup({ week_key: '2026-W47', xp_migrated: true });
        expect(applyStartingTier(touched)).toBe(touched);
        expect(touched.difficulty).toBe('intermediate');
        const already = signup({ difficulty: 'beginner' });
        expect(applyStartingTier(already)).toBe(already);
    });

    test('never overrides a tier somebody set: Advanced and Elite stand even on an otherwise untouched row', () => {
        for (const difficulty of ['advanced', 'elite']) {
            const row = signup({ difficulty });
            expect(applyStartingTier(row)).toBe(row);
        }
    });

    test('an explicit Intermediate keeps it: choosing a tier leaves marks, so the row is touched', () => {
        // What setDifficulty() leaves behind before the first save lands.
        const chosen = signup({ first_session_date: AT, diff_unlocked_date: { intermediate: AT, advanced: '', elite: '' } });
        expect(applyStartingTier(chosen)).toBe(chosen);
        expect(chosen.difficulty).toBe('intermediate');
    });

    test('is deterministic: the same row always gives the same answer', () => {
        const row = signup();
        expect(applyStartingTier(row)).toEqual(applyStartingTier(row));
        expect(applyStartingTier(applyStartingTier(row)).difficulty).toBe('beginner');
    });

    test.each([null, undefined, [], 'row', 7, true])('passes a value that is not a row straight through (%j)', (v) => {
        expect(applyStartingTier(v)).toBe(v);
    });
});

describe('the read-only SQL checks say what the rule says, column by column', () => {
    /* supabase/checks/new-accounts-start-at-beginner.sql is what the owner runs on staging and
       production to see a new account's real column defaults and how many existing accounts the
       rule would move. If it named different columns, or a different kind of blank for a column,
       than the rule uses, it would answer a question the app is not asking. */
    const here = path.dirname(fileURLToPath(import.meta.url));
    const sql = readFileSync(path.resolve(here, '../supabase/checks/new-accounts-start-at-beginner.sql'), 'utf8');
    const section = (n) => {
        const from = sql.indexOf(`-- ==== QUERY ${n} of 2`);
        const to = sql.indexOf(`-- ==== QUERY ${n + 1} of 2`);
        expect(from, `QUERY ${n} is present`).toBeGreaterThan(-1);
        return sql.slice(from, to === -1 ? undefined : to);
    };
    const unquote = (literal) => literal.replace(/''/g, "'");
    const inValuesLists = (text) => [...text.matchAll(/\(values((?:\s*\('[a-z_]+'\),?)+)\)\s*[a-z]+\(col\)/g)]
        .flatMap(m => [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]));
    const readAsJson = (text) => [...text.matchAll(/j->>?'([a-z_]+)'/g)].map(m => m[1]);

    /** QUERY 1's (column, kind) pairs, as written in its list. */
    const query1Kinds = () => Object.fromEntries(
        [...section(1).matchAll(/\('([a-z_]+)',\s*'([a-z ]+)'\)/g)].map(m => [m[1], m[2]]));
    /** The defaults QUERY 1 reads as blank for each kind, exactly as its CASE spells them. */
    const blankDefaultsByKind = () => {
        const out = {};
        const clause = /when m\.kind = '([a-z ]+)'\s+and c\.column_default (?:in \(([^)]*)\)|= ('(?:[^']|'')*'))/g;
        for (const m of section(1).matchAll(clause)) {
            out[m[1]] = m[2] !== undefined
                ? [...m[2].matchAll(/'((?:[^']|'')*)'/g)].map(x => unquote(x[1]))
                : [unquote(m[3].slice(1, -1))];
        }
        return out;
    };
    /** A default as Postgres prints it, read back as the value a row would hold. */
    const asValue = (printed) => {
        const typed = /^'(.*)'::(text|character varying|jsonb)$/s.exec(printed);
        if (typed) return typed[2] === 'jsonb' ? JSON.parse(typed[1]) : typed[1];
        if (printed === 'true' || printed === 'false') return printed === 'true';
        if (/^-?\d+$/.test(printed)) return Number(printed);
        throw new Error('unrecognised default: ' + printed);
    };
    const tierRecordPattern = () => {
        const m = /when m\.kind = 'tier record'\s+and c\.column_default ~ '((?:[^']|'')*)'/.exec(section(1));
        expect(m, 'the tier record has a pattern of its own').not.toBeNull();
        return new RegExp(unquote(m[1]));
    };

    test('the rule reads the 17 columns this file is written against, each of a known kind', () => {
        expect(MARKER_COLUMNS).toHaveLength(17);
        expect(new Set(MARKER_COLUMNS).size).toBe(17);
        const KINDS = new Set(['text', 'flag', 'count', 'list', 'tier record', 'absent']);
        for (const column of MARKER_COLUMNS) expect(KINDS.has(MARKER_KINDS[column]), column).toBe(true);
        expect(Object.keys(MARKER_KINDS).sort()).toEqual([...MARKER_COLUMNS].sort());
    });

    test('query 1 (the column defaults) names every marker column with the kind the rule gives it', () => {
        expect(query1Kinds()).toEqual(MARKER_KINDS);
    });

    test('query 2 (the impact counts) reads every marker column and nothing else but the tier', () => {
        const read = new Set([...inValuesLists(section(2)), ...readAsJson(section(2))]);
        read.delete('difficulty');
        expect([...read].sort()).toEqual([...MARKER_COLUMNS].sort());
    });

    test('query 1 reads as blank exactly these defaults for each kind, and the rule agrees each is blank', () => {
        const accepted = blankDefaultsByKind();
        // Pinned: widening this list, for any kind, would make the check say "blank" about a default the app does not.
        expect(accepted).toEqual({
            text: ["''::text", "''::character varying"],
            flag: ['false'],
            count: ['0'],
            list: ["'[]'::jsonb", "'null'::jsonb"],
            absent: ["'null'::jsonb"],
        });
        for (const [kind, defaults] of Object.entries(accepted)) {
            const column = MARKER_COLUMNS.find(c => MARKER_KINDS[c] === kind);
            for (const printed of defaults) {
                expect(isUntouchedSignupRow(signup({ [column]: asValue(printed) })), `${kind}: ${printed}`).toBe(true);
            }
        }
        // The programme is "absent" or it is a mark: an object or a list default is never blank for it.
        expect(accepted.absent).toEqual(["'null'::jsonb"]);
    });

    test("the database's real tier-record default reads as blank, and the app agrees", () => {
        // On staging and on production: an object with an empty string for every tier.
        const real = `'{"elite": "", "advanced": "", "intermediate": ""}'::jsonb`;
        expect(tierRecordPattern().test(real)).toBe(true);
        expect(isUntouchedSignupRow(signup({ diff_unlocked_date: asValue(real) }))).toBe(true);
    });

    test('the tier-record pattern and the rule agree on every other default, so it cannot say "blank" for a mark', () => {
        const re = tierRecordPattern();
        const SAMPLES = [
            `'{}'::jsonb`,
            `'{"elite": null}'::jsonb`,
            `'{"elite": "", "advanced": "", "intermediate": "2026-11-10T10:00:00.000Z"}'::jsonb`,
            `'{"intermediate": "2026-11-10", "advanced": "", "elite": ""}'::jsonb`,
            `'{"elite": "", "advanced": 0}'::jsonb`,
            `'{"elite": "", "advanced": false}'::jsonb`,
            `'{"a": {"b": ""}}'::jsonb`,
            `'[]'::jsonb`,
            `'[""]'::jsonb`,
            `'"x"'::jsonb`,
            `'null'::jsonb`,
        ];
        for (const printed of SAMPLES) {
            const ruleSaysBlank = isUntouchedSignupRow(signup({ diff_unlocked_date: asValue(printed) }));
            expect(re.test(printed), printed).toBe(ruleSaysBlank);
        }
    });

    test('the tier-record pattern is not applied to any other kind of column', () => {
        // It sits behind `m.kind = 'tier record'`, which only diff_unlocked_date has.
        const only = MARKER_COLUMNS.filter(c => MARKER_KINDS[c] === 'tier record');
        expect(only).toEqual(['diff_unlocked_date']);
        // A list column defaulting to '{}' and the programme defaulting to anything are NOT in any accepted set.
        const accepted = Object.values(blankDefaultsByKind()).flat();
        expect(accepted).not.toContain("'{}'::jsonb");
    });
});
