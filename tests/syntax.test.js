import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// index.html carries the entire app in one inline <script>. A syntax error there
// takes the whole thing down, and because there is no build step nothing else
// would catch it before deploy. This parses the script without executing it, so
// it costs milliseconds and runs on every `npm test`.
const ROOT = path.resolve(import.meta.dirname, '..');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function inlineScripts(source) {
    return [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
}

describe('index.html inline script', () => {
    const scripts = inlineScripts(html);

    test('has exactly one inline script block', () => {
        expect(scripts.length).toBe(1);
    });

    test('parses without a syntax error', () => {
        // new vm.Script compiles but does not run, which is what we want: the app
        // expects a DOM and would throw immediately in Node.
        expect(() => new vm.Script(scripts[0], { filename: 'index.html:inline' })).not.toThrow();
    });

    test('contains no stray markdown code fences', () => {
        // Thirteen of these were once sitting in the markup and rendered as
        // literal ``` on screen, including on the login page.
        const fences = html.split('\n').filter(l => /^\s*```\s*$/.test(l));
        expect(fences).toHaveLength(0);
    });

    test('every element id is unique', () => {
        // Duplicate ids silently break getElementById wiring in a file this size.
        const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
        const seen = new Set();
        const dupes = ids.filter(id => (seen.has(id) ? true : (seen.add(id), false)));
        expect([...new Set(dupes)]).toEqual([]);
    });
});
