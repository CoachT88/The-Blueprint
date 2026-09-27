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
| `SUPABASE_URL` | Optional | coach-tee, ko-fi | Public; already in the page source. coach-tee falls back to a built-in default, ko-fi requires it |
| `KOFI_ACCEPTED_TYPES` | Optional | `/api/kofi-webhook` | Comma-separated Ko-fi event types that grant access. Defaults to `Shop Order` |
| `KOFI_SHOP_ITEM_CODE` | Optional | `/api/kofi-webhook` | The shop item that is The Blueprint. Defaults to `75a70cb698`, the code in the checkout link |

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

If **every** member suddenly gets 503, read the Worker log: it names the
missing or unusable variable directly. If every member gets 401, that is not
a configuration problem, because configuration problems cannot produce a 401
any more.

## Keep auto-reload off on Anthropic credits

Credits without auto-reload are a hard ceiling on abuse: the worst case is that
the balance runs out and the endpoint starts failing. Turn it on only alongside
a spend cap.
