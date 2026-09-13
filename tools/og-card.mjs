/**
 * Builds img/og-card.jpg, the 1200x630 image every link preview shows.
 *
 * It existed as a <meta> tag pointing at a file nobody had made, so every
 * link pasted into iMessage, WhatsApp, Reddit or anywhere else rendered as
 * a bare grey box. On a product whose entire distribution is the founder
 * pasting a link, that is the first impression.
 *
 * Run: node tools/og-card.mjs
 *
 * Liberation Sans is named first on purpose. This renders once and ships as
 * a flat image, so it must not depend on a font that happens to be on the
 * machine that ran it. Liberation is the metric clone of Helvetica that this
 * container actually has, and it is what the page's own Helvetica fallback
 * resolves to anyway.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'img', 'og-card.jpg');

const html = `<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;overflow:hidden;background:#020617;
    font-family:"Liberation Sans",Helvetica,Arial,sans-serif;position:relative}
  .glow{position:absolute;inset:0;
    background:
      radial-gradient(900px 420px at 12% -12%,rgba(59,130,246,.30),transparent 66%),
      radial-gradient(700px 420px at 92% 108%,rgba(168,85,247,.20),transparent 64%);}
  .in{position:relative;padding:72px 78px;height:100%;display:flex;flex-direction:column;
    justify-content:space-between}
  .brand{display:flex;align-items:center;gap:16px}
  .mark{width:52px;height:52px;border-radius:15px;
    background:linear-gradient(150deg,#3b82f6,#1d4ed8);display:grid;place-items:center;
    color:#fff;font-weight:700;font-style:italic;font-size:25px}
  .name{color:#f8fafc;font-weight:700;font-style:italic;text-transform:uppercase;
    letter-spacing:-.01em;font-size:29px}
  h1{font-weight:700;font-style:italic;text-transform:uppercase;font-size:78px;
    line-height:.99;letter-spacing:-.03em;max-width:17ch;
    background:linear-gradient(150deg,#f8fafc,#8fa3bd);-webkit-background-clip:text;
    background-clip:text;color:transparent}
  .sub{color:#cbd5e1;font-size:26px;line-height:1.4;max-width:46ch;margin-top:24px}
  .foot{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  .pill{border:1px solid #1f2c40;background:#0f172a;border-radius:999px;
    padding:11px 20px;color:#94a3b8;font-size:19px;font-weight:700}
  .pill.hot{border-color:rgba(59,130,246,.42);color:#60a5fa;
    background:linear-gradient(150deg,rgba(59,130,246,.14),rgba(15,23,42,.6))}
</style>
<div class="glow"></div>
<div class="in">
  <div class="brand"><div class="mark">B</div><div class="name">The Blueprint</div></div>
  <div>
    <h1>Your sexual performance can be trained.</h1>
    <p class="sub">Blood flow, pelvic floor control, lasting longer, and structured
      length and girth training. One app.</p>
  </div>
  <div class="foot">
    <span class="pill hot">$30 once</span>
    <span class="pill">No subscription</span>
    <span class="pill">Private on your phone</span>
  </div>
</div>`;

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await p.setContent(html, { waitUntil: 'load' });
await p.evaluate(() => document.fonts.ready);

// If the headline fell back to a font without the metrics this layout assumes,
// it will have wrapped to a fourth line and be sitting outside the card. Catch
// that here rather than shipping a clipped image.
const fit = await p.evaluate(() => {
  const h = document.querySelector('h1').getBoundingClientRect();
  const f = document.querySelector('.foot').getBoundingClientRect();
  return { headlineBottom: Math.round(h.bottom), footBottom: Math.round(f.bottom), h: 630 };
});
if (fit.footBottom > fit.h || fit.headlineBottom > fit.h) {
  throw new Error(`og-card overflows 630px: ${JSON.stringify(fit)}`);
}

await p.screenshot({ path: OUT, type: 'jpeg', quality: 90 });
await b.close();
console.log('wrote', OUT, JSON.stringify(fit));
