/**
 * House style rules for member-facing prose, in one place.
 *
 * These lived inside tests/learnGuides.test.js and so applied to the six
 * Learning Centre guides and nothing else. The Research Lab pages are
 * member-facing prose written to the same rules and were covered by
 * neither, which is not a theoretical gap: a review of those two pages
 * found "a single centre" and "respectable looking neighbour" sitting in
 * published copy. Both had been through a grep that was supposed to catch
 * them and did not.
 *
 * So the lists move here and both suites import them. One source, every
 * page that has to obey the rules.
 */

/**
 * British spellings, which the site does not use. It writes practical
 * American English, and these drift in whenever several pages are written
 * in one sitting, which is exactly the kind of thing nobody catches by
 * reading.
 *
 * Each pattern is anchored and inflection-specific so it cannot flag a word
 * that is correct in American English: "analysis", "emphasis" and
 * "realistic" are spelled the same on both sides and must not trip this.
 */
export const BRITISH_SPELLINGS = [
    /\brecognis(e|ed|es|ing|able)\b/i, /\bbehaviour(s|al|ally)?\b/i,
    /\bcolour(s|ed|ing|less)?\b/i, /\banalys(e|ed|es|ing)\b/i,
    /\bsummaris(e|ed|es|ing)\b/i, /\bemphasis(e|ed|es|ing)\b/i,
    /\b(individual|personal|normal|prioriti|special|minimi|maximi|organi|real|apologi)s(e|ed|es|ing|ation)\b/i,
    /\bcharacteris(e|ed|es|ing|ation)\b/i, /\bpractis(e|ed|es|ing)\b/i,
    /\bprogramme(s)?\b/i, /\bwhilst\b/i, /\blitre(s)?\b/i, /\bmetre(s)?\b/i,
    /\bfibre(s)?\b/i, /\bdefence\b/i, /\blicence\b/i, /\btravelling\b/i,
    /\blabell(ed|ing)\b/i, /\bcounselling\b/i, /\bjudgement\b/i, /\bageing\b/i,
    /\bgrey\b/i, /\bcentre(s)?\b/i, /\bfavour(s|ed|ite)?\b/i, /\bhonour(s|ed)?\b/i,
    /\bhumour\b/i, /\bneighbour(s|hood)?\b/i, /\bmodelling\b/i, /\benquir(e|ed|y|ies)\b/i,
];

/**
 * Rhetorical contrast constructions, which the house style does not use.
 *
 * The first version of this list caught the obvious forms and missed the
 * one the guides were actually full of: define a thing by denying something
 * first, then assert the real answer. "Stamina is not endurance. It is the
 * ability to notice where your arousal is." Three article openings were
 * built that way and the guard said nothing.
 *
 * The negation patterns require a POSITIVE assertion to follow, which is
 * what makes the construction rhetorical. A run of plain negations that
 * limits a claim, such as "it is not a treatment, it is not a strengthening
 * program", is a scope statement and is often medically required, so the
 * lookahead lets it through.
 */
export const CONTRAST_CONSTRUCTIONS = [
    /\bnot just\b/i, /\bnot merely\b/i, /\bnot simply\b/i, /\bisn'?t just\b/i,
    /\bbut rather\b/i, /\bnot only\b[^.]{0,60}\bbut\b/i,
    /\b(is|are|was|were) not\b[^.!?]{0,90}\.\s*(It|They|That|This|What)\s+(is|are)\s+(?![^.!?]{0,25}\bnot\b)/,
    /\b(is|are) not\b[^.!?]{0,70},\s*(it|they|that)\s+(is|are)\s+(?![^.!?]{0,25}\bnot\b)/i,
    /* The semicolon form. The two patterns above cover the same construction
       joined by a period and by a comma, and a semicolon slipped between
       them: "...is not a conservative reading of the literature; it is a
       different claim" sat in published Research Lab copy and neither
       pattern matched it. One instance existed across every member-facing
       page when this was added. */
    /\b(is|are|was|were) not\b[^.!?;]{0,90};\s*(it|they|that|this|what)\s+(is|are)\s+(?![^.!?]{0,25}\bnot\b)/i,
    /\bdifferent claim from\b/i,
    /\bwhere most\b[^.!?]{0,50}\bgoes wrong\b/i,
    /\bis the whole (article|guide|point|story)\b/i,
    /\bnot the first place\b/i,
    /\bnot a matter of\b/i,
];

/**
 * The visible words of a page: no script, no style, no comments, no markup.
 *
 * Every rule above is about what a member reads, so every check runs on
 * this rather than on the file. Running them on raw HTML would both miss
 * prose split across tags and flag CSS property names.
 */
export const visibleText = (html) => html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

/** Where a pattern matched, with enough either side to read it. */
export const context = (text, match, pad = 70) => {
    const i = text.indexOf(match);
    return '...' + text.slice(Math.max(0, i - pad), i + match.length + pad).trim() + '...';
};
