# Phase 3 current-app image handoff

These are the latest, **owner-supplied** Blueprint app screens (October 2026).
They supersede the older Playwright-generated shots in the public sales pages.

Commit these four JPEG files directly into the root `img/` directory on
`phase3-user-current-screenshots-2026-10-27`. Do not rename them:

| File | Owner screenshot | Screen | Expected dimensions |
| --- | --- | --- | --- |
| `img/app-today-2026.jpg` | `IMG_7829.jpeg` | HQ: Girth Day | 780 × 1630 |
| `img/app-sessions-2026.jpg` | `IMG_7830.jpeg` | Choose a Different Session | 780 × 1442 |
| `img/app-recovery-2026.jpg` | `IMG_7831.jpeg` | Recovery | 780 × 1524 |
| `img/app-guided-practice-2026.jpg` | `IMG_7832.jpeg` | Diaphragmatic breathing | 780 × 1596 |

The files are optimized JPEGs of the actual submitted pictures, without
invented screenshots or generated app views.

The homepage `#look` gallery uses all four. The What's Inside page uses
Today and Guided Practice. The `tests/marketingScreenshots.test.js` test
**intentionally fails** until the exact image assets exist, preventing
release of broken links.

The legacy `img/shot-*.jpg` files are not used by the new public copy.
The old screenshot generator is not the source of truth for marketing images
because it previously produced visuals that did not reflect the user's device.
