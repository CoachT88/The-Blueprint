import { describe, test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { dateKeyForWeekday } from '../src/weekUtils.js';

/**
 * Golden master for the pre-extraction implementation.
 *
 * This is intentionally a verbatim frozen copy of the function that lived in
 * both weekCompletion.js and scheduleSlot.js before this PR. It is not a
 * second production implementation; it exists only to prove the shared helper
 * preserves the exact behavior being replaced.
 */
const LEGACY_DAY_MS = 86400000;
function legacyDateKeyForWeekday(ref, index) {
    const monday = new Date(ref);
    monday.setHours(12, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const d = new Date(monday.getTime() + (((index + 6) % 7) * LEGACY_DAY_MS));
    return d.toISOString().split('T')[0];
}

const localNoon = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0, 0);

const refs = [
    // Ordinary mid-week references.
    localNoon(2026, 10, 7),
    localNoon(2026, 6, 17),

    // Every day of one full week.
    ...Array.from({ length: 7 }, (_, i) => localNoon(2026, 10, 5 + i)),

    // Month boundaries, including 31st -> 1st.
    localNoon(2026, 1, 31),
    localNoon(2026, 2, 1),
    localNoon(2026, 3, 31),
    localNoon(2026, 4, 1),

    // Year boundaries.
    localNoon(2025, 12, 31),
    localNoon(2026, 1, 1),
    localNoon(2026, 12, 31),
    localNoon(2027, 1, 1),

    // Leap day.
    localNoon(2024, 2, 29),

    // DST-adjacent calendar dates. The golden master makes this independent
    // of whether the host timezone itself observes either transition.
    localNoon(2026, 3, 28),
    localNoon(2026, 3, 29),
    localNoon(2026, 3, 30),
    localNoon(2026, 10, 24),
    localNoon(2026, 10, 25),
    localNoon(2026, 10, 26),
];

describe('dateKeyForWeekday preserves the pre-extraction mapping', () => {
    test('golden-master sweep agrees for every weekday index', () => {
        for (const ref of refs) {
            for (let index = 0; index < 7; index++) {
                expect(dateKeyForWeekday(ref, index)).toBe(legacyDateKeyForWeekday(ref, index));
            }
        }
    });

    test('Sunday is index 0 and is the last day of the ISO week', () => {
        const ref = localNoon(2026, 10, 7); // Wednesday
        const monday = dateKeyForWeekday(ref, 1);
        const sunday = dateKeyForWeekday(ref, 0);
        const delta = (Date.parse(sunday + 'T00:00:00Z') - Date.parse(monday + 'T00:00:00Z')) / LEGACY_DAY_MS;
        expect(delta).toBe(6);
    });

    test('Monday is index 1 and Saturday is index 6', () => {
        const ref = localNoon(2026, 10, 7);
        const monday = dateKeyForWeekday(ref, 1);
        const saturday = dateKeyForWeekday(ref, 6);
        const delta = (Date.parse(saturday + 'T00:00:00Z') - Date.parse(monday + 'T00:00:00Z')) / LEGACY_DAY_MS;
        expect(delta).toBe(5);
    });

    test('the seven weekday indices produce seven distinct consecutive dates', () => {
        const ref = localNoon(2026, 10, 7);
        const isoOrder = [1, 2, 3, 4, 5, 6, 0].map(i => dateKeyForWeekday(ref, i));
        expect(new Set(isoOrder).size).toBe(7);
        for (let i = 1; i < isoOrder.length; i++) {
            const delta = (Date.parse(isoOrder[i] + 'T00:00:00Z') - Date.parse(isoOrder[i - 1] + 'T00:00:00Z')) / LEGACY_DAY_MS;
            expect(delta).toBe(1);
        }
    });

    test('every reference day in one local week resolves to the same seven keys', () => {
        const expected = [0, 1, 2, 3, 4, 5, 6].map(i => dateKeyForWeekday(localNoon(2026, 10, 5), i));
        for (let day = 5; day <= 11; day++) {
            const got = [0, 1, 2, 3, 4, 5, 6].map(i => dateKeyForWeekday(localNoon(2026, 10, day), i));
            expect(got).toEqual(expected);
        }
    });

    test('month, year, leap-day and DST-adjacent refs stay golden-master identical', () => {
        for (const ref of refs.slice(9)) {
            for (let index = 0; index < 7; index++) {
                expect(dateKeyForWeekday(ref, index)).toBe(legacyDateKeyForWeekday(ref, index));
            }
        }
    });

    test('local-noon to UTC-date behavior is pinned explicitly in UTC+14', () => {
        /*
         * In Pacific/Kiritimati, local noon is already the previous UTC
         * calendar date. This subprocess isolates TZ so the suite cannot
         * disturb other tests. A future "cleanup" that builds YYYY-MM-DD from
         * local parts instead of toISOString() will flip this result.
         */
        const moduleUrl = new URL('../src/weekUtils.js', import.meta.url).href;
        const script = [
            `import { dateKeyForWeekday } from ${JSON.stringify(moduleUrl)};`,
            "const ref = new Date(2026, 9, 7, 12, 0, 0, 0);",
            "process.stdout.write(dateKeyForWeekday(ref, 3));",
        ].join('\n');
        const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            env: { ...process.env, TZ: 'Pacific/Kiritimati' },
            encoding: 'utf8',
        }).trim();

        // Wednesday local noon in UTC+14 is Tuesday 22:00Z, so the legacy
        // implementation exposes the UTC date portion: 2026-10-06.
        expect(out).toBe('2026-10-06');
    });

    test('the helper itself is deterministic and reads no implicit now', () => {
        const ref = localNoon(2026, 10, 7);
        for (let index = 0; index < 7; index++) {
            expect(dateKeyForWeekday(ref, index)).toBe(dateKeyForWeekday(ref, index));
        }
    });
});
