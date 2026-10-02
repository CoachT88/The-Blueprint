import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// app/index.html carries the entire app in one inline <script>. The sales
// page took the site root, so the app moved down a level; this reads the app. A syntax error there
// takes the whole thing down, and because there is no build step nothing else
// would catch it before deploy. This parses the script without executing it, so
// it costs milliseconds and runs on every `npm test`.
const ROOT = path.resolve(import.meta.dirname, '..');
const html = readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');

function inlineScripts(source) {
    return [...source.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
        .map(m => ({ isModule: /type\s*=\s*["']module["']/.test(m[1]), body: m[2] }));
}

describe('app/index.html inline script', () => {
    const scripts = inlineScripts(html);
    const classic = scripts.filter(s => !s.isModule);
    const modules = scripts.filter(s => s.isModule);

    test('has exactly one classic script block, which is the app', () => {
        expect(classic.length).toBe(1);
    });

    test('has exactly one module script block, which wires in src/', () => {
        // Phase 2A.2. The decision modules are imported rather than copied, so
        // there is one definition of the precedence and nothing to keep in sync.
        expect(modules.length).toBe(1);
    });

    test('the app script parses without a syntax error', () => {
        // new vm.Script compiles but does not run, which is what we want: the app
        // expects a DOM and would throw immediately in Node.
        expect(() => new vm.Script(classic[0].body, { filename: 'app/index.html:inline' })).not.toThrow();
    });

    test('every module the page imports actually exists at that path', () => {
        // This is the failure mode of the whole wiring: a relative path that
        // resolves in nobody's head. A 404 here leaves the Today card on its
        // placeholder in production, and no unit test would notice, because
        // the modules themselves are imported directly by their own suites.
        const specifiers = [...modules[0].body.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
        expect(specifiers.length).toBeGreaterThan(0);
        for (const spec of specifiers) {
            expect(spec.startsWith('.'), `${spec} must be a relative path`).toBe(true);
            const resolved = path.resolve(ROOT, 'app', spec);
            expect(existsSync(resolved), `${spec} resolves to ${resolved}, which does not exist`).toBe(true);
        }
    });

    test('the module script only wires, it does not decide', () => {
        // Decision logic belongs in src/ where vitest can execute it. If this
        // block grows an if or a loop, something has leaked back into the page.
        const body = modules[0].body.replace(/\/\/[^\n]*/g, '');
        expect(/\b(if|for|while|switch)\s*\(/.test(body.replace(/if \(typeof window.renderDashboard[^\n]*/, ''))).toBe(false);
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
