// Whop membership webhook
// Grants access on purchase, revokes on cancellation/refund.
//
// Required secrets (Cloudflare Pages → Settings → Variables and Secrets):
//   SUPABASE_URL             — your Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY — Supabase → Project Settings → API → service_role

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
