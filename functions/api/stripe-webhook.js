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
 * CLAIM AN EVENT FOR PROCESSING, AND SAY WHAT KIND OF DELIVERY THIS IS.
 *
 * The bug this replaces. The first version inserted the event id and treated
 * the insert as "handled". If a later write failed, the handler returned 500,
 * Stripe retried, the insert conflicted, the retry was read as a duplicate
 * and answered 200. The purchase was silently dropped with the customer's
 * money already taken, and nothing anywhere said so.
 *
 * So the row now carries a status. It is 'processing' until the work
 * finishes and only then 'done'.
 *
 *   'new'     first delivery, nobody has worked on it
 *   'retry'   a row exists and is still 'processing', so either a previous
 *             attempt failed partway or a concurrent delivery is in flight
 *   'done'    finished successfully before; skip and answer 200
 *
 * A 'retry' PROCEEDS. That is only safe because every write this handler
 * makes is idempotent, so here is that audit, operation by operation:
 *
 *   purchases insert    unique on (provider, provider_ref); a repeat is a
 *                       409 that recordPurchase reports rather than throws
 *   members upsert      resolution=merge-duplicates on email, so a repeat
 *                       writes the same row
 *   attachUid PATCH     filtered user_id=is.null and revoked_at=is.null, so
 *                       a repeat matches nothing
 *   purchases PATCH     sets the same status; only resolved_at drifts, which
 *                       is a timestamp nothing branches on
 *   revoke_if_unpaid    recomputes the whole decision from the ledger, so
 *                       calling it twice reaches the same verdict
 *   restore_if_paid     filtered revoked_at is not null, so a repeat matches
 *                       nothing
 *
 * Two concurrent deliveries both proceeding therefore converge on the same
 * state. A lease or an advisory lock would serialise them, and would also
 * mean a crashed holder blocks the event until the lease expires. Idempotent
 * writes are the stronger property, so they are the one relied on.
 */
async function claimEvent(env, event) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/payment_events`, {
    method: 'POST',
    headers: sbHeaders(env, { Prefer: 'return=representation' }),
    body: JSON.stringify([{ id: event.id, provider: 'stripe', type: event.type }]),
  });

  if (res.ok) {
    const rows = await res.json().catch(() => []);
    if (Array.isArray(rows) && rows.length === 1) return 'new';
    throw new Error('payment_events insert returned no row');
  }

  if (res.status !== 409) {
    throw new Error(`payment_events insert failed: ${res.status}`);
  }

  /* Conflict. Read the existing row to find out whether the earlier attempt
     finished. */
  const look = await fetch(
    `${env.SUPABASE_URL}/rest/v1/payment_events`
    + `?id=eq.${encodeURIComponent(event.id)}&select=status,attempts`,
    { headers: sbHeaders(env) });
  if (!look.ok) throw new Error(`payment_events read failed: ${look.status}`);
  const rows = await look.json().catch(() => []);
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) throw new Error('payment_events conflicted but the row is absent');

  if (row.status === 'done') return 'done';

  /* Still 'processing'. Count the attempt and carry on. */
  await fetch(
    `${env.SUPABASE_URL}/rest/v1/payment_events?id=eq.${encodeURIComponent(event.id)}`,
    {
      method: 'PATCH',
      headers: sbHeaders(env, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ attempts: (Number(row.attempts) || 1) + 1 }),
    }).catch(() => { /* a lost counter must not stop the work */ });

  return 'retry';
}

/** The work finished. Nothing will process this event again. */
async function completeEvent(env, id) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/payment_events?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: sbHeaders(env, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ status: 'done', completed_at: new Date().toISOString() }),
    });
  if (!res.ok) {
    /* The work is done and only the bookkeeping failed. Throwing here would
       turn a success into a 500 and invite a retry that redoes idempotent
       work for no reason, so it is logged and swallowed. The row stays
       'processing', and a retry would re-run harmlessly. */
    console.error(`Stripe: could not mark ${id} done, status ${res.status}`);
  }
}

/**
 * The work failed. Record why, leave the row 'processing' so a retry is
 * allowed to proceed, and let the caller answer 500 so Stripe sends one.
 */
async function failEvent(env, id, message) {
  try {
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/payment_events?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: sbHeaders(env, { Prefer: 'return=minimal' }),
        /* Truncated, and it is an error string from our own code rather than
           an upstream body, so it carries no customer detail. */
        body: JSON.stringify({ last_error: String(message || '').slice(0, 500) }),
      });
  } catch (e) { /* diagnosis is best effort */ }
}

/** The ledger row for one transaction reference, or null. */
async function findPurchase(env, ref) {
  const q = `provider=eq.stripe&provider_ref=eq.${encodeURIComponent(ref)}`
    + '&select=id,status,email';
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/purchases?${q}`,
    { headers: sbHeaders(env) });
  if (!res.ok) throw new Error(`purchases read failed: ${res.status}`);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Record a paid purchase, and say what was already on file.
 *
 * OUT OF ORDER DELIVERY IS THE REASON THIS RETURNS A STATUS RATHER THAN A
 * BOOLEAN. Stripe does not guarantee ordering, so charge.refunded can arrive
 * before the checkout.session.completed that created the charge. When it
 * does, the refund handler records the refund against this reference with a
 * null address, and the completion then arrives for a transaction the ledger
 * already knows was refunded. Granting access on that completion would hand
 * the app to somebody who has their money back.
 *
 *   'inserted'  first time; a paid purchase now exists
 *   'paid'      already recorded as paid, which is an ordinary replay
 *   other       already recorded as refunded or disputed: DO NOT GRANT
 */
async function recordPurchase(env, { ref, email, amountCents, currency }) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/purchases`, {
    method: 'POST',
    headers: sbHeaders(env, { Prefer: 'return=minimal' }),
    body: JSON.stringify([{
      provider: 'stripe', provider_ref: ref, email,
      amount_cents: amountCents, currency, status: 'paid',
    }]),
  });
  if (res.ok) return 'inserted';
  if (res.status !== 409) throw new Error(`purchases insert failed: ${res.status}`);

  const existing = await findPurchase(env, ref);
  if (!existing) throw new Error('purchases conflicted but the row is absent');

  /* An out-of-order refund recorded this reference without an address,
     because a charge object does not reliably carry one. Fill it in now that
     the completion has supplied it, so revoke_if_unpaid can see this
     transaction when it counts what the address has paid for. */
  if (!existing.email && email) {
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/purchases?id=eq.${encodeURIComponent(existing.id)}`, {
        method: 'PATCH',
        headers: sbHeaders(env, { Prefer: 'return=minimal' }),
        body: JSON.stringify({ email, amount_cents: amountCents, currency }),
      }).catch(() => { /* best effort; the status below is what decides */ });
  }

  return existing.status;
}

/**
 * Record a refund or dispute for a transaction the ledger has never seen.
 *
 * This happens when Stripe delivers out of order. The refund is real, so
 * recording it invents nothing; the address is genuinely unknown at this
 * point, which is why purchases.email is nullable. The later completion
 * fills the address in and is refused access by the status recorded here.
 *
 * The alternative, acknowledging the refund and moving on, is what the
 * previous version did, and it ended with a refunded customer holding
 * access and nothing in the system disagreeing.
 */
async function recordUnmatchedResolution(env, { ref, status, email, amountCents, currency }) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/purchases`, {
    method: 'POST',
    headers: sbHeaders(env, { Prefer: 'return=minimal' }),
    body: JSON.stringify([{
      provider: 'stripe', provider_ref: ref, email: email || null,
      amount_cents: amountCents ?? null, currency: currency || null,
      status, resolved_at: new Date().toISOString(),
    }]),
  });
  if (res.ok) return true;
  if (res.status === 409) return false;   // raced with the completion
  throw new Error(`unmatched ${status} insert failed: ${res.status}`);
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

/**
 * Call revoke_if_unpaid and say, in the log, which rule decided.
 *
 * The function returns text rather than a boolean so this can tell apart
 * four different outcomes that all look like "nothing exploded":
 *
 *   revoked      no paid purchase remains and the entitlement is from the
 *                ledger era, so access ended
 *   kept_paid    another paid purchase stands. This is the man who bought
 *                twice and refunded once, and he keeps what he paid for.
 *   kept_legacy  the entitlement predates the ledger, so its payment history
 *                is unknown and automation does not get to end it. LOUD,
 *                because it is the one outcome a human should look at.
 *   no_member    no entitlement row for that address at all
 */
async function describeRevocation(env, email, cause) {
  const verdict = await rpc(env, 'revoke_if_unpaid', { p_email: email });
  const who = redactEmail(email);

  if (verdict === 'kept_legacy') {
    console.error(
      `Stripe: ${cause} for ${who} did NOT revoke: this entitlement predates`
      + ' the purchase ledger, so its payment history is unknown. Decide by'
      + ' hand whether access should end.');
    return `${cause}, legacy entitlement kept for review`;
  }
  if (verdict === 'kept_paid') {
    console.log(`Stripe: ${cause} for ${who}, another paid purchase stands,`
      + ' access continues');
    return `${cause}, another purchase stands`;
  }
  if (verdict === 'revoked') {
    console.log(`Stripe: ${cause} for ${who}, access revoked`);
    return `${cause}, access revoked`;
  }
  if (verdict === 'no_member') {
    console.error(`Stripe: ${cause} for ${who} matched no entitlement, needs review`);
    return `${cause}, no entitlement found`;
  }
  /* An unrecognised verdict means the function changed and this did not.
     Throwing puts the event back in the retry path rather than logging a
     shrug and marking it done. */
  throw new Error(`revoke_if_unpaid returned an unknown verdict: ${verdict}`);
}

/**
 * CONFIRM THE SESSION ACTUALLY BOUGHT THE CONFIGURED PRICE.
 *
 * The amount check alone is a proxy for product identity, and a weak one:
 * any payment to this account at exactly the configured amount would satisfy
 * it, including a Payment Link made in the dashboard for something else.
 *
 * line_items is not in the webhook payload, so it is fetched. The session id
 * comes from a signature-verified body, and the answer comes from Stripe
 * rather than from anything the browser sent.
 *
 * This is what stops a Price change silently widening what counts as a paid
 * purchase. Change the Price in the dashboard and this check fails against
 * the configured STRIPE_PRICE_ID until the Worker secret is updated too; the
 * amount check then fails until STRIPE_PRICE_CENTS is updated as well. Both
 * failures refuse access rather than granting it.
 */
async function sessionBoughtOurPrice(env, sessionId) {
  if (!env.STRIPE_SECRET_KEY) return { ok: false, why: 'STRIPE_SECRET_KEY is not configured' };
  if (!env.STRIPE_PRICE_ID) return { ok: false, why: 'STRIPE_PRICE_ID is not configured' };

  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/line_items?limit=10`,
    {
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Stripe-Version': '2025-09-30.clover',
      },
    });
  if (!res.ok) {
    /* Thrown rather than refused, so the event stays retryable. A transient
       Stripe error must not permanently deny a real purchase. */
    throw new Error(`line_items read failed: ${res.status}`);
  }
  const body = await res.json().catch(() => null);
  const items = body && Array.isArray(body.data) ? body.data : null;
  if (!items) throw new Error('line_items response had no data array');

  if (items.length !== 1) {
    return { ok: false, why: `session had ${items.length} line items, expected 1` };
  }
  const priceId = items[0].price && items[0].price.id;
  if (priceId !== env.STRIPE_PRICE_ID) {
    return { ok: false, why: `line item price was ${priceId}, expected ${env.STRIPE_PRICE_ID}` };
  }
  if (items[0].quantity !== 1) {
    return { ok: false, why: `quantity was ${items[0].quantity}, expected 1` };
  }
  return { ok: true };
}

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

/* A charge sometimes carries an address and often does not, which is why an
   out-of-order refund may record a null one. */
const chargeEmail = (c) => (c && c.billing_details && c.billing_details.email)
  || (c && c.receipt_email) || null;

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

  let claim;
  try {
    claim = await claimEvent(env, event);
  } catch (e) {
    /* The gate itself failed, so we cannot tell a first delivery from a
       repeat. 500 makes Stripe retry, which is the safe direction: a repeat
       delivery against a working gate beats a purchase silently dropped. */
    console.error('Stripe: could not claim the event -', e.message);
    return new Response('Internal error', { status: 500 });
  }

  if (claim === 'done') {
    /* Finished successfully before. 200 so Stripe stops retrying. */
    console.log(`Stripe: event ${event.id} (${event.type}) already completed`);
    return new Response('OK', { status: 200 });
  }
  if (claim === 'retry') {
    /* Loud, because it means an earlier attempt took the customer's money
       and did not finish granting access. The work below repeats safely. */
    console.error(`Stripe: RETRYING ${event.id} (${event.type}),`
      + ' an earlier attempt did not finish');
  }

  const obj = (event.data && event.data.object) || {};

  /* Every terminal outcome goes through here, so an event is marked done
     exactly once and 'processing' means only "unfinished". A decision not to
     grant access is still a finished decision: re-evaluating it on every
     retry for three days would be noise, not safety. */
  const finish = async (reason) => {
    await completeEvent(env, event.id);
    if (reason) console.log(`Stripe: ${event.type} -> ${reason}`);
    return new Response('OK', { status: 200 });
  };

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const reason = notAPurchase(obj, env);
        if (reason) {
          /* Verified as genuinely from Stripe, and not a purchase of this
             product. Logged at error level because if a real purchase ever
             lands here that line is the only thing that will say so. */
          console.error('Stripe: verified session did not grant access -', reason);
          return finish('not this product');
        }

        /* Product identity from Stripe's own record of what was bought,
           not from the amount alone. */
        const bought = await sessionBoughtOurPrice(env, obj.id);
        if (!bought.ok) {
          console.error('Stripe: verified session did not buy this product -', bought.why);
          return finish('wrong price or product');
        }

        const email = sessionEmail(obj);
        if (!isPlausibleEmail(email)) {
          console.error('Stripe: paid session carried no usable address');
          return finish('no usable address');
        }

        const ref = typeof obj.payment_intent === 'string'
          ? obj.payment_intent : obj.id;

        const recorded = await recordPurchase(env, {
          ref, email,
          amountCents: Number.isFinite(obj.amount_subtotal)
            ? obj.amount_subtotal : obj.amount_total,
          currency: String(obj.currency || '').toLowerCase(),
        });

        /* OUT OF ORDER DELIVERY. The ledger already knows this transaction
           was refunded or disputed, because that event arrived first. The
           money is back with the buyer, so a stale completion must not hand
           over the app. */
        if (recorded !== 'inserted' && recorded !== 'paid') {
          console.error(
            `Stripe: completion for ${redactEmail(email)} REFUSED, the ledger`
            + ` already records this transaction as ${recorded}.`
            + ' An out-of-order refund or dispute arrived first.');
          return finish(`stale completion, already ${recorded}`);
        }

        await upsertMember(env, email);

        /* REPURCHASE AFTER REFUND. A revoked row keeps revoked_at set, and
           both attachUid and claim_membership refuse a revoked row, so
           without this a man who was refunded and bought again would pay and
           stay locked out. restore_if_paid clears the mark only after
           counting at least one paid purchase in the ledger, so the decision
           rests on verified payment state rather than on this event. */
        const restored = await rpc(env, 'restore_if_paid', { p_email: email });

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
          + `, attached=${Boolean(uid)}, revocationCleared=${restored}`);
        return finish('access granted');
      }

      case 'charge.refunded': {
        /* A PARTIAL refund does not revoke. A goodwill refund of part of the
           price must not cut someone off, and guessing at a threshold inside
           a webhook is how that goes wrong. Flagged for a human instead. */
        if (obj.amount_refunded !== obj.amount) {
          console.error('Stripe: PARTIAL refund, access left in place, needs review'
            + ` - charge ${obj.id} refunded ${obj.amount_refunded} of ${obj.amount}`);
          return finish('partial refund, access kept');
        }
        const ref = typeof obj.payment_intent === 'string' ? obj.payment_intent : null;
        if (!ref) {
          console.error('Stripe: refund carried no payment_intent, needs review');
          return finish('refund without a reference');
        }
        const email = await resolvePurchase(env, ref, 'refunded');
        if (!email) {
          /* Out of order: the completion has not arrived yet. Record the
             refund against this reference so the completion, when it
             lands, is refused rather than granting access to someone whose
             money has been returned. */
          const noted = await recordUnmatchedResolution(env, {
            ref, status: 'refunded', email: chargeEmail(obj),
            amountCents: obj.amount ?? null,
            currency: String(obj.currency || '').toLowerCase() || null,
          });
          console.error('Stripe: refund arrived before its completion;'
            + ` recorded against ${ref} so the completion cannot grant access`
            + ` (newRow=${noted})`);
          return finish('refund recorded ahead of its completion');
        }
        return finish(await describeRevocation(env, email, 'refund'));
      }

      case 'charge.dispute.created': {
        const ref = typeof obj.payment_intent === 'string' ? obj.payment_intent : null;
        if (!ref) return finish('dispute without a reference');
        const email = await resolvePurchase(env, ref, 'disputed');
        if (!email) {
          const noted = await recordUnmatchedResolution(env, {
            ref, status: 'disputed', email: chargeEmail(obj),
            amountCents: obj.amount ?? null,
            currency: String(obj.currency || '').toLowerCase() || null,
          });
          console.error('Stripe: dispute arrived before its completion;'
            + ` recorded against ${ref} so the completion cannot grant access`
            + ` (newRow=${noted})`);
          return finish('dispute recorded ahead of its completion');
        }
        return finish(await describeRevocation(env, email, 'dispute'));
      }

      case 'charge.dispute.closed': {
        const ref = typeof obj.payment_intent === 'string' ? obj.payment_intent : null;
        if (!ref) return finish('dispute close without a reference');
        if (obj.status !== 'won') {
          console.log(`Stripe: dispute closed ${obj.status}, access stays revoked`);
          return finish(`dispute ${obj.status}`);
        }
        const email = await resolvePurchase(env, ref, 'paid');
        if (!email) return finish('dispute win matched nothing');
        /* Clears revoked_at and leaves user_id null on purpose, so the member
           re-attaches through claim_membership(). One attach path. */
        const restored = await rpc(env, 'restore_if_paid', { p_email: email });
        console.log(`Stripe: dispute won for ${redactEmail(email)}, restored=${restored}`);
        return finish('dispute won, access restored');
      }

      case 'checkout.session.expired':
        /* A failed or abandoned payment. No session completed means nothing
           was written, which is already the correct outcome, so there is
           nothing to undo. */
        return finish('session expired, nothing written');

      default:
        return finish('type not handled');
    }
  } catch (e) {
    /* The row stays 'processing', so the retry Stripe sends is allowed to
       proceed and finish the work. This is the path the first version of
       this handler got wrong. */
    console.error(`Stripe: handling ${event.type} failed -`, e.message);
    await failEvent(env, event.id, e.message);
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
  redactEmail, sessionEmail, chargeEmail, claimEvent, describeRevocation,
  recordPurchase, recordUnmatchedResolution, sessionBoughtOurPrice,
};
