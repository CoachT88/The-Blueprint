// Stripe purchase webhook.
//
// Writes a purchase into public.purchases and an entitlement into
// public.members on a verified payment, and revokes on a verified refund or
// dispute. Modelled on functions/api/kofi-webhook.js, which is already
// correct, so the two handlers behave the same way wherever they can.
//
// Required secrets (Cloudflare Pages -> Settings -> Variables and Secrets,
// every one of them marked Encrypt):
//   SUPABASE_URL                - project URL
//   SUPABASE_SERVICE_ROLE_KEY   - Supabase -> Project Settings -> API
//   STRIPE_WEBHOOK_SECRET       - Stripe -> Developers -> Webhooks -> the
//                                 signing secret for THIS endpoint, whsec_...
//   STRIPE_PRICE_CENTS          - expected pre-tax amount, e.g. 9900
//   STRIPE_CURRENCY             - expected currency, e.g. usd
//   STRIPE_LIVEMODE             - 'true' in production, 'false' in test
//
// This endpoint hands out paid access, so it is only as trustworthy as the
// signature check below. Anyone on the internet can POST here.

/* Never log an email, a raw body, or a parsed event. This webhook carries
   the address of someone who just bought a sexual-health product, and
   request logs are the wrong place for that to live. Same helper, same
   reason, as the Ko-fi handler. */
function redactEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return '<none>';
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}

/* Compared in constant time so response latency cannot be used to recover
   the signature a character at a time. Identical in intent to tokensMatch
   in the Ko-fi handler. */
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Deliberately not a full RFC validator. The job is to stop a verified but
   malformed payload writing junk into the table that grants paid access. */
function isPlausibleEmail(value) {
  return typeof value === 'string'
    && value.length >= 6 && value.length <= 254
    && /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value);
}

const hex = (buf) => [...new Uint8Array(buf)]
  .map(b => b.toString(16).padStart(2, '0')).join('');

/**
 * Verify Stripe's signature over the EXACT bytes received.
 *
 * Two things make this work and are easy to get wrong:
 *
 *   1. The signed payload is `${timestamp}.${rawBody}` where rawBody is the
 *      request body as sent. Parsing and re-serialising changes the bytes
 *      and the signature will never match, so the body is read once as text
 *      and the same string is used here and for JSON.parse.
 *   2. The header can carry several v1 signatures during a secret rotation.
 *      All of them are checked, so a rotation does not drop events.
 *
 * The timestamp tolerance is what stops a captured request being replayed
 * tomorrow. The payment_events table stops it being replayed within the
 * tolerance window.
 */
async function verifySignature(rawBody, header, secret, toleranceSeconds = 300) {
  if (typeof header !== 'string') return { ok: false, reason: 'no signature header' };

  let timestamp = null;
  const candidates = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2);
    if (k === 't') timestamp = v;
    else if (k === 'v1' && v) candidates.push(v);
  }
  if (!timestamp || !candidates.length) return { ok: false, reason: 'malformed signature header' };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'malformed timestamp' };
  const age = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (age > toleranceSeconds) return { ok: false, reason: `timestamp outside tolerance (${age}s)` };

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${rawBody}`));
  const expected = hex(mac);

  for (const candidate of candidates) {
    if (constantTimeEqual(candidate, expected)) return { ok: true };
  }
  return { ok: false, reason: 'no signature matched' };
}

/* ── Supabase, service role ──────────────────────────────────────────────── */

const sbHeaders = (env, extra = {}) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  ...extra,
});

/**
 * Record the event id, and say whether this is the first time we have seen
 * it. A conflict means already processed, which the caller answers 200 to:
 * anything else makes Stripe retry an event that was handled correctly.
 */
async function firstSight(env, event) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/payment_events`, {
    method: 'POST',
    headers: sbHeaders(env, { Prefer: 'return=representation' }),
    body: JSON.stringify([{ id: event.id, provider: 'stripe', type: event.type }]),
  });
  if (res.status === 409) return false;            // unique violation
  if (!res.ok) throw new Error(`payment_events insert failed: ${res.status}`);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length === 1;
}

/** Insert the purchase. A duplicate provider_ref means already recorded. */
async function recordPurchase(env, { ref, email, amountCents, currency }) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/purchases`, {
    method: 'POST',
    headers: sbHeaders(env, { Prefer: 'return=minimal' }),
    body: JSON.stringify([{
      provider: 'stripe', provider_ref: ref, email,
      amount_cents: amountCents, currency, status: 'paid',
    }]),
  });
  if (res.status === 409) return false;
  if (!res.ok) throw new Error(`purchases insert failed: ${res.status}`);
  return true;
}

/**
 * The entitlement, written exactly the way the Ko-fi handler writes it.
 *
 * user_id is NOT sent here even when one is known. The comment in
 * kofi-webhook.js explains why and it applies unchanged: merge-duplicates
 * would overwrite a user_id that a claim had already attached, and a repeat
 * purchase would silently move a live entitlement onto a different account.
 */
async function upsertMember(env, email) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/members`, {
    method: 'POST',
    headers: sbHeaders(env, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([{ email }]),
  });
  if (!res.ok) throw new Error(`members upsert failed: ${res.status}`);
}

/**
 * Attach identity to a row nobody owns yet.
 *
 * The user_id=is.null filter is what makes this unable to steal: if a claim
 * or an earlier webhook already attached someone, the PATCH matches no rows
 * and changes nothing. revoked_at=is.null so a revoked row is not revived
 * by a stale attach.
 *
 * Best effort. A failure here never fails the webhook, because the purchase
 * is already recorded and claim_membership() still works.
 */
async function attachUid(env, email, uid) {
  try {
    const q = `email=eq.${encodeURIComponent(email)}&user_id=is.null&revoked_at=is.null`;
    await fetch(`${env.SUPABASE_URL}/rest/v1/members?${q}`, {
      method: 'PATCH',
      headers: sbHeaders(env, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ user_id: uid, claimed_at: new Date().toISOString() }),
    });
  } catch (e) {
    /* Swallowed on purpose. Stripe must not retry a recorded purchase
       because an optimisation failed. */
  }
}

/** Exactly one CONFIRMED auth user for this address, or null. */
async function findSoleAuthUser(env, email) {
  try {
    const url = `${env.SUPABASE_URL}/auth/v1/admin/users?per_page=2&filter=`
      + encodeURIComponent(email);
    const res = await fetch(url, { headers: sbHeaders(env) });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const users = Array.isArray(body) ? body
      : (body && Array.isArray(body.users) ? body.users : null);
    if (!users) return null;
    /* The filter is a server-side search, so re-check the address exactly
       and only accept a CONFIRMED one: an unconfirmed address proves nothing
       and anybody can type it at signup. */
    const exact = users.filter(u => u && typeof u.email === 'string'
      && u.email.toLowerCase() === email.toLowerCase()
      && (u.email_confirmed_at || u.confirmed_at));
    return exact.length === 1 ? exact[0].id : null;
  } catch (e) {
    return null;
  }
}

/** Mark a purchase refunded or disputed. Returns the email, or null. */
async function resolvePurchase(env, ref, status) {
  const q = `provider=eq.stripe&provider_ref=eq.${encodeURIComponent(ref)}`;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/purchases?${q}`, {
    method: 'PATCH',
    headers: sbHeaders(env, { Prefer: 'return=representation' }),
    body: JSON.stringify({ status, resolved_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`purchases update failed: ${res.status}`);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0].email : null;
}

const rpc = async (env, fn, args) => {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: sbHeaders(env), body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn} failed: ${res.status}`);
  return res.json().catch(() => null);
};

/* ── Product identity ────────────────────────────────────────────────────── */

/**
 * The rule carried over from the Ko-fi handler: no verified product
 * identity, no access. A payment to this Stripe account for something else
 * must not unlock the app.
 *
 * Three checks, all from Stripe's own numbers rather than from anything the
 * browser sent:
 *
 *   mode            must be a one-time payment, not a subscription
 *   payment_status  must be paid, so an async method still pending is not
 *                   treated as a purchase
 *   amount          must equal the configured price BEFORE tax
 *
 * amount_subtotal is used in preference to amount_total because Stripe Tax
 * adds to the total, so comparing the total would break the moment tax is
 * enabled. Subtotal is absent on some session shapes, in which case the
 * total is the only number available and is used instead.
 *
 * A stronger check is possible by expanding line_items, which costs an extra
 * API round trip. Recorded as a hardening option rather than done, because
 * the amount check already refuses a payment for a different product at a
 * different price, and the session is created by our own endpoint.
 */
function notAPurchase(session, env) {
  if (!session || typeof session !== 'object') return 'session was not an object';
  if (session.mode !== 'payment') return `mode was ${session.mode}`;
  if (session.payment_status !== 'paid') return `payment_status was ${session.payment_status}`;

  const expected = Number(env.STRIPE_PRICE_CENTS);
  if (!Number.isFinite(expected) || expected <= 0) return 'STRIPE_PRICE_CENTS is not configured';

  const amount = Number.isFinite(session.amount_subtotal)
    ? session.amount_subtotal : session.amount_total;
  if (amount !== expected) return `amount was ${amount}, expected ${expected}`;

  const currency = (env.STRIPE_CURRENCY || 'usd').toLowerCase();
  if (String(session.currency || '').toLowerCase() !== currency) {
    return `currency was ${session.currency}, expected ${currency}`;
  }
  return null;
}

const sessionEmail = (s) =>
  (s.customer_details && s.customer_details.email) || s.customer_email || null;

/* ── Handler ─────────────────────────────────────────────────────────────── */

export async function onRequestPost({ request, env }) {
  /* Missing config is a refusal, not a free pass. The Ko-fi handler learned
     this the hard way: a check that only runs when its secret happens to be
     set is a lock that unlocks itself when you lose the key. */
  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error('Stripe: STRIPE_WEBHOOK_SECRET is not configured; refusing');
    return new Response('Service unavailable', { status: 503 });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Stripe: Supabase credentials are not configured; refusing');
    return new Response('Service unavailable', { status: 503 });
  }

  /* Read once. The signature covers these exact bytes. */
  let rawBody;
  try {
    rawBody = await request.text();
  } catch (e) {
    console.error('Stripe: could not read the request body');
    return new Response('Bad Request', { status: 400 });
  }

  const verdict = await verifySignature(
    rawBody, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!verdict.ok) {
    console.error('Stripe: signature rejected -', verdict.reason);
    return new Response('Unauthorized', { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    console.error('Stripe: signed body was not JSON');
    return new Response('Bad Request', { status: 400 });
  }
  if (!event || typeof event !== 'object' || typeof event.id !== 'string') {
    console.error('Stripe: event had no id');
    return new Response('Bad Request', { status: 400 });
  }

  /* A test-mode event must never write a live entitlement, and the reverse
     is just as wrong. Compared explicitly rather than inferred from the key,
     so a misrouted endpoint is refused rather than silently honoured. */
  const expectLive = String(env.STRIPE_LIVEMODE || '').toLowerCase() === 'true';
  if (Boolean(event.livemode) !== expectLive) {
    console.error(`Stripe: livemode mismatch, event=${event.livemode} expected=${expectLive}`);
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    if (!(await firstSight(env, event))) {
      /* Already handled. 200 so Stripe stops retrying. */
      console.log(`Stripe: duplicate event ${event.id} (${event.type}), ignored`);
      return new Response('OK', { status: 200 });
    }
  } catch (e) {
    /* The replay gate itself failed, so we cannot tell first from repeat.
       500 makes Stripe retry, which is the safe direction: better a repeat
       delivery against a working gate than a purchase silently dropped. */
    console.error('Stripe: replay gate failed -', e.message);
    return new Response('Internal error', { status: 500 });
  }

  const obj = (event.data && event.data.object) || {};

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const reason = notAPurchase(obj, env);
        if (reason) {
          /* Verified as genuinely from Stripe, and not a purchase of this
             product. 200 so delivery is accepted, logged at error level
             because if a real purchase ever lands here that line is the only
             thing that will say so. */
          console.error('Stripe: verified session did not grant access -', reason);
          return new Response('OK', { status: 200 });
        }

        const email = sessionEmail(obj);
        if (!isPlausibleEmail(email)) {
          console.error('Stripe: paid session carried no usable email');
          return new Response('OK', { status: 200 });
        }

        const ref = typeof obj.payment_intent === 'string'
          ? obj.payment_intent : obj.id;

        await recordPurchase(env, {
          ref, email,
          amountCents: Number.isFinite(obj.amount_subtotal)
            ? obj.amount_subtotal : obj.amount_total,
          currency: String(obj.currency || '').toLowerCase(),
        });
        await upsertMember(env, email);

        /* client_reference_id is the uid of a buyer who was signed in when
           the session was created. When we have it we never had to infer
           identity from the address, so a buyer paying with a different
           address still activates. */
        const uid = typeof obj.client_reference_id === 'string'
          && obj.client_reference_id.length >= 32
          ? obj.client_reference_id
          : await findSoleAuthUser(env, email);
        if (uid) await attachUid(env, email, uid);

        console.log(`Stripe: purchase recorded for ${redactEmail(email)}`
          + `, attached=${Boolean(uid)}`);
        return new Response('OK', { status: 200 });
      }

      case 'charge.refunded': {
        /* A PARTIAL refund does not revoke. A goodwill refund of part of the
           price should not cut off access, and guessing at a threshold
           inside a webhook is how that goes wrong. Flagged for a human
           instead. */
        const full = obj.amount_refunded === obj.amount;
        if (!full) {
          console.error('Stripe: PARTIAL refund, access left in place, needs review'
            + ` - charge ${obj.id} refunded ${obj.amount_refunded} of ${obj.amount}`);
          return new Response('OK', { status: 200 });
        }
        const ref = typeof obj.payment_intent === 'string' ? obj.payment_intent : null;
        if (!ref) {
          console.error('Stripe: refund carried no payment_intent, needs review');
          return new Response('OK', { status: 200 });
        }
        const email = await resolvePurchase(env, ref, 'refunded');
        if (!email) {
          console.error('Stripe: refund matched no recorded purchase, needs review');
          return new Response('OK', { status: 200 });
        }
        const revoked = await rpc(env, 'revoke_if_unpaid', { p_email: email });
        console.log(`Stripe: full refund for ${redactEmail(email)}`
          + `, revoked=${revoked}`);
        return new Response('OK', { status: 200 });
      }

      case 'charge.dispute.created': {
        const ref = typeof obj.payment_intent === 'string' ? obj.payment_intent : null;
        if (!ref) return new Response('OK', { status: 200 });
        const email = await resolvePurchase(env, ref, 'disputed');
        if (!email) {
          console.error('Stripe: dispute matched no recorded purchase, needs review');
          return new Response('OK', { status: 200 });
        }
        const revoked = await rpc(env, 'revoke_if_unpaid', { p_email: email });
        console.log(`Stripe: dispute opened for ${redactEmail(email)}, revoked=${revoked}`);
        return new Response('OK', { status: 200 });
      }

      case 'charge.dispute.closed': {
        const ref = typeof obj.payment_intent === 'string' ? obj.payment_intent : null;
        if (!ref) return new Response('OK', { status: 200 });
        if (obj.status !== 'won') {
          console.log(`Stripe: dispute closed ${obj.status}, access stays revoked`);
          return new Response('OK', { status: 200 });
        }
        const email = await resolvePurchase(env, ref, 'paid');
        if (!email) return new Response('OK', { status: 200 });
        /* Clears revoked_at and leaves user_id null on purpose, so the
           member re-attaches through claim_membership(). One attach path. */
        const restored = await rpc(env, 'restore_if_paid', { p_email: email });
        console.log(`Stripe: dispute won for ${redactEmail(email)}, restored=${restored}`);
        return new Response('OK', { status: 200 });
      }

      case 'checkout.session.expired':
        /* A failed or abandoned payment. No session completed means nothing
           was written, which is already the correct outcome, so there is
           nothing to undo. Logged only. */
        console.log('Stripe: checkout session expired, nothing written');
        return new Response('OK', { status: 200 });

      default:
        console.log(`Stripe: ${event.type} not handled`);
        return new Response('OK', { status: 200 });
    }
  } catch (e) {
    /* 500 so Stripe retries. The replay gate already holds this event id, so
       a retry is a no-op for anything that did commit, and the parts that
       did not commit get another chance. */
    console.error(`Stripe: handling ${event.type} failed -`, e.message);
    return new Response('Internal error', { status: 500 });
  }
}

/* A GET here is somebody checking the endpoint exists, including Stripe's
   own dashboard. It must never do anything. */
export async function onRequestGet() {
  return new Response('OK', { status: 200 });
}

/* Exported for tests. The handler above is what runs in production. */
export const __test = {
  verifySignature, constantTimeEqual, notAPurchase, isPlausibleEmail,
  redactEmail, sessionEmail,
};
