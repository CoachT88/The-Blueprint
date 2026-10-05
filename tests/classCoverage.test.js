import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The vendored-CSS gate. Phase 3B.
 *
 * app/vendor/tw.css is generated once from app/index.html and committed,
 * because the app no longer loads the Tailwind JIT runtime. That makes a
 * dropped utility a silent visual regression: the class stays in the markup,
 * no rule exists, and the element just renders without it.
 *
 * Tailwind's own content scan produced that file, so this is the independent
 * second opinion that the scan was complete. "The tool said so" is not
 * evidence when the failure mode is invisible.
 *
 * It also pins the one runtime-composed class in the codebase. Anything new
 * of that shape has to be declared here with a justification, which is the
 * point: a future dynamic class cannot bypass the gate by being invisible to
 * a static scan.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const HTML = readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'app/vendor/tw.css'), 'utf8');

/** Class selectors the CSS actually defines, with Tailwind's escaping undone. */
const definedSelectors = () => {
    const out = new Set();
    // `\\.` consumes an escaped char as one unit, so the match stops at an
    // unescaped ':' (a pseudo-class) or '{' rather than swallowing it.
    for (const m of CSS.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) out.add(m[1].replace(/\\(.)/g, '$1'));
    return out;
};

/** The app's own hand-written classes are not Tailwind's responsibility. */
const ownClasses = () => {
    const style = (HTML.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
    return new Set([...style.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]));
};

/** Every class token the production file can emit, and how it was written. */
const harvest = () => {
    const found = new Map();
    const add = (raw, how) => String(raw)
        .replace(/\$\{[^}]*\}/g, ' ')                  // blank the template holes
        .split(/\s+/).forEach(t => { t = t.trim(); if (t && !found.has(t)) found.set(t, how); });

    for (const m of HTML.matchAll(/\bclass(?:Name)?\s*=\s*"([^"]*)"/g)) add(m[1], 'attribute');
    for (const m of HTML.matchAll(/\bclass(?:Name)?\s*=\s*'([^']*)'/g)) add(m[1], 'attribute');
    for (const m of HTML.matchAll(/\bclass(?:Name)?\s*=\s*`([^`]*)`/g)) add(m[1], 'template-literal');
    for (const m of HTML.matchAll(/\bclassList\.\w+\(([^)]*)\)/g))
        for (const l of m[1].matchAll(/['"`]([^'"`]+)['"`]/g)) add(l[1], 'classList');
    // Ternary branches inside a className template hole: `${x?'bg-a':'bg-b'}`.
    // Scoped to className assignments so prose elsewhere cannot leak in.
    for (const m of HTML.matchAll(/\bclass(?:Name)?\s*=\s*`([^`]*)`/g))
        for (const hole of m[1].matchAll(/\$\{[^}]*\}/g))
            for (const l of hole[0].matchAll(/['"`]([^'"`]+)['"`]/g)) add(l[1], 'dynamic-state-class');
    return found;
};

const BARE = new Set(['flex','grid','block','inline','contents','hidden','italic','uppercase','lowercase',
    'capitalize','relative','absolute','fixed','sticky','static','truncate','underline','border','rounded',
    'shadow','transition','transform','container','sr-only','invisible','visible','antialiased']);
const isUtility = (t) => t.includes('[') || BARE.has(t)
    || (/-/.test(t) && /^-?[a-z]/.test(t) && !/[^a-z0-9[\]().,%#/:_.-]/i.test(t));

/**
 * Classes assembled at runtime, which a static scan cannot see.
 *
 * Each entry must say what the complete set of values is and where they are
 * defined, and the test below EXPANDS it and checks every value really
 * resolves. Declaring a prefix is not enough; the expansion is the proof.
 */
const RUNTIME_COMPOSED = [{
    pattern: 'type-${...}',
    where: 'renderDashboard(), the weekly calendar tiles',
    // DAY_TYPES has exactly four keys and the expression is
    // `type-${_known?type:'unknown'}` with _known = !!DAY_TYPES[type], so the
    // emitted value is one of these five and nothing else.
    expandsTo: ['type-length', 'type-girth', 'type-stamina', 'type-rest', 'type-unknown'],
    definedIn: "the app's own <style>",
}];

describe('vendored CSS covers every class the app can emit', () => {
    test('ACCEPTANCE: no utility class is missing a rule', () => {
        const defined = definedSelectors(), own = ownClasses();
        const declared = new Set(RUNTIME_COMPOSED.flatMap(r => [r.pattern.split('${')[0]]));
        const missing = [];
        for (const [t, how] of harvest()) {
            if (own.has(t) || /^fa[srb]?$|^fa-/.test(t)) continue;   // app's own, or Font Awesome
            if (declared.has(t)) continue;                            // a declared runtime prefix
            if (!isUtility(t)) continue;
            if (!defined.has(t)) missing.push(`${t} (via ${how})`);
        }
        expect(missing).toEqual([]);
    });

    test('ACCEPTANCE: every runtime-composed class expands to something defined', () => {
        /* The declaration above is a claim. This is the check. If someone
           adds a DAY_TYPES key without a matching .type-X rule, the class
           silently stops applying and this fails. */
        const style = (HTML.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
        const defined = definedSelectors();
        const unresolved = [];
        for (const r of RUNTIME_COMPOSED)
            for (const v of r.expandsTo)
                if (!new RegExp(`\\.${v}(?![\\w-])`).test(style) && !defined.has(v))
                    unresolved.push(`${v} (from ${r.pattern} in ${r.where})`);
        expect(unresolved).toEqual([]);
    });

    test('REGRESSION: DAY_TYPES has not grown past the declared expansion', () => {
        // The expansion above is only sound while DAY_TYPES holds these four.
        const block = HTML.match(/const DAY_TYPES=\{([\s\S]*?)\n\};/);
        expect(block, 'DAY_TYPES block not found').toBeTruthy();
        const keys = [...block[1].matchAll(/^\s*([a-z]+)\s*:/gm)].map(m => m[1]).sort();
        expect(keys).toEqual(['girth', 'length', 'rest', 'stamina']);
    });

    test('ACCEPTANCE: no class is built by string concatenation', () => {
        /* The one construction the gate genuinely cannot follow. Template
           literals are fine because the class text is literal; `'bg-'+c` is
           not, and must never appear. */
        const suspects = [];
        for (const re of [
            /['"`](?:bg|text|border|from|to|via|ring|shadow|fill|stroke|p|m|w|h|gap)-[a-z]*['"`]\s*\+/g,
            /\+\s*['"`]-?[0-9]{2,3}['"`]\s*\+/g,
        ]) for (const m of HTML.matchAll(re))
            suspects.push(`line ${HTML.slice(0, m.index).split('\n').length}: ${m[0].trim()}`);
        expect(suspects).toEqual([]);
    });

    test('REGRESSION: no invalid leading-zero opacity utility returns', () => {
        // bg-blue-500/08 and friends produce no CSS at all. 23 of them
        // shipped with no fill until Phase 3B.
        const bad = [...HTML.matchAll(/\b(?:bg|text|border)-[a-z]+-\d+\/0\d\b/g)].map(m => m[0]);
        expect([...new Set(bad)]).toEqual([]);
    });

    test('REGRESSION: every step screen closes its own tags', () => {
        /* The whole app is one 7,900-line HTML document, so an unbalanced
           <div> does not error: the browser silently re-nests, and #step-0
           quietly swallows the Manual, #step-1 and every modal after it.
           Phase 3C.1 did exactly that while moving blocks around, and only
           an unrelated test noticed, several layers downstream. This walks
           the depth between each step and the next. */
        const ids = ['step-welcome','step-0','step-1','step-2','step-3','step-3b','step-4','step-5'];
        const offenders = [];
        for (let i = 0; i < ids.length - 1; i++) {
            const from = HTML.indexOf(`<div id="${ids[i]}"`);
            const to = HTML.indexOf(`<div id="${ids[i + 1]}"`);
            if (from < 0 || to < 0 || to < from) continue;
            let depth = 0;
            for (const m of HTML.slice(from, to).matchAll(/<div\b[^>]*>|<\/div>/g))
                depth += m[0].startsWith('</') ? -1 : 1;
            if (depth !== 0) offenders.push(`${ids[i]} ends at depth ${depth}`);
        }
        expect(offenders).toEqual([]);
    });

    test('REGRESSION: the styling CDNs stay out of the document', () => {
        for (const host of ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com'])
            expect(HTML, `${host} must not be referenced`).not.toContain(host);
    });
});
