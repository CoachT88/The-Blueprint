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

describe('The App product page: purchase-ready path without a mobile gallery detour', () => {
  test('one early and one final purchase action share the established checkout route', () => {
    const top = main.indexOf('class="product-quick-action"');
    const gallery = main.indexOf('class="app-preview"');
    const offer = main.indexOf('<h2>What you get for $99</h2>');
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(gallery);
    expect(gallery).toBeLessThan(offer);
    expect(main.split('<a class="cta" href="/#get">Get The Blueprint, $99</a>')).toHaveLength(3);
    expect(main).toContain('One payment, no subscription.');
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
