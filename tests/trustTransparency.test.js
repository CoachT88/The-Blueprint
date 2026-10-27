import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const home = readFileSync('index.html', 'utf8');
const manual = readFileSync('app/index.html', 'utf8');
const faq = readFileSync('faq/index.html', 'utf8');
const coach = readFileSync('functions/api/coach-tee.js', 'utf8');

describe('Published trust claims reflect the actual AI coaching data path', () => {
  test('privacy copy discloses AI sharing instead of promising only the buyer sees measurements', () => {
    expect(home).not.toContain('only person\n            who ever sees your numbers is you');
    expect(manual).not.toContain('They are tied to your account and only you can read them.');
    expect(home).toContain('your latest logged measurements, are sent to an external AI provider');
    expect(manual).toContain('sent to an external AI provider to generate a reply');
    expect(faq).toContain('Does Coach Tee share my training data with an AI provider?');
    expect(faq).toContain('most recent length and girth measurements');
  });

  test('coach limit is disclosed and agrees with the backend cap', () => {
    const limit = coach.match(/const DAILY_LIMIT = (\d+);/);
    expect(limit).not.toBeNull();
    expect(home).toContain('up to ' + limit[1] + ' questions per day');
    expect(home).not.toContain('as many questions as you want');
  });

  test('photos are not asserted to be in the automatic coaching summary', () => {
    expect(manual).toContain('Progress photos are not included in that automatic summary.');
    expect(faq).toContain('Progress photos are not included in this automatic summary.');
    expect(coach).toContain('https://api.anthropic.com/v1/messages');
  });
});
