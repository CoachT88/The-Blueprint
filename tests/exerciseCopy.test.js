import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'index.html'), 'utf8');

/**
 * The file with comments removed.
 *
 * The banned-phrase scan runs against this rather than the raw file,
 * because a comment explaining why a phrase was removed necessarily
 * contains the phrase, and a guard that cannot be documented is a guard
 * people route around. Comments are not shown to anybody.
 *
 * Block comments only. Stripping `//` would take every URL with it.
 */
const visible = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * Claims and cues the app is not allowed to make.
 *
 * Three defects shipped at once and none of them were caught by a test,
 * because every test in this repo checks behaviour and none of them read
 * what the app actually says to the member.
 *
 *   "gently bear down"   a Valsalva cue under a relaxation label, served
 *                        to the men whose screener flagged a floor that
 *                        already holds tension. The one with a safety cost.
 *   "neural reset"       a central nervous system claim for a peripheral
 *                        manoeuvre, with nothing behind it.
 *   "hold at the edge"   the opposite of the stop-start technique the
 *                        exercise is a version of.
 *
 * This file is the floor under the copy. It is deliberately a blunt
 * instrument: a banned phrase list plus a shape check. It cannot tell
 * whether copy is good, only whether it has regressed to something we
 * have already established is wrong.
 */
describe('claims the app may not make', () => {
    /* Each entry: the phrase, and why it is banned. The reason is in the
       failure message, so whoever trips it finds out why without having
       to dig through a commit log. */
    const BANNED = [
        ['bear down',
            'Valsalva cue. Raises intra-abdominal pressure and teaches straining, '
            + 'which is the opposite motor pattern to pelvic floor release, and it is '
            + 'served to the tension-holding cohort. Use a release cue instead.'],
        ['bearing down',
            'Same as "bear down".'],
        ['neural reset',
            'Asserts a central nervous system effect from a peripheral manoeuvre. '
            + 'The literature mechanism is the peripheral bulbospongiosus reflex, and '
            + 'even that is a hypothesis. Describe the effect, not a mechanism.'],
        ['rewire your nervous system',
            'No neuroplasticity data exists for any breathing or pelvic protocol.'],
        ['rewires your nervous system',
            'Same as above.'],
        ['pelvic down-training',
            'Clinical term, banned member facing. Use "Relaxation & Coordination".'],
        ['down-training',
            'Clinical term, banned member facing. Use "Relaxation & Coordination".'],
    ];

    test.each(BANNED)('the app never says "%s"', (phrase, why) => {
        const i = visible.toLowerCase().indexOf(phrase.toLowerCase());
        const context = i >= 0 ? visible.slice(Math.max(0, i - 120), i + 120) : '';
        expect(i, `Found "${phrase}".\n\nWhy this is banned: ${why}\n\nIn:\n...${context}...`)
            .toBe(-1);
    });
});

describe('the stop-start exercise describes stop-start', () => {
    /* It is a version of the stop-start technique and it used to tell the
       member to do the opposite in three places: slow down rather than
       stop, hold at the plateau, and resume at roughly 60% arousal, which
       is still high. The corrected instructions are pinned here because
       nothing else in the suite reads them. */
    const block = html.slice(html.indexOf("title:'Edging"), html.indexOf("title:'Lateral Compression'"));

    test('the exercise block was found', () => {
        expect(block.length).toBeGreaterThan(400);
    });

    test('it says stop, not slow down', () => {
        expect(block).toContain('STOP. Take your hand off completely');
        expect(block).toContain('Do not slow down');
    });

    test('it waits for the urge to go entirely, not to 60 percent', () => {
        expect(block).toContain('until the urge has fully gone');
        expect(block).not.toContain('drop to 60%');
        expect(block).not.toContain('roughly 60%');
    });

    test('there is no hold at the edge', () => {
        expect(block).not.toContain('Hold at that plateau');
        expect(block).not.toContain('Hold the edge');
    });
});

describe('every exercise answers the three questions', () => {
    /* What am I supposed to do, what should it feel like, and what should
       I NOT feel. The fields already existed; nothing asserted they were
       populated, so an exercise could ship with an empty dontFeel and the
       safety half of the instruction would simply be missing. */
    /* Scoped to ROUTINES. `title:` is also used by milestones, warmup tips
       and tour stops, none of which are exercises and none of which have
       a feel or a dontFeel. */
    const routines = html.slice(html.indexOf('const ROUTINES={'),
                                html.indexOf('// SUPABASE + PERSISTED STATE'));
    const blocks = routines.split(/(?=title:\s*')/).slice(1);
    const titles = blocks.map(b => (b.match(/^title:\s*'([^']+)'/) || [])[1]).filter(Boolean);

    test('all fourteen exercises were found', () => {
        expect(routines.length).toBeGreaterThan(5000);
        expect(titles).toHaveLength(14);
        expect(titles).toContain('Directional Pulls');
        expect(titles).toContain('Kegel Contractions');
        expect(titles).toContain('Lateral Compression');
    });

    test.each(['feel', 'dontFeel'])('every exercise has a non-empty %s', (field) => {
        const empty = [];
        blocks.forEach((b, i) => {
            const m = b.match(new RegExp(`${field}:\\s*'((?:[^'\\\\]|\\\\.)*)'`));
            if (!m || m[1].trim().length < 12) empty.push(titles[i]);
        });
        expect(empty, `These exercises have no usable ${field}: ${empty.join(', ')}`).toEqual([]);
    });
});
