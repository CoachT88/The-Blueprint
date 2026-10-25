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

    it('INTERNAL NOTES AND BACKEND SOURCE ARE NOT SERVED', () => {
        /* The other direction of the same mistake. `src` was excluded when
           it had to ship; `docs`, `supabase` and `functions` were shipping
           when they had to be excluded.

           wrangler.jsonc points assets.directory at the repository root, so
           anything not named here is a fetchable URL. docs/ was serving the
           carried-debt list, the known-failures list and the content
           standards to anyone who guessed the path.

           This closes the theblueprint.site vector only. The repository is
           public, so these files remain readable on GitHub. */
        const mustNotShip = [
            'docs/carried-debt.md',
            'docs/known-timezone-failures.md',
            'docs/assessment-logic.md',
            'docs/learning-centre-content-standard.md',
            'supabase/members-rls-hardening.sql',
            'functions/api/kofi-webhook.js',
            'tests/deployedAssets.test.js',
            'tools/sync-site-nav.mjs',
            'package.json',
            'wrangler.jsonc',
        ];
        const served = mustNotShip.filter(f => !isIgnored(f, rules));
        expect(served, `served to the public internet: ${served.join(', ')}`).toEqual([]);
    });

    it('and the things the site genuinely needs are still served', () => {
        /* The exclusion above must not repeat the src/ outage. */
        const mustShip = [
            'src/nextBestAction.js',
            'app/index.html',
            'index.html',
            'img/og-card.jpg',
            'sitemap.xml',
            'robots.txt',
            'research-lab/index.html',
            'assessment/index.html',
        ];
        const blocked = mustShip.filter(f => existsSync(path.join(ROOT, f)) && isIgnored(f, rules));
        expect(blocked, `excluded but required: ${blocked.join(', ')}`).toEqual([]);
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

    it('DECLARES EXACTLY ONE WORKER, AND IT IS PRODUCTION', () => {
        /* A second Worker was added and then removed on instruction: the
           integration deploys to the one production Worker with checkout
           gated off, rather than to a parallel test deployment. So the
           config must declare no named environments at all, because a
           stray one is a second deployment nobody is watching. */
        const config = JSON.parse(readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8'));
        expect(config.name).toBe('the-blueprint');
        expect(config.env, 'a named environment is declared, which is a second Worker')
            .toBeUndefined();
    });

    it('production declares no Stripe route and no Stripe secrets', () => {
        /* wrangler.jsonc is committed. Every Stripe value is a Worker secret
           set with `wrangler secret put`, so none of them may appear here. */
        const raw = readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
        for (const name of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
            'STRIPE_PRICE_ID', 'STRIPE_LIVEMODE', 'sk_test_', 'sk_live_', 'whsec_']) {
            expect(raw, `wrangler.jsonc mentions ${name}`).not.toContain(name);
        }
        const config = JSON.parse(raw);
        expect(config.vars, 'production declares plaintext vars').toBeUndefined();
    });

    it('wrangler.jsonc stays strict JSON, because a test parses it', () => {
        /* It carries a .jsonc extension and has always been comment-free. I
           added explanatory comments while setting up the test environment
           and broke the parse above, so this records the constraint: the
           explanation belongs in the runbook, not in this file. */
        const raw = readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
        expect(() => JSON.parse(raw)).not.toThrow();
        expect(raw, 'a line comment crept back in').not.toMatch(/^\s*\/\//m);
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
