# Product screenshots: current app (October 2026)

**Status: completed in PR #161.** The site now uses four device screenshots
supplied by Coach Tee, not screenshots generated from an older development
build. Do not quietly regenerate these with headless Playwright or AI:
marketing must reflect what a paying customer actually sees.

## Source and destination

| Original device file | Committed website asset | Dimensions | View |
|---|---|---|---|
| `IMG_7829.jpeg` | `img/app-today-2026.jpg` | 780 × 1630 | HQ / Today / Girth Day |
| `IMG_7830.jpeg` | `img/app-sessions-2026.jpg` | 780 × 1442 | Choose a Different Session |
| `IMG_7831.jpeg` | `img/app-recovery-2026.jpg` | 780 × 1524 | Recovery / Coach Tee recommendations |
| `IMG_7832.jpeg` | `img/app-guided-practice-2026.jpg` | 780 × 1596 | Guided Practice / Diaphragmatic Breathing |

The owner provided all four files in the project conversation. The screenshots
were resized and compressed, without adding invented claims, measurements,
interface elements, or progress examples.

The homepage `#look` gallery uses all four, displayed as an accessible
sideways-scrolling gallery on small screens and a grid on desktop.
`/whats-inside/` uses the Today and Guided Practice screens to illustrate
what a new purchaser can expect.

The former `img/shot-*.jpg` captures and automated capture workflow were
removed to prevent a stale UI from accidentally replacing the updated
screenshots. `img/og-card.jpg` remains the link-preview image.

## How to update these in the future

1. Confirm the actual current customer-facing app version on a mobile device.
2. Capture authentic screens with a demonstration account that contains no
   real customer information. Use realistic but clearly presented sample state.
3. Optimize the originals carefully for the web while preserving content.
4. Update the images in `img/` and their references in `index.html` and
   `whats-inside/index.html`. Match HTML `width`/`height` attributes
   to the actual JPEG pixel dimensions.
5. Update captions, alt text, tests and this document. The
   `tests/marketingScreenshots.test.js` suite checks referenced image files,
   image dimensions, orphaned assets, and whether the retired screenshot
   generator has returned.
6. Verify the mobile swipe gallery, desktop grid, page scroll and image
   loading at 320px, 390px, 768px and desktop before merging.

Never publish images that show obsolete or invented app features.
