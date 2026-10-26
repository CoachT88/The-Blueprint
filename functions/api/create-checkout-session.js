// Creates a Stripe Checkout Session for The Blueprint.
//
// Exists so the secret key never reaches a browser. The page calls this, gets
// back a client secret, and mounts Stripe's embedded Checkout with it.
//
// Required secrets. Cloudflare -> Workers & Pages -> the-blueprint ->
// Settings -> Variables and Secrets, Encrypt. THE WORKER, NOT A PAGES
// PROJECT. README-DEPLOY.md has the full table.
//   STRIPE_SECRET_KEY   - sk_test_... or sk_live_...; a restricted key needs
//                         Checkout Sessions write and Prices read here, and
//                         Checkout Sessions read for the webhook
//   STRIPE_PRICE_ID     - the Price object for the $99 one-time product
//   STRIPE_PRICE_CENTS  - 9900. Checked against the live Price below, so a
//                         dashboard change closes checkout rather than
//                         charging an amount the webhook will refuse
//   SUPABASE_URL        - to verify a signed-in buyer's token
//   SUPABASE_ANON_KEY   - the public key, used only for the token check.
//                         MISSING IT FAILS QUIETLY: checkout still works but
//                         no client_reference_id is set, so the purchase
//                         binds by email instead of to the account
//
// Optional:
//   STRIPE_CURRENCY     - defaults to usd
//   STRIPE_API_VERSION  - sent only if set; see priceMatchesConfig below
//   STRIPE_RETURN_URL   - defaults to
//                         https://theblueprint.site/welcome/?session_id={CHECKOUT_SESSION_ID}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

function redactEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return '<none>';
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}

/**
 * Who is buying, established from a token rather than from the request body.
 *
 * THE BROWSER MUST NEVER SUPPLY THE UID. client_reference_id ends up as the
 * account an entitlement attaches to, so a caller who could name it could
 * attach somebody else's purchase to their own account. The uid is read from
 * a Supabase access token verified by Supabase itself, and the request body
 * is not consulted for identity at all.
 *
 * No token is the normal case: most buyers have no account yet. That path
 * returns nulls and the webhook falls back to matching on the purchase
 * address.
 */
async function identifyBuyer(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ') || auth.length < 20) return { uid: null, email: null };
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return { uid: null, email: null };

  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth },
    });
    if (!res.ok) return { uid: null, email: null };
    const user = await res.json().catch(() => null);
    if (!user || typeof user.id !== 'string') return { uid: null, email: null };
    /* Only a confirmed address is used to prefill, for the same reason the
       webhook only auto-attaches a confirmed one: an unconfirmed address
       proves nothing and anybody can type it at signup. */
    const confirmed = Boolean(user.email_confirmed_at || user.confirmed_at);
    return { uid: user.id, email: confirmed ? user.email : null };
  } catch (e) {
    return { uid: null, email: null };
  }
}

/**
 * CONFIRM THE PRICE STILL CHARGES WHAT THE WORKER EXPECTS.
 *
 * Pricing is managed from the Stripe dashboard, and changing a Price there
 * changes neither this Worker's STRIPE_PRICE_CENTS nor the figure printed on
 * the website. Those three are independent and must agree.
 *
 * Without this check the failure lands on the customer: they pay the new
 * amount, the webhook compares it to the old STRIPE_PRICE_CENTS, refuses,
 * and they are left charged with no access. Checking here instead means a
 * mismatch makes checkout unavailable BEFORE anyone pays, which is the
 * failure to prefer.
 *
 * It also means a Price change cannot quietly widen what counts as a paid
 * purchase: the amount the webhook enforces and the amount Stripe charges
 * are reconciled every time a session is created.
 */
async function priceMatchesConfig(env) {
  const expected = Number(env.STRIPE_PRICE_CENTS);
  if (!Number.isFinite(expected) || expected <= 0) {
    return { ok: false, why: 'STRIPE_PRICE_CENTS is not configured' };
  }
  const res = await fetch(
    `https://api.stripe.com/v1/prices/${encodeURIComponent(env.STRIPE_PRICE_ID)}`, {
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        /* Omitted unless STRIPE_API_VERSION is set, so the account's own
           default applies. Pinning a version the account cannot serve would
           fail every call, and the fields this code reads (mode,
           payment_status, amount_subtotal, amount_total, currency,
           payment_intent, client_reference_id, customer_details.email) have
           been stable across versions for years. Set the variable only to
           match a webhook endpoint deliberately pinned in the dashboard. */
        ...(env.STRIPE_API_VERSION ? { 'Stripe-Version': env.STRIPE_API_VERSION } : {}),
      },
    });
  if (!res.ok) return { ok: false, why: `could not read the Price: HTTP ${res.status}` };
  const price = await res.json().catch(() => null);
  if (!price) return { ok: false, why: 'the Price response was not JSON' };

  if (price.active === false) return { ok: false, why: 'the Price is archived' };
  if (price.type !== 'one_time') return { ok: false, why: `the Price type is ${price.type}` };
  if (price.unit_amount !== expected) {
    return {
      ok: false,
      why: `the Price charges ${price.unit_amount} but STRIPE_PRICE_CENTS is ${expected}`,
    };
  }
  const currency = (env.STRIPE_CURRENCY || 'usd').toLowerCase();
  if (String(price.currency || '').toLowerCase() !== currency) {
    return { ok: false, why: `the Price is in ${price.currency}, expected ${currency}` };
  }
  return { ok: true };
}

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) {
    console.error('Stripe: checkout session config missing; refusing');
    return json({ error: 'Checkout is unavailable right now.' }, 503);
  }

  /* Before anything is created. A mismatch here is a configuration error,
     so it reads as unavailable rather than as a customer problem, and the
     log says exactly which value disagrees. */
  const consistent = await priceMatchesConfig(env);
  if (!consistent.ok) {
    console.error('Stripe: REFUSING TO OPEN CHECKOUT, price configuration is'
      + ` inconsistent - ${consistent.why}.`
      + ' Reconcile the Stripe Price, STRIPE_PRICE_CENTS and the figure shown'
      + ' on the website before activating.');
    return json({ error: 'Checkout is unavailable right now.' }, 503);
  }

  const { uid, email } = await identifyBuyer(request, env);
  const returnUrl = env.STRIPE_RETURN_URL
    || 'https://theblueprint.site/welcome/?session_id={CHECKOUT_SESSION_ID}';

  /* Form-encoded, because that is what the Stripe API takes and it avoids
     pulling the SDK into a Worker. */
  const form = new URLSearchParams();
  form.set('ui_mode', 'embedded');
  form.set('mode', 'payment');
  form.set('line_items[0][price]', env.STRIPE_PRICE_ID);
  form.set('line_items[0][quantity]', '1');
  form.set('return_url', returnUrl);
  /* So a man who abandons and comes back is not charged twice for the same
     session, and so the receipt reaches him. */
  form.set('customer_creation', 'always');

  if (uid) form.set('client_reference_id', uid);
  if (email) form.set('customer_email', email);

  /* NOTHING ABOUT HIS HEALTH GOES TO STRIPE. No assessment answers, no
     measurements, no erection-quality ratings, no session history, no Coach
     Tee conversation, no photographs. The metadata below is a product tag
     and nothing else, and this comment is here so that stays true when
     somebody wants to add analytics. */
  form.set('metadata[product]', 'blueprint');

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        /* Pin the API version so a Stripe-side default change cannot alter
           the payload shape the webhook parses. */
        ...(env.STRIPE_API_VERSION ? { 'Stripe-Version': env.STRIPE_API_VERSION } : {}),
      },
      body: form.toString(),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.client_secret) {
      /* The upstream body can carry account detail, and the browser has no
         use for it either way. */
      console.error('Stripe: session creation failed, status', res.status,
        data && data.error ? data.error.code : '');
      return json({ error: 'Checkout is unavailable right now.' }, 502);
    }

    console.log(`Stripe: session created, signedIn=${Boolean(uid)}`
      + `, prefill=${redactEmail(email)}`);
    return json({ clientSecret: data.client_secret });
  } catch (e) {
    console.error('Stripe: session creation threw -', e.message);
    return json({ error: 'Checkout is unavailable right now.' }, 502);
  }
}

export const __test = { identifyBuyer, redactEmail, priceMatchesConfig };
