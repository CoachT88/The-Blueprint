#!/usr/bin/env bash
# Regenerate app/vendor/tw.css from app/index.html.
#
# There is no build step in this project and this script is NOT one: it is run
# by hand when the markup gains or loses Tailwind classes, and its output is
# committed. Deployment serves the committed file through the existing ASSETS
# binding, exactly as before.
#
#   npm install --no-save tailwindcss@3
#   ./tools/build-vendor-css.sh
#   npm test          # tests/classCoverage.test.js proves nothing was dropped
set -euo pipefail
cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/cfg.cjs" <<'CFG'
module.exports = {
  content: [require('path').resolve(__dirname, '../../app/index.html')],
  theme: { extend: {} },
  corePlugins: { preflight: true },
};
CFG
# content path above is relative to the temp dir, so pass it absolutely
printf "module.exports={content:['%s/app/index.html'],theme:{extend:{}},corePlugins:{preflight:true}};\n" "$PWD" > "$TMP/cfg.cjs"
printf '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' > "$TMP/in.css"
./node_modules/.bin/tailwindcss -c "$TMP/cfg.cjs" -i "$TMP/in.css" -o "$TMP/out.css" --minify >/dev/null
{
cat <<'HDR'
/* Tailwind CSS, generated once and committed. Replaces cdn.tailwindcss.com,
   whose JIT runtime compiled these same utilities in the browser on every
   load: ~100 KB of JavaScript, a third-party round trip, and an unstyled app
   whenever it was slow or blocked. There is no build step; this file is
   served from the repo through the existing ASSETS binding.

   Linked BELOW the inline <style> in app/index.html, which is where the CDN's
   injected stylesheet effectively sat. Linking it above flips the cascade and
   the app's own component classes start beating Tailwind utilities, which is
   how the deload banner briefly rendered on every HQ.

   DO NOT EDIT. Regenerate with tools/build-vendor-css.sh.
   tests/classCoverage.test.js is the gate that proves nothing was dropped. */
HDR
cat "$TMP/out.css"
} > app/vendor/tw.css
printf 'app/vendor/tw.css  %s bytes\n' "$(wc -c < app/vendor/tw.css)"
