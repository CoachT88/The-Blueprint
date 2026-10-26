import { describe, test, expect, afterEach, vi } from 'vitest';
import { onRequestGet } from '../functions/api/checkout-status.js';
import worker from '../src/worker.js';

const ID = 'cs_live_a1Example123';
const ENV = {
  STRIPE_SECRET_KEY: 'rk_live_example',
  STRIPE_PRICE_ID: 'price_example',
  STRIPE_PRICE_CENTS: '9900',
  STRIPE_CURRENCY: 'usd',
  STRIPE_LIVEMODE: 'true',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
};
const baseSession = {
  id: ID, livemode: true, mode: 'payment', status: 'complete',
  payment_status: 'paid', amount_subtotal: 9900, currency: 'usd',
  payment_intent: 'pi_example',
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
const request = (id = ID) =>
  new Request('https://theblueprint.site/api/checkout-status?session_id=' +
    encodeURIComponent(id));

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

function stub({ session = baseSession, ledger = [
  { status: 'paid', amount_cents: 9900, currency: 'usd' },
], stripeCode = 200, dbCode = 200 } = {}) {
  const urls = [];
  global.fetch = vi.fn(async url => {
    const u = String(url);
    urls.push(u);
    if (u.includes('api.stripe.com')) return json(session, stripeCode);
    if (u.includes('/rest/v1/purchases')) return json(ledger, dbCode);
    throw new Error('unexpected outgoing request');
  });
  return urls;
}

describe('checkout return status never grants unpaid access', () => {
  test('untrusted or absent Stripe IDs are refused before any API calls', async () => {
    const urls = stub();
    for (const id of ['bad', 'cs_test_abcd']) {
      const response = await onRequestGet({ request: request(id), env: ENV });
      expect(response.status).toBe(400);
      expect((await response.json()).state).toBe('invalid');
    }
    expect(urls).toHaveLength(0);
  });

  test('missing production verification config never says verified', async () => {
    const urls = stub();
    const response = await onRequestGet({
      request: request(), env: { ...ENV, SUPABASE_SERVICE_ROLE_KEY: undefined },
    });
    expect(response.status).toBe(503);
    expect((await response.json()).state).toBe('unavailable');
    expect(urls).toHaveLength(0);
  });

  test('declined or open checkout is not paid and never reads the ledger', async () => {
    const urls = stub({ session: {
      ...baseSession, status: 'open', payment_status: 'unpaid',
    } });
    const response = await onRequestGet({ request: request(), env: ENV });
    expect((await response.json()).state).toBe('not_paid');
    expect(urls.filter(url => url.includes('/purchases'))).toHaveLength(0);
  });

  test('asynchronous payment pending is not confirmed', async () => {
    stub({ session: { ...baseSession, payment_status: 'unpaid' } });
    const response = await onRequestGet({ request: request(), env: ENV });
    expect((await response.json()).state).toBe('processing');
  });

  test('Stripe paid but webhook has not written the ledger is only processing', async () => {
    stub({ ledger: [] });
    const response = await onRequestGet({ request: request(), env: ENV });
    expect((await response.json()).state).toBe('processing');
  });

  test('Stripe paid and the paid purchase ledger agree', async () => {
    const urls = stub();
    const response = await onRequestGet({ request: request(), env: ENV });
    const body = await response.text();
    expect(JSON.parse(body).state).toBe('verified');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(urls.some(url => url.includes('/rest/v1/purchases?'))).toBe(true);
    expect(body).not.toContain('service-key');
  });

  test('refunded or disputed purchases are never verified', async () => {
    for (const status of ['refunded', 'disputed']) {
      stub({ ledger: [{ status, amount_cents: 9900, currency: 'usd' }] });
      const response = await onRequestGet({ request: request(), env: ENV });
      expect((await response.json()).state).toBe('review');
    }
  });

  test('a Stripe payment for the wrong amount is refused before ledger lookup', async () => {
    const urls = stub({ session: { ...baseSession, amount_subtotal: 1 } });
    const response = await onRequestGet({ request: request(), env: ENV });
    expect((await response.json()).state).toBe('review');
    expect(urls.some(url => url.includes('/purchases'))).toBe(false);
  });

  test('network or auth failures always fail closed', async () => {
    stub({ stripeCode: 403 });
    let response = await onRequestGet({ request: request(), env: ENV });
    expect(response.status).toBe(503);
    expect((await response.json()).state).toBe('unavailable');

    stub({ dbCode: 500 });
    response = await onRequestGet({ request: request(), env: ENV });
    expect(response.status).toBe(503);
    expect((await response.json()).state).toBe('unavailable');
  });

  test('production Worker route reaches the verification handler, not static assets', async () => {
    const urls = stub({ session: { ...baseSession, payment_status: 'unpaid' } });
    const response = await worker.fetch(request(), {
      ...ENV, ASSETS: { fetch: async () => new Response('static fallback') },
    });
    expect((await response.json()).state).toBe('processing');
    expect(urls.length).toBe(1);
  });

  test('return page never claims payment before server verification', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const page = readFileSync(path.join(root, 'welcome/index.html'), 'utf8');
    expect(page).toContain('Checking your payment...');
    expect(page).toContain('/api/checkout-status?session_id=');
    expect(page).toContain("state==='verified'");
    expect(page).not.toContain('<h1>Payment received.</h1>');
  });
});