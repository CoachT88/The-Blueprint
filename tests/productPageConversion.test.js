import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const page = readFileSync('whats-inside/index.html', 'utf8');
const main = page.slice(page.indexOf('<main class="wrap">'), page.indexOf('</main>'));

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

  test('genuine owner screenshots stay visible in a keyboard-accessible, swipeable mobile gallery', () => {
    expect(main).toContain('src="/img/app-today-2026.jpg"');
    expect(main).toContain('src="/img/app-guided-practice-2026.jpg"');
    expect(main).toContain('class="preview-grid" role="region"');
    expect(main).toContain('tabindex="0"');
    expect(main).toContain('class="preview-hint"');
    expect(page).toContain('.preview-grid{display:flex;gap:14px;');
    expect(page).toContain('scroll-snap-type:x mandatory');
    expect(page).toContain('overflow-x:auto');
    expect(page).toContain('scroll-snap-align:start');
  });

  test('truthful scope and access directions are preserved', () => {
    expect(main).toContain('sign in with the same email address');
    expect(main).toContain('No exercise or technique can guarantee changes');
    expect(main).toContain('href="/support/"');
    expect(main).toContain('href="/faq/"');
    expect(main).not.toContain('limited time');
  });
});
