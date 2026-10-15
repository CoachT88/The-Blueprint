import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * EVERY MODULE THE BROWSER IMPORTS MUST SURVIVE DEPLOYMENT.
 *
 * This test exists because of a production outage that every other test
 * passed through without noticing.
 *
 * app/index.html ends with a <script type="module"> that imports eighteen
 * files from ../src by URL and only then assigns window.BP. `.assetsignore`
 * excluded `src`, so Cloudflare never uploaded those files, every import
 * 404'd, the module never executed, and window.BP stayed undefined. Three
 * separate symptoms followed, all silent:
 *
 *   renderToday()         returned at `if(!window.BP) return;`, leaving the
 *                         static markup, which is a blank Today card
 *   commitPreferredName() returned true without saving a name
 *   the guided tour       pointed at sections that had never rendered
 *
 * Nothing caught it because the e2e server serves the repository root: the
 * imports resolved locally and 404'd only once deployed. A browser test
 * cannot see this, because the thing that is wrong is the upload manifest.
 *
 * So the check is static: read the real import list out of the real page,
 * and read the real ignore file, and require that none of the former is
 * matched by the latter.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const page = readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');

/** Every bare `from '...'` specifier inside a module script in the page. */
function browserImports(html) {
    const out = [];
    const moduleBlocks = [...html.matchAll(/<script\b[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/g)];
    for (const [, body] of moduleBlocks) {
        for (const m of body.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) out.push(m[1]);
    }
    return [...new Set(out)];
}

/** The ignore file's meaningful lines, comments and blanks dropped. */
function ignoreRules() {
    const file = path.join(ROOT, '.assetsignore');
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
}

/* Cloudflare treats a bare directory name as that whole subtree, which is
   exactly how `src` took eighteen files out with one word. */
function isIgnored(relPath, rules) {
    const parts = relPath.split('/');
    return rules.some(rule => {
        const r = rule.replace(/^\/+|\/+$/g, '');
        if (relPath === r) return true;                       // the exact file
        if (parts.includes(r) && !r.includes('/')) return true; // a directory name
        if (relPath.startsWith(r + '/')) return true;          // a path prefix
        return false;
    });
}

describe('deployed assets cover what the browser imports', () => {
    const imports = browserImports(page);
    const rules = ignoreRules();

    it('the page really does import browser modules', () => {
        /* If this ever reads zero, the extraction above has broken and every
           assertion below would pass vacuously. */
        expect(imports.length).toBeGreaterThan(5);
        expect(imports.some(s => s.includes('../src/'))).toBe(true);
    });

    it('EVERY IMPORTED FILE EXISTS ON DISK', () => {
        const missing = [];
        for (const spec of imports) {
            if (!spec.startsWith('.')) continue;              // not a relative file
            const abs = path.resolve(ROOT, 'app', spec);
            if (!existsSync(abs)) missing.push(spec);
        }
        expect(missing).toEqual([]);
    });

    it('AND NONE OF THEM IS EXCLUDED FROM DEPLOYMENT', () => {
        /* The actual outage, as an assertion. With `src` in .assetsignore this
           lists all eighteen modules. */
        const excluded = [];
        for (const spec of imports) {
            if (!spec.startsWith('.')) continue;
            const abs = path.resolve(ROOT, 'app', spec);
            const rel = path.relative(ROOT, abs).split(path.sep).join('/');
            if (isIgnored(rel, rules)) excluded.push(rel);
        }
        expect(excluded).toEqual([]);
    });

    it('ships every local stylesheet linked by the member app', () => {
        const links=[...page.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)]
            .map(m=>m[1]).filter(href=>href.startsWith('.'));
        expect(links).toContain('./blueprint.css');
        for(const href of links){
            const file=path.resolve(ROOT,'app',href);
            expect(existsSync(file),href).toBe(true);
            expect(isIgnored(path.relative(ROOT,file),rules),href).toBe(false);
        }
    });

    it('deploys the production Worker by its exact current name', () => {
        /* A stale Worker name silently deploys the wrong service. PR #111
           exposed an out-of-date name alongside a Workers Builds command
           running preview instead of production deploy. Keep this invariant
           independent of the Cloudflare dashboard's deploy command. */
        const config = JSON.parse(readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8'));
        expect(config.name).toBe('the-blueprint');
        expect(config.main).toBe('src/worker.js');
        expect(config.assets.directory).toBe('.');
    });

    it('the worker is still excluded, because wrangler bundles it', () => {
        /* The one genuinely server-side file in src/. It must NOT be served,
           and keeping this assertion stops the fix above from being widened
           into "ignore nothing". */
        expect(isIgnored('src/worker.js', rules)).toBe(true);
    });

    it('backend directories are still excluded', () => {
        for (const dir of ['functions', 'supabase', 'tests', 'tools']) {
            expect(isIgnored(dir + '/anything.js', rules)).toBe(true);
        }
    });

    it('window.BP is assigned by that module, which is why this matters', () => {
        /* The causal link, pinned. If the assignment ever moves out of the
           module, the reasoning in this file needs rewriting rather than
           quietly becoming wrong. */
        const moduleBlocks = [...page.matchAll(/<script\b[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/g)];
        const assigns = moduleBlocks.filter(([, body]) => /window\.BP\s*=/.test(body));
        expect(assigns.length).toBe(1);
    });
});
