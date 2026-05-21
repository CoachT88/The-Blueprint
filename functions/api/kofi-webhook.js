// Ko-fi purchase webhook
// Adds buyer's email to Supabase members table on any successful payment.

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
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase upsert failed: ${res.status} — ${errText}`);
  }
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    const text = await request.text();
    console.log('Ko-fi raw body:', text.slice(0, 200));
    const params = new URLSearchParams(text);
    const dataStr = params.get('data');
    if (!dataStr) {
      console.error('Ko-fi: no data field in body');
      return new Response('Bad Request', { status: 400 });
    }
    body = JSON.parse(dataStr);
    console.log('Ko-fi parsed — type:', body.type, 'email:', body.email);
  } catch (e) {
    console.error('Ko-fi parse error:', e);
    return new Response('Bad JSON', { status: 400 });
  }

  // Verify token if configured
  if (env.KOFI_VERIFICATION_TOKEN && body.verification_token !== env.KOFI_VERIFICATION_TOKEN) {
    console.error('Ko-fi token mismatch');
    return new Response('Unauthorized', { status: 401 });
  }

  const email = body.email;
  if (!email) {
    console.error('Ko-fi: no email in payload');
    return new Response('OK', { status: 200 });
  }

  try {
    await upsertMember(email, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    console.log('Ko-fi: member added —', email);
  } catch (e) {
    console.error('Ko-fi webhook DB error:', e.message);
    return new Response('Internal error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

export async function onRequestGet() {
  return new Response('OK', { status: 200 });
}
