# Deploying The Blueprint

`wrangler.jsonc` sets `main: src/worker.js`, so **the Worker is what serves the
site**. It imports the handlers in `functions/api/` — those files are the single
implementation of each endpoint, not a second copy.

## Variables the Worker needs

Set in Cloudflare → Workers & Pages → **theblueprint** → Settings → Variables
and Secrets. A missing one does not fail loudly: the endpoint that needs it
returns 503 and the app just says the feature is unavailable. The Worker's logs
name the missing variable.

| Name | Kind | Used by | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Secret | `/api/coach-tee` | Anthropic console → API keys |
| `SUPABASE_JWT_SECRET` | **Secret** | `/api/coach-tee` | Project Settings → API → JWT Secret. Coach Tee verifies each caller's token against this locally. Without it the endpoint returns **503**, not 401 |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | coach-tee, ko-fi | Bypasses row level security. Coach Tee reads the members table with it; without it coach-tee returns 503. Never put this in the client |
| `KOFI_VERIFICATION_TOKEN` | Secret | `/api/kofi-webhook` | Ko-fi → Webhooks. Without it the webhook refuses every request rather than accepting forgeries |
| `SUPABASE_URL` | Optional | coach-tee, ko-fi | Public; already in the page source. coach-tee falls back to a built-in default and derives the expected JWT issuer from it, ko-fi requires it |
| `KOFI_ACCEPTED_TYPES` | Optional | `/api/kofi-webhook` | Comma-separated Ko-fi event types that grant access. Defaults to `Shop Order` |
| `KOFI_PRODUCT_CODE` | Optional | `/api/kofi-webhook` | The shop item that IS The Blueprint. Defaults to `75a70cb698`, the code in the checkout link. A verified order whose product cannot be matched is refused, so this is the value to change if the shop item is ever recreated. `KOFI_SHOP_ITEM_CODE` is still read as an alias |

`SUPABASE_ANON_KEY` is no longer used. Coach Tee used to ask Supabase over
HTTP who a token belonged to, which meant a wrong anon key and an invalid
token produced the same 401 and were answered the same way. Tokens are
verified locally now, so that ambiguity is gone and the anon key with it.

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
