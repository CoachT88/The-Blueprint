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
| `SUPABASE_URL` | Optional | coach-tee, ko-fi | Public; already in the page source. coach-tee falls back to a built-in default, ko-fi requires it |
| `SUPABASE_ANON_KEY` | Optional | `/api/coach-tee` | Public by design. Falls back to a built-in default. `SUPABASE_ANON` is accepted too, since that is what index.html calls it |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | `/api/kofi-webhook` | Bypasses row level security. Never put this in the client |
| `KOFI_VERIFICATION_TOKEN` | Secret | `/api/kofi-webhook` | Ko-fi → Webhooks. Without it the webhook refuses every request rather than accepting forgeries |

Only the secrets can stop an endpoint. The Supabase URL and anon key are
public constants sitting in the page source, so coach-tee carries defaults for
them rather than refusing to run when they are not configured — requiring a
public value to be set separately bought nothing and cost an outage the first
time it changed.

## Keep auto-reload off on Anthropic credits

Credits without auto-reload are a hard ceiling on abuse: the worst case is that
the balance runs out and the endpoint starts failing. Turn it on only alongside
a spend cap.
