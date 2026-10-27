#!/usr/bin/env node
/**
 * Captures the REAL current Blueprint PWA using the same headless-browser
 * harness used by the integration suite. All content is fictional demo data.
 * No production account, token, or member information is accessed.
 *
 * This deliberately generates the marketing screenshots from production UI,
 * not from mockups. Run in CI using npm ci + playwright install chromium.
 */
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { openApp, signIn } from '../tests/e2e/harness.js';

const out = join(process.cwd(), 'img');
mkdirSync(out, { recursive: true });
const app = await openApp({ clock: new Date('2026-10-21T13:00:00-07:00') });
const { page, errors } = app;
// Stable, synthetic history to demonstrate the real progress graphs without
// asserting that an enlargement occurred. The dates are before the fixed
// in-browser clock, and the measurements remain essentially unchanged.
const base = Date.parse('2026-10-21T12:00:00Z');
const date = (daysAgo) => new Date(base - daysAgo*86400000).toISOString();
const demo = {
  primaryGoal: 'all',
  difficulty: 'intermediate',
  allTimeSessionCount: 7,
  totalXp: 490,
  progressCheckins: [],
  measurements: [
    {date:date(28),bpel:6.10,mseg:4.70},
    {date:date(21),bpel:6.08,mseg:4.70},
    {date:date(14),bpel:6.12,mseg:4.69},
    {date:date(7),bpel:6.10,mseg:4.70}
  ],
  sessionLog: [
    {date:date(12),routineType:'length',eq:7,xpEarned:45},
    {date:date(9),routineType:'recovery',eq:8,xpEarned:15},
    {date:date(6),routineType:'girth',eq:8,xpEarned:45},
    {date:date(3),routineType:'stamina',eq:8,xpEarned:45},
    {date:date(1),routineType:'length',eq:9,xpEarned:45}
  ]
};

async function capture(file, step) {
  await page.evaluate(({ step }) => {
    // Exercise the real production navigation and render functions.
    // Only instructional overlays are dismissed for a clean product view.
    if (step === 'hq') goToStep(0);
    if (step === 'session') goToStep(3);
    if (step === 'recovery') goToRecoveryPicker();
    if (step === 'progress') {
      goToStep(0);
      openProgressChart();
    }
  }, { step });
  await page.waitForTimeout(650);
  const expected = step==='hq'?'#step-0':step==='session'?'#step-3':step==='recovery'?'#step-3b':'#chart-modal';
  const visible = await page.locator(expected).isVisible();
  if (!visible) throw new Error('Expected product screen not visible: '+expected);
  const filepath = join(out,file);
  await page.screenshot({path:filepath,type:'jpeg',quality:88,animations:'disabled'});
  const size = statSync(filepath).size;
  if (size < 20000) throw new Error('Screenshot unusually small: '+filepath+' ('+size+' bytes)');
  console.log(file, step, size+' bytes');
}

try {
  await signIn(page, { id: 'marketing-demo', email: 'demo@example.invalid', persisted: demo });
  await page.evaluate(() => {
    // Prevent onboarding tours and update notices covering the product.
    localStorage.setItem('bp_onboarded_marketing-demo','1');
    localStorage.setItem('bp_update_notice_v1_marketing-demo','1');
  });
  await capture('shot-home.jpg','hq');
  await capture('shot-mission.jpg','session');
  await capture('shot-recovery.jpg','recovery');
  await capture('shot-progress.jpg','progress');
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await app.close();
}
