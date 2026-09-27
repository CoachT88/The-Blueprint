// Coach Tee - the app's AI coach, proxied so the Anthropic key never reaches
// a browser.
//
// Required secrets (Cloudflare Pages -> Settings -> Variables and Secrets):
//   ANTHROPIC_API_KEY         - Anthropic console -> API keys
//   SUPABASE_JWT_SECRET       - Supabase -> Project Settings -> API -> JWT Secret
//   SUPABASE_SERVICE_ROLE_KEY - Supabase -> Project Settings -> API -> service_role
//   SUPABASE_URL              - optional; a public value with a default below
//
// This endpoint spends money on every call, so three things guard it: the
// caller has to hold a session this project issued, that session has to belong
// to a paying member, and the system prompt is chosen here rather than sent by
// the caller.
//
// Every one of those can fail, and the status code says whose fault it was.
// 401 means sign in. 403 means you are signed in but have not bought this.
// 503 means we are misconfigured or Supabase is unwell. Conflating the last
// with the first is how this endpoint once told every paying member to sign in
// while they already were.
//
// The previous version had neither. It forwarded whatever system prompt the
// request supplied, with no authentication and Access-Control-Allow-Origin
// set to *, which made it a free general-purpose model that any page on the
// internet could drive and this account paid for.

/* The prompts live on the server and the client picks one by name. That is
   the whole difference between a coaching endpoint and an open model: a
   stranger can still reach this, but the only thing they can make it do is
   coach them about pelvic-floor training.

   The text was moved here verbatim from the client. It has since been edited
   in one respect only: the formatting rules now ask for short paragraphs
   separated by a blank line. The substance, the medical content and the
   coaching voice are untouched. */
const SYSTEM_PROMPTS = {
  coach: "You are Coach Tee, a men's sexual health and performance specialist with deep expertise in pelvic floor physiology, tissue conditioning, blood flow optimization, hormonal health, and PE protocols. You speak with authority and precision backed by research and clinical understanding. You are direct, confident, and never hedge unnecessarily.\n\nCRITICAL RULES you follow on every single response:\n- NEVER use em dashes (-- or the character) under any circumstances. Use commas, periods, or colons instead.\n- No markdown. No asterisks, no headers, no bold. The app renders your reply as plain text, so **this** would arrive with the asterisks still in it.\n- Break the answer into short paragraphs of two or three sentences, separated by a blank line. Never send one continuous block. Every one of these answers is read on a phone, where a wall of text is skipped rather than read.\n- When you give steps or options, put each one on its own line starting with \"- \". No numbering, no bold, nothing else.\n- Never start with a filler phrase like \"Great question\" or \"Sure!\"\n- Always give a thorough, complete answer. If a topic has nuance, address the nuance directly. Do not oversimplify.\n\nMEDICAL ACCURACY REQUIREMENTS:\n- Kegel exercises are NOT universally beneficial. Men with a hypertonic (chronically tight or overactive) pelvic floor will often make their symptoms WORSE by doing kegels. The correct intervention for a hypertonic pelvic floor is reverse kegels, myofascial release, hip openers, and diaphragmatic breathing, not additional contraction work. Always ask or assess context before recommending kegels. If a man reports symptoms like urgency, premature ejaculation tied to tension, pelvic pain, or difficulty relaxing, suspect hypertonic floor and recommend release work over contractions.\n- Blood flow to erectile tissue depends on endothelial nitric oxide synthase (eNOS) activity, which is stimulated by physical deconditioning recovery, adequate sleep (testosterone peaks during REM), hydration, and vascular health. Chronic restriction, dehydration, and poor sleep all degrade EQ over time.\n- Length gains in PE typically precede girth gains. Early progress often reflects decompression and connective tissue elongation. Girth requires advanced techniques like clamping and Uli and responds more slowly. Never suggest girth comes faster or easier than length.\n- When discussing stamina and ejaculatory control, distinguish between psychological (performance anxiety, mental arousal spike) and physiological (hypertonic pelvic floor, pudendal nerve hypersensitivity) causes. Treatment differs significantly.\n- Testosterone optimization is downstream of sleep quality, body fat percentage, zinc and magnesium sufficiency, and chronic stress reduction. Supplementation without addressing these is largely ineffective.\n\nRESPONSE STYLE:\n- Be thorough. If a question has layers, address the layers. A 4 to 6 sentence response is often appropriate, split across two or three short paragraphs. Longer if the topic demands it, and longer means more paragraphs, never a bigger one.\n- Be specific. Cite mechanisms, not just conclusions. \"Nitric oxide dilates the smooth muscle of the corpus cavernosum\" is better than \"good blood flow helps erections.\"\n- Speak like a knowledgeable coach who has studied this deeply and worked with real men, not like a disclaimer-heavy medical chatbot.\n- Never say \"consult a doctor\" as a cop-out. You can note when something warrants professional evaluation, but still give a substantive answer.\n- The user is an adult who wants real information. Give it to them.",
  recovery: "You are a tissue expansion recovery analyst. The user will describe how their session felt, including EQ, pump, fatigue, and sensations. Give exactly 2 sentences: one assessing their recovery status, one actionable recommendation for their next session. Put them in two paragraphs with a blank line between, so the assessment and the instruction do not run together. No markdown. No em dashes. Be direct and specific.",
};

/* A member's own numbers get appended to the prompt so Coach Tee answers as
   someone who knows them. Both caps exist because every character here is
   billed to this account. */
const MAX_USER_MSG = 4000;
const MAX_CONTEXT = 4000;

/* The project URL. Public: it is already in the page source. It keeps a
   default so a value nobody has to keep secret cannot become the reason the
   endpoint is down.

   The anon key used to live here too, because identity was established by
   asking Supabase over HTTP. It is gone: tokens are verified locally now, so
   the only Supabase call left is the membership read, which uses the service
   role key. */
const SUPABASE_DEFAULT_URL = 'https://edqmujiczuvavlemfpaz.supabase.co';

/* Supabase mints user sessions with this audience. */
const AUTHENTICATED_AUDIENCE = 'authenticated';

/* Supabase's issuer is the project URL plus /auth/v1, so it is derived rather
   than configured. One value to set, one place to be wrong. */
function supabaseIssuer(env) {
  return supabaseConfig(env).url + '/auth/v1';
}

function supabaseConfig(env) {
  return {
    /* Trailing slashes get trimmed: a configured value ending in "/" would
       build .co//rest/v1/members, which is not the endpoint. */
    url: String(env.SUPABASE_URL || SUPABASE_DEFAULT_URL).replace(/\/+$/, ''),
  };
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/* Identity is established by verifying the caller's JWT here, against this
   project's own signing secret. There is no network call.

   This replaced asking Supabase "who is this token" over HTTP, and the reason
   is the distinction the previous version could not make. Supabase answers 401
   both when the caller's token is genuinely invalid AND when the anon key this
   endpoint is configured with belongs to a different project. Those need
   opposite responses, and guessing wrong in one direction tells every paying
   member to sign in while they already are. That is an outage this endpoint
   has had once.

   Verifying locally removes the ambiguity, because each failure has exactly
   one cause:

     no Authorization header        the caller sent no credential
     not three dot-separated parts  the caller sent something that is not a JWT
     signature does not verify      not issued by this project
     exp in the past                the token expired
     JWT secret not configured      WE are misconfigured
     algorithm is not HS256         WE are misconfigured for this project

   Only the first four are the caller's problem. The last two are ours, and
   must never be reported to a member as an authentication failure.

   Returns one of:
     { ok: true,  user: { id, email } }
     { ok: false, kind: 'unauthorized',  why }   the caller can fix this
     { ok: false, kind: 'misconfigured', why }   only a deploy can fix this   */

function b64urlToBytes(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const unauthorized = (why) => ({ ok: false, kind: 'unauthorized', why });
const misconfigured = (why) => ({ ok: false, kind: 'misconfigured', why });

async function identify(request, env) {
  const secret = env.SUPABASE_JWT_SECRET;
  if (!secret) {
    console.error('coach-tee: SUPABASE_JWT_SECRET is not set, so no session can be verified');
    return misconfigured('no-jwt-secret');
  }

  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return unauthorized('no-token');
  const token = auth.slice(7).trim();

  const parts = token.split('.');
  if (parts.length !== 3) return unauthorized('malformed');

  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    return unauthorized('undecodable');
  }

  /* Deliberately our fault rather than the caller's. A Supabase project moved
     to asymmetric signing keys issues RS256 or ES256 tokens that this secret
     cannot verify, and every member would otherwise be told to sign in. An
     attacker who sets alg themselves is refused either way, so classifying
     this as a configuration problem costs nothing and catches the migration
     the day it happens. */
  if (!header || header.alg !== 'HS256') {
    console.error('coach-tee: token algorithm is ' + (header && header.alg) +
      ', but this endpoint verifies HS256. The project signing keys and this secret disagree.');
    return misconfigured('alg-mismatch');
  }

  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    verified = await crypto.subtle.verify(
      'HMAC', key, b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + '.' + parts[1]));
  } catch (e) {
    /* importKey only throws on a secret this runtime cannot use, which is a
       deploy fault. A wrong signature returns false; it does not throw. */
    console.error('coach-tee: could not use SUPABASE_JWT_SECRET to verify -', e.message);
    return misconfigured('unusable-secret');
  }
  if (!verified) return unauthorized('bad-signature');

  /* ── Claims ───────────────────────────────────────────────────────────────
     A valid signature proves the token was minted by whoever holds this
     project's JWT secret. It does not prove the token is a user session, and
     that gap is the reason aud is checked: this project's own anon key is a
     JWT signed with the same secret, and without an audience check a token
     that is not a login would satisfy the signature. */

  const now = Date.now();
  if (typeof claims.exp === 'number' && claims.exp * 1000 <= now) {
    return unauthorized('expired');
  }
  /* Not-before, with a minute of slack for clock drift between Supabase and
     this worker. Rejecting a token issued half a second in the future would
     be a clock problem wearing an auth problem's clothes. */
  if (typeof claims.nbf === 'number' && claims.nbf * 1000 > now + 60_000) {
    return unauthorized('not-yet-valid');
  }

  /* Supabase issues user sessions with aud "authenticated". The spec allows a
     single value or a list, so both are accepted. Anything else is not a
     logged-in member and the caller is the one who can fix that. */
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(AUTHENTICATED_AUDIENCE)) {
    return unauthorized('wrong-audience');
  }

  /* The issuer is derived from SUPABASE_URL rather than configured
     separately, so there is no new value to get wrong and no second place to
     keep in step.

     Classified as OUR fault, not the caller's, and that is a deliberate
     departure worth stating plainly. By the time this runs the signature has
     already verified, which means the token was issued by the holder of our
     JWT secret, which means it is from our project. An issuer that then fails
     to match can only mean SUPABASE_URL and SUPABASE_JWT_SECRET are pointing
     at different projects. Calling that an invalid caller token would hand
     every member a "sign in" they cannot act on, which is the exact failure
     this endpoint was fixed for. A forger cannot reach this line without the
     secret, and a forger holding the secret would simply write the correct
     issuer, so refusing with 401 here buys no security either. */
  const expectedIssuer = supabaseIssuer(env);
  if (typeof claims.iss === 'string' && claims.iss !== expectedIssuer) {
    console.error('coach-tee: token issuer is ' + claims.iss + ' but SUPABASE_URL implies ' +
      expectedIssuer + '. The configured project URL and JWT secret disagree.');
    return misconfigured('issuer-mismatch');
  }
  if (!claims.iss) {
    /* No issuer at all is not a Supabase session token. */
    return unauthorized('no-issuer');
  }

  if (!claims.sub) return unauthorized('no-subject');

  return { ok: true, user: { id: claims.sub, email: claims.email || '' } };
}

/* The same members-table check the app runs at sign-in, repeated here so a
   signed-in account that never paid cannot spend the Anthropic balance.

   This does NOT fail open. An earlier version let the request through when the
   lookup errored, on the grounds that an outage should not cost paying members
   the feature. That reasoning is wrong for a gate: "we could not check" is not
   "they are a member", and an unreadable members table would have reopened the
   endpoint to anyone with a Supabase account. Availability problems are
   answered with 503, which is honest, rather than by letting the request past.

   Returns the same shape as identify():
     { ok: true }
     { ok: false, kind: 'not-member' }     -> 403
     { ok: false, kind: 'misconfigured' }  -> 503, our deploy is wrong
     { ok: false, kind: 'upstream' }       -> 503, Supabase is unwell         */
async function checkMembership(email, env, supabase) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('coach-tee: SUPABASE_SERVICE_ROLE_KEY is not set, cannot check membership');
    return { ok: false, kind: 'misconfigured', why: 'no-service-key' };
  }
  /* A verified token with no email claim cannot be matched against the members
     table, and letting it through would skip the gate entirely. */
  if (!email) {
    console.error('coach-tee: verified token carried no email claim');
    return { ok: false, kind: 'not-member', why: 'no-email-claim' };
  }
  let res;
  try {
    const url = supabase.url + '/rest/v1/members?select=email&limit=1&email=eq.' + encodeURIComponent(email);
    res = await fetch(url, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      },
    });
  } catch (e) {
    console.error('coach-tee: members lookup could not reach Supabase -', e.message);
    return { ok: false, kind: 'upstream', why: 'unreachable' };
  }
  if (!res.ok) {
    console.error('coach-tee: members lookup failed, status', res.status);
    return { ok: false, kind: 'upstream', why: 'status-' + res.status };
  }
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) {
    console.error('coach-tee: members lookup returned something that is not a list');
    return { ok: false, kind: 'upstream', why: 'unreadable-body' };
  }
  return rows.length > 0 ? { ok: true } : { ok: false, kind: 'not-member', why: 'no-row' };
}

/* Questions per member per UTC day. Counted by supabase/coach-usage.sql, which
   is optional: with the migration unapplied this returns true every time and
   there is simply no cap. */
const DAILY_LIMIT = 100;

async function withinDailyLimit(userId, env, supabase) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !userId) return true;
  try {
    const res = await fetch(supabase.url + '/rest/v1/rpc/bump_coach_usage', {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user: userId }),
    });
    if (!res.ok) return true;
    const count = await res.json().catch(() => null);
    return typeof count === 'number' ? count <= DAILY_LIMIT : true;
  } catch {
    return true;
  }
}

export async function onRequestPost({ request, env }) {
  const supabase = supabaseConfig(env);

  /* Only the Anthropic key can stop this endpoint now. The Supabase URL and
     anon key are public values printed in the page source, so requiring them
     to be configured separately bought nothing and cost an outage: verifying
     a session made the anon key newly required, and a Worker set up before
     that change refused every request while looking perfectly configured.
     A secret has to be set. A public constant should not need to be. */
  if (!env.ANTHROPIC_API_KEY) {
    console.error('coach-tee: not configured, missing ANTHROPIC_API_KEY');
    return json({ error: { message: 'Coach Tee is unavailable right now.' } }, 503);
  }

  /* The gate is back on, narrowed so it cannot fail the way it did before.
     Previously any failure of the check refused the request, so a
     misconfigured anon key read as "everybody is a stranger" and the feature
     was down for everyone while looking perfectly configured. Now only a
     refusal the caller can actually fix is enforced. If the check itself
     cannot run, the answer goes through and the log says why.

     Everything else that closes this endpoint is unchanged: the system prompt
     lives here so a caller cannot supply one, only two modes exist, the
     message and context are capped, and CORS invites nobody. */
  const who = await identify(request, env);
  if (!who.ok && who.kind === 'unauthorized') {
    return json({ error: { message: 'Sign in to talk to Coach Tee.' } }, 401);
  }
  if (!who.ok) {
    /* Our fault, so say so. Telling a signed-in member to sign in when the
       real problem is a missing secret is the failure this endpoint has
       already had, and it is indistinguishable from the app being broken. */
    console.error('coach-tee: refusing because this endpoint is misconfigured -', who.why);
    return json({ error: { message: 'Coach Tee is temporarily unavailable. This is our end, not yours.' } }, 503);
  }
  const user = who.user;

  /* A signed-in account is not the same as a paying one. Anyone can create a
     Supabase account against a public anon key, so without this the endpoint
     is still open to anybody willing to sign up. */
  const member = await checkMembership(user.email, env, supabase);
  if (!member.ok && member.kind === 'not-member') {
    console.warn('coach-tee: refused a signed-in non-member,', user.id, member.why);
    return json({ error: { message: 'Coach Tee is for Blueprint members.' } }, 403);
  }
  if (!member.ok) {
    console.error('coach-tee: could not establish membership -', member.kind, member.why);
    return json({ error: { message: 'Coach Tee is temporarily unavailable. This is our end, not yours.' } }, 503);
  }

  if (!(await withinDailyLimit(user.id, env, supabase))) {
    console.warn('coach-tee: daily limit reached for', user.id);
    return json({ error: { message: "That is today's Coach Tee limit. It resets tomorrow." } }, 429);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: { message: 'Bad request.' } }, 400);
  }

  const system = SYSTEM_PROMPTS[payload.mode];
  if (!system) return json({ error: { message: 'Unknown request.' } }, 400);

  const userMsg = String(payload.userMsg || '').slice(0, MAX_USER_MSG);
  if (!userMsg.trim()) return json({ error: { message: 'Nothing to send.' } }, 400);

  const context = String(payload.context || '').slice(0, MAX_CONTEXT);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: context ? system + '\n\n' + context : system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      /* The upstream body is not echoed back: it can carry account detail,
         and a browser has no use for it either way. */
      console.error('coach-tee: non-JSON response from Anthropic, status', res.status);
      data = { error: { message: 'Coach Tee could not answer that one.' } };
    }
    return json(data, res.status);
  } catch (e) {
    console.error('coach-tee: upstream request failed -', e.message);
    return json({ error: { message: 'Coach Tee could not answer that one.' } }, 502);
  }
}

/* Same-origin only now. A same-origin fetch sends no preflight, so the app
   never reaches this handler; it exists to tell other sites no. */
export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
