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

    return env.ASSETS.fetch(request);
  },
};
