import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const PAGES = {
  food: 'research-lab/nitric-oxide-foods/index.html',
  supplements: 'research-lab/supplements/index.html',
  reports: 'research-lab/community-reports/index.html',
};
const read = path => readFileSync(path, 'utf8');
const article = src => src.slice(src.indexOf('<main class="wrap">'), src.indexOf('</main>') + 7);

describe('Research Lab expansion: medically cautious, inspectable and navigable', () => {
  test('three investigations are linked from the Lab and have sourced canonical pages', () => {
    const hub = article(read('research-lab/index.html'));
    const sitemap = read('sitemap.xml');
    for (const [name, path] of Object.entries(PAGES)) {
      const slug = '/' + path.slice(0, -'index.html'.length);
      const src = read(path);
      expect(hub, name).toContain(`href="${slug}"`);
      expect(sitemap, name).toContain(`<loc>https://theblueprint.site${slug}</loc>`);
      expect(src).toContain(`<link rel="canonical" href="https://theblueprint.site${slug}">`);
      expect(article(src).match(/<h1[ >]/g), name).toHaveLength(1);
      expect(src).toContain('No clinician has reviewed this page.');
      expect(src).toContain('<ul class="refs">');
      expect(article(src)).not.toContain('<a class="cta"');
    }
  });

  test('community size never masquerades as verified results or unique men', () => {
    const t = article(read(PAGES.reports));
    expect(t).toContain('165,000 members');
    expect(t).toContain('200,000');
    expect(t).toContain('82,000');
    expect(t).toContain('not counts of people reporting verified gains');
    expect(t).toContain('Members can belong to multiple groups.');
    expect(t).toContain('Community-reported, unverified');
    expect(t).toContain('longer abstinence intervals');
  });

  test('food content distinguishes vascular mechanism from ED treatment claims', () => {
    const t = article(read(PAGES.food));
    expect(t).toContain('Blood pressure is not an erection score.');
    expect(t).toContain('Eating watermelon is not equivalent');
    expect(t).toContain('medical evaluation');
  });

  test('supplement investigation separates controlled research from anecdotes and discloses safety', () => {
    const t = article(read(PAGES.supplements));
    for (const s of ['L-citrulline','arginine','ginseng','zinc','lecithin','pygeum']) {
      expect(t.toLowerCase(), s).toContain(s.toLowerCase());
    }
    expect(t).toContain('unlisted drug ingredients');
    expect(t).toContain('NCCIH');
    expect(t).toContain('FDA warning');
    expect(t).not.toMatch(/\b(?:take|use|swallow)\s+\d+(?:\.\d+)?\s*(?:mg|g|capsules)/i);
  });

  test('source links on each article are HTTPS and independent of our service', () => {
    for (const path of Object.values(PAGES)) {
      const t = article(read(path));
      const refs = t.match(/<ul class="refs">([\s\S]*?)<\/ul>/);
      expect(refs).not.toBeNull();
      const sources = [...refs[1].matchAll(/<a href="([^"]+)"([^>]*)>/g)];
      expect(sources.length, path).toBeGreaterThanOrEqual(3);
      for (const [, url, attrs] of sources) {
        expect(url, path).toMatch(/^https:\/\//);
        expect(url, path).not.toContain('theblueprint.site');
        expect(attrs).toContain('rel="noopener noreferrer"');
      }
    }
  });
});
