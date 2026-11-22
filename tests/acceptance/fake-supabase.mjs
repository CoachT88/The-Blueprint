// A LOCAL stand-in for the Supabase endpoints the app uses, so that beginner-acceptance.mjs can be checked
// without a staging project (FAKE=1). It validates THE SCRIPT, not the real database.
//
// The signup row carries the OLD column default ('intermediate') and the real diff_unlocked_date default
// (an object with an empty string for every tier). Writes follow the revision guard in soft mode: a write that
// names a stale base_rev is refused with HTTP 409 / PT409, one that names none is accepted (and clears
// last_write_id), and every accepted write bumps rev. claim_membership() always answers true.
//
// What it does not model: Postgres jsonb (rows are held as plain JSON, so object key order is kept exactly as
// sent, which a jsonb column does not promise), row-level security, real latency, or the real guard's triggers.
import http from 'node:http';

export const signupRow = (uid) => ({
    id: uid, rev: 0, last_write_id: null, base_rev: null, sync_meta: null,
    schedule: null, completed_days: null, total_xp: 0, session_log: [], measurements: [], seen_milestones: [],
    difficulty: 'intermediate',
    diff_unlocked_date: { elite: '', advanced: '', intermediate: '' },
    first_session_date: '', week_key: '', records: null,
    tip_index: 0, last_tip_date: '', all_time_session_count: 0, xp_migrated: false, streak_passes: 0,
    pass_protected_dates: [], last_pass_earned_date: '', primary_goal: '', pelvic_profile: '', pelvic_screen_date: '',
    programme: null, programme_start_date: null, day_plans: [], progression_ledger: [], progress_checkins: [],
});

export async function startFake({ uid, email }) {
    const state = { row: signupRow(uid), claims: 0, writes: 0, refused: 0, seen: new Set(), claimedBy: null };
    const server = http.createServer(async (req, res) => {
        const u = new URL(req.url, 'http://fake');
        let body = ''; for await (const c of req) body += c;
        state.seen.add(`${req.method} ${u.pathname}`);
        const json = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
        if (u.pathname === '/auth/v1/user' && req.method === 'GET')
            return json(200, { id: uid, email, aud: 'authenticated', role: 'authenticated', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {} });
        if (u.pathname === '/rest/v1/rpc/claim_membership') { state.claims++; state.claimedBy = uid; return json(200, true); }
        if (u.pathname === '/rest/v1/user_data') {
            if (req.method === 'GET') {
                if (!state.row) return json(406, { code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' });
                return (req.headers.accept || '').includes('pgrst.object') ? json(200, state.row) : json(200, [state.row]);
            }
            if (req.method === 'POST' || req.method === 'PATCH') {
                let p = {}; try { p = JSON.parse(body || '{}'); } catch (e) { return json(400, { message: 'bad json' }); }
                const obj = Array.isArray(p) ? p[0] : p;
                if (!state.row) state.row = signupRow(uid);
                const hasBase = typeof obj.base_rev === 'number';
                if (hasBase && obj.base_rev !== state.row.rev) { state.refused++; return json(409, { code: 'PT409', details: null, hint: null, message: 'rev_conflict' }); }
                for (const [k, v] of Object.entries(obj)) if (v !== undefined && k !== 'rev' && k !== 'base_rev') state.row[k] = v;
                if (!hasBase) state.row.last_write_id = null;
                state.row.rev = (state.row.rev || 0) + 1; state.row.base_rev = null; state.writes++;
                res.writeHead(201); return res.end();
            }
        }
        return json(404, { code: 'PGRST205', details: null, hint: null, message: `Could not find the table '${u.pathname}' in the schema cache` });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    return { url: `http://127.0.0.1:${port}`, state, close: () => new Promise(r => server.close(r)) };
}
