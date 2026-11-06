import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { startServer, launchOptions } from './harness.js';

let srv, browser;
beforeAll(async () => {
  srv = await startServer();
  browser = await chromium.launch(launchOptions());
}, 90_000);
afterAll(async () => {
  await browser?.close();
  await srv?.close();
});

describe('Reports vs. Research claim test, real browser', () => {
  for (const width of [320, 390, 768, 1280]) {
    test(width + 'px: answers teach evidence and do not persist or transmit choices', async () => {
      const page = await browser.newPage({ viewport: {width, height: 850} });
      const outbound = [];
      const errors = [];
      page.on('request', request => {
        if (['xhr', 'fetch', 'beacon'].includes(request.resourceType())) outbound.push(request.url());
      });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(srv.origin + '/research-lab/community-reports/index.html', {waitUntil:'domcontentloaded', timeout:60_000});
      await page.waitForSelector('#claim-stage:not([hidden])', {timeout:5000});

      expect(await page.locator('#claim-progress').textContent()).toContain('Question 1 of 3');
      expect(await page.locator('#claim-question').textContent()).toContain('165,000 members');
      await page.locator('#claim-choices button').nth(0).click();
      expect(await page.locator('#claim-feedback').textContent()).toContain('Member counts indicate audience size');
      expect(await page.locator('#claim-next').isVisible()).toBe(true);
      await page.locator('#claim-next').click();

      expect(await page.locator('#claim-question').textContent()).toContain('fuller-glans photograph');
      await page.locator('#claim-choices button').nth(0).click();
      expect(await page.locator('#claim-feedback').textContent()).toContain('A photograph taken immediately afterward');
      await page.locator('#claim-next').click();

      expect(await page.locator('#claim-question').textContent()).toContain('ejaculate volume');
      await page.locator('#claim-choices button').nth(1).click();
      expect(await page.locator('#claim-feedback').textContent()).toContain('Time since the last ejaculation');
      await page.locator('#claim-next').click();

      expect(await page.locator('#claim-finished').isVisible()).toBe(true);
      expect(await page.locator('#claim-stage').isVisible()).toBe(false);
      expect(await page.locator('#claim-finished a[href="#original-reports"]').count()).toBe(1);
      const privacy = await page.evaluate(() => ({
        localStorage: localStorage.length,
        sessionStorage: sessionStorage.length,
        overflowX: document.documentElement.scrollWidth > innerWidth + 1
      }));
      expect(privacy.localStorage).toBe(0);
      expect(privacy.sessionStorage).toBe(0);
      expect(privacy.overflowX).toBe(false);
      expect(outbound).toEqual([]);
      expect(errors).toEqual([]);
      await page.close();
    }, 65_000);
  }

  /* THE DEEP LINK THE CHECKER ITSELF OFFERS.
     Every Research Lab section is a link target, and the finished screen
     sends the reader to #original-reports. The browser scrolls a target to
     y=0, which is underneath a 61px sticky header, so before
     tools/research.css gained scroll-margin-top the reader arrived at a
     heading he could not see. Measured against the header rather than
     against a number, so changing the header height cannot quietly
     reintroduce it. */
  for (const [page_, anchors] of [
    ['/research-lab/community-reports/', ['#claim-lab', '#original-reports']],
    ['/size-enhancement/', ['#reports', '#length', '#girth', '#manual', '#practice', '#safety']],
  ]) {
    test(`${page_}: every anchor target lands below the sticky header`, async () => {
      const page = await browser.newPage({ viewport: {width: 390, height: 850} });
      for (const hash of anchors) {
        await page.goto(srv.origin + page_ + hash, {waitUntil:'domcontentloaded', timeout:60_000});
        await page.waitForTimeout(600);
        const seen = await page.evaluate((hash) => {
          const target = document.getElementById(hash.slice(1));
          const header = document.querySelector('.sn').getBoundingClientRect().bottom;
          const heading = target.matches('h1,h2,h3') ? target : target.querySelector('h1,h2,h3');
          const box = (heading || target).getBoundingClientRect();
          return {header: Math.round(header), top: Math.round(box.top),
                  label: ((heading || target).textContent || '').trim().slice(0, 40)};
        }, hash);
        expect(seen.top, `${page_}${hash} "${seen.label}" is under the header`)
          .toBeGreaterThanOrEqual(seen.header);
      }
      await page.close();
    }, 65_000);
  }
});
