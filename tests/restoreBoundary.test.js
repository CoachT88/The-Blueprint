import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'index.html'), 'utf8');

/**
 * The adoption boundary, asserted against the source rather than against
 * behaviour.
 *
 * Every other test in this phase asks what the app does with a restored
 * state. This one asks whether a future edit can quietly reintroduce the
 * problem: eight code paths assigning `persisted` directly, five of them
 * validating nothing. A behavioural test cannot see a NINTH path being added
 * next to the seven that were fixed, because nothing exercises it yet.
 *
 * The assertion is deliberately scoped rather than global. `let persisted =
 * {...DEFAULT_PERSISTED}` at the top of the script is legitimate
 * initialisation and so are the two sign-out resets, which adopt no foreign
 * data. What must hold is narrower: inside loadPersisted() and importData(),
 * the only way to assign `persisted` is adoptPersisted().
 */

/** The source of a function, from its signature to its matching brace. */
function bodyOf(signature) {
    const start = html.indexOf(signature);
    if (start < 0) throw new Error(`not found: ${signature}`);
    let i = html.indexOf('{', start + signature.length - 1);
    let depth = 0;
    for (let j = i; j < html.length; j++) {
        if (html[j] === '{') depth++;
        else if (html[j] === '}' && --depth === 0) return html.slice(start, j + 1);
    }
    throw new Error(`unbalanced: ${signature}`);
}

/* A bare assignment to the binding itself. `persisted.foo =` and
   `_persistedLoaded =` are both excluded, which is the point: the first is
   an ordinary field write and the second is a trust decision that
   deliberately lives outside adoption. */
const BARE_ASSIGN = /(?<![.\w$])persisted\s*=(?!=)/g;

describe('one adoption boundary, enforced in the source', () => {
    const paths = [
        ['loadPersisted', 'async function loadPersisted(){'],
        ['importData', 'function importData(file){'],
    ];

    test('both restore entry points were found and are substantial', () => {
        paths.forEach(([, sig]) => expect(bodyOf(sig).length).toBeGreaterThan(400));
    });

    test.each(paths)('%s assigns persisted only through adoptPersisted()', (name, sig) => {
        const body = bodyOf(sig);
        const bare = body.match(BARE_ASSIGN) || [];
        const adopted = body.match(/adoptPersisted\(/g) || [];
        expect(adopted.length, `${name} no longer adopts anything`).toBeGreaterThan(0);
        expect(bare.length,
            `${name} assigns \`persisted\` directly ${bare.length} time(s). Restored and `
            + 'imported state has to go through adoptPersisted(), or the fields it '
            + 'normalises are whatever the caller happened to supply.').toBe(0);
    });

    test('every path that adopts is still accounted for', () => {
        /* Seven: four localStorage restores, the brand-new account, the
           server row, and the import. If this number moves, a path was added
           or removed and the map in the phase notes is out of date. */
        const all = html.match(/adoptPersisted\(/g) || [];
        expect(all).toHaveLength(8);   // seven call sites plus the definition
    });
});

describe('adoptPersisted keeps to its own job', () => {
    const body = bodyOf('function adoptPersisted(raw){');

    test('it does not decide whether the state can be trusted', () => {
        /* _persistedLoaded is a property of which path succeeded, not of
           whether normalisation went cleanly. A restore from a stale backup
           normalises perfectly and is still not grounds to overwrite a
           server row, so the decision stays with each caller. */
        expect(body).not.toMatch(/_persistedLoaded\s*=/);
    });

    test('it does not interpret day plans, only the container holding them', () => {
        /* normaliseDayPlans() drops the records it refuses. That is right at
           the point of use and is data loss here, because the next save
           would persist it and the reader that understands those records
           arrives in a later phase. */
        expect(body).not.toContain('normaliseDayPlans');
        expect(body).toContain('Array.isArray(persisted.dayPlans)');
    });

    test('it owns schedule normalisation rather than sharing it', () => {
        expect(body).toContain('normaliseSchedule()');
        /* Called from exactly one place now. Three callers is what let five
           restore paths miss it. The definition reads `normaliseSchedule(){`
           and the prose above it has no semicolon, so this counts calls. */
        const calls = html.match(/normaliseSchedule\(\);/g) || [];
        expect(calls).toHaveLength(1);
    });
});

describe('the two schema-fallback tiers stay distinct', () => {
    test('the newest columns are their own list', () => {
        expect(html).toContain("const _LATEST_SCHEMA_COLUMNS=['programme','day_plans'];");
    });

    test('_NEWER_COLUMNS still carries everything it did, ledger included', () => {
        /* The narrow tier exists so this list is not the first thing a member
           loses. Shrinking it would move those columns out of the broad
           fallback's reach on a table missing an older migration. */
        const m = html.match(/const _NEWER_COLUMNS=\[([^\]]*)\]/);
        expect(m, '_NEWER_COLUMNS is gone').not.toBe(null);
        const cols = m[1].split(',').map(s => s.trim().replace(/'/g, ''));
        expect(cols).toEqual(['streak_passes', 'pass_protected_dates', 'last_pass_earned_date',
                              'primary_goal', 'pelvic_profile', 'pelvic_screen_date',
                              'programme_start_date', 'progression_ledger']);
    });

    test('the newest columns are not also in the broad list', () => {
        /* They are stripped as a union, so duplicating them would make the
           narrow tier indistinguishable from the broad one. */
        const m = html.match(/const _NEWER_COLUMNS=\[([^\]]*)\]/);
        const cols = m[1].split(',').map(x => x.trim().replace(/'/g, ''));
        expect(cols).not.toContain('programme');
        expect(cols).not.toContain('day_plans');
    });
});
