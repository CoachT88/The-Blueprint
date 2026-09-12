import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

/**
 * Coach Tee's answers arrived as a wall of text.
 *
 * The model was sending paragraphs. .chat-msg had no white-space rule, so the
 * browser collapsed every line break into a space and five paragraphs came out
 * as one block. .ai-response-box, one line above it in the stylesheet, has had
 * white-space:pre-wrap all along, which is why the identical model read fine in
 * the Recovery panel and badly in the chat.
 *
 * That is a CSS property nobody would think to check, on a file with no build
 * step, and deleting it again would look like tidying. So these measure what a
 * member actually sees: the rendered height of a bubble. A reply whose breaks
 * are honoured is taller than the same words run together. If the rule goes,
 * the two heights converge and this fails.
 */
describe('a long answer is broken up on screen', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'cr1' });
        await app.page.evaluate(() => openCoach());
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('paragraph breaks survive into the rendered bubble', async () => {
        const m = await app.page.evaluate(() => {
            const area = document.getElementById('coach-chat-area');
            const paras = 'Blood flow is the first thing to fix.\n\n'
                + 'Sleep is where testosterone actually peaks.\n\n'
                + 'Hydration matters more than any supplement.';
            const render = (t) => {
                area.innerHTML = `<div id="probe" class="chat-msg ai">${t}</div>`;
                return document.getElementById('probe').offsetHeight;
            };
            const broken = render(paras);
            const runTogether = render(paras.replace(/\n/g, ' '));
            area.innerHTML = '';
            return { broken, runTogether };
        });
        // Laid out at all, so a hidden panel cannot pass this by measuring zero.
        expect(m.runTogether).toBeGreaterThan(0);
        expect(m.broken).toBeGreaterThan(m.runTogether);
    }, 30_000);

    test('a real reply renders with its breaks and a label of its own', async () => {
        const out = await app.page.evaluate(async () => {
            // Stand in for the endpoint. Nothing here should reach Anthropic.
            window.fetchClaude = async () => ({
                ok: true,
                text: 'Short first paragraph.\n\nShort second paragraph.',
            });
            document.getElementById('coach-input').value = 'why is my EQ down';
            await askCoach();
            const bubble = document.querySelector('#coach-chat-area .chat-msg.ai');
            const who = bubble.querySelector('.chat-who');
            return {
                whiteSpace: getComputedStyle(bubble).whiteSpace,
                text: bubble.textContent,
                who: who && who.textContent,
                // The label must sit on its own line, not lead the sentence.
                labelIsBlock: who && getComputedStyle(who).display === 'block',
            };
        });
        expect(out.whiteSpace).toBe('pre-wrap');
        expect(out.who).toBe('Coach Tee');
        expect(out.labelIsBlock).toBe(true);
        expect(out.text).toContain('first paragraph.\n\nShort second');
    }, 30_000);
});

describe('what the model sends is tidied before it is shown', () => {
    let app;
    beforeAll(async () => {
        app = await openApp();
        await signIn(app.page, { id: 'cr2' });
    }, 60_000);
    afterAll(async () => { await app?.close(); });

    /* pre-wrap renders whatever it is given, so the two things the prompt asks
       the model not to do now cost something visible if it does them anyway:
       a run of blank lines becomes a hole, and markdown becomes punctuation the
       reader has to ignore. */
    const tidy = (s) => app.page.evaluate((t) => tidyReply(t), s);

    test('a run of blank lines cannot open a hole in an answer', async () => {
        expect(await tidy('One.\n\n\n\n\nTwo.')).toBe('One.\n\nTwo.');
    });

    test('markdown bold is stripped rather than shown as asterisks', async () => {
        expect(await tidy('Do **not** skip the warmup.')).toBe('Do not skip the warmup.');
    });

    test('a stray heading loses its hashes', async () => {
        expect(await tidy('## Recovery\n\nTake the day.')).toBe('Recovery\n\nTake the day.');
    });

    test('single breaks inside a paragraph are left alone', async () => {
        expect(await tidy('- one\n- two\n- three')).toBe('- one\n- two\n- three');
    });

    test('leading and trailing whitespace goes', async () => {
        expect(await tidy('\n\n  Answer.  \n\n')).toBe('Answer.');
    });
});
