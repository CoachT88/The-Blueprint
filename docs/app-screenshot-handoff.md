# Swapping in the owner's current app screenshots

**Status: blocked, and the only thing in the October 2026 site overhaul
that is.** The four files are not in this repository, not in any branch,
and not anywhere in the environment this work was done in. PR #158 says
where they are: *"The archive containing the four exact prepared files is
available in the ChatGPT conversation."* That is not a place a repository
can reach.

Nothing is broken while they are missing. The pages reference the four
screenshots that are committed today and they all resolve. What is true is
that those four were generated from the app by
`tools/capture-marketing-screenshots.mjs`, and the owner has said they do
not match what the app looks like on their device.

**No substitute was produced.** Re-running the generator would produce the
same mismatch, and drawing a picture of an app screen is a fabricated
product claim. The swap waits for the real files.

## What to send

Four images, as captured on the device:

| Owner's file | Screen |
|---|---|
| `IMG_7829.jpeg` | HQ / Today / Girth Day |
| `IMG_7830.jpeg` | Choose a Different Session |
| `IMG_7831.jpeg` | Recovery / Coach Tee recommendations |
| `IMG_7832.jpeg` | Guided Practice / Diaphragmatic Breathing |

Attach them to the pull request, drop them in the repository, or send them
any way that reaches a file. The originals are better than anything
pre-cropped: cropping and optimizing is the easy half.

## What happens then

Four edits, in one commit.

1. **Commit the files** as `img/app-today-2026.jpg`,
   `img/app-sessions-2026.jpg`, `img/app-recovery-2026.jpg` and
   `img/app-guided-practice-2026.jpg`. PR #158 prepared those names and the
   dimensions it optimized to (780 wide; 1630, 1442, 1524 and 1596 tall).
   Any consistent size works as long as step 2 matches it.

2. **Update the markup in two places.** The home page `#look` gallery uses
   all four; `/whats-inside/` uses Today and Guided Practice. Each `<img>`
   carries `width` and `height`, and those two numbers must equal the real
   pixel dimensions of the file.

   This is not cosmetic. The owner's captures are a different aspect ratio
   from the generated ones, so a swap that leaves `width="390"
   height="844"` in place reserves the wrong space and the page jumps as
   each image loads. `tests/marketingScreenshots.test.js` reads the JPEG
   headers and fails if a declared size disagrees with the file, which is
   the one check that catches this before a visitor does.

3. **Rewrite the four captions** to describe the screens that are actually
   shown. The current captions describe the current images; Girth Day and
   Diaphragmatic Breathing are different screens and deserve their own
   words. PR #158 drafted a set.

4. **Delete the four `img/shot-*.jpg` files.** The same test fails on any
   image in `img/` that nothing references, so the old set cannot be left
   behind for somebody to wonder about later. `og-card.jpg` stays; it is
   the link preview card and every page's meta tags point at it.

Then `npx vitest run tests/marketingScreenshots.test.js`, and the full
suite before merging.

## What not to do

- **Do not regenerate them.** `tools/capture-marketing-screenshots.mjs`
  drives the real app with fictional data and is honest as far as it goes,
  but it is what produced the mismatch the owner is asking to fix. PR #158
  proposes retiring it along with its workflow; that decision belongs with
  whoever merges #158.
- **Do not ship a reference to a file that is not committed.** A broken
  `<img>` on the page selling the product is worse than an older picture of
  it.
- **Do not alter what the screens show.** Crop and compress; do not edit
  numbers, badges, or state into or out of a product screenshot.
