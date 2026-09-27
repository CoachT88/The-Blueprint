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
