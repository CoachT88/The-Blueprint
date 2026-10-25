// The deployed entry point. wrangler.jsonc points "main" here, so this file —
// not the functions/ directory — is what actually answers requests.
//
// It used to carry its own copy of every endpoint, duplicating the handlers in
// functions/api/. That is how a security fix came to be applied to the copy
// nobody was running: both files looked authoritative, and only one was. So
// there is now exactly one implementation of each endpoint and this file only
// decides which of them a URL belongs to.

import {
  onRequestPost as kofiPost,
  onRequestGet as kofiGet,
} from '../functions/api/kofi-webhook.js';

import {
  onRequestPost as coachPost,
  onRequestOptions as coachOptions,
} from '../functions/api/coach-tee.js';

import {
  onRequestPost as stripeWebhookPost,
  onRequestGet as stripeWebhookGet,
} from '../functions/api/stripe-webhook.js';

import {
  onRequestPost as checkoutSessionPost,
} from '../functions/api/create-checkout-session.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* Whop is no longer the payment processor and its webhook is gone. It
       authenticated nothing: a POST granted paid access for any email, and a
       deactivation event deleted a paying customer by email. Anything still
       calling it now gets a plain 410 rather than a silent success. */
    if (url.pathname === '/api/whop-webhook') {
      return new Response('Gone', { status: 410 });
    }

    if (url.pathname === '/api/kofi-webhook') {
      if (request.method === 'POST') return kofiPost({ request, env });
      if (request.method === 'GET') return kofiGet();
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (url.pathname === '/api/coach-tee') {
      if (request.method === 'POST') return coachPost({ request, env });
      if (request.method === 'OPTIONS') return coachOptions();
      return new Response('Method Not Allowed', { status: 405 });
    }

    /* Stripe. These were written as functions/api/ modules, which is the
       Cloudflare PAGES convention: a file there becomes a route on a Pages
       project automatically. This is a WORKER, wrangler.jsonc points main
       here, and nothing under functions/ is routed unless this file says so.
       So both handlers existed, were fully tested, and answered 404 on the
       live domain until these two blocks were added.
       tests/workerRoutes.test.js now asserts that every handler in
       functions/api/ is reachable through here, so the next endpoint cannot
       be forgotten the same way. */

    if (url.pathname === '/api/stripe-webhook') {
      if (request.method === 'POST') return stripeWebhookPost({ request, env });
      /* Stripe's dashboard probes the endpoint with a GET when you add it.
         The handler answers 200 and does nothing. */
      if (request.method === 'GET') return stripeWebhookGet();
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (url.pathname === '/api/create-checkout-session') {
      /* POST only. It creates a Stripe object, so it must not be reachable
         by a link, a prefetch, or a crawler. */
      if (request.method === 'POST') return checkoutSessionPost({ request, env });
      return new Response('Method Not Allowed', { status: 405 });
    }

    return env.ASSETS.fetch(request);
  },
};
