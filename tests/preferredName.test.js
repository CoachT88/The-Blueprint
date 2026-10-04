import { describe, test, expect } from 'vitest';
import {
    validatePreferredName, readPreferredName, hasPreferredName,
    nameLength, PREFERRED_NAME_MAX,
} from '../src/preferredName.js';

/**
 * A preferred name is optional forever, and the no-name path is the one
 * most members are on. Every assertion here is about accepting what someone
 * actually typed, refusing only what cannot be stored, and never inventing
 * a name for a member who did not give one.
 */

describe('validation', () => {
    test('a plain name comes back as given', () => {
        expect(validatePreferredName('Marcus')).toEqual({ ok: true, value: 'Marcus' });
    });

    test('surrounding whitespace is trimmed', () => {
        expect(validatePreferredName('   Marcus   ').value).toBe('Marcus');
        expect(validatePreferredName('\n\tMarcus \n').value).toBe('Marcus');
    });

    test('inner spacing is left exactly as typed', () => {
        expect(validatePreferredName('  Jean  Luc  ').value).toBe('Jean  Luc');
    });

    test('whitespace only is no name, not an empty name', () => {
        for (const raw of ['', '   ', '\t', '\n\n', '   ']) {
            const out = validatePreferredName(raw);
            expect(out.ok).toBe(true);
            expect(out.value).toBeNull();
        }
    });

    test('anything that is not a string reads as no name', () => {
        // A corrupted metadata blob must not become "[object Object]" on
        // someone's home screen.
        for (const raw of [null, undefined, 42, {}, [], true, { toString: () => 'x' }]) {
            expect(validatePreferredName(raw)).toEqual({ ok: true, value: null });
        }
    });

    test('non-Latin scripts are accepted unchanged', () => {
        for (const name of ['Søren', 'Ñico', 'Марк', '马克', 'مروان', 'יוסי', 'ಮಾರ್ಕ್']) {
            expect(validatePreferredName(name).value).toBe(name);
        }
    });

    test('emoji are accepted', () => {
        expect(validatePreferredName('Marcus 💪').value).toBe('Marcus 💪');
        expect(validatePreferredName('😀').value).toBe('😀');
    });

    test('apostrophes, hyphens and punctuation are accepted', () => {
        for (const name of ["O'Brien", 'Jean-Luc', 'Smith Jr.', 'D’Angelo', 'Anne-Marie O’Neill']) {
            expect(validatePreferredName(name).value).toBe(name);
        }
    });

    test('no judgement is made about whether a name is real', () => {
        for (const name of ['x', '123', 'Mr Blobby', 'aaaaaa', '....']) {
            expect(validatePreferredName(name).ok).toBe(true);
            expect(validatePreferredName(name).value).toBe(name);
        }
    });
});

describe('length, counted in code points', () => {
    test('the limit is forty', () => {
        expect(PREFERRED_NAME_MAX).toBe(40);
    });

    test('exactly forty is accepted', () => {
        const name = 'a'.repeat(40);
        expect(validatePreferredName(name)).toEqual({ ok: true, value: name });
    });

    test('forty one is refused, with the numbers to explain it', () => {
        const out = validatePreferredName('a'.repeat(41));
        expect(out).toEqual({ ok: false, reason: 'too-long', length: 41, max: 40 });
    });

    test('REGRESSION: refusal never truncates', () => {
        // Quietly storing the first forty characters of someone's name and
        // showing it back to them is worse than asking them to shorten it.
        const out = validatePreferredName('a'.repeat(60));
        expect(out.ok).toBe(false);
        expect(out).not.toHaveProperty('value');
    });

    test('astral characters count as one each, not two', () => {
        // Forty emoji are eighty UTF-16 units and forty code points.
        expect(nameLength('😀'.repeat(40))).toBe(40);
        expect('😀'.repeat(40).length).toBe(80);
        expect(validatePreferredName('😀'.repeat(40)).ok).toBe(true);
        expect(validatePreferredName('😀'.repeat(41)).ok).toBe(false);
    });

    test('trimming happens before measuring', () => {
        expect(validatePreferredName('  ' + 'a'.repeat(40) + '  ').ok).toBe(true);
    });
});

describe('reading from the auth user', () => {
    const user = (meta, extra = {}) => ({ id: 'u1', email: 'marcus.kane@example.com', user_metadata: meta, ...extra });

    test('a stored name is returned', () => {
        expect(readPreferredName(user({ preferred_name: 'Marcus' }))).toBe('Marcus');
        expect(hasPreferredName(user({ preferred_name: 'Marcus' }))).toBe(true);
    });

    test('no metadata is no name', () => {
        expect(readPreferredName(user({}))).toBeNull();
        expect(readPreferredName({ id: 'u1', email: 'a@b.c' })).toBeNull();
        expect(readPreferredName(null)).toBeNull();
        expect(readPreferredName(undefined)).toBeNull();
        expect(hasPreferredName(user({}))).toBe(false);
    });

    test('an explicitly cleared name is no name', () => {
        expect(readPreferredName(user({ preferred_name: null }))).toBeNull();
        expect(readPreferredName(user({ preferred_name: '' }))).toBeNull();
        expect(readPreferredName(user({ preferred_name: '   ' }))).toBeNull();
    });

    test('REGRESSION: the email local part is never used as a name', () => {
        // The most likely shortcut, and the one most likely to be wrong and
        // to feel invasive.
        const u = user({}, { email: 'marcus.kane@example.com' });
        expect(readPreferredName(u)).toBeNull();
        expect(readPreferredName(u)).not.toBe('marcus.kane');
        expect(readPreferredName(u)).not.toBe('marcus');
        expect(String(readPreferredName(user({ preferred_name: null })))).not.toMatch(/marcus/i);
    });

    test('REGRESSION: nothing else about the member becomes a name', () => {
        const u = { id: 'u1', email: 'a@b.c', user_metadata: {},
                    full_name: 'Guessed', name: 'Guessed', phone: '123' };
        expect(readPreferredName(u)).toBeNull();
    });

    test('a stored value that could not be saved today is not shown', () => {
        // Over-length or wrong-typed metadata reaching the database must not
        // reappear on a screen just because it got there.
        expect(readPreferredName(user({ preferred_name: 'a'.repeat(80) }))).toBeNull();
        expect(readPreferredName(user({ preferred_name: 42 }))).toBeNull();
        expect(readPreferredName(user({ preferred_name: { a: 1 } }))).toBeNull();
    });

    test('other metadata keys are ignored', () => {
        expect(readPreferredName(user({ nickname: 'Nope', display_name: 'Nope' }))).toBeNull();
    });
});
