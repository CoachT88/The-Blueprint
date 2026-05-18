// Whop membership webhook
// Grants access on purchase, revokes on cancellation/refund.
//
// Required secrets (add in Cloudflare Pages → Settings → Variables and Secrets):
//   WHOP_WEBHOOK_SECRET      — Whop dashboard → Developer → Webhooks → signing secret
//   SUPABASE_URL             — your Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY — Supabase → Project Settings → API → service_role

async function verifyWhopSignature(secret, rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map(p => { const i = p.indexOf('='); return [p.slice(0,i).trim(), p.slice(i+1).trim()]; })
  );
  const { t: timestamp, v0: receivedHex } = parts;
  if (!timestamp || !receivedHex) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false; // reject replays > 5 min old

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`));
  const expectedHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return expectedHex === receivedHex;
}

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
    },
  });
  if (!res.ok) throw new Error(`Supabase delete failed: ${res.status}`);
}

export async function onRequestPost({ request, env }) {
  const rawBody = await request.text();
  const sigHeader = request.headers.get('Whop-Signature');

  const valid = await verifyWhopSignature(env.WHOP_WEBHOOK_SECRET, rawBody, sigHeader);
  if (!valid) return new Response('Unauthorized', { status: 401 });

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return new Response('Bad JSON', { status: 400 }); }

  const event = payload.event || payload.action;
  const email = payload.data?.user?.email || payload.data?.email;

  if (email) {
    try {
      if (event === 'membership_activated' || event === 'membership.went_valid') {
        await upsertMember(email, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
      } else if (event === 'membership_deactivated' || event === 'membership.went_invalid') {
        await deleteMember(email, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
      }
    } catch (e) {
      console.error('Webhook DB error:', e);
      return new Response('Internal error', { status: 500 });
    }
  }

  return new Response('OK', { status: 200 });
}

export async function onRequestGet() {
  return new Response('OK', { status: 200 });
}
