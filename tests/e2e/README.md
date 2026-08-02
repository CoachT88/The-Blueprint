# End-to-end suites

These drive the real `index.html` in Chromium. The app is one ~5,000 line file
with no build step, so there are no modules to import and unit-test — the only
honest way to check behaviour is to load the page and use it.

## Running

```bash
npm test        # unit + syntax only. No browser, ~0.5s. Run this constantly.
npm run test:e2e  # these suites. Launches a browser, takes a few minutes.
npm run test:all  # both
```

A single suite:

```bash
E2E=1 npx vitest run tests/e2e/data-loss.test.js
```

You do not need to start a server. Each suite serves the repo itself on a random
free port.

If Playwright cannot find Chromium, either run `npx playwright install chromium`
or point at an existing binary:

```bash
PW_CHROMIUM_PATH=/path/to/chrome npm run test:e2e
```

## What each suite guards

| Suite | Guards |
|---|---|
| `data-loss` | **The one that matters most.** A timed-out load must never write defaults over a real row. |
| `data-preservation` | An established member survives load and save with everything intact. |
| `schedule-safety` | A member's customised calendar is never silently rewritten. |
| `offline` | The write guard does not block a member who has a valid local backup. |
| `schema-fallback` | A column that has not been migrated yet cannot break the whole upsert. |
| `regression` | Broad wiring smoke test: functions, element ids, every step, a full session. |
| `warmup-flow` | Warmup only for Length and Girth; girth rounds match the tier. |
| `hydration` | Logging past the goal, typo guard, undo, units, Coach Tee units. |
| `goal` | Goal capture, stamina day type, and the surfaces that adapt to it. |
| `tour-geometry` | All eight coach marks land on target and stay in the viewport. |
| `tour-lifecycle` | Shows once, skip, replay, one-time tips, and the intro-to-tour chain. |
| `recovery-pass` | Earn, cap, consume, and the four cases that must not consume. |
| `photo-compare` | Before/after, tap to swap, single-photo state. |
| `membership-denial` | A non-member is refused and pointed at the storefront. |
| `newuser-ux` | Welcome copy, rest-day warning, mission subtitles, jargon glosses. |
| `coach-eq` | Coach Tee context content and EQ chart formatting. |

## Things that will bite you

**Don't name an import after an app global.** Inside `page.evaluate` the bundler
rewrites identifiers that match a module import, so a helper called `session`
becomes `__vite_ssr_import_1__.session` and blows up, because the app's own
global `session` object is what the browser actually has. This is why the helper
is `sessionEntry`. Same applies to `persisted`, `currentUser`, `goToStep`.

**Assign to bare identifiers, not `window`.** The app declares `currentUser`,
`persisted` and friends with top-level `let`. Those live in the global lexical
environment and are *not* window properties, so `window.currentUser = ...`
creates an unrelated property and the app still sees `null`. `signIn()` handles
this correctly; follow the same pattern in new tests.

**`#step-0` is the scroll container, not the page.** `html` and `body` are
`overflow:hidden`. That means `getBoundingClientRect()` already returns viewport
coordinates, so fixed-position overlays need no scroll-offset maths — and also
that `window.scrollY` is always 0 and tells you nothing.

**Smooth scrolling has no completion event.** The tour settles with a timeout
before measuring. If you add geometry assertions, wait too.

**Use `textContent`, not `innerText`, for button labels.** `.btn-primary` applies
`text-transform: uppercase`, and `innerText` returns the transformed text while
`textContent` returns what the code actually set.

**Assert on SVG text nodes, not `innerHTML`.** A regex for an inch mark will
happily match `stroke-width="2.5"`.

**Tailwind is not real here.** See the header comment in `tw-shim.css`. The CDNs
are blocked on purpose so runs are deterministic and work offline, and the shim
covers the layout utilities the app uses. Assertions should be about behaviour
and state; if you need pixel-accurate layout, build Tailwind properly and drop
the CDN block instead. The shim has no arbitrary z-index utilities, which is why
`photo-compare` parks the step layer before clicking.

## Adding a suite

```js
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { openApp, signIn } from './harness.js';

describe('the thing', () => {
    let app;
    beforeAll(async () => { app = await openApp(); await signIn(app.page); }, 60_000);
    afterAll(async () => { await app?.close(); });

    test('behaves', async () => {
        // ...
        expect(app.errors).toEqual([]);  // worth asserting at least once per suite
    });
});
```

`openApp()` takes `{ row, hangRead, rejectColumns, files }` to shape the Supabase
stub: the row a read returns, whether the read hangs so the timeout path runs,
which columns an upsert should reject, and what the photo storage lists. Every
accepted upsert is recorded on `window.__writes`.
