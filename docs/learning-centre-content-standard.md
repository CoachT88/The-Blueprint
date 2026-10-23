# The Learning Centre content standard

Every guide under a learning hub follows this. `tests/learnGuides.test.js`
enforces the parts a machine can check, and the parts it cannot are listed
here so a reviewer knows what to read for.

A guide is a page that answers one question a man actually types into a
search box. The hub lists the questions; a guide is one of them, published.

## The shape of a guide

In this order:

1. **Direct answer.** The opening says what is going on before it explains
   anything. A man who reads only the first screen should leave with the
   answer, not with a promise that the answer is further down.
2. **Possible causes.** What can produce the pattern, stated as things that
   can contribute rather than things that are definitely happening to him.
3. **What to check.** The observations that distinguish one cause from
   another, written as questions he can answer about himself.
4. **Practical instructions.** What to do differently, in steps.
5. **Free action plan.** A self-contained exercise, described in full on the
   page. It must work for someone who buys nothing, registers for nothing
   and hands over no personal information, to us or to anyone else. It must
   state plainly what it cannot tell him. An action plan that only works
   once you have bought the app is marketing wearing an exercise's clothes,
   and it is not what this section is for.
6. **When medical evaluation matters.** Named, specific circumstances. Not
   a disclaimer, a list.
7. **Credible references.** Every important health claim in the guide is
   backed by a source a reader can open, and each source is listed with the
   statement it supports, so he can check the claim rather than the article.
8. **Relevant Blueprint next step.** What the app does for this particular
   problem, the two calls to action, and the price.

Sections 5 and 7 are what separate a guide from an advertisement. Both are
load-bearing. Neither is optional.

## Principles

Stage 4 is at least three principles, each presented the same way in every
guide, as a `.principle` card:

- **A statement.** One sentence naming a relationship or mechanism. Not a
  slogan, and not the article's headline reworded. A principle whose words
  mostly repeat the title teaches nobody anything, and the test rejects it.
- **Why it matters**, tying it to what the reader came for.
- **Practical example**, a real situation, not an abstraction.
- **Apply it**, one specific thing to do.

The strongest of the three is repeated near the end as a `.takeaway`, which
is the line a reader should still have a week later.

## The free action plan

- It is `.check` for an observation list, `.steps` for a physical or
  behavioural routine. A routine states position, duration, repetitions,
  an easier variation and the common mistake.
- A routine also carries a `.safety` block saying what to stop for.
- Every plan carries a `.limits` block saying what it cannot tell the
  reader, and never lets a clean-looking week read as reassurance.
- The section contains no link and no call to action at all. The test
  counts anchors in it and requires zero.

## Metadata

Every guide carries Open Graph for the link preview, and one
`application/ld+json` block holding an `Article` and a `BreadcrumbList`.

The structured data must be true. The author is the organisation. There is
no `reviewedBy`, no named clinician and no credential, because nobody with
medical credentials has reviewed these pages, and claiming otherwise in
machine-readable form is still claiming it. Dates are real and not in the
future. Every URL in `citation` is one the page itself lists.

`tools/sync-site-nav.mjs` writes `sitemap.xml` from the same `PAGES` list
that drives the header, so a guide cannot be published and left
undiscoverable. The sitemap has no `lastmod`: a date we cannot derive
truthfully is a fabricated signal, and it is an optional field.

## Privacy

A guide runs no script of its own. The only script on the page is the
shared header's drawer, plus the structured data, which is not executable.
No analytics, no tag manager, no pixel. Nothing reads or writes
`localStorage`, `sessionStorage` or cookies, so a reader's answers to a
checklist exist only on his paper or in his own notes app. This is enforced
by test, because a sexual health page is the worst possible place to leak a
behavioural signal.

## Sources

- Allowed domains are listed in `CREDIBLE_DOMAINS` in
  `tests/learnGuides.test.js`: government health bodies, national health
  services, medical schools and major clinical nonprofits. Adding a domain
  is a deliberate edit to that list, not something a new guide does quietly.
- Every link is `https`, and carries `rel="noopener noreferrer"`. The
  referrer is stripped for the same reason this site has no font CDN: a man
  reading a page about erectile function should not have the page he came
  from announced to a third party.
- A link that opens in a new tab says so to a screen reader, via the
  `.sr-only` span inside the anchor.
- **Check that a URL resolves before publishing it.** The container's
  network policy blocks most outbound hosts, so `curl` returns nothing
  useful. Confirm the URL through search instead, and confirm the page
  actually says the thing you are citing it for. A dead or mis-cited
  reference is worse than no reference.

## Claims

- Never promise an outcome. The copy says "can", "may", "can help". It never
  says a result is guaranteed, cured or fixed.
- Never state a result a member will get. No invented trends, no
  individualised health claims, no outcomes.
- The app is an educational training tool. Every guide says, on the page,
  that it does not diagnose or treat, and that some causes require medical
  care. The footer of another page does not count.
- The price is `$49 one-time access.`, stated once. `class="fig"` belongs to
  the home page's price figure and is not used anywhere else. No monthly or
  subscription language.

## Language

- No em dashes. None. The test checks for `—`, `–` and the two-em and
  three-em dashes.
- No contrast-based rhetoric. Write the thing that is true. Do not set it
  against a thing that is not.
- Practical and direct. Short paragraphs. Plain words over clinical ones
  where both are accurate.
- The banned member-facing phrases in `tests/exerciseCopy.test.js` apply
  here too.

## Page mechanics

- Self-contained: one inline `<style>`, no external stylesheet, no font CDN.
  `tests/landingCss.test.js` explains why.
- The whole stylesheet comes from `tools/guide.css`, written in between the
  `GUIDE-CSS` markers by the sync. A guide has no CSS of its own, and the
  test fails if it grows any: six hand-maintained stylesheets become six
  different-looking articles within a month. Body text is 17px at 1.7 line
  height, in a column of roughly 65 to 70 characters.
- Its own `<link rel="canonical">` on `https://theblueprint.site`.
- A breadcrumb back to `/learn/` and to its hub. The shared header marks a
  link current only on an exact path match, so a guide does not light up its
  hub in the nav, and the breadcrumb is what tells a reader where he is.
  This is deliberate: `aria-current="page"` on a link to a different page
  would be wrong.
- The guide is added to `PAGES` in `tools/sync-site-nav.mjs`, and the shared
  header is written in by running it. Never hand-copy the header.
- The hub's question becomes a link to the guide. If the hub carries a line
  saying guides are being prepared, that line is reworded so it speaks only
  for the ones still unwritten.

## Adding a guide

1. Write the page at its own top-level path.
2. Add it to `PAGES` in `tools/sync-site-nav.mjs` and in
   `tests/siteNav.test.js`, and to the matrix in
   `tests/e2e/site-nav.test.js`.
3. Run `node tools/sync-site-nav.mjs`.
4. Add an entry to `GUIDES` in `tests/learnGuides.test.js`. That one entry
   is what applies this whole standard to the new page.
5. Link it from its hub.
6. `npx vitest run` and `E2E=1 npx vitest run`.
