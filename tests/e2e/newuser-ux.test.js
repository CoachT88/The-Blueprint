import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * The first-run surfaces. Each of these covers something a brand-new member hit
 * before: a waiver as the first substantive thing they read, a rest day that
 * only revealed itself after a 10-minute warmup, an unexplained Length/Girth
 * fork, and acronyms with no expansion.
 */
describe('welcome screen', () => {
    let app;
    beforeAll(async () => { app = await openApp(); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('explains the program before the liability gate', async () => {
        const r = await app.page.evaluate(() => {
            const el = document.getElementById('step-welcome');
            const cards = el.querySelectorAll('.instruction-card');
            const text = el.innerText;
            const waiverIdx = text.indexOf('LIABILITY');
            const programIdx = text.indexOf('Guided sessions');
            return { visible: !el.classList.contains('hidden-step'), cards: cards.length, text, waiverIdx, programIdx };
        });
        expect(r.visible).toBe(true);
        expect(r.cards).toBeGreaterThanOrEqual(3);
        expect(r.text).toMatch(/Guided sessions/);
        expect(r.text).toMatch(/Four tiers/);
        // The program blurb must come before the waiver, not after it.
        expect(r.programIdx).toBeGreaterThan(-1);
        expect(r.programIdx).toBeLessThan(r.waiverIdx === -1 ? Infinity : r.waiverIdx);
    });
});

describe('HQ rest-day warning', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'u2' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test.each([
        ['a training day', 'length', true, 'BEGIN LENGTH SESSION'],
        ['a rest day', 'rest', false, 'BEGIN RECOVERY SESSION'],
    ])('on %s the banner and button match', async (_label, type, bannerHidden, launchLabel) => {
        const r = await app.page.evaluate(t => {
            persisted.schedule[new Date().getDay()] = t;
            goToStep(0);
            return {
                bannerHidden: document.getElementById('hq-rest-banner').classList.contains('hidden'),
                launch: document.getElementById('launch-btn').textContent,
            };
        }, type);
        expect(r.bannerHidden).toBe(bannerHidden);
        expect(r.launch).toBe(launchLabel);
    }, 30_000);
});

describe('mission select guidance', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'u3' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('Length and Girth explain what they are', async () => {
        const r = await app.page.evaluate(() => ({
            length: document.getElementById('mission-length-btn').innerText,
            girth: document.getElementById('mission-girth-btn').innerText,
        }));
        expect(r.length).toMatch(/Stretching protocol/i);
        expect(r.girth).toMatch(/Jelq and Uli/i);
    });

    test('a beginner gets a recommendation, a veteran does not', async () => {
        const beginner = await app.page.evaluate(() => {
            persisted.schedule[new Date().getDay()] = 'length';
            persisted.difficulty = 'beginner';
            persisted.allTimeSessionCount = 0;
            persisted.primaryGoal = 'size';
            goToStep(3);
            return !document.getElementById('beginner-rec-note').classList.contains('hidden');
        });
        expect(beginner).toBe(true);

        const veteran = await app.page.evaluate(() => {
            persisted.difficulty = 'elite';
            persisted.allTimeSessionCount = 40;
            persisted.schedule[new Date().getDay()] = 'girth';
            goToStep(0); goToStep(3);
            // A veteran still sees the scheduled-day line, but not the
            // "new here" recommendation.
            return document.getElementById('beginner-rec-note').textContent;
        });
        expect(veteran).not.toMatch(/New here/i);
    }, 40_000);
});

describe('jargon glosses', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page, { id: 'u4' }); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('the HQ chips expand BPEL and MSEG', async () => {
        const text = await app.page.evaluate(() => {
            persisted.primaryGoal = 'size'; goToStep(0);
            return document.getElementById('last-measure-row').innerText;
        });
        expect(text).toMatch(/bone-pressed length/i);
        expect(text).toMatch(/mid-shaft girth/i);
    }, 30_000);

    test('EQ and RPE are explained where they are first asked for', async () => {
        const r = await app.page.evaluate(() => {
            goToStep(5);
            return {
                step5: document.getElementById('step-5').innerText,
                targetEq: document.querySelector('#step-4 .text-right p').textContent,
            };
        });
        expect(r.step5).toMatch(/1 = flaccid/i);
        expect(r.step5).toMatch(/Rate of Perceived Exertion/i);
        expect(r.targetEq).toBe('Target EQ');
        expect(app.errors).toEqual([]);
    }, 30_000);
});
