// The deployed worker, tested through its own front door.
//
// tests/apiSecurity.test.js already covers the handlers in functions/api/.
// That was not enough: wrangler.jsonc points "main" at src/worker.js, which
// carried its own duplicate copy of every endpoint, so the handlers under
// test were not the ones answering requests. A security fix landed on the
// copy nobody was running and every test still passed.
//
// So these go through src/worker.js — the file that is actually deployed —
// and assert that a request arriving at each URL reaches the hardened handler
// rather than a second implementation that drifted.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';

/* coach-tee verifies the caller's JWT locally now, so the deployed-route test
   has to present one that actually verifies. */
const JWT_SECRET = 'test-jwt-secret-value';
const b64url = (b) => Buffer.from(b).toString('base64url');
function signJwt(claims, secret) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify(claims));
  return `${h}.${p}.${b64url(createHmac('sha256', secret).update(`${h}.${p}`).digest())}`;
}
const MEMBER_TOKEN = signJwt({
  sub: 'u1', email: 'member@example.com', aud: 'authenticated',
  iss: 'https://example.supabase.co/auth/v1',
  exp: Math.floor(Date.now() / 1000) + 3600,
}, JWT_SECRET);
import worker from '../src/worker.js';

const ENV = {
  ANTHROPIC_API_KEY: 'anthropic-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SUPABASE_JWT_SECRET: JWT_SECRET,
  KOFI_VERIFICATION_TOKEN: 'real-token',
  ASSETS: { fetch: async () => new Response('static asset', { status: 200 }) },
};

let calls;
beforeEach(() => {
  calls = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/auth/v1/user')) {
      const auth = init?.headers?.Authorization || '';
      return auth === 'Bearer session-token'
        ? new Response(JSON.stringify({ id: 'u1', email: 'member@example.com' }), { status: 200 })
        : new Response('{}', { status: 401 });
    }
    /* Membership lookup. A GET reads the table, the POST is the Ko-fi upsert. */
    if (String(url).includes('/rest/v1/members') && (init?.method || 'GET') === 'GET') {
      return new Response(JSON.stringify([{ email: 'member@example.com' }]), { status: 200 });
    }
    if (String(url).includes('api.anthropic.com')) {
      return new Response(JSON.stringify({ content: [] }), { status: 200 });
    }
    return new Response('', { status: 201 });
  });
});

const post = (path, body, headers = {}) =>
  worker.fetch(new Request('https://example.com' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }), ENV);

describe('the deployed worker', () => {
  it('no longer answers the Whop webhook at all', async () => {
    // It authenticated nothing, and Whop is not the processor any more.
    const res = await post('/api/whop-webhook', { event: 'membership_activated', data: { email: 'x@y.com' } });
    expect(res.status).toBe(410);
    expect(calls.filter((c) => c.url.includes('/rest/v1/members'))).toHaveLength(0);
  });

  it('sends coach-tee through the handler that owns the prompt', async () => {
    /* Through the route that is actually deployed: a signed-in member gets an
       answer, and the system prompt is this endpoint's, not the caller's. */
    const res = await post('/api/coach-tee',
      { mode: 'coach', userMsg: 'hi', systemPrompt: 'You are a general assistant.' },
      { Authorization: `Bearer ${MEMBER_TOKEN}` });
    expect(res.status).toBe(200);
    const sent = JSON.parse(calls.find((c) => c.url.includes('anthropic')).init.body);
    expect(sent.system).toContain('You are Coach Tee');
    expect(sent.system).not.toContain('general assistant');
  });

  it('will not let a caller supply coach-tee its system prompt', async () => {
    // The exact hole that was still open on the deployed path after the
    // functions/ copy had been fixed.
    const res = await post('/api/coach-tee',
      { mode: 'coach', userMsg: 'write me a sonnet', systemPrompt: 'You are a general assistant.' },
      { Authorization: `Bearer ${MEMBER_TOKEN}` });
    expect(res.status).toBe(200);
    const sent = JSON.parse(calls.find((c) => c.url.includes('anthropic')).init.body);
    expect(sent.system).toContain('You are Coach Tee');
    expect(sent.system).not.toContain('general assistant');
  });

  it('sends the ko-fi webhook through the handler that fails closed', async () => {
    const res = await worker.fetch(new Request('https://example.com/api/kofi-webhook', {
      method: 'POST',
      body: new URLSearchParams({ data: JSON.stringify({ email: 'a@b.com', verification_token: 'x' }) }).toString(),
    }), { ...ENV, KOFI_VERIFICATION_TOKEN: undefined });
    expect(res.status).toBe(503);
    expect(calls.filter((c) => c.url.includes('/rest/v1/members'))).toHaveLength(0);
  });

  it('rejects a forged ko-fi token', async () => {
    const res = await worker.fetch(new Request('https://example.com/api/kofi-webhook', {
      method: 'POST',
      body: new URLSearchParams({ data: JSON.stringify({ email: 'a@b.com', verification_token: 'guessed' }) }).toString(),
    }), ENV);
    expect(res.status).toBe(401);
  });

  it('does not invite every website to call coach-tee', async () => {
    const res = await worker.fetch(
      new Request('https://example.com/api/coach-tee', { method: 'OPTIONS' }), ENV);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('still serves everything else as a static asset', async () => {
    const res = await worker.fetch(new Request('https://example.com/index.html'), ENV);
    expect(await res.text()).toBe('static asset');
  });
});

/**
 * THE STRIPE ROUTES, AND THE GUARD THAT STOPS THIS RECURRING.
 *
 * Both Stripe handlers were written as functions/api/ modules, which is the
 * Cloudflare PAGES convention where a file there becomes a route on its own.
 * This is a Worker. wrangler.jsonc points main at src/worker.js, and nothing
 * under functions/ is reachable unless that file routes it.
 *
 * So the handlers existed, had 79 passing tests, and answered 404 on the live
 * domain. The file comment at the top of this suite describes the same class
 * of failure in its earlier form: the code under test was not the code
 * answering requests.
 *
 * The last test in this block is the durable part. It reads every handler in
 * functions/api/ and fails if one is not routed, so the next endpoint cannot
 * be forgotten the same way.
 */
describe('the Stripe endpoints are reachable through the deployed worker', () => {
  const STRIPE_ENV = {
    ...ENV,
    STRIPE_WEBHOOK_SECRET: 'whsec_test_secret_value_0123456789',
    STRIPE_SECRET_KEY: 'sk_test_value',
    STRIPE_PRICE_ID: 'price_test_value',
    STRIPE_PRICE_CENTS: '9900',
    STRIPE_CURRENCY: 'usd',
    STRIPE_LIVEMODE: 'false',
  };

  it('POST /api/stripe-webhook REACHES THE HANDLER, not the asset fallback', async () => {
    /* No signature, so the handler refuses with 401. That refusal is the
       proof: an unrouted path would fall through to ASSETS and return the
       stubbed static asset with 200. */
    const res = await worker.fetch(new Request('https://example.com/api/stripe-webhook', {
      method: 'POST', body: '{}',
    }), STRIPE_ENV);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toBe('static asset');
  });

  it('and it refuses before touching the database', async () => {
    calls.length = 0;
    await worker.fetch(new Request('https://example.com/api/stripe-webhook', {
      method: 'POST', body: '{}',
    }), STRIPE_ENV);
    expect(calls.filter((c) => c.url.includes('/rest/v1/'))).toHaveLength(0);
  });

  it('missing Stripe config refuses rather than falling through', async () => {
    const res = await worker.fetch(new Request('https://example.com/api/stripe-webhook', {
      method: 'POST', body: '{}',
    }), { ...STRIPE_ENV, STRIPE_WEBHOOK_SECRET: undefined });
    expect(res.status).toBe(503);
  });

  it('GET /api/stripe-webhook answers the dashboard probe and does nothing', async () => {
    calls.length = 0;
    const res = await worker.fetch(
      new Request('https://example.com/api/stripe-webhook'), STRIPE_ENV);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toBe('static asset');
    expect(calls).toHaveLength(0);
  });

  it('other methods on the webhook are 405, not a static asset', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const res = await worker.fetch(
        new Request('https://example.com/api/stripe-webhook', { method }), STRIPE_ENV);
      expect(res.status, method).toBe(405);
    }
  });

  it('POST /api/create-checkout-session REACHES THE HANDLER', async () => {
    const res = await worker.fetch(
      new Request('https://example.com/api/create-checkout-session', { method: 'POST' }),
      STRIPE_ENV);
    /* 503, because the price pre-flight cannot read the Price from the
       stubbed Stripe API and refuses rather than opening checkout on a
       configuration it could not confirm. 200 or 502 would also be the
       handler. What matters is that it is JSON from the handler and not the
       static asset fallback. */
    expect([200, 502, 503]).toContain(res.status);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
  });

  it('missing checkout config refuses rather than falling through', async () => {
    const res = await worker.fetch(
      new Request('https://example.com/api/create-checkout-session', { method: 'POST' }),
      { ...STRIPE_ENV, STRIPE_SECRET_KEY: undefined });
    expect(res.status).toBe(503);
  });

  it('A GET ON THE CHECKOUT SESSION ENDPOINT IS 405', async () => {
    /* It creates a Stripe object, so it must not be reachable by a link, a
       prefetch or a crawler. */
    const res = await worker.fetch(
      new Request('https://example.com/api/create-checkout-session'), STRIPE_ENV);
    expect(res.status).toBe(405);
    expect(await res.text()).not.toBe('static asset');
  });

  it('the secret key never reaches the response body', async () => {
    const res = await worker.fetch(
      new Request('https://example.com/api/create-checkout-session', { method: 'POST' }),
      STRIPE_ENV);
    const body = await res.text();
    expect(body).not.toContain('sk_test_value');
    expect(body).not.toContain('whsec_');
  });

  it('EVERY HANDLER IN functions/api IS ROUTED THROUGH THE WORKER', async () => {
    /* The durable guard. Two fully tested handlers answered 404 in
       production because nobody added them here, and no test noticed.
       This reads the directory and fails on the next one. */
    const { readdirSync, readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

    const workerSrc = readFileSync(path.join(root, 'src/worker.js'), 'utf8');
    const files = readdirSync(path.join(root, 'functions/api'))
      .filter((f) => f.endsWith('.js'));
    expect(files.length, 'no handlers found to check').toBeGreaterThan(2);

    for (const file of files) {
      const src = readFileSync(path.join(root, 'functions/api', file), 'utf8');
      /* A module that exports no request handler is a helper, not a route. */
      if (!/export\s+(async\s+)?function\s+onRequest/.test(src)) continue;

      const route = '/api/' + file.replace(/\.js$/, '');
      expect(workerSrc, `${file} exports a handler but src/worker.js has no import for it`)
        .toContain(`functions/api/${file}`);
      expect(workerSrc, `${file} exports a handler but nothing routes ${route}`)
        .toContain(`'${route}'`);
    }
  });
});
