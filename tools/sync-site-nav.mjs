#!/usr/bin/env node
/**
 * Write the canonical header into every public page.
 *
 * WHY A SCRIPT AND NOT A <link>. Every page here is self-contained: one
 * inline <style>, no external stylesheet, no font CDN.
 * tests/landingCss.test.js enforces that on the home page and says why. So
 * "one shared navigation" has to mean one SOURCE, copied in, with a test
 * that fails when a copy drifts. That is tests/siteNav.test.js.
 *
 *   node tools/sync-site-nav.mjs          write the pages
 *   node tools/sync-site-nav.mjs --check  report drift, write nothing
 *
 * Edit tools/site-nav.css and tools/site-nav.html. Never edit a page's copy.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Every public page. A new learning-centre guide is added here, and
   tests/siteNav.test.js reads the same list, so a page that is never synced
   fails rather than quietly shipping without a header. */
export const PAGES = [
    'index.html',
    'learn/index.html',
    'last-longer/index.html',
    'stronger-erections/index.html',
    'performance-anxiety-erections/index.html',
    'better-sexual-performance/index.html',
    'how-it-works/index.html',
    'whats-inside/index.html',
    'faq/index.html',
    'support/index.html',
    'safety/index.html',
];

export const CSS_START = '/* SITE-NAV:START */';
export const CSS_END = '/* SITE-NAV:END */';
export const HTML_START = '<!-- SITE-NAV:START -->';
export const HTML_END = '<!-- SITE-NAV:END -->';

export const navCss = () => readFileSync(path.join(ROOT, 'tools/site-nav.css'), 'utf8').trim();
export const navHtml = () => readFileSync(path.join(ROOT, 'tools/site-nav.html'), 'utf8').trim();

/** Replace between markers, or insert them if this page has none yet. */
function put(src, startTag, endTag, body, insert) {
    const s = src.indexOf(startTag);
    const e = src.indexOf(endTag);
    if (s !== -1 && e !== -1 && e > s) {
        return src.slice(0, s) + startTag + '\n' + body + '\n' + endTag + src.slice(e + endTag.length);
    }
    return insert(src, startTag + '\n' + body + '\n' + endTag);
}

export function render(src) {
    let out = put(src, CSS_START, CSS_END, navCss(), (html, block) => {
        /* Into the page's one <style>, at the end, so a page rule can still
           override the header if it ever has to. */
        const i = html.lastIndexOf('</style>');
        if (i === -1) throw new Error('no <style> block to put the header CSS in');
        return html.slice(0, i) + '\n' + block + '\n' + html.slice(i);
    });
    out = put(out, HTML_START, HTML_END, navHtml(), (html, block) => {
        const m = html.match(/<body[^>]*>/i);
        if (!m) throw new Error('no <body> to put the header in');
        const i = m.index + m[0].length;
        return html.slice(0, i) + '\n' + block + '\n' + html.slice(i);
    });
    return out;
}

const check = process.argv.includes('--check');
let drifted = 0;
for (const rel of PAGES) {
    const p = path.join(ROOT, rel);
    const before = readFileSync(p, 'utf8');
    const after = render(before);
    if (before === after) continue;
    drifted++;
    if (check) console.log('DRIFT', rel);
    else { writeFileSync(p, after); console.log('wrote', rel); }
}
if (check) {
    console.log(drifted ? `${drifted} page(s) out of sync` : 'all pages in sync');
    process.exit(drifted ? 1 : 0);
}
console.log(drifted ? `${drifted} page(s) updated` : 'already in sync');
