#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Revision-guard check against a REAL Supabase STAGING project.
// ═══════════════════════════════════════════════════════════════════════════
// The local proofs (tests/sql, tests/e2e/sync-protection) run PostgreSQL and the
// app against a model of PostgREST. This closes the remaining gap: real
// PostgREST, real RLS, real HTTP status codes, a real signed-in member.
//
// NEVER point this at production. It writes to one member's row.
//
// SETUP (owner):
//   1. A Supabase STAGING project with the app's schema and
//      supabase/revision-guard.sql applied (soft mode).
//   2. One throwaway test member (sign up in staging); note its user id and a
//      current access token (supabase.auth.getSession() in the browser console).
//   3. Export:
//        STAGING_URL        https://<ref>.supabase.co
//        STAGING_ANON_KEY   the staging anon key
//        STAGING_USER_ID    the test member's uuid
//        STAGING_USER_JWT   that member's access token
//        EXPECT_MODE        soft (default) | hard
//   4. node tools/staging-check.mjs
//
// THEN, BY HAND, with the real app pointed at staging, signed in as that member:
//   a. open the app in two tabs; finish a session in tab A; then finish one in
//      tab B without reloading. Expect both sessions in history, XP counted once
//      each, and no error shown.
//   b. change the goal in tab A, then in tab B (stale) change difficulty and
//      finish a session. Expect the session kept, the newer goal kept, and the
//      "updated from another device" notice naming what was not saved.
//   c. switch the project to hard mode (supabase/revision-guard-enforce.sql) and
//      confirm an up-to-date tab still saves.
// ═══════════════════════════════════════════════════════════════════════════
const need = ['STAGING_URL', 'STAGING_ANON_KEY', 'STAGING_USER_ID', 'STAGING_USER_JWT'];
const missing = need.filter(k => !process.env[k]);
if (missing.length) { console.error('Missing env: ' + missing.join(', ')); process.exit(2); }
const { STAGING_URL: URL0, STAGING_ANON_KEY: ANON, STAGING_USER_ID: UID, STAGING_USER_JWT: JWT } = process.env;
const MODE = (process.env.EXPECT_MODE || 'soft').toLowerCase();
if (/\.supabase\.co/.test(URL0) && /prod/i.test(URL0)) { console.error('Refusing: that URL looks like production.'); process.exit(2); }

const H = { apikey: ANON, Authorization: 'Bearer ' + JWT, 'Content-Type': 'application/json' };
// The same request supabase-js makes for .upsert(obj, {onConflict:'id'}).
const upsert = (obj) => fetch(`${URL0}/rest/v1/user_data?on_conflict=id`, {
    method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(obj) });
const read = async () => {
    const r = await fetch(`${URL0}/rest/v1/user_data?id=eq.${UID}&select=*`, { headers: { ...H, Accept: 'application/vnd.pgrst.object+json' } });
    return r.ok ? r.json() : null;
};
let pass = 0, fail = 0;
const chk = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : `   expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`)); };
const bodyOf = async (r) => { try { return await r.json(); } catch { return {}; } };

const row0 = await read();
if (!row0) { console.error('Could not read the test member\'s row. Check the id, token and RLS.'); process.exit(2); }
if (typeof row0.rev !== 'number') { console.error('The row has no `rev`: supabase/revision-guard.sql has not been applied here.'); process.exit(2); }
console.log(`Starting at rev ${row0.rev}, mode expectation: ${MODE}\n`);

// 1. A protected write names its base and lands.
let rev = row0.rev;
let r = await upsert({ id: UID, total_xp: row0.total_xp ?? 0, base_rev: rev, last_write_id: 'check-1' });
chk('protected write accepted', r.ok, true);
let row = await read();
chk('rev advanced by one, write id recorded', [row.rev, row.last_write_id], [rev + 1, 'check-1']);
chk('base_rev is reset after the write', row.base_rev, null);
const staleBase = rev; rev = row.rev;

// 2. A stale base is refused, with a status the client recognises, and changes nothing.
r = await upsert({ id: UID, total_xp: 999999, base_rev: staleBase, last_write_id: 'check-stale' });
const b2 = await bodyOf(r);
chk('stale write refused with HTTP 409', r.status, 409);
chk('refusal says rev_conflict', /rev_conflict/.test(JSON.stringify(b2)), true);
row = await read();
chk('refused write changed nothing', [row.rev, row.total_xp === 999999], [rev, false]);

// 3. Partial columns merge: a write that omits total_xp leaves it alone.
r = await upsert({ id: UID, base_rev: rev, last_write_id: 'check-3', tip_index: (row.tip_index ?? 0) });
chk('partial-column write accepted', r.ok, true);
const before = row.total_xp; row = await read(); rev = row.rev;
chk('omitted column untouched', row.total_xp, before);

// 4. Legacy write (no base_rev).
r = await upsert({ id: UID, tip_index: row.tip_index ?? 0 });
if (MODE === 'hard') {
    chk('HARD: legacy write refused (409)', r.status, 409);
    chk('HARD: refusal says rev_required', /rev_required/.test(JSON.stringify(await bodyOf(r))), true);
} else {
    chk('SOFT: legacy write accepted', r.ok, true);
    row = await read();
    chk('SOFT: it bumped rev and cleared last_write_id', [row.rev, row.last_write_id], [rev + 1, null]);
    rev = row.rev;
}

// 5. Ten simultaneous writers on one base: exactly one wins.
const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    upsert({ id: UID, base_rev: rev, last_write_id: 'race-' + i, tip_index: i }).then(x => x.status)));
chk('exactly one of ten simultaneous writers accepted', results.filter(s => s >= 200 && s < 300).length, 1);
chk('the other nine refused with 409', results.filter(s => s === 409).length, 9);
row = await read();
chk('rev advanced exactly once', row.rev, rev + 1);

// 6. The enforcement setting is not reachable by a member.
const cfg = await fetch(`${URL0}/rest/v1/user_data_rev_config`, { headers: { ...H, 'Accept-Profile': 'private' } });
chk('private config not readable through the API', cfg.ok, false);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
