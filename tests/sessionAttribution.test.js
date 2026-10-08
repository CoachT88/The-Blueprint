import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attributeEntry, canAttribute, performedByAttribution, ATTRIBUTION }
    from '../src/sessionAttribution.js';

/**
 * Which prescription did this session satisfy?
 *
 * THREE SHAPES, and the third is the conservative rule this phase turns on.
 *
 *   valid prescriptionDate   the launch snapshot was readable. Attributed.
 *   absent                   a record from before the field existed.
 *                            Attributed by its completion date, so upgrading
 *                            does not retroactively unsatisfy anybody.
 *   null                     a 3C.4 completion whose identity could not be
 *                            proven. Performed work is kept; the claim about
 *                            which prescription it satisfied is withheld.
 *
 * The rule the third case buys: a Thursday session resumed after midnight
 * cannot silently satisfy Friday's prescription. The price is that a corrupted
 * snapshot costs the member that day's programme credit, which is the cheaper
 * mistake and is deliberate.
 */

const MECH = ['length', 'girth', 'stamina'];

describe('a valid prescriptionDate is the identity', () => {
    test('it is used even when it differs from the completion date', () => {
        /* THE MIDNIGHT CASE, at the attribution layer. Launched Thursday,
           finished 00:10 Friday. */
        const a = attributeEntry({
            date: '2026-03-13T00:10:00.000Z',
            prescriptionDate: '2026-03-12',
            routineType: 'girth',
        });
        expect(a).toEqual({ kind: ATTRIBUTION.DATED, key: '2026-03-12' });
    });

    test('it wins over the completion date, never averages with it', () => {
        const a = attributeEntry({ date: '2026-03-20T09:00:00.000Z', prescriptionDate: '2026-03-12' });
        expect(a.key).toBe('2026-03-12');
    });
});

describe('an ABSENT prescriptionDate keeps the historical fallback', () => {
    test('a pre-3C.4 entry attributes by its completion date', () => {
        const a = attributeEntry({ date: '2026-03-12T19:00:00.000Z', routineType: 'length' });
        expect(a).toEqual({ kind: ATTRIBUTION.LEGACY_DATE, key: '2026-03-12' });
    });

    test('upgrading does not unsatisfy a week that was already satisfied', () => {
        /* The reason absent cannot be strict. Every entry in every member's
           history predates the field; treating them as unprovable would wipe
           the current week on upgrade and rewrite the ledger's past. */
        const log = [
            { date: '2026-03-09T19:00:00.000Z', routineType: 'length' },
            { date: '2026-03-12T19:00:00.000Z', routineType: 'girth' },
        ];
        const { legacy, dated } = performedByAttribution(log, MECH);
        expect(dated.size).toBe(0);
        expect(legacy.get('2026-03-09')).toEqual({ any: true, mechanical: true });
        expect(legacy.get('2026-03-12')).toEqual({ any: true, mechanical: true });
    });

    test('an unreadable completion date is UNKNOWN, not a guess', () => {
        for (const date of ['', 'yesterday', 'T12:00', '2026-02-31T00:00:00Z', 7, null]) {
            const a = attributeEntry({ date, routineType: 'length' });
            expect(a.kind, String(date)).toBe(ATTRIBUTION.UNKNOWN);
            expect(a.key).toBeNull();
        }
    });
});

describe('an explicit NULL prescriptionDate satisfies nothing', () => {
    const SAME_DAY = {
        date: '2026-03-12T20:00:00.000Z',
        prescriptionDate: null,
        routineType: 'girth',
    };

    test('the performed work is still a real entry', () => {
        /* Not data loss. The session happened, it is in the log, it has its
           type and its timestamp. Only the prescription claim is withheld. */
        expect(SAME_DAY.routineType).toBe('girth');
        expect(canAttribute(SAME_DAY)).toBe(false);
    });

    test('NAMED CASE: same day as the prescription, and still not satisfied', () => {
        /* The case worth stating out loud, because it is the one that costs
           the member something. The session was finished on the very day it
           was prescribed, and the completion date would have credited it, and
           we decline anyway: the only evidence left is the clock, and the
           same evidence would credit Friday for a Thursday session resumed
           after midnight. One rule, both cases. */
        const { dated, legacy } = performedByAttribution([SAME_DAY], MECH);
        expect(dated.size).toBe(0);
        expect(legacy.size).toBe(0);
    });

    test('and it cannot reach the NEXT day either', () => {
        const after = { date: '2026-03-13T00:10:00.000Z', prescriptionDate: null, routineType: 'girth' };
        const { dated, legacy } = performedByAttribution([after], MECH);
        expect(dated.has('2026-03-13')).toBe(false);
        expect(legacy.has('2026-03-13')).toBe(false);
    });

    test('null is NOT the same answer as absent', () => {
        /* The distinction the whole rule rests on, so it is asserted rather
           than assumed. `undefined` would vanish through JSON into the jsonb
           column and collapse the two. */
        expect(attributeEntry({ date: '2026-03-12T20:00:00Z', prescriptionDate: null }).kind)
            .toBe(ATTRIBUTION.UNKNOWN);
        expect(attributeEntry({ date: '2026-03-12T20:00:00Z' }).kind)
            .toBe(ATTRIBUTION.LEGACY_DATE);
    });
});

describe('a MALFORMED prescriptionDate is quarantined, never demoted', () => {
    /* The one way the conservative rule could be routed around: if a bad
       value fell back to "absent", a typo would regain completion-date
       attribution and the strictness would be optional. */
    const BAD = ['', '2026-3-9', '2026-02-31', '2026-13-01', 'Thursday', '12/03/2026',
                 0, 7, true, [], {}, { date: '2026-03-12' }, '2026-03-12T00:00:00Z'];

    test.each(BAD.map(v => [JSON.stringify(v) ?? String(v), v]))(
        'prescriptionDate %s is UNKNOWN, not LEGACY_DATE', (_label, v) => {
            const a = attributeEntry({ date: '2026-03-12T20:00:00.000Z', prescriptionDate: v });
            expect(a.kind).toBe(ATTRIBUTION.UNKNOWN);
            expect(a.key).toBeNull();
        });

    test('a malformed value cannot satisfy by falling back to the clock', () => {
        const { dated, legacy } = performedByAttribution(
            [{ date: '2026-03-12T20:00:00.000Z', prescriptionDate: '2026-3-12', routineType: 'girth' }], MECH);
        expect(dated.size + legacy.size).toBe(0);
    });
});

describe('aggregation is order independent', () => {
    /* A later Recovery entry must not erase an earlier qualifying mechanical
       completion, and a Recovery entry alone must not satisfy a Primary. The
       accumulator ORs `mechanical` precisely so the answer cannot depend on
       the order entries happen to sit in the log. */
    const mech = (d) => ({ date: `${d}T19:00:00.000Z`, prescriptionDate: d, routineType: 'length' });
    const recov = (d) => ({ date: `${d}T21:00:00.000Z`, prescriptionDate: d, routineType: 'recovery' });

    test('Recovery then mechanical satisfies', () => {
        const { dated } = performedByAttribution([recov('2026-03-12'), mech('2026-03-12')], MECH);
        expect(dated.get('2026-03-12')).toEqual({ any: true, mechanical: true });
    });

    test('mechanical then Recovery also satisfies', () => {
        const { dated } = performedByAttribution([mech('2026-03-12'), recov('2026-03-12')], MECH);
        expect(dated.get('2026-03-12')).toEqual({ any: true, mechanical: true });
    });

    test('Recovery alone does not satisfy, and is not invisible either', () => {
        const { dated } = performedByAttribution([recov('2026-03-12')], MECH);
        expect(dated.get('2026-03-12')).toEqual({ any: true, mechanical: false });
    });

    test('three of each, interleaved, in both directions', () => {
        const a = [recov('2026-03-12'), mech('2026-03-12'), recov('2026-03-12')];
        const b = [...a].reverse();
        expect(performedByAttribution(a, MECH).dated.get('2026-03-12').mechanical).toBe(true);
        expect(performedByAttribution(b, MECH).dated.get('2026-03-12').mechanical).toBe(true);
    });
});

describe('legacy and 3C.4 records mix in one week', () => {
    test('each is attributed by its own relationship, in its own map', () => {
        const log = [
            { date: '2026-03-09T19:00:00.000Z', routineType: 'length' },                       // absent
            { date: '2026-03-12T19:00:00.000Z', prescriptionDate: '2026-03-12', routineType: 'girth' },
            { date: '2026-03-13T00:10:00.000Z', prescriptionDate: '2026-03-12', routineType: 'stamina' },
            { date: '2026-03-14T19:00:00.000Z', prescriptionDate: null, routineType: 'length' },
        ];
        const { dated, legacy } = performedByAttribution(log, MECH);
        expect([...legacy.keys()]).toEqual(['2026-03-09']);
        expect([...dated.keys()]).toEqual(['2026-03-12']);
        /* Both 3C.4 entries landed on the same prescription date, which is
           correct: one finished on the day and one after midnight. */
        expect(dated.get('2026-03-12')).toEqual({ any: true, mechanical: true });
        /* And the null one is in neither. */
        expect(dated.has('2026-03-14')).toBe(false);
        expect(legacy.has('2026-03-14')).toBe(false);
    });

    test('the two maps never share a key space', () => {
        /* Merging them is how a day gets credited twice or not at all: a
           dated key is a LOCAL day and a legacy key is the UTC date part of a
           timestamp, so the same string can mean different days. */
        const log = [
            { date: '2026-03-12T19:00:00.000Z', routineType: 'length' },
            { date: '2026-03-12T19:00:00.000Z', prescriptionDate: '2026-03-12', routineType: 'recovery' },
        ];
        const { dated, legacy } = performedByAttribution(log, MECH);
        expect(legacy.get('2026-03-12').mechanical).toBe(true);
        expect(dated.get('2026-03-12').mechanical).toBe(false);
    });
});

describe('it is pure and it cannot throw', () => {
    test('junk input is UNKNOWN rather than an exception', () => {
        for (const junk of [null, undefined, 7, 'x', [], true]) {
            expect(() => attributeEntry(junk)).not.toThrow();
            expect(attributeEntry(junk).kind).toBe(ATTRIBUTION.UNKNOWN);
        }
        expect(performedByAttribution('not an array', MECH).dated.size).toBe(0);
        expect(performedByAttribution([null, undefined, 3], MECH).legacy.size).toBe(0);
    });

    test('the input list comes back untouched', () => {
        const log = [{ date: '2026-03-12T19:00:00.000Z', prescriptionDate: '2026-03-12', routineType: 'length' }];
        const snap = JSON.stringify(log);
        performedByAttribution(log, MECH);
        expect(JSON.stringify(log)).toBe(snap);
    });

    test('an absent mechanical list satisfies nothing rather than everything', () => {
        const { dated } = performedByAttribution(
            [{ date: '2026-03-12T19:00:00.000Z', prescriptionDate: '2026-03-12', routineType: 'length' }],
            undefined);
        expect(dated.get('2026-03-12')).toEqual({ any: true, mechanical: false });
    });
});

/**
 * ONE definition, shared.
 *
 * The requirement is not merely that the rule is right, it is that every
 * consumer reads the SAME rule. Four of them answer completion questions and
 * the moment two reimplement the fallback they will disagree about a day, and
 * both suites will stay green while they do it.
 */
describe('every consumer reads this module and none reimplements it', () => {
    const read = (f) => readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', f), 'utf8');

    test.each([
        ['src/weekCompletion.js'],
        ['src/weekStrip.js'],
        ['src/todayPrescription.js'],
    ])('%s imports the shared helper', (f) => {
        expect(read(f)).toMatch(/from '\.\/sessionAttribution\.js'/);
    });

    test('no consumer re-derives the completion-date fallback', () => {
        /* THE shape of a reimplementation. `e.date.split('T')[0]` is the
           fallback rule itself, and it belongs in exactly one file. Every
           week reader had its own copy before this phase, which is how a
           Thursday session finished after midnight got credited to Friday in
           two places independently. */
        for (const f of ['src/weekCompletion.js', 'src/weekStrip.js', 'src/todayPrescription.js']) {
            const body = read(f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\*.*$/gm, ' ');
            expect(body, f).not.toMatch(/\.date\.split\(/);
        }
        expect(read('src/sessionAttribution.js')).toMatch(/\.date\.split\(/);
    });

    test('the week readers never touch a log entry prescriptionDate', () => {
        /* Narrower than it looks, and deliberately so: todayPrescription.js is
           excluded because normaliseLaunchSnapshot validates the LAUNCH
           SNAPSHOT, a different object that happens to carry a field of the
           same name. These two have no snapshot business at all, so any
           mention would be an attribution rule of their own. */
        for (const f of ['src/weekCompletion.js', 'src/weekStrip.js']) {
            const body = read(f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\*.*$/gm, ' ');
            expect(body, f).not.toMatch(/prescriptionDate/);
        }
    });

    test('the page reads the record and the helper, never a bare field', () => {
        const page = read('app/index.html');
        /* prescriptionDate appears in index.html only where the completion is
           WRITTEN and where the launch snapshot is read, never as an
           attribution rule of its own. */
        const reads = page.split('\n').filter(l =>
            l.includes('.prescriptionDate') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'));
        for (const line of reads) {
            expect(line, line.trim()).toMatch(/_snap\.prescriptionDate|prescriptionDate:/);
        }
    });
});
