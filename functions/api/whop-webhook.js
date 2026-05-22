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
  console.log('Whop raw body (full):', rawBody);

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return new Response('Bad JSON', { status: 400 }); }

  const event = payload.event || payload.action;
  const status = payload.data?.status;

  // Try every known location Whop puts the email across different event types
  const email =
    payload.data?.user?.email ||
    payload.data?.email ||
    payload.data?.membership?.user?.email ||
    payload.data?.checkout?.email ||
    payload.data?.order?.email ||
    payload.user?.email ||
    null;

  console.log('Whop parsed — event:', event, 'status:', status, 'email:', email);
  console.log('Whop payload keys:', Object.keys(payload));
  console.log('Whop data keys:', payload.data ? Object.keys(payload.data) : 'no data field');

  if (email) {
    const isActive = event === 'membership_activated' || event === 'membership.went_valid'
      || event === 'payment.succeeded' || event === 'checkout.completed'
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
    console.error('Whop: no email found — full payload:', rawBody);
  }

  return new Response('OK', { status: 200 });
}

export async function onRequestGet() {
  return new Response('OK', { status: 200 });
}
