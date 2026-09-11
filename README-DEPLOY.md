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
| `SUPABASE_URL` | Variable | coach-tee, ko-fi | Public; it is in the page source |
| `SUPABASE_ANON_KEY` | Variable | `/api/coach-tee` | Public by design; also in the page source. Used to ask Supabase who a session token belongs to |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | `/api/kofi-webhook` | Bypasses row level security. Never put this in the client |
| `KOFI_VERIFICATION_TOKEN` | Secret | `/api/kofi-webhook` | Ko-fi → Webhooks. Without it the webhook refuses every request rather than accepting forgeries |

`SUPABASE_ANON_KEY` was added when coach-tee started verifying sessions. A
Worker configured before that change has everything else and still refuses
every request, which is exactly what it is meant to do — it just needs setting
once.

## Keep auto-reload off on Anthropic credits

Credits without auto-reload are a hard ceiling on abuse: the worst case is that
the balance runs out and the endpoint starts failing. Turn it on only alongside
a spend cap.
