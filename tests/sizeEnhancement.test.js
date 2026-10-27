import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

describe('public size enhancement resource', () => {
  const page = read('size-enhancement/index.html');

  test('is indexable and discoverable from the site', () => {
    expect(page).toContain('<link rel="canonical" href="https://theblueprint.site/size-enhancement/">');
    expect(page).toContain('"isAccessibleForFree":true');
    expect(read('sitemap.xml')).toContain('<loc>https://theblueprint.site/size-enhancement/</loc>');
    expect(read('learn/index.html')).toContain('href="/size-enhancement/"');
    expect(read('index.html')).toContain('href="/size-enhancement/"');
  });

  test('links community anecdotes alongside independent research', () => {
    expect(page).toContain('thunders.place/progress-reports/gains-are-real-5-gains-in-4-months.v2.html');
    expect(page).toContain('reddit.com/r/PenisPumpResults/comments/1q7x0rx/');
    expect(page).toContain('uroweb.org/guidelines/sexual-and-reproductive-health');
    expect(page).toContain('pubmed.ncbi.nlm.nih.gov/31027932/');
    expect(page).toContain('manual techniques');
    expect(page).toContain('cannot establish success rates');
  });

  test('leads with attributed community stories and keeps measurement context', () => {
    const body = page.slice(page.indexOf('<main class="wrap">'));
    const firstHeading = body.match(/<h1>([^<]+)<\/h1>/)?.[1];
    expect(firstHeading).toMatch(/Men are reporting changes in length and girth/);
    expect(body.indexOf('r/gettingbigger')).toBeLessThan(body.indexOf('Optional clinical background'));
    expect(body).toContain('r/AJelqForYou');
    expect(body).toContain('thunders.place/progress-reports/seep-progress.html');
    expect(body).toContain('reddit.com/r/PenisPumpResults/comments/1q533js/');
    expect(body).toContain('One man interviewed by GQ said');
    expect((body.match(/class="report-card"/g) || []).length).toBeGreaterThanOrEqual(5);
    expect(body).toContain('not an independently verified result');
    expect(body).toContain('after nine days off');
    expect(body).toContain('returning to 4.0 after one week');
  });

  test('offers useful free action and readable clinical cautions', () => {
    expect(page).toContain('Try this free seven-day starting-point check');
    expect(page).toContain('An erection lasting more than four hours is a medical emergency.');
    expect(page).toContain('No specific gain is guaranteed.');
    expect(page).toContain('No clinician has reviewed this page.');
    expect(page).toContain('href="/research-lab/manual-techniques/"');
    expect(page).toContain('href="/whats-inside/"');
  });
});
