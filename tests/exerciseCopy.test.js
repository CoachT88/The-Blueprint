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
 *
 * AND THEY ARE STRIPPED ONLY INSIDE <style> AND <script>, which is not
 * fussiness. Stripping `/*` across the whole file meant `accept="image/*"`
 * on a file input opened a comment that ran to the first real `*\/` three
 * thousand lines later, inside the script. Roughly seventy thousand
 * characters disappeared with it: every onboarding slide, the whole Manual,
 * and the day modal. The banned-phrase scan was passing over all of it
 * vacuously, which is the same failure mode as having no guard at all, and
 * it was invisible because a test that cannot see anything still goes green.
 */
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const visible = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(<(style|script)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi,
        (_m, open, _tag, body, close) => open + body.replace(BLOCK_COMMENT, ' ') + close);

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
describe('the scan can actually see the copy', () => {
    /* The guard above is only worth the file it lives in if `visible` still
       holds the member-facing text. It did not, for a long time, and nothing
       said so: an `accept="image/*"` attribute opened a block comment that
       ran into the script and took every onboarding slide and the entire
       Manual with it. So the extractor is now checked against landmarks from
       each region it has to cover, chosen because they sit on both sides of
       the stray opener and were the text that went missing. */
    test.each([
        ['the onboarding slides',  'Rest days are mandatory'],
        ['the Manual',             'Each day is color-coded'],
        ['the day modal',          'Adjust intent'],
        ['the HQ itself',          'This week'],
        ['the inline script',      'function renderWeekStrip'],
    ])('%s is still in view', (_where, landmark) => {
        expect(visible).toContain(landmark);
    });

    test('and comments really are stripped, inside style and script alike', () => {
        expect(html).toContain('The WeekStrip');          // a <style> comment
        expect(visible).not.toContain('The WeekStrip');
        expect(html).toContain('THE INTERACTION BOUNDARY');  // a <script> comment
        expect(visible).not.toContain('THE INTERACTION BOUNDARY');
    });
});

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

describe('no surface promises a calendar edit the app will not honour', () => {
    /* Phase 3S.1 PR C. For a member whose week is derived from dated plans,
       the day-type buttons are withdrawn until Change My Programme exists, so
       any copy telling them to tap a day and set its type is false.
       It was false in THREE places at once, which is the same shape as the
       three copy defects this file was created for: the tour stop, the intro
       screen and the Manual's calendar entry. A behavioural test cannot catch
       this, because the copy is correct for the other cohort. */
    const BANNED = [
        ['tap any day to change',
            'Withdrawn for authoritative-plan members. Changing a week is Change '
            + 'My Programme, which does not exist yet.'],
        ['tap any day to set',
            'Same as above.'],
        ['change the plan',
            'The tour stop title. Changing a week is Change My Programme, which '
            + 'does not exist yet.'],
        ['to change its assignment',
            'The Manual phrasing of the same promise.'],
        /* Phase 3C.3. The second half of the same defect. The previous pass
           replaced "change the plan" with "tap a day to view it and update
           its completion status", which was true at the time because the
           completion toggle survived cutover. It no longer does: a generic
           tick against a dated prescription claims a session happened with
           no record of it, so the toggle is withdrawn with the day types and
           the copy that offered it has to go with them. */
        ['tap a day to view',
            'The toggle it points at is withdrawn for authoritative-plan '
            + 'members, so this promises an interaction that does nothing.'],
        ['update its completion status',
            'Same as above. Manual completion is not a thing the strip offers '
            + 'a member whose week comes from their programme.'],
        ['change it any time from the manual',
            'The goal picker said this. Changing the goal records a preference '
            + 'and leaves the programme alone, so it offered a feature that '
            + 'does not exist.'],
    ];

    test.each(BANNED)('no surface says "%s"', (phrase, why) => {
        const i = visible.toLowerCase().indexOf(phrase.toLowerCase());
        const context = i >= 0 ? visible.slice(Math.max(0, i - 140), i + 140) : '';
        expect(i, `Found "${phrase}".\n\nWhy this is banned: ${why}\n\nIn:\n...${context}...`)
            .toBe(-1);
    });

    test('the two week headings name a week, not a schedule the member builds', () => {
        /* Headings rather than phrases, because the WORDS are still correct
           elsewhere: "Weekly schedule set for lasting longer." and "Update
           your weekly schedule to match this focus?" are what a LEGACY
           member sees, and for that cohort the column genuinely is their
           weekly schedule and they genuinely edited it. Banning the words
           outright would have deleted two true sentences to satisfy a guard,
           so the check is pinned to the two headings that became false. */
        expect(visible).not.toContain('>Your Weekly Schedule<');
        expect(visible).toContain('>Your Training Week<');
        expect(visible).not.toContain('Weekly Calendar</p>');
        expect(visible).toContain('Your Week</p>');
    });

    test('the tour has exactly one week stop, pointed at the WeekStrip', () => {
        /* Two stops were titled "Your week": one on the dot row and one on the
           calendar under it. That is a tour telling you it is touring two
           surfaces that should have been one. Both are now one stop on one
           surface, and the old ids are gone rather than merely unused. */
        const stops = html.slice(html.indexOf('const TOUR_STOPS'), html.indexOf('function startTour'));
        expect(stops).toContain("sel:'#hq-week-card'");
        expect(stops).not.toContain("sel:'#hq-calendar-card'");
        expect(stops).not.toContain("sel:'#hq-stat-chips'");
        expect(stops.match(/title:'Your week'/g)).toHaveLength(1);
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
