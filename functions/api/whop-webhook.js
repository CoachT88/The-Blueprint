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
  console.log('Whop raw body:', rawBody.slice(0, 300));

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return new Response('Bad JSON', { status: 400 }); }

  const event = payload.event || payload.action;
  const status = payload.data?.status;
  const email = payload.data?.user?.email || payload.data?.email;
  console.log('Whop parsed — event:', event, 'status:', status, 'email:', email);

  if (email) {
    const isActive = event === 'membership_activated' || event === 'membership.went_valid'
      || status === 'active' || status === 'trialing' || status === 'past_due';
    const isInactive = event === 'membership_deactivated' || event === 'membership.went_invalid'
      || status === 'expired' || status === 'canceled' || status === 'refunded' || status === 'completing';

    try {
      if (isActive) {
        await upsertMember(email, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
        console.log('Whop: member added —', email);
      } else if (isInactive) {
        await deleteMember(email, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
        console.log('Whop: member removed —', email);
      } else {
        console.log('Whop: unhandled event/status —', event, status);
      }
    } catch (e) {
      console.error('Whop webhook DB error:', e.message);
      return new Response('Internal error', { status: 500 });
    }
  } else {
    console.error('Whop: no email found in payload');
  }

  return new Response('OK', { status: 200 });
}

export async function onRequestGet() {
  return new Response('OK', { status: 200 });
}
