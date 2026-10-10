import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Coach Tee's voice, pinned where it can actually be checked.
 *
 * WHAT THIS CAN PROVE. The system prompt is a string in our source, so its
 * instructions are testable: that it asks for brevity rather than thoroughness,
 * that it still carries every medical requirement, and that it does not tell
 * the model to do the things the brief rules out.
 *
 * WHAT IT CANNOT PROVE. Whether the model obeys. No static test can measure
 * the tone or length of a generated reply, and asserting on a mocked reply
 * would only test the mock. Real voice checking is the manual pass in the
 * report. These tests exist so a future edit cannot quietly reintroduce
 * "be thorough" or drop a medical rule, which is the regression that would
 * otherwise go unnoticed until a member read it.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const src = readFileSync(path.join(ROOT, 'functions', 'api', 'coach-tee.js'), 'utf8');

/* The coach prompt only, so a match in the recovery prompt or in a code
   comment cannot stand in for one in the instructions that matter. */
function coachPrompt() {
  const m = src.match(/coach:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) throw new Error('could not find the coach system prompt');
  return JSON.parse('"' + m[1] + '"');
}

describe('Coach Tee system prompt', () => {
  const p = coachPrompt();

  it('stays inside the per-request prompt budget', () => {
    /* This string is paid for on every single request, so the voice rules
       are not a licence for it to grow without limit. The API test asserts
       the same ceiling from the request side. */
    expect(p.length).toBeLessThanOrEqual(5000);
  });

  it('was actually found and is substantial', () => {
    /* Guards every assertion below: a failed extraction would make them all
       pass or all fail for the wrong reason. */
    expect(p.length).toBeGreaterThan(1500);
    expect(p).toContain('Coach Tee');
  });

  describe('brevity replaced thoroughness', () => {
    it('ASKS FOR A SHORT ANSWER, with a stated default', () => {
      expect(p).toMatch(/2 to 4 sentences/);
      expect(p).toMatch(/30 to 65 words/);
    });

    it('NO LONGER tells the model to be thorough or to avoid oversimplifying', () => {
      /* The exact instructions that contradicted the brief. Their absence is
         the point of this change. */
      expect(p).not.toMatch(/Always give a thorough, complete answer/);
      expect(p).not.toMatch(/Do not oversimplify/);
      expect(p).not.toMatch(/4 to 6 sentence response is\s*often appropriate/);
      expect(p).not.toMatch(/Be thorough\./);
    });

    it('still allows expansion, so brevity is a default and not a cap', () => {
      expect(p).toMatch(/when he asks for detail/);
      expect(p).toMatch(/safety/i);
    });

    it('states the answer, reason, next move sequence', () => {
      expect(p).toMatch(/Shape: the answer, a brief reason, the next move/);
    });
  });

  describe('hedging and chatbot tells are named and banned', () => {
    for (const phrase of ['it might be beneficial', 'you could potentially consider',
                          'generally speaking', "it's important to note", 'as an AI']) {
      it(`forbids "${phrase}"`, () => {
        expect(p.toLowerCase()).toContain(phrase.toLowerCase());
        /* Present as a prohibition, which is why the cut-the-hedging clause
           has to be there too. */
        expect(p).toMatch(/Cut the hedging/);
      });
    }

    it('does not ask the model to end with a question', () => {
      expect(p).toMatch(/Do not end with a question/);
    });

    it('still bans filler openers, em dashes and markdown', () => {
      expect(p).toMatch(/Great question/);
      expect(p).toMatch(/NEVER use em dashes/);
      expect(p).toMatch(/No markdown/);
    });
  });

  describe('the product never says these to a member', () => {
    /* The same list tests/exerciseCopy.test.js enforces for the app's own
       copy. Coach Tee writes member-facing text too, and nothing was stopping
       it using any of them. */
    for (const phrase of ['bear down', 'bearing down', 'neural reset',
                          'rewire your nervous system', 'rewires your nervous system',
                          'pelvic down-training', 'down-training']) {
      it(`tells the model never to say "${phrase}"`, () => {
        expect(p).toContain(phrase);
      });
    }
    it('and frames them as forbidden, not as vocabulary', () => {
      expect(p).toMatch(/Never say to a member:/);
    });
  });

  describe('every medical requirement survived', () => {
    for (const [label, pattern] of [
      ['kegels are not universally beneficial', /Kegel exercises are NOT universally beneficial/],
      ['a tight floor gets release work', /reverse kegels, myofascial release, hip openers/],
      ['the symptom list that implies tension', /urgency, premature ejaculation tied to tension, pelvic pain/],
      ['blood flow mechanism', /endothelial nitric oxide synthase/],
      ['length precedes girth', /Length gains in PE typically precede girth gains/],
      ['never claim girth is faster', /Never suggest girth comes faster or easier than length/],
      ['psychological versus physiological stamina', /distinguish between psychological/],
      ['testosterone is downstream of habits', /Testosterone optimization is downstream/],
    ]) {
      it(label, () => { expect(p).toMatch(pattern); });
    }

    it('does NOT ask the member a screening question any more', () => {
      /* The old wording told the model to ask, which the brief rules out.
         It uses the screener it is handed instead. */
      expect(p).not.toMatch(/Always ask or assess context before recommending kegels/);
      expect(p).toMatch(/Do not ask the member a screening question/);
      expect(p).toMatch(/pelvic floor screener result you are given/);
    });

    it('keeps a real red flag honest without the consult-a-doctor cop-out', () => {
      expect(p).toMatch(/Never say "consult a doctor" as a cop-out/);
      expect(p).toMatch(/red flag/);
      expect(p).toMatch(/Never tell him to train through pain or injury/);
    });

    it('never promises results', () => {
      expect(p).toMatch(/Never promise results/);
      expect(p).toMatch(/never guarantee size change/);
    });
  });

  describe('personalisation without invention', () => {
    it('uses the data it is given and no number it was not', () => {
      expect(p).toMatch(/never a number you were not given/);
      expect(p).toMatch(/No invented history, measurements, symptoms or streaks/);
    });

    it('encourages consistency without guilt or a speech', () => {
      expect(p).toMatch(/without praise, pressure or a motivational speech/);
      expect(p).toMatch(/without guilt/);
    });
  });

  describe('what this change did not touch', () => {
    it('the recovery mode prompt is unchanged and still asks for two sentences', () => {
      expect(src).toMatch(/Give exactly 2 sentences/);
    });

    it('max_tokens is still generous, so nothing is hard truncated', () => {
      const m = src.match(/max_tokens:\s*(\d+)/);
      expect(m).toBeTruthy();
      expect(Number(m[1])).toBeGreaterThanOrEqual(500);
    });

    it('the model and API version are untouched', () => {
      expect(src).toMatch(/claude-haiku-4-5-20251001/);
      expect(src).toMatch(/'anthropic-version': '2023-06-01'/);
    });
  });
});
