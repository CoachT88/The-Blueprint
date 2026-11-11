#!/usr/bin/env node
// Swaps the Erection Quality website copy to the activation version.
//
// WHY THIS EXISTS. The website must not advertise the new EQ programme before it
// is switched on, and must describe it the moment it is. The two states are
// pinned in tests/goalBridge.test.js to EQ_SESSIONS_ENABLED in app/index.html,
// so flipping the flag without running this, or running this without flipping
// the flag, fails CI. The activation copy itself lives in this directory and is
// tested against the implementation while it is still unused.
//
// USE, at activation, in the same change that sets EQ_SESSIONS_ENABLED to true:
//     node tools/launch/apply-eq-website-copy.mjs
// It refuses to run while the flag is false. It is idempotent. Reverting is
// `git checkout` of the two pages.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const BRIDGE_OPEN = '<div class="goal-bridge" id="for-erections">';
const HUB_READING = /<p class="reading">The app charts the erection quality[\s\S]*?<\/p>/;

/** Pure: the two pages in, the two pages out. Everything outside the two replaced regions is untouched. */
export function applyEqCopy({ whatsInside, hub, bridge, hubReading }) {
    const start = whatsInside.indexOf(BRIDGE_OPEN);
    if (start < 0) throw new Error('whats-inside: the #for-erections bridge was not found');
    const end = whatsInside.indexOf('</div>', start) + '</div>'.length;
    const nextWhatsInside = whatsInside.slice(0, start) + bridge.trim() + whatsInside.slice(end);
    if (!HUB_READING.test(hub)) throw new Error('stronger-erections: the reading paragraph was not found');
    const nextHub = hub.replace(HUB_READING, () => hubReading.trim());
    return { whatsInside: nextWhatsInside, hub: nextHub };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const app = readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
    if (!/^let EQ_SESSIONS_ENABLED\s*=\s*true\b/m.test(app)) {
        console.error('Refusing: EQ_SESSIONS_ENABLED is not true in app/index.html. The website must not advertise EQ before it is on.');
        process.exit(2);
    }
    const files = { whatsInside: 'whats-inside/index.html', hub: 'stronger-erections/index.html' };
    const out = applyEqCopy({
        whatsInside: readFileSync(path.join(ROOT, files.whatsInside), 'utf8'),
        hub: readFileSync(path.join(ROOT, files.hub), 'utf8'),
        bridge: readFileSync(path.join(HERE, 'eq-bridge.live.html'), 'utf8'),
        hubReading: readFileSync(path.join(HERE, 'eq-hub-reading.live.html'), 'utf8'),
    });
    writeFileSync(path.join(ROOT, files.whatsInside), out.whatsInside);
    writeFileSync(path.join(ROOT, files.hub), out.hub);
    console.log('EQ website copy applied to', Object.values(files).join(' and '));
}
