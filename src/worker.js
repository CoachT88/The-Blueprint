// ── Supabase members table helpers ────────────────────────────────────────
async function upsertMember(email, supabaseUrl, serviceKey) {
  const res = await fetch(`${supabaseUrl}/rest/v1/members`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([{ email }]),
  });
  if (!res.ok) throw new Error(`Supabase upsert failed: ${res.status}`);
}

async function deleteMember(email, supabaseUrl, serviceKey) {
  const res = await fetch(`${supabaseUrl}/rest/v1/members?email=eq.${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Supabase delete failed: ${res.status}`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── Whop membership webhook ──────────────────────────────────────────
    if (url.pathname === '/api/whop-webhook' && request.method === 'GET') {
      return new Response('OK', { status: 200 });
    }
    if (url.pathname === '/api/whop-webhook' && request.method === 'POST') {
      let payload;
      try { payload = JSON.parse(await request.text()); } catch { return new Response('Bad JSON', { status: 400 }); }

      const event = payload.event || payload.action;
      const email = payload.data?.user?.email || payload.data?.email;

      if (email) {
        try {
          if (event === 'membership.went_valid' || event === 'membership_activated') {
            await upsertMember(email, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
          } else if (event === 'membership.went_invalid' || event === 'membership_deactivated') {
            await deleteMember(email, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
          }
        } catch (e) {
          console.error('Whop webhook DB error:', e);
          return new Response('Internal error', { status: 500 });
        }
      }

      return new Response('OK', { status: 200 });
    }

    // ── Ko-fi membership webhook ─────────────────────────────────────────
    if (url.pathname === '/api/kofi-webhook' && request.method === 'GET') {
      return new Response('OK', { status: 200 });
    }
    if (url.pathname === '/api/kofi-webhook' && request.method === 'POST') {
      let body;
      try {
        const text = await request.text();
        const params = new URLSearchParams(text);
        const dataStr = params.get('data');
        if (!dataStr) return new Response('Bad Request', { status: 400 });
        body = JSON.parse(dataStr);
      } catch { return new Response('Bad JSON', { status: 400 }); }

      if (env.KOFI_VERIFICATION_TOKEN && body.verification_token !== env.KOFI_VERIFICATION_TOKEN) {
        return new Response('Unauthorized', { status: 401 });
      }

      const email = body.email;
      if (email) {
        try {
          await upsertMember(email, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
        } catch (e) {
          console.error('Ko-fi webhook DB error:', e);
          return new Response('Internal error', { status: 500 });
        }
      }

      return new Response('OK', { status: 200 });
    }

    // ── Coach Tee proxy ──────────────────────────────────────────────────
    if (url.pathname === '/api/coach-tee' && request.method === 'POST') {
      const { userMsg, systemPrompt } = await request.json();

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMsg }],
        }),
      });

      const data = await res.json();
      return new Response(JSON.stringify(data), {
        status: res.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // OPTIONS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // All other requests served by static assets
    return env.ASSETS.fetch(request);
  },
};
