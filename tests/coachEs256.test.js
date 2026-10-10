import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateKeyPairSync, createSign, createHmac, randomUUID } from 'node:crypto';
/* Imported per test where the module-level JWKS cache matters, because that
   cache deliberately survives requests and would otherwise leak between
   tests and make them order dependent. */
import { onRequestPost as coachPost } from '../functions/api/coach-tee.js';

/** A cold copy of the endpoint, with an empty JWKS cache. */
async function coldCoach() {
    vi.resetModules();
    return (await import('../functions/api/coach-tee.js?cold=' + Math.random())).onRequestPost;
}

/**
 * Coach Tee, verifying Supabase ES256 sessions through the project's JWKS.
 *
 * Supabase now signs with an ECC P-256 key, so a session token arrives as
 * ES256 and the shared JWT secret cannot verify it at all. The endpoint used
 * to refuse every such token with 503, which is why Coach was down while
 * Supabase auth, login and the rest of the app worked.
 *
 * These tests sign with a REAL P-256 key generated here and serve its public
 * half from a stubbed JWKS endpoint, so the signature path is genuinely
 * exercised rather than mocked. No secret and no private key is needed by the
 * endpoint for this path, which is the point.
 */

const SUPABASE_URL = 'https://edqmujiczuvavlemfpaz.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS_URL = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
const JWT_SECRET = 'legacy-shared-secret';

/* One keypair for the suite, plus a second that the project never publishes,
   which is how a validly-signed-but-wrong-key token is built. */
const KID = 'key-' + randomUUID();
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const other = generateKeyPairSync('ec', { namedCurve: 'P-256' });

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const nowSec = () => Math.floor(Date.now() / 1000);

const claimsFor = (over = {}) => ({
  sub: 'u1', email: 'member@example.com', aud: 'authenticated',
  iss: ISSUER, exp: nowSec() + 3600, ...over,
});

/** A real ES256 JWS: the signature is raw r||s, as the spec requires. */
function signEs256(claims, key = privateKey, { kid = KID, alg = 'ES256' } = {}) {
  /* `kid: null` OMITS the field, which is what a token with no key id really
     looks like. It cannot be `undefined`: a destructuring default applies to
     undefined, so `{ kid: undefined }` would silently restore the real kid,
     which is exactly how the first version of this test passed while proving
     nothing. */
  const header = kid === null ? { alg, typ: 'JWT' } : { alg, typ: 'JWT', kid };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(claims));
  const sig = createSign('sha256').update(`${h}.${p}`)
    .sign({ key, dsaEncoding: 'ieee-p1363' });
  return `${h}.${p}.${b64url(sig)}`;
}

function signHs256(claims) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify(claims));
  return `${h}.${p}.${b64url(createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest())}`;
}

const jwkFor = (pub, kid = KID) => ({ ...pub.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' });

const COACH_ENV = {
  ANTHROPIC_API_KEY: 'anthropic-key',
  SUPABASE_URL,
  SUPABASE_JWT_SECRET: JWT_SECRET,
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
};

const request = (token) => new Request('https://example.com/api/coach-tee', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ mode: 'coach', userMsg: 'how do I progress?' }),
});

let membersRows, jwksKeys, jwksStatus, jwksThrows, jwksHits, anthropicStatus, anthropicBody;

beforeEach(() => {
  membersRows = [{ email: 'member@example.com' }];
  jwksKeys = [jwkFor(publicKey)];
  jwksStatus = 200; jwksThrows = false; jwksHits = 0;
  anthropicStatus = 200;
  anthropicBody = { content: [{ type: 'text', text: 'answer' }] };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  global.fetch = vi.fn(async (url, init) => {
    const u = String(url);
    if (u.includes('/.well-known/jwks.json')) {
      jwksHits += 1;
      if (jwksThrows) throw new Error('network down');
      if (jwksStatus !== 200) return new Response('nope', { status: jwksStatus });
      return new Response(JSON.stringify({ keys: jwksKeys }), { status: 200 });
    }
    if (u.includes('/rest/v1/members') && (init?.method || 'GET') === 'GET') {
      return new Response(JSON.stringify(membersRows), { status: 200 });
    }
    if (u.includes('/rest/v1/rpc/bump_coach_usage')) return new Response('1', { status: 200 });
    if (u.includes('api.anthropic.com')) {
      return new Response(JSON.stringify(anthropicBody), { status: anthropicStatus });
    }
    return new Response('{}', { status: 200 });
  });
});

const ask = (token, env) => coachPost({
  request: request(token), env: env === undefined ? COACH_ENV : env,
});
const anthropicCalled = () => global.fetch.mock.calls.some(([u]) => String(u).includes('api.anthropic.com'));

describe('coach-tee: ES256 sessions', () => {
  it('ACCEPTS a valid ES256 member token', async () => {
    const res = await ask(signEs256(claimsFor()));
    expect(res.status).toBe(200);
    expect(anthropicCalled()).toBe(true);
  });

  it('needs NO JWT secret to do it', async () => {
    /* The whole point: ES256 verifies against public keys, so the shared
       secret is irrelevant and its absence must not matter. */
    const res = await ask(signEs256(claimsFor()), { ...COACH_ENV, SUPABASE_JWT_SECRET: undefined });
    expect(res.status).toBe(200);
  });

  it('fetches the project JWKS once, then serves it from cache', async () => {
    const cold = await coldCoach();
    const call = () => cold({ request: request(signEs256(claimsFor())), env: COACH_ENV });
    expect((await call()).status).toBe(200);
    expect(jwksHits).toBe(1);
    expect((await call()).status).toBe(200);
    expect(jwksHits).toBe(1);          // second request used the cache
  });

  it('REJECTS a signature made with a key the project does not publish', async () => {
    /* Correctly formed ES256, same kid, wrong private key. */
    const res = await ask(signEs256(claimsFor(), other.privateKey));
    expect(res.status).toBe(401);
    expect(anthropicCalled()).toBe(false);
  });

  it('REJECTS a tampered payload', async () => {
    const good = signEs256(claimsFor());
    const [h, , s] = good.split('.');
    const forged = b64url(JSON.stringify(claimsFor({ sub: 'someone-else' })));
    const res = await ask(`${h}.${forged}.${s}`);
    expect(res.status).toBe(401);
    expect(anthropicCalled()).toBe(false);
  });

  it('REJECTS an expired token', async () => {
    const res = await ask(signEs256(claimsFor({ exp: nowSec() - 60 })));
    expect(res.status).toBe(401);
    expect(anthropicCalled()).toBe(false);
  });

  it('REJECTS the wrong audience', async () => {
    const res = await ask(signEs256(claimsFor({ aud: 'anon' })));
    expect(res.status).toBe(401);
    expect(anthropicCalled()).toBe(false);
  });

  it('treats a wrong issuer as OUR misconfiguration, not the member’s', async () => {
    /* Same rule the HS256 path already had: a verified signature means the
       token is from this project, so a mismatched issuer can only mean
       SUPABASE_URL points somewhere else. */
    const res = await ask(signEs256(claimsFor({ iss: 'https://other.supabase.co/auth/v1' })));
    expect(res.status).toBe(503);
    expect(anthropicCalled()).toBe(false);
  });

  it('REJECTS a token with no subject', async () => {
    const res = await ask(signEs256(claimsFor({ sub: undefined })));
    expect(res.status).toBe(401);
  });

  describe('the key id is mandatory', () => {
    it('REJECTS an ES256 token with NO kid, without spending a JWKS fetch', async () => {
      /* There is no "any usable key" fallback. A token naming no key would
         otherwise be verified against an arbitrary published one, which with
         several keys live, during a rotation, is the endpoint choosing on the
         caller's behalf. */
      const cold = await coldCoach();
      const res = await cold({
        request: request(signEs256(claimsFor(), privateKey, { kid: null })), env: COACH_ENV });
      expect(res.status).toBe(401);
      expect(jwksHits).toBe(0);        // refused before any network call
      expect(anthropicCalled()).toBe(false);
    });

    it('REJECTS an EMPTY kid', async () => {
      const cold = await coldCoach();
      const res = await cold({
        request: request(signEs256(claimsFor(), privateKey, { kid: '' })), env: COACH_ENV });
      expect(res.status).toBe(401);
      expect(jwksHits).toBe(0);
    });

    it('REJECTS a kid that does not match, even when the SIGNATURE is valid', async () => {
      /* Signed with the real key, so only the kid is wrong. The published set
         has a key that would verify this signature, and it must still be
         refused because the token named a different one. */
      const cold = await coldCoach();
      const res = await cold({
        request: request(signEs256(claimsFor(), privateKey, { kid: 'not-the-published-kid' })),
        env: COACH_ENV });
      expect(res.status).toBe(401);
      expect(anthropicCalled()).toBe(false);
    });

    it('and a kid naming a key of the WRONG type is refused', async () => {
      /* A published RSA entry must not be reachable by an ES256 token, even
         by name. */
      const cold = await coldCoach();
      jwksKeys = [{ kty: 'RSA', kid: KID, alg: 'RS256', use: 'sig', n: 'xx', e: 'AQAB' }];
      const res = await cold({ request: request(signEs256(claimsFor())), env: COACH_ENV });
      expect(res.status).toBe(401);
      expect(anthropicCalled()).toBe(false);
    });
  });

  describe('key rotation and an unknown kid', () => {
    it('REFETCHES once, so a freshly rotated key works immediately', async () => {
      /* Warm the cache with the old key set, then rotate: the new kid is
         unknown until a refetch, which is exactly the rotation case. */
      const cold = await coldCoach();
      expect((await cold({ request: request(signEs256(claimsFor())), env: COACH_ENV })).status).toBe(200);
      expect(jwksHits).toBe(1);
      const rotated = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const newKid = 'rotated-' + randomUUID();
      jwksKeys = [jwkFor(rotated.publicKey, newKid)];
      const res = await cold({
        request: request(signEs256(claimsFor(), rotated.privateKey, { kid: newKid })), env: COACH_ENV });
      expect(res.status).toBe(200);
      expect(jwksHits).toBe(2);        // one refetch, not a loop
    });

    it('REJECTS an unknown kid that no refetch explains, and does not loop', async () => {
      const res = await ask(signEs256(claimsFor(), other.privateKey, { kid: 'never-published' }));
      expect(res.status).toBe(401);
      expect(jwksHits).toBeLessThanOrEqual(2);
      expect(anthropicCalled()).toBe(false);
    });
  });

  describe('JWKS unavailable', () => {
    it('with a COLD cache it is OUR failure, never a pass', async () => {
      const cold = await coldCoach();
      jwksThrows = true;
      const res = await cold({ request: request(signEs256(claimsFor())), env: COACH_ENV });
      expect(res.status).toBe(503);
      expect(anthropicCalled()).toBe(false);
    });

    it('a non-200 JWKS response is also 503, not 401', async () => {
      const cold = await coldCoach();
      jwksStatus = 500;
      const res = await cold({ request: request(signEs256(claimsFor())), env: COACH_ENV });
      expect(res.status).toBe(503);
      expect(anthropicCalled()).toBe(false);
    });

    it('but a WARM cache keeps members working while JWKS is down', async () => {
      /* Deliberate resilience, stated so it is a decision rather than an
         accident: once the key set is cached, a Supabase blip does not take
         Coach down with it until the TTL expires. */
      const cold = await coldCoach();
      expect((await cold({ request: request(signEs256(claimsFor())), env: COACH_ENV })).status).toBe(200);
      jwksThrows = true;
      const res = await cold({ request: request(signEs256(claimsFor())), env: COACH_ENV });
      expect(res.status).toBe(200);
    });
  });

  describe('the gates that must survive', () => {
    it('a NON-MEMBER with a perfect ES256 token is refused 403', async () => {
      membersRows = [];
      const res = await ask(signEs256(claimsFor()));
      expect(res.status).toBe(403);
      expect(anthropicCalled()).toBe(false);
    });

    it('a missing Anthropic key is handled gracefully, before any auth work', async () => {
      const res = await ask(signEs256(claimsFor()), { ...COACH_ENV, ANTHROPIC_API_KEY: undefined });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.message).not.toMatch(/key|secret|token/i);
    });

    it('an Anthropic failure does not leak internals', async () => {
      anthropicStatus = 500;
      anthropicBody = { error: { message: 'internal upstream detail' } };
      const res = await ask(signEs256(claimsFor()));
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).not.toMatch(/anthropic-key|service-key|legacy-shared-secret/);
    });

    it('HS256 still works, so a legacy project is not broken', async () => {
      const res = await ask(signHs256(claimsFor()));
      expect(res.status).toBe(200);
    });

    it('alg:none is refused and never reaches Anthropic', async () => {
      const h = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
      const p = b64url(JSON.stringify(claimsFor()));
      const res = await ask(`${h}.${p}.`);
      expect(res.status).not.toBe(200);
      expect(anthropicCalled()).toBe(false);
    });

    it('an HS256 token signed with the PUBLIC key is refused', async () => {
      /* The classic confusion attack: read the public key from the JWKS and
         use it as an HMAC secret. Each branch pins its own key type, so this
         matches neither. */
      const jwk = jwkFor(publicKey);
      const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const p = b64url(JSON.stringify(claimsFor()));
      const sig = b64url(createHmac('sha256', JSON.stringify(jwk)).update(`${h}.${p}`).digest());
      const res = await ask(`${h}.${p}.${sig}`);
      expect(res.status).toBe(401);
      expect(anthropicCalled()).toBe(false);
    });
  });
});
