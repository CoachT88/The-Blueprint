# Vendored assets

The app used to pull three stylesheets from third parties at runtime:
`cdn.tailwindcss.com` (a ~100 KB JIT compiler that generated the CSS in the
browser on every load), `cdnjs.cloudflare.com` for Font Awesome, and
`fonts.googleapis.com` for Inter and JetBrains Mono. Any one of them slow or
blocked left the app unstyled.

Phase 3B committed them instead. **There is no build step.** `wrangler.jsonc`
sets `assets.directory: "."` and `src/worker.js` falls through to
`env.ASSETS.fetch`, so everything in `app/vendor/` is already served at its
repo path. Deployment is unchanged.

| File | What | Size |
|---|---|---|
| `app/vendor/tw.css` | Tailwind, scanned from `app/index.html` | 29.9 KB (6.5 KB gzipped) |
| `app/vendor/fa.css` | Font Awesome 6 Free Solid, 79 glyphs | 3.1 KB |
| `app/vendor/webfonts/fa-solid-900.woff2` | the solid face | 119.5 KB |
| `app/vendor/fonts/inter-wght-{normal,italic}.woff2` | Inter variable, 100-900 | 97.7 KB |
| `app/vendor/fonts/jetbrains-mono-{700,800}.woff2` | numerics | 42.3 KB |

## Regenerating the Tailwind CSS

Run this whenever the markup gains or loses a Tailwind class:

```sh
npm install --no-save tailwindcss@3
./tools/build-vendor-css.sh
npm test        # tests/classCoverage.test.js proves nothing was dropped
```

`--no-save` on purpose: the toolchain is not a dependency of the app, and
`package.json` must stay free of it.

## Three things that will bite you

**Link order matters.** `tw.css` is linked *below* the inline `<style>` in
`app/index.html`, because that is where the CDN's injected stylesheet
effectively sat. Move it above and the cascade flips: the app's own component
classes start beating Tailwind utilities, and
`.deload-banner{display:flex}` quietly beats `.hidden{display:none}` so the
deload banner renders on every HQ. `tests/e2e/stacking.test.js` covers it.

**Dropped classes are invisible.** With the JIT gone, a class the content scan
misses simply has no rule. The element keeps the class and renders without it,
and nothing errors. `tests/classCoverage.test.js` is the gate: it harvests
every class token the file can emit, from attributes, template literals,
`classList` calls and ternary branches, and fails if any has no rule.

**Runtime-composed classes must be declared.** The one in the codebase is
`type-${...}` on the calendar tiles, bounded to five values by `DAY_TYPES`.
It is declared in `RUNTIME_COMPOSED` in that test, which expands it and
checks every value resolves, and a companion test fails if `DAY_TYPES` grows.
Anything built by concatenation (`'bg-' + colour`) is rejected outright.

## Fonts

Inter is the **variable** build: 97.7 KB in 2 files against 193.8 KB in 8 for
the static faces, and it is the only one of the two that renders every weight
the app asks for. The static set loaded 400/600/700/900, so the three
`font-medium` (500) and twelve `font-weight:800` declarations were synthesised
from a neighbour. Measured rendered widths: at 500 the static face was
identical to 400, and at 800 identical to 900.

JetBrains Mono has no 900 in the family; 800 is the heaviest. Shipping 700 and
800 means `#box-phase-count`'s `font-weight:900` resolves to a real 800 face
rather than synthesising from 700, which is what it did when only 700 was
imported.

Two Font Awesome **Pro** icons were referenced and had been rendering nothing:
`fa-shield-exclamation` on the liability gate and `fa-droplets` in the warmup.
They are now `fa-triangle-exclamation` and `fa-droplet`.

## Still external

`unpkg.com` serves the Supabase JS client. That is a script, not styling, and
was out of scope for Phase 3B.
