import { describe, test, expect } from 'vitest';
import { getISOWeek, getISOYear, getCurrentWeekKey, shouldResetWeek } from '../src/weekUtils.js';

// ---------------------------------------------------------------------------
// getISOWeek
// ---------------------------------------------------------------------------
describe('getISOWeek', () => {
    test('mid-year date returns correct week number', () => {
        // Jun 13, 2024 is a Thursday — Thursday is the anchor day for ISO weeks
        expect(getISOWeek(new Date('2024-06-13'))).toBe(24);
    });

    test('Jan 1 that falls inside the previous year\'s last week', () => {
        // Jan 1, 2023 is a Sunday → belongs to ISO week 52 of 2022
        expect(getISOWeek(new Date('2023-01-01'))).toBe(52);
    });

    test('late-December date that belongs to week 1 of the next year', () => {
        // Dec 30, 2024 is a Monday → belongs to ISO week 1 of 2025
        expect(getISOWeek(new Date('2024-12-30'))).toBe(1);
    });

    test('Dec 31, 2024 also belongs to week 1 of 2025', () => {
        expect(getISOWeek(new Date('2024-12-31'))).toBe(1);
    });

    test('Jan 6, 2025 is week 2', () => {
        // ISO week 1 of 2025 ends Jan 5; Jan 6 (Monday) starts week 2
        expect(getISOWeek(new Date('2025-01-06'))).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// getISOYear
// ---------------------------------------------------------------------------
describe('getISOYear', () => {
    test('mid-year date returns same calendar year', () => {
        expect(getISOYear(new Date('2024-06-13'))).toBe(2024);
    });

    test('Dec 30, 2024 belongs to ISO year 2025', () => {
        expect(getISOYear(new Date('2024-12-30'))).toBe(2025);
    });

    test('Jan 1, 2023 belongs to ISO year 2022', () => {
        expect(getISOYear(new Date('2023-01-01'))).toBe(2022);
    });

    test('Jan 1, 2025 belongs to ISO year 2025', () => {
        expect(getISOYear(new Date('2025-01-01'))).toBe(2025);
    });
});

// ---------------------------------------------------------------------------
// getCurrentWeekKey — the key written to / read from persisted.weekKey
// ---------------------------------------------------------------------------
describe('getCurrentWeekKey', () => {
    test('mid-year date returns correct key', () => {
        expect(getCurrentWeekKey(new Date('2024-06-13'))).toBe('2024_w24');
    });

    test('Dec 30, 2024 key uses ISO year 2025, not calendar year 2024', () => {
        // This is the core regression test: the old code returned "2024_w1"
        expect(getCurrentWeekKey(new Date('2024-12-30'))).toBe('2025_w1');
    });

    test('Dec 31, 2024 key is also 2025_w1', () => {
        expect(getCurrentWeekKey(new Date('2024-12-31'))).toBe('2025_w1');
    });

    test('Jan 1, 2025 key matches Dec 30, 2024 — same ISO week', () => {
        expect(getCurrentWeekKey(new Date('2025-01-01'))).toBe('2025_w1');
    });

    test('Jan 1, 2023 key uses ISO year 2022, not calendar year 2023', () => {
        expect(getCurrentWeekKey(new Date('2023-01-01'))).toBe('2022_w52');
    });

    test('Dec 28, 2024 is still in week 52 of 2024', () => {
        expect(getCurrentWeekKey(new Date('2024-12-28'))).toBe('2024_w52');
    });
});

// ---------------------------------------------------------------------------
// shouldResetWeek — guards the completedDays reset in loadPersisted
// ---------------------------------------------------------------------------
describe('shouldResetWeek', () => {
    test('same week, different days — no reset', () => {
        const key = getCurrentWeekKey(new Date('2024-06-10')); // Monday, week 24
        expect(shouldResetWeek(key, new Date('2024-06-12'))).toBe(false); // Wednesday, same week
    });

    test('different weeks — triggers reset', () => {
        const key = getCurrentWeekKey(new Date('2024-06-10')); // week 24
        expect(shouldResetWeek(key, new Date('2024-06-17'))).toBe(true);  // week 25
    });

    test('year boundary: Dec 30 and Jan 1 are the same ISO week — no reset', () => {
        // Without the ISO year fix, Dec 30 produced "2024_w1" and Jan 1 produced
        // "2025_w1", causing a spurious reset mid-week for users.
        const key = getCurrentWeekKey(new Date('2024-12-30'));
        expect(shouldResetWeek(key, new Date('2025-01-01'))).toBe(false);
    });

    test('year boundary: Dec 28 (week 52) → Dec 30 (week 1) correctly resets', () => {
        const key = getCurrentWeekKey(new Date('2024-12-28')); // 2024_w52
        expect(shouldResetWeek(key, new Date('2024-12-30'))).toBe(true);  // 2025_w1
    });

    test('stale key from previous year triggers reset', () => {
        expect(shouldResetWeek('2023_w52', new Date('2024-01-08'))).toBe(true);
    });

    test('empty/missing persisted key triggers reset', () => {
        expect(shouldResetWeek('', new Date('2024-06-13'))).toBe(true);
    });
});
