import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const page = readFileSync('whats-inside/index.html', 'utf8');
const main = page.slice(page.indexOf('<main class="wrap">'), page.indexOf('</main>'));

// Find the actual media query block, rather than finding CSS strings that may
// have been moved outside the breakpoint. Balanced braces catch accidental
// scope changes while preserving the existing self-contained page structure.
function cssRuleInMediaQuery(source, query, selector) {
  const start = source.indexOf(query);
  expect(start, 'mobile breakpoint must exist').toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) { end = i; break; }
  }
  expect(end, 'mobile breakpoint must close').toBeGreaterThan(open);
  const body = source.slice(open + 1, end);
  const selectorStart = body.indexOf(selector + '{');
  expect(selectorStart, selector + ' must be inside the mobile query').toBeGreaterThanOrEqual(0);
  const valueStart = selectorStart + selector.length + 1;
  return body.slice(valueStart, body.indexOf('}', valueStart));
}

const home = readFileSync('index.html', 'utf8');

describe('The hero promises a system and this page delivers one', () => {
  test('THE SECONDARY CTA LABEL AND ITS DESTINATION AGREE', () => {
    /* The hero's second button used to read "See the $99 app" and now reads
       "Show me the system". A curiosity label is only honest if the page it
       opens answers the curiosity, and this page used to open with a price
       headline.

       The label is pinned deliberately, not parsed. A first attempt pulled
       the longest word out of whatever the button said and looked for it on
       this page; renaming the button to "Show me the blueprint" passed,
       because the word blueprint is everywhere. A rename SHOULD fail here.
       Changing the promise is exactly the moment somebody has to come back
       and check that the destination still keeps it. */
    const cta = home.match(/<a class="btn ghost" href="\/whats-inside\/">([^<]+)<\/a>/);
    expect(cta, 'the hero has no secondary CTA to /whats-inside/').not.toBeNull();
    expect(cta[1], 'the hero promise changed: re-check that this page answers it')
      .toBe('Show me the system');

    const h1 = main.match(/<h1>([^<]+)<\/h1>/)[1];
    const lead = main.match(/<p class="lead">([\s\S]*?)<\/p>/)[1];
    expect(h1.toLowerCase(), 'the h1 does not answer "show me the system"')
      .toContain('system');
    /* And it says what the system IS, in the first screen, rather than
       using the word and moving on. */
    expect(lead.toLowerCase()).toContain('the system is');
    for (const part of ['goal', 'session', 'recovery', 'record']) {
      expect(lead.toLowerCase(), `the lead never names the ${part}`).toContain(part);
    }
  });

  test('and the one-time price is still unmissable above the fold', () => {
    /* Leading with the system must not bury what it costs. Three places
       carry it before a reader scrolls: the lead, the early button, and the
       page title. */
    const lead = main.match(/<p class="lead">([\s\S]*?)<\/p>/)[1];
    expect(lead).toContain('$99');
    expect(lead).toContain('no subscription');
    const quick = main.match(/<div class="product-quick-action">([\s\S]*?)<\/div>/)[1];
    expect(quick).toContain('$99');
    expect(page).toMatch(/<title>[^<]*\$99|<title>[^<]*What It Costs|<title>[^<]*and What It Costs/i);
  });
});

describe('The App product page: purchase-ready path without a mobile gallery detour', () => {
  test('one early and one final purchase action share the established checkout route', () => {
    const top = main.indexOf('class="product-quick-action"');
    const gallery = main.indexOf('class="app-preview"');
    const offer = main.indexOf('<h2>What you get for $99</h2>');
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(gallery);
    expect(gallery).toBeLessThan(offer);
    expect(main.split('<a class="cta" href="/#get">Get The Blueprint, $99</a>')).toHaveLength(3);
    /* The lead now reads "One payment, no subscription, $99 once", so the
       terms are asserted as terms rather than as one frozen sentence. */
    expect(main).toContain('One payment, no subscription');
    expect(main).toContain('$99 once');
    expect(main).toContain('Future app updates are included at no extra cost');
  });

  test('real owner screenshots are a mobile swipe gallery, not a desktop scroller', () => {
    expect(main).toContain('src="/img/app-today-2026.jpg"');
    expect(main).toContain('src="/img/app-guided-practice-2026.jpg"');
    const mobileGridCSS = cssRuleInMediaQuery(page, '@media(max-width:540px)', '.preview-grid');
    for (const style of ['display:flex', 'scroll-snap-type:x mandatory', 'overflow-x:auto']) {
      expect(mobileGridCSS).toContain(style);
    }
    expect(cssRuleInMediaQuery(page, '@media(max-width:540px)', '.preview-card'))
      .toContain('scroll-snap-align:start');
    // Default mode stays a two-column, non-scrollable grid.
    expect(page).toContain('.preview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))');
  });

  test('gallery itself is keyboard-focusable, explicitly named and described', () => {
    const grid = main.match(/<div class="preview-grid"([^>]*)>/);
    expect(grid, 'gallery div present').not.toBeNull();
    const attrs = grid[1];
    expect(attrs).toContain('role="region"');
    expect(attrs).toContain('aria-label="Current Blueprint app screenshots, scroll sideways to see both"');
    expect(attrs).toContain('aria-describedby="product-gallery-hint"');
    expect(attrs).toContain('tabindex="0"');
    const hint = '<p class="preview-hint" id="product-gallery-hint">Swipe sideways to explore both current app screens.</p>';
    expect(main).toContain(hint);
    expect(main.indexOf(hint)).toBeLessThan(main.indexOf(grid[0]));
  });

  test('truthful scope and access directions are preserved', () => {
    expect(main).toContain('sign in with the same email address');
    expect(main).toContain('No exercise or technique can guarantee changes');
    expect(main).toContain('href="/support/"');
    expect(main).toContain('href="/faq/"');
    expect(main).not.toContain('limited time');
  });
});
