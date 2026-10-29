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

  test('beetroot powder is named as an alternative, with nitrate variability and source attribution', () => {
    const t = article(read(PAGES.food));
    expect(t).toContain('Beet powder: a convenient alternative');
    expect(t).toContain('nitrate amount per serving');
    expect(t).toContain('nitrate content across products');
    expect(t).toContain('https://pmc.ncbi.nlm.nih.gov/articles/PMC8512783/');
    expect(t).toContain('https://www.sciencedirect.com/science/article/pii/S2772502225005207');
  });

  test('pure L-citrulline vs malate explains the compound ratio and limits conclusions to tested outcomes', () => {
    const t = article(read(PAGES.supplements));
    for (const term of ['Pure L-citrulline:', 'Citrulline malate:', '2:1', 'some of the powder weight is malate',
      'not erection quality or sexual stamina', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12143003/']) {
      expect(t).toContain(term);
    }
    expect(t).toContain('2026 systematic review');
    expect(t).not.toContain('citrulline malate is more effective for erections');
  });

  test('interactive claim checker is accessible and has no personal data collection', () => {
    const src = read(PAGES.reports);
    const main = article(src);
    for (const s of ['id="claim-lab"', 'id="claim-stage" hidden',
      'role="status" aria-live="polite"', 'id="claim-choices"',
      'id="claim-feedback"', 'id="claim-next"', 'id="claim-finished" hidden',
      'id="original-reports"', 'id="claim-share"']) {
      expect(main).toContain(s);
    }
    expect(src).toContain('document.getElementById');
    expect(src).toContain('navigator.share');
    expect(src).not.toContain('localStorage');
    expect(src).not.toContain('sessionStorage');
    expect(src).not.toContain('fetch(');
    expect(src).toContain('https://theblueprint.site/research-lab/community-reports/#claim-lab');
    expect(src).toContain('current >= items.length');
  });

  test('nutrition and supplement pages include traceable sexual-performance firsthand accounts, including no benefit', () => {
    const food = article(read(PAGES.food));
    const supplements = article(read(PAGES.supplements));
    expect(food).toContain('What men report about erections');
    expect(food).toContain('Beet powder and powdered blends');
    expect(food).toContain('Little or no noticeable improvement');
    expect(food).toContain('https://www.reddit.com/r/Supplements/comments/1lx9nos/');
    expect(food).toContain('https://www.reddit.com/r/erectiledysfunction/comments/1kxflok/');
    expect(supplements).toContain('What men report: pure L-citrulline vs citrulline malate');
    expect(supplements).toContain('Malate felt better to one user');
    expect(supplements).toContain('Some men favor pure L-citrulline');
    expect(supplements).toContain('Some men notice no sexual difference');
    expect(supplements).toContain('https://www.reddit.com/r/Biohackers/comments/1vbgvgu/');
    expect(supplements).toContain('https://www.reddit.com/r/Supplements/comments/1mvcaqg/');
    expect(supplements).toContain('no reliable head-to-head clinical evidence');
  });

  test('all featured ingredients show what men report and what the account cannot establish', () => {
    const t = article(read(PAGES.supplements));
    expect((t.match(/<h3>What men report/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(t).toContain('January 2026 personal account');
    expect(t).toContain('September 2026 thread');
    expect(t).toContain('October 2024 lecithin self-experiment');
    expect(t).toContain('without independent verification');
    expect(t).toContain('cannot isolate arginine');
    expect(t).toContain('cannot identify ginseng');
    expect(t).not.toMatch(/\bguaranteed (?:erections|stamina|growth|volume)\b/i);
  });

  test('other community investigations link to original accounts with appropriate limitations', () => {
    const t = article(read(PAGES.reports));
    expect((t.match(/What men report:/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(t).toContain('https://thebiohacker.com/forums/threads/pump-users-did-pumping-increase-your-erect-glans-size-permanently.3246767/');
    expect(t).toContain('https://www.reddit.com/r/MaleSexualHealth/comments/1fydoe2/');
    expect(t).toContain('people who noticed no effect');
    expect(t).toContain('cannot establish');
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
