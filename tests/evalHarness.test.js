import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * THE EVAL HARNESS SPENDS MONEY, SO ITS GATES GET A TEST.
 *
 * tests/eval/run.mjs calls the Anthropic API directly. It is not part of any
 * suite and nothing invokes it automatically, which makes it the easiest
 * thing in the repository to accidentally change into something that bills
 * on every run.
 *
 * This file runs in the ordinary unit suite. It does not evaluate anything.
 * It checks that the harness still refuses to send without a key and a
 * budget, that it still reads the real system prompts instead of a copy, and
 * that the prompt set still covers the seven agreed categories.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const RUNNER = 'tests/eval/run.mjs';
const PROMPTS = 'tests/eval/prompts.json';

describe('the eval harness exists and is wired', () => {
    test('THE RUNNER AND THE PROMPT SET ARE BOTH PRESENT', () => {
        for (const f of [RUNNER, PROMPTS, 'tests/eval/README.md']) {
            expect(existsSync(path.join(ROOT, f)), `${f} is missing`).toBe(true);
        }
    });

    test('ALL SEVEN CATEGORIES ARE COVERED, WITH PROMPTS IN EACH', () => {
        const spec = JSON.parse(read(PROMPTS));
        const wanted = ['erectile', 'timing', 'pelvic', 'unsafe', 'redflag', 'training', 'tone'];
        expect(Object.keys(spec.categories).sort()).toEqual([...wanted].sort());
        for (const c of wanted) {
            const n = spec.prompts.filter(p => p.category === c).length;
            expect(n, `category ${c} has ${n} prompts`).toBeGreaterThanOrEqual(5);
        }
    });

    test('every prompt declares what the answer must and must not do', () => {
        const spec = JSON.parse(read(PROMPTS));
        for (const p of spec.prompts) {
            expect(p.id, 'a prompt has no id').toBeTruthy();
            expect(p.text.length, `${p.id} has no question`).toBeGreaterThan(10);
            expect(Array.isArray(p.must) && p.must.length, `${p.id} has no must`).toBeTruthy();
            expect(Array.isArray(p.mustNot) && p.mustNot.length, `${p.id} has no mustNot`).toBeTruthy();
        }
    });

    test('the prompt file says plainly that the prompts are synthetic', () => {
        /* public.coach_usage holds (user_id, day, count) and nothing else,
           and the app tells members it never records what they asked. So no
           real corpus exists to anonymise, and the file must not imply one
           does. */
        const raw = read(PROMPTS);
        expect(raw).toMatch(/NOT REAL MEMBER QUESTIONS/);
        expect(raw).toMatch(/coach_usage/);
    });
});

describe('the harness cannot bill by accident', () => {
    const src = () => read(RUNNER);

    test('IT REFUSES WITHOUT AN API KEY', () => {
        expect(src()).toMatch(/if \(!process\.env\.ANTHROPIC_API_KEY\)/);
        expect(src()).toMatch(/Nothing was sent/);
    });

    test('IT REFUSES WITHOUT AN EXPLICIT BUDGET, AND HAS NO DEFAULT', () => {
        /* A default budget is a budget somebody did not choose. */
        expect(src()).toMatch(/EVAL_BUDGET_USD \|\| 0/);
        expect(src()).toMatch(/if \(!budget\)/);
        expect(src(), 'a non-zero default budget crept in')
            .not.toMatch(/EVAL_BUDGET_USD \|\| [1-9]/);
    });

    test('it estimates before sending and refuses an over-budget run', () => {
        expect(src()).toMatch(/estimated cost/);
        expect(src()).toMatch(/if \(estimate > budget\)/);
        expect(src()).toMatch(/Refusing to run/);
    });

    test('it stops mid-run if actual spend passes the budget', () => {
        /* The estimate can be wrong. The running total is what protects the
           bill. */
        expect(src()).toMatch(/if \(spent > budget\)/);
        expect(src()).toMatch(/STOPPING/);
    });

    test('a dry run is available and sends nothing', () => {
        expect(src()).toMatch(/EVAL_DRY_RUN/);
    });

    test('it is in no suite, so it never runs as part of a test pass', () => {
        const cfg = read('vitest.config.js');
        expect(cfg, 'the eval harness was added to a vitest include list')
            .not.toMatch(/tests\/eval/);
        const pkg = JSON.parse(read('package.json'));
        for (const [name, script] of Object.entries(pkg.scripts)) {
            expect(script, `npm script ${name} runs the eval harness`)
                .not.toMatch(/tests\/eval\/run/);
        }
    });

    test('and CI does not run it', () => {
        expect(read('.github/workflows/test.yml'))
            .not.toMatch(/tests\/eval|EVAL_BUDGET/);
    });
});

describe('what the harness measures, it measures rather than assumes', () => {
    const src = () => read(RUNNER);

    test('THE SYSTEM PROMPTS ARE READ FROM THE ENDPOINT, NOT COPIED', () => {
        /* A copy drifts, and an evaluation of a prompt the endpoint does not
           use measures nothing. */
        expect(src()).toMatch(/functions\/coach-tee\.js|functions\/api\/coach-tee\.js/);
        expect(src()).toMatch(/SYSTEM_PROMPTS/);
    });

    test('cache savings come from reported usage, never from a formula', () => {
        /* The brief was explicit: actual API usage, not assumed savings. */
        expect(src()).toMatch(/cache_read_input_tokens/);
        expect(src()).toMatch(/cache_creation_input_tokens/);
        expect(src()).toMatch(/cacheMode/);
    });

    test('latency and token counts come from the response', () => {
        expect(src()).toMatch(/latencyMs/);
        expect(src()).toMatch(/usage\.input_tokens/);
        expect(src()).toMatch(/usage\.output_tokens/);
    });

    test('max_tokens matches what production sends', () => {
        const prod = read('functions/api/coach-tee.js').match(/max_tokens:\s*(\d+)/);
        const harness = read(RUNNER).match(/MAX_TOKENS\s*=\s*(\d+)/);
        expect(prod, 'could not read production max_tokens').not.toBeNull();
        expect(harness, 'could not read harness MAX_TOKENS').not.toBeNull();
        expect(harness[1], 'the harness and production disagree on max_tokens')
            .toBe(prod[1]);
    });

    test('the production model under test is the one production uses', () => {
        const prod = read('functions/api/coach-tee.js').match(/model:\s*'(claude-[a-z0-9-]+)'/);
        expect(prod).not.toBeNull();
        /* The endpoint pins a dated snapshot; the harness names the family.
           Assert the family matches so a production model change is caught. */
        const family = prod[1].replace(/-\d{8}$/, '');
        expect(read(RUNNER), `production runs ${prod[1]}, harness does not test ${family}`)
            .toContain(family);
    });

    test('the banned member-facing phrases are all checked', () => {
        const src2 = read(RUNNER);
        for (const phrase of ['bear down', 'bearing down', 'neural reset',
            'rewire your nervous system', 'pelvic down-training', 'down-training']) {
            expect(src2, `the harness does not check for "${phrase}"`).toContain(phrase);
        }
    });

    test('red-flag and unsafe answers are checked for a referral', () => {
        expect(read(RUNNER)).toMatch(/no referral to care/);
        expect(read(RUNNER)).toMatch(/a protocol appears/);
    });

    test('and the harness says mechanical checks are not a quality verdict', () => {
        /* The failure mode this guards: a green mechanical run getting
           reported as "the model is fine". */
        expect(read(RUNNER)).toMatch(/not a quality verdict/);
    });
});
