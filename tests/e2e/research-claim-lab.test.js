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
});
