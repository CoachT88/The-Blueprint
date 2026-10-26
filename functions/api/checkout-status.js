// Public, read-only status for the Stripe return page.
// A return URL does not prove payment. Never expose customer emails,
// entitlement IDs, raw Stripe responses or a client secret here.

const reply = (state, status = 200) => new Response(JSON.stringify({ state }), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  },
});

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get('session_id') || '';
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(id) || id.length > 200) {
    return reply('invalid', 400);
  }

  const live = String(env.STRIPE_LIVEMODE).toLowerCase() === 'true';
  if (id.startsWith('cs_live_') !== live) return reply('invalid', 400);

  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID ||
      !env.STRIPE_PRICE_CENTS || !env.SUPABASE_URL ||
      !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Stripe return: verification configuration incomplete');
    return reply('unavailable', 503);
  }

  try {
    const res = await fetch(
      'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(id), {
        headers: {
          Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
          ...(env.STRIPE_API_VERSION
            ? { 'Stripe-Version': env.STRIPE_API_VERSION } : {}),
        },
      });

    if (res.status === 404) return reply('invalid', 404);
    if (!res.ok) {
      console.error('Stripe return: session lookup failed, HTTP', res.status);
      return reply('unavailable', 503);
    }

    const session = await res.json();
    if (!session || session.id !== id ||
        Boolean(session.livemode) !== live ||
        session.mode !== 'payment') return reply('invalid', 400);

    if (session.payment_status !== 'paid') {
      // Complete + unpaid may be an asynchronous payment method.
      return reply(session.status === 'complete' ? 'processing' : 'not_paid');
    }

    const expected = Number(env.STRIPE_PRICE_CENTS);
    const amount = Number.isFinite(session.amount_subtotal)
      ? session.amount_subtotal : session.amount_total;
    if (!Number.isFinite(expected) || expected <= 0 ||
        amount !== expected ||
        String(session.currency || '').toLowerCase() !==
          String(env.STRIPE_CURRENCY || 'usd').toLowerCase() ||
        typeof session.payment_intent !== 'string') {
      return reply('review');
    }

    // A successful Stripe charge alone is not an activated membership.
    // Only the signed webhook can create the purchase ledger entry.
    const q = 'provider=eq.stripe&provider_ref=eq.' +
      encodeURIComponent(session.payment_intent) +
      '&select=status,amount_cents,currency&limit=1';
    const ledger = await fetch(env.SUPABASE_URL + '/rest/v1/purchases?' + q, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
        Accept: 'application/json',
      },
    });
    if (!ledger.ok) {
      console.error('Stripe return: ledger lookup failed, HTTP', ledger.status);
      return reply('unavailable', 503);
    }

    const rows = await ledger.json();
    if (!Array.isArray(rows)) return reply('unavailable', 503);
    if (rows.length === 0) return reply('processing');

    const row = rows[0];
    if (row.status !== 'paid' ||
        row.amount_cents !== expected ||
        String(row.currency || '').toLowerCase() !==
          String(env.STRIPE_CURRENCY || 'usd').toLowerCase()) {
      return reply('review');
    }

    return reply('verified');
  } catch (e) {
    // Never fail open on a Stripe or database outage.
    console.error('Stripe return: verification request failed');
    return reply('unavailable', 503);
  }
}