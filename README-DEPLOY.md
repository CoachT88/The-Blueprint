# Deploying The Blueprint

**Deployment target:** `wrangler.jsonc` names the live Cloudflare Worker `the-blueprint`. The earlier `theblueprint` Worker is retired; do not deploy to it. Before a production release, verify the Workers Builds production branch is `main`, the production **Deploy command** is `npx wrangler deploy` (not `npx wrangler preview`), and the required secrets exist on `the-blueprint`. Keep Worker Previews disabled until separately configured with isolated preview settings and safe secrets. Cloudflare Pages deployments do not by themselves verify this Worker's `/api` routes.

`wrangler.jsonc` sets `main: src/worker.js`, so **the Worker is what serves the
site**. It imports the handlers in `functions/api/` — those files are the single
implementation of each endpoint, not a second copy.

## Variables the Worker needs

Set in Cloudflare → Workers & Pages → **the-blueprint** (current production Worker; not the retired `theblueprint`) → Settings → Variables
and Secrets. A missing one does not fail loudly: the endpoint that needs it
returns 503 and the app just says the feature is unavailable. The Worker's logs
name the missing variable.

| Name | Kind | Used by | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Secret | `/api/coach-tee` | Anthropic console → API keys |
| `SUPABASE_JWT_SECRET` | **Secret** | `/api/coach-tee` | Project Settings → API → JWT Secret. Coach Tee verifies each caller's token against this locally. Without it the endpoint returns **503**, not 401 |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | coach-tee, ko-fi | Bypasses row level security. Coach Tee reads the members table with it; without it coach-tee returns 503. Never put this in the client. **Worker only** — see the runtime note below |
| `KOFI_VERIFICATION_TOKEN` | Secret | `/api/kofi-webhook` | Ko-fi → Webhooks. Without it the webhook refuses every request rather than accepting forgeries |
| `SUPABASE_URL` | Optional | coach-tee, ko-fi | Public; already in the page source. coach-tee falls back to a built-in default and derives the expected JWT issuer from it, ko-fi requires it |
| `KOFI_ACCEPTED_TYPES` | Optional | `/api/kofi-webhook` | Comma-separated Ko-fi event types that grant access. Defaults to `Shop Order` |
| `KOFI_PRODUCT_CODE` | Optional | `/api/kofi-webhook` | The shop item that IS The Blueprint. Defaults to `75a70cb698`, the code in the checkout link. A verified order whose product cannot be matched is refused, so this is the value to change if the shop item is ever recreated. `KOFI_SHOP_ITEM_CODE` is still read as an alias |

Coach Tee no longer uses `SUPABASE_ANON_KEY`. It used to ask Supabase over
HTTP who a token belonged to, which meant a wrong anon key and an invalid
token produced the same 401 and were answered the same way. Tokens are
verified locally now, so that ambiguity is gone.

**The anon key is needed again, for checkout.** See the Stripe table below:
without it a signed-in buyer's purchase is not bound to their account.

## Variables Stripe checkout needs

Same place, same Worker. These are what the launch added.

| Name | Kind | Used by | Notes |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | **Secret** | both Stripe endpoints | A restricted key is enough and is what to use. It needs **Checkout Sessions: write** to create a session, **Checkout Sessions: read** because the webhook fetches `line_items` to prove the buyer bought our Price, and **Prices: read** for the pre-flight. Nothing else — not Customers, Charges or Refunds write |
| `STRIPE_WEBHOOK_SECRET` | **Secret** | `/api/stripe-webhook` | Stripe → Webhooks → the endpoint → signing secret, one `whsec_` value. Without it the webhook returns **503** and refuses every request rather than accepting forgeries. During a secret roll Stripe sends several `v1=` signatures in one header and the handler accepts any that verifies, so the window is survivable, but the variable itself still has to be updated |
| `STRIPE_PRICE_ID` | Secret | both | The Price object for the $99 one-time product. The webhook grants access **only** for this Price |
| `STRIPE_PRICE_CENTS` | Secret | both | `9900`. Checked against the live Price before a session opens, so a dashboard price change closes checkout instead of charging an amount the webhook will refuse |
| `STRIPE_CURRENCY` | Optional | both | Defaults to `usd` |
| `STRIPE_LIVEMODE` | Secret | `/api/stripe-webhook` | `true` on production. A test-mode event arriving at a live endpoint, or the reverse, is rejected with 401 and nothing is written |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | `/api/stripe-webhook` | Already above for coach-tee and ko-fi. The webhook writes `purchases`, `members` and `payment_events` with it |
| `SUPABASE_URL` | **Required here** | both Stripe endpoints | Optional for coach-tee, required for these. The session endpoint verifies the buyer's token against it; the webhook writes through it |
| `SUPABASE_ANON_KEY` | **Required here** | `/api/create-checkout-session` | Public, and already in the page source. Used only to ask Supabase to verify a buyer's access token. **A missing anon key does not fail loudly:** checkout still works, but `identifyBuyer` returns nulls, no `client_reference_id` is set, and the purchase binds by email instead of to the account. Set it |
| `STRIPE_API_VERSION` | Optional | both | Sent as `Stripe-Version` **only if set**. Set it only to match a webhook endpoint deliberately pinned in the dashboard; leave it unset to use the account default. Pinning a version the account cannot serve fails every call |
| `STRIPE_RETURN_URL` | Optional | `/api/create-checkout-session` | Defaults to `https://theblueprint.site/welcome/?session_id={CHECKOUT_SESSION_ID}` |

The browser never sees any of these. The publishable `pk_live_` key in
`index.html` is public by design and can do nothing on its own.

**The buyer's identity never comes from the request body.**
`client_reference_id` decides which account an entitlement attaches to, so a
caller who could name it could attach someone else's purchase to their own
account. It is read from a Supabase-verified access token or not at all.

**Nothing about anyone's health goes to Stripe.** The only metadata sent is
`metadata[product]=blueprint`: no assessment answers, no measurements, no
session history, no photographs.

Rollback for the Stripe launch is `docs/stripe-launch-rollback.md`. It is a
revert of the launch merge, not a flag flip.

## What each Coach Tee failure means

The status code says whose fault it is, and that distinction is deliberate.
Telling a signed-in member to sign in, when the real problem is a missing
secret, is an outage this endpoint has already had once.

| The member sees | It means | Where to look |
|---|---|---|
| **401** Sign in to talk to Coach Tee | No token, a forged or expired one | Nothing to fix server-side |
| **403** Coach Tee is for Blueprint members | Real session, no row in `members` | Did their purchase reach the webhook? |
| **503** temporarily unavailable, this is our end | Missing secret, project key change, or Supabase unwell | Worker logs name the variable |
| **429** today's limit | Over 100 questions in a day | `coach_usage` table |

A 401 means the token itself is wrong: absent, forged, expired, not yet
valid, not a logged-in session (`aud`), or carrying no issuer or subject.
A mismatched **issuer** is a 503 rather than a 401, because by then the
signature has already verified: the token is from this project, so a
disagreeing issuer can only mean `SUPABASE_URL` and `SUPABASE_JWT_SECRET`
point at different places.

If **every** member suddenly gets 503, read the Worker log: it names the
missing or unusable variable directly. If every member gets 401, that is not
a configuration problem, because configuration problems cannot produce a 401
any more.

## Keep auto-reload off on Anthropic credits

Credits without auto-reload are a hard ceiling on abuse: the worst case is that
the balance runs out and the endpoint starts failing. Turn it on only alongside
a spend cap.

## Invoking the notification sender

`/functions/v1/send-notifications` has two independent gates, in two different
headers. Both must pass. Getting them the wrong way round produces a 401 that
looks the same either way, which is why this table exists.

| Header | Value | Checked by | What it is for |
|---|---|---|---|
| `Authorization` | `Bearer <SUPABASE_ANON_KEY>` | Supabase's gateway, before the function runs | Satisfying the platform's `verify_jwt`. Not a secret |
| `x-cron-secret` | `<CRON_SECRET>` | The function, in `_shared/cronAuth.js` | **This is the authentication.** Keep it secret |

The anon key is public: it is in the page source. It is there only because
`verify_jwt` is on and the gateway wants a valid project JWT. The service role
key would also pass, and should not be used: it bypasses row level security,
and `cron.job` stores its command as plain text in the database.

`verify_jwt` stays **on**. The deploy command carries no `--no-verify-jwt`, and
there is no `supabase/config.toml` turning it off. Both gates, always.

Both values live in Supabase Vault and are read by name at call time, so
`cron.job.command` holds no secret. See `supabase/notifications.sql`.

### The backend admin key lives in two different places

This caused a production failure worth writing down, because the two runtimes
behave differently and the variable has the same job in both.

| Runtime | What runs there | Where the admin key comes from |
|---|---|---|
| **Cloudflare Worker** | `/api/coach-tee`, `/api/kofi-webhook` | `SUPABASE_SERVICE_ROLE_KEY`, set by hand. Cloudflare has no reserved prefixes |
| **Supabase Edge Function** | `send-notifications` | `SUPABASE_SECRET_KEYS`, injected automatically. `SUPABASE_`-prefixed names **cannot** be set by hand |

On a project using the newer API key system, Supabase stopped injecting
`SUPABASE_SERVICE_ROLE_KEY` into edge functions, and the reserved prefix means
it cannot be added. The notification function was handed `undefined`, every
query went out unauthenticated, row level security refused the read, and it
reported `read_failed` — an error pointing squarely at the database, which was
the one place nothing was wrong.

`send-notifications` now reads `SUPABASE_SECRET_KEYS` first and falls back to
`SUPABASE_SERVICE_ROLE_KEY`, so it works hosted, locally and self-hosted. If
the key inside that map is not called `default`, set `SUPABASE_SECRET_KEY_NAME`
to its name. Missing entirely is a **503** with `service-key-not-configured`,
and the function's startup log names the shape it found without printing any
value.

The Worker is unaffected and needs no change. Its value is a legacy
`service_role` JWT and still works because legacy keys remain enabled on this
project. **If legacy JWT keys are ever disabled**, three things break together:
the Worker's service-role calls, Coach Tee's `SUPABASE_JWT_SECRET` verification
(user tokens become asymmetric, which the code reports as a 503
`alg-mismatch`), and the cron's anon-JWT gateway credential. No code change is
needed for that day: on Cloudflare the variable is just a name, so an
`sb_secret_…` value can be pasted into the existing `SUPABASE_SERVICE_ROLE_KEY`.

### Function secrets

Set in Supabase → Edge Functions → Secrets, not on the Worker:

| Name | Used for |
|---|---|
| `CRON_SECRET` | Matched against the `x-cron-secret` header |
| `VAPID_SUBJECT` | `mailto:` contact on every push |
| `VAPID_PUBLIC_KEY` | Must match the key in `app/index.html`. A test pins this |
| `VAPID_PRIVATE_KEY` | Signs each push. Its public half is the one above |

A missing `CRON_SECRET` returns **503**, not 401: an unset secret is a deploy
fault and reporting it as "unauthorized" sends whoever is debugging it looking
in the wrong place.

### The VAPID pair must match

`app/index.html` carries the public half; Supabase holds both. If they disagree
every send fails with 403 `VapidPkHashMismatch` and nothing arrives. Supabase
only shows a SHA256 digest of a secret, which is enough to check:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('<key from app/index.html>').digest('hex'))"
```

The result must match the `VAPID_PUBLIC_KEY` digest in the dashboard.
`tests/sendNotifications.test.js` pins this, so editing the key in the app
without changing the secret fails the build.
