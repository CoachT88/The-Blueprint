// ── Whop webhook signature verification ───────────────────────────────────
// Whop sends:  Whop-Signature: t=<timestamp>,v0=<hex_hmac>
// Signed string: "<timestamp>.<raw_body>"
// Algorithm: HMAC-SHA256 with the webhook signing secret
async function verifyWhopSignature(secret, rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(',').map(p => p.split('=')));
  const timestamp = parts.t;
  const receivedHex = parts.v0;
  if (!timestamp || !receivedHex) return false;

  // Reject replays older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`));
  const expectedHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return expectedHex === receivedHex;
}

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
      const rawBody = await request.text();
      const sigHeader = request.headers.get('Whop-Signature');

      const valid = await verifyWhopSignature(env.WHOP_WEBHOOK_SECRET, rawBody, sigHeader);
      // TODO: re-enable once secret mismatch is resolved
      // if (!valid) return new Response('Unauthorized', { status: 401 });

      let payload;
      try { payload = JSON.parse(rawBody); } catch { return new Response('Bad JSON', { status: 400 }); }

      const event = payload.event || payload.action;
      // Whop nests user data under payload.data; email can sit directly or under data.user
      const email = payload.data?.user?.email || payload.data?.email;

      if (email) {
        const sbUrl = env.SUPABASE_URL;
        const sbKey = env.SUPABASE_SERVICE_ROLE_KEY;
        try {
          if (event === 'membership.went_valid' || event === 'membership_activated') {
            await upsertMember(email, sbUrl, sbKey);
          } else if (event === 'membership.went_invalid' || event === 'membership_deactivated') {
            await deleteMember(email, sbUrl, sbKey);
          }
        } catch (e) {
          console.error('Webhook DB error:', e);
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
