#!/usr/bin/env node
/**
 * Write the canonical header into every public page, and the canonical guide
 * stylesheet into every Learning Centre guide.
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
 * Edit tools/site-nav.css, tools/site-nav.html and tools/guide.css. Never
 * edit a page's copy of any of them.
 */
import { readFileSync, writeFileSync } from 'node:fs';
export const ORIGIN = 'https://theblueprint.site';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* The Learning Centre guides. These are public pages, so they take the
   shared header like everything else, and they additionally take the shared
   guide stylesheet, because six hand-copied stylesheets would drift into six
   different-looking articles within a month. Declared before PAGES, which
   spreads it. */
export const GUIDES = [
    'performance-anxiety-erections/index.html',
    'blood-sugar-erections/index.html',
    'hydration-erections/index.html',
    'pelvic-floor-premature-ejaculation/index.html',
    'hip-mobility-sexual-performance/index.html',
    'improve-sexual-stamina/index.html',
    'cardio-erections/index.html',
    'weaker-morning-erections/index.html',
    'anxiety-or-physical-ed/index.html',
    'finish-quickly-penetration/index.html',
    'ejaculation-warning-signs/index.html',
    'arousal-awareness-practice/index.html',
    'last-longer-alone-than-sex/index.html',
    'breathing-manage-arousal/index.html',
    'sleep-erections-libido/index.html',
    'stay-composed-during-arousal/index.html',
];

/* The Research Lab pages. Declared before STYLED, which spreads it. */
export const RESEARCH = [
    'research-lab/index.html',
    'research-lab/manual-techniques/index.html',
];

/* Pages that take the shared header and the design system but must NOT be
   indexed, so they are deliberately absent from the sitemap.

   /welcome/ only means something to someone who just paid, and its URL
   carries a Stripe session id. /app/ is already absent from PAGES for the
   same class of reason: it is the application behind sign-in, not a page for
   a search engine. */
export const NOINDEX = [
    'welcome/index.html',
];

/* Pages that take tools/guide.css: the guides, plus the assessment.
   The assessment is not a guide. It runs logic, it has no references and
   no action plan, and the guide content rules in tests/learnGuides.test.js
   would be nonsense applied to it. It does need the same design system,
   which is what this list is for. */
export const STYLED = [...GUIDES, 'assessment/index.html', ...RESEARCH, 'size-enhancement/index.html', ...NOINDEX];

/* The Research Lab. Takes the design system like the assessment, and
   additionally takes tools/research.css for the evidence labels and method
   cards, which exist nowhere else on the site. */
export const RESEARCH_CSS_PAGES = [...RESEARCH, 'size-enhancement/index.html'];

/* Every public page. A new learning-centre guide is added here, and
   tests/siteNav.test.js reads the same list, so a page that is never synced
   fails rather than quietly shipping without a header. */
export const PAGES = [
    'index.html',
    'learn/index.html',
    'daily/index.html',
    'last-longer/index.html',
    'stronger-erections/index.html',
    'better-sexual-performance/index.html',
    'how-it-works/index.html',
    'whats-inside/index.html',
    'faq/index.html',
    'support/index.html',
    'safety/index.html',
    'assessment/index.html',
    ...RESEARCH,
    'size-enhancement/index.html',
    ...GUIDES,
];

export const CSS_START = '/* SITE-NAV:START */';
export const CSS_END = '/* SITE-NAV:END */';
export const HTML_START = '<!-- SITE-NAV:START -->';
export const HTML_END = '<!-- SITE-NAV:END -->';
export const GUIDE_START = '/* GUIDE-CSS:START */';
export const GUIDE_END = '/* GUIDE-CSS:END */';
export const RESEARCH_START = '/* RESEARCH-CSS:START */';
export const RESEARCH_END = '/* RESEARCH-CSS:END */';

export const navCss = () => readFileSync(path.join(ROOT, 'tools/site-nav.css'), 'utf8').trim();
export const navHtml = () => readFileSync(path.join(ROOT, 'tools/site-nav.html'), 'utf8').trim();
export const guideCss = () => readFileSync(path.join(ROOT, 'tools/guide.css'), 'utf8').trim();
export const researchCss = () => readFileSync(path.join(ROOT, 'tools/research.css'), 'utf8').trim();

/** Replace between markers, or insert them if this page has none yet. */
function put(src, startTag, endTag, body, insert) {
    const s = src.indexOf(startTag);
    const e = src.indexOf(endTag);
    if (s !== -1 && e !== -1 && e > s) {
        return src.slice(0, s) + startTag + '\n' + body + '\n' + endTag + src.slice(e + endTag.length);
    }
    return insert(src, startTag + '\n' + body + '\n' + endTag);
}

export function render(src, isGuide = false, isResearch = false) {
    let out = src;
    if (isResearch) {
        out = put(out, RESEARCH_START, RESEARCH_END, researchCss(), () => {
            throw new Error('a Research Lab page must carry the RESEARCH-CSS markers');
        });
    }
    if (isGuide) {
        /* Replace only. A guide is authored with these markers already in
           its <style>, above the header block, so the ordering is whatever
           the author laid out and never depends on which sync ran first. */
        out = put(out, GUIDE_START, GUIDE_END, guideCss(), () => {
            throw new Error('a guide must carry the GUIDE-CSS markers in its <style>');
        });
    }
    out = put(out, CSS_START, CSS_END, navCss(), (html, block) => {
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

/**
 * The sitemap, built from the same PAGES list so a new page cannot be
 * published and then quietly left undiscoverable.
 *
 * No <lastmod>. A date we cannot derive truthfully is a fabricated signal,
 * and lastmod is optional, so the honest sitemap is the one without it.
 * /app/ is deliberately absent: it is the application behind sign-in, not a
 * page for a search engine to index.
 */
export function sitemap() {
    const urls = PAGES.map(p => ORIGIN + '/' + p.replace(/(^|\/)index\.html$/, '$1'))
        .map(u => (u.endsWith('/') ? u : u + '/'));
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')
        + '\n</urlset>\n';
}

const check = process.argv.includes('--check');
let drifted = 0;
for (const rel of [...PAGES, ...NOINDEX]) {
    const p = path.join(ROOT, rel);
    const before = readFileSync(p, 'utf8');
    const after = render(before, STYLED.includes(rel), RESEARCH_CSS_PAGES.includes(rel));
    if (before === after) continue;
    drifted++;
    if (check) console.log('DRIFT', rel);
    else { writeFileSync(p, after); console.log('wrote', rel); }
}
{
    const p = path.join(ROOT, 'sitemap.xml');
    const want = sitemap();
    let have = '';
    try { have = readFileSync(p, 'utf8'); } catch { /* not written yet */ }
    if (have !== want) {
        drifted++;
        if (check) console.log('DRIFT sitemap.xml');
        else { writeFileSync(p, want); console.log('wrote sitemap.xml'); }
    }
}

if (check) {
    console.log(drifted ? `${drifted} file(s) out of sync` : 'all pages in sync');
    process.exit(drifted ? 1 : 0);
}
console.log(drifted ? `${drifted} file(s) updated` : 'already in sync');
