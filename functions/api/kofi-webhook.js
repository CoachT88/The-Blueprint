// Ko-fi purchase webhook
// Adds buyer's email to Supabase members table on any successful payment.
//
// Setup:
//   1. Go to Ko-fi → Settings → API  and set a Verification Token
//   2. Set webhook URL to: https://the-blueprint-b50.pages.dev/api/kofi-webhook
//   3. Add these to Cloudflare Pages → Settings → Variables and Secrets:
//        KOFI_VERIFICATION_TOKEN  — the token you set in Ko-fi
//        SUPABASE_URL             — your Supabase project URL
//        SUPABASE_SERVICE_ROLE_KEY — Supabase → Project Settings → API → service_role

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

export async function onRequestPost({ request, env }) {
  let body;
  try {
    const text = await request.text();
    const params = new URLSearchParams(text);
    const dataStr = params.get('data');
    if (!dataStr) return new Response('Bad Request', { status: 400 });
    body = JSON.parse(dataStr);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  // Verify token if configured
  if (env.KOFI_VERIFICATION_TOKEN && body.verification_token !== env.KOFI_VERIFICATION_TOKEN) {
    return new Response('Unauthorized', { status: 401 });
  }

  const email = body.email;
  if (!email) return new Response('OK', { status: 200 });

  try {
    await upsertMember(email, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  } catch (e) {
    console.error('Ko-fi webhook DB error:', e);
    return new Response('Internal error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

export async function onRequestGet() {
  return new Response('OK', { status: 200 });
}
