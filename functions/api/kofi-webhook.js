// Ko-fi purchase webhook
// Adds a buyer's email to the Supabase members table on a successful payment.
//
// Required secrets (Cloudflare Pages -> Settings -> Variables and Secrets):
//   SUPABASE_URL              - your Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY - Supabase -> Project Settings -> API -> service_role
//   KOFI_VERIFICATION_TOKEN   - Ko-fi -> Webhooks -> Verification Token
//
// This endpoint hands out paid access, so it is only as trustworthy as the
// token check below. Anyone on the internet can POST here; the token is the
// only thing separating a real purchase from a stranger typing curl.

/* Never log an email, a raw body, or a parsed payload. This webhook carries
   the email address of someone who just bought a sexual-health product, and
   request logs are the wrong place for that to live. These helpers say what
   happened without saying who it happened to. */
function redactEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return '<none>';
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}

/* EMAIL REMAINS THE INITIAL ENTITLEMENT KEY, and it has to: a purchase
   usually arrives before the buyer has an account at all. A row with
   user_id null is the correct resting state, and the next legitimate
   email-authenticated sign-in claims it through claim_membership().

   This is only an optimisation on top: if exactly ONE existing auth user
   already holds this verified email, the row can be attached immediately so
   that buyer never needs the claim step. Exactly one, because zero means
   there is nobody to attach to yet and more than one is ambiguous, and
   guessing between them would hand an entitlement to the wrong account. */
async function findSoleAuthUser(email, supabaseUrl, serviceKey) {
  try {
    const url = `${supabaseUrl}/auth/v1/admin/users?per_page=2&filter=`
      + encodeURIComponent(email);
    const res = await fetch(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const users = Array.isArray(body) ? body : (body && Array.isArray(body.users) ? body.users : null);
    if (!users) return null;
    /* The filter is a server-side search, so re-check the address exactly and
       only accept a CONFIRMED one: an unconfirmed address proves nothing and
       anybody can type it at signup. */
    const exact = users.filter(u => u && typeof u.email === 'string'
      && u.email.toLowerCase() === email.toLowerCase()
      && (u.email_confirmed_at || u.confirmed_at));
    return exact.length === 1 ? exact[0].id : null;
  } catch (e) {
    return null;                       // never block a purchase on this
  }
}

async function upsertMember(email, supabaseUrl, serviceKey) {
  /* STEP 1. The entitlement itself, keyed on email and carrying no identity.
     Sending user_id here would be wrong even when one is known, because
     merge-duplicates would overwrite a user_id that a claim had already
     attached, and a repeat purchase would silently move a live entitlement
     onto a different account. */
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

  /* STEP 2, best effort. Attach identity ONLY to a row that nobody owns yet.
     The user_id=is.null filter is what makes this unable to steal: if a
     claim or an earlier webhook already attached someone, the PATCH matches
     no rows and changes nothing. A failure is swallowed because the purchase
     is already recorded and the claim path still works. */
  try {
    const soleUserId = await findSoleAuthUser(email, supabaseUrl, serviceKey);
    if (!soleUserId) return;
    await fetch(`${supabaseUrl}/rest/v1/members`
      + `?email=eq.${encodeURIComponent(email)}&user_id=is.null`, {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ user_id: soleUserId, claimed_at: new Date().toISOString() }),
    });
  } catch (e) {
    /* Never let the optimisation fail the webhook: Ko-fi would retry a
       purchase that has in fact already been recorded. */
  }
}

/* Compared in constant time so response latency cannot be used to recover the
   token one character at a time. */
function tokensMatch(a, b) {
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

/* ── Which Ko-fi events buy The Blueprint ────────────────────────────────────
 *
 * Ko-fi sends one webhook for every kind of payment it processes, and until
 * now this endpoint granted paid access for all of them. A three pound tip
 * unlocked the app.
 *
 * The Blueprint is sold as a Ko-fi Shop item: the checkout link in the app is
 * https://ko-fi.com/s/75a70cb698, and ko-fi.com/s/<code> is the shop item URL
 * form, so 75a70cb698 is this product's direct_link_code. A purchase arrives
 * as type "Shop Order" carrying that code in shop_items. A donation arrives as
 * "Donation", a membership payment as "Subscription", and neither is a
 * purchase of this product.
 *
 * The rule is absolute: no verified Blueprint product identity, no access.
 * A Shop Order whose product cannot be identified is refused, not waved
 * through on the type alone.
 *
 * Both the accepted types and the product code are overridable by environment
 * variable, and that is load bearing rather than decorative: this was written
 * without network access to Ko-fi's documentation, so the field names come
 * from their documented payload format rather than from a captured live
 * request. Every refusal logs the structure it saw, so if the assumption is
 * wrong the first real purchase says exactly where the identifier lives.
 */
const DEFAULT_ACCEPTED_TYPES = ['Shop Order'];
const DEFAULT_PRODUCT_CODE = '75a70cb698';

function acceptedTypes(env) {
  const configured = String(env.KOFI_ACCEPTED_TYPES || '').trim();
  if (!configured) return DEFAULT_ACCEPTED_TYPES;
  return configured.split(',').map((t) => t.trim()).filter(Boolean);
}

/* KOFI_SHOP_ITEM_CODE is the name this shipped with for one round of review.
   Both are read so renaming it cannot silently stop matching. */
function productCode(env) {
  return String(env.KOFI_PRODUCT_CODE || env.KOFI_SHOP_ITEM_CODE || DEFAULT_PRODUCT_CODE).trim();
}

/* Every place Ko-fi is known to name the product that was bought. Returns
   `{ code, where }` for each one found, with `where` used only for logging.

   Deliberately limited to fields that have been named or observed. Inventing
   more places to look would mean inventing more ways to let the wrong product
   through. */
function collectProductCodes(body) {
  const found = [];
  const add = (value, where) => {
    if (typeof value === 'string' && value.trim()) found.push({ code: value.trim(), where });
  };

  add(body.direct_link_code, 'direct_link_code');
  add(body.item_code, 'item_code');

  if (Array.isArray(body.shop_items)) {
    body.shop_items.forEach((item, i) => {
      if (!item || typeof item !== 'object') return;
      add(item.direct_link_code, `shop_items[${i}].direct_link_code`);
      add(item.item_code, `shop_items[${i}].item_code`);
    });
  }
  return found;
}

/* Structural detail only, for when a verified Shop Order is refused because no
   product could be identified. Names and shapes, never values: no email, no
   token, no amount, no message. Enough to see where Ko-fi actually put the
   identifier, and nothing that would put a customer's details in a log. */
function payloadShape(body) {
  const keys = Object.keys(body).sort().join(',');
  const items = Array.isArray(body.shop_items) ? body.shop_items : null;
  const itemShape = !items
    ? (body.shop_items === undefined ? 'shop_items:absent' : 'shop_items:not-an-array')
    : items.length === 0
      ? 'shop_items:empty'
      : `shop_items[0] keys: ${Object.keys(items[0] || {}).sort().join(',')}`;
  return `top-level keys: ${keys} | ${itemShape}`;
}

/* The single decision: does this verified payload buy The Blueprint?
   Returns null to grant access, or a short reason not to.

   The rule is that no verified product identity means no access. A Shop Order
   with no identifiable product used to be granted on the type alone, on the
   grounds that only one product exists. That is an assumption about the shop
   rather than a fact about the payload, and it stops being true the first time
   a second item is listed. */
function notAPurchase(body, env) {
  const type = typeof body.type === 'string' ? body.type.trim() : '';
  if (!acceptedTypes(env).includes(type)) return `type=${type || '<missing>'}`;

  /* A recurring payment is a membership, not a one-off purchase of this. */
  if (body.is_subscription_payment === true) return 'recurring payment, not a one-off purchase';

  const wanted = productCode(env);
  const found = collectProductCodes(body);

  if (!found.length) {
    /* The diagnostic that matters. If a real purchase is ever refused here,
       this line says where Ko-fi put the identifier so the fix is obvious. */
    console.error(`Ko-fi: verified ${type} carried no product identifier. ${payloadShape(body)}`);
    return 'no product identifier in the payload';
  }

  if (!found.some((f) => f.code === wanted)) {
    console.error(`Ko-fi: verified ${type} is a different product. Found ` +
      found.map((f) => `${f.where}=${f.code}`).join(', '));
    return 'product identifier does not match The Blueprint';
  }

  return null;
}

export async function onRequestPost({ request, env }) {
  /* Checked before the body is even parsed. The previous version only
     compared the token when KOFI_VERIFICATION_TOKEN happened to be set, so a
     missing or misspelled variable silently turned the check off and let
     every request through - a lock that unlocks itself when you lose the
     key. Missing config is now a refusal, not a free pass. */
  if (!env.KOFI_VERIFICATION_TOKEN) {
    console.error('Ko-fi: KOFI_VERIFICATION_TOKEN is not configured; refusing the request');
    return new Response('Service unavailable', { status: 503 });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Ko-fi: Supabase credentials are not configured; refusing the request');
    return new Response('Service unavailable', { status: 503 });
  }

  let body;
  try {
    const text = await request.text();
    /* Ko-fi documents a URL-encoded form with the payload in a "data"
       field; some of its test requests send bare JSON instead. */
    const dataStr = new URLSearchParams(text).get('data');
    body = JSON.parse(dataStr || text);
  } catch (e) {
    console.error('Ko-fi: could not parse the request body');
    return new Response('Bad Request', { status: 400 });
  }

  /* JSON.parse happily returns null, a number or a string, and reading a
     property off null throws. Established before anything touches the body. */
  if (!body || typeof body !== 'object') {
    console.error('Ko-fi: payload was not an object');
    return new Response('Bad Request', { status: 400 });
  }

  if (!tokensMatch(body.verification_token, env.KOFI_VERIFICATION_TOKEN)) {
    console.error('Ko-fi: verification token mismatch');
    return new Response('Unauthorized', { status: 401 });
  }

  /* Verified as genuinely from Ko-fi, but not a purchase of this product.
     Answered 200 so Ko-fi accepts delivery and stops retrying: the event is
     real and correctly signed, we simply do not act on it. Logged at error
     level with the exact type, because if a real purchase ever lands here
     that log line is the only thing that will say so. */
  const reason = notAPurchase(body, env);
  if (reason) {
    console.error('Ko-fi: verified event did not grant access -', reason);
    return new Response('OK', { status: 200 });
  }

  /* Lowercased, because Supabase Auth lowercases the address it signs people
     in with, and the members lookup is a case-sensitive equality test. A row
     written as Buyer@Example.com never matches the buyer@example.com the app
     asks about, so the buyer pays and is then told there is no membership for
     their email. Trimmed for the same reason. */
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isPlausibleEmail(email)) {
    /* Verified as genuinely from Ko-fi, but with nothing usable in it. 200 so
       Ko-fi stops retrying a request that can never succeed. */
    console.error('Ko-fi: verified payload carried no usable email');
    return new Response('OK', { status: 200 });
  }

  try {
    await upsertMember(email, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    console.log('Ko-fi: member added -', redactEmail(email));
  } catch (e) {
    console.error('Ko-fi: database write failed -', e.message);
    return new Response('Internal error', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

export async function onRequestGet() {
  return new Response('OK', { status: 200 });
}
