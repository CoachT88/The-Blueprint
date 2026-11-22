# Acceptance runs against a staging project

These are not part of `npm test` or `npm run test:e2e`. They need a Supabase **staging** project, so they run
when someone chooses to run them, never in CI, and never against production.

| File | What it is |
|---|---|
| `beginner-acceptance.mjs` | The focused Beginner acceptance run: the app in this checkout, in a real browser, against staging. |
| `fake-supabase.mjs` | A local stand-in for the Supabase endpoints the app uses, so the script itself can be checked without staging. |

## `beginner-acceptance.mjs`

### What it answers

With the staging column default for `user_data.difficulty` still `'intermediate'` (the old default):

1. A fresh signup-state row starts at Beginner. The app layer does this on its own (`src/startingTier.js`); the
   database still says Intermediate.
2. The first mechanical session uses Beginner dosing (3 rounds, 60 s and 30 s) and awards 10 XP.
3. Explicitly selecting Intermediate still works, and a stale device cannot overwrite that choice.
4. Membership claiming, progress persistence and cross-device recovery stay correct, on the real revision guard.

It drives three devices (separate browser contexts) for one test member. Device A does onboarding, the first
session and the tier choice. Device B signs in early, goes stale, then recovers. Device C is a fresh sign-in.
Device A then signs out and back in.

### Before you run it

All of this is the project owner's to set up; the script sets up none of it.

1. A Supabase **staging** project with the app's schema, the revision guard in soft mode
   (`supabase/revision-guard.sql`) and `claim_membership()`. Never production.
2. One throwaway test member on that project, with a membership that `claim_membership()` will accept on the
   member's first sign-in (the run asserts that the database answers `true`).
3. That member's `user_data` row in signup state: revision 0, difficulty `'intermediate'`, and every column in
   `MARKER_COLUMNS` (`src/startingTier.js`) blank. The script checks this first and stops (exit 4) if it is not so.
   Putting the account back into that state after a run is a deliberate, owner-run reset. This directory does
   not contain one.
4. That member's current access token. It is short-lived, so take it just before the run.
5. A clean checkout of the commit to test: `git status` must show nothing, or the script stops (exit 7).
6. `npm ci`, and a Chromium: `npx playwright install chromium`, or `PW_CHROMIUM_PATH=/path/to/chromium` as in
   `tests/e2e/README.md`.

### Run it

Read the token without echoing it, so it never lands in shell history or a file:

```bash
read -rs STAGING_USER_JWT && export STAGING_USER_JWT
```

Then:

```bash
STAGING_URL=https://<project-ref>.supabase.co \
STAGING_ANON_KEY=<staging anon key> \
STAGING_USER_ID=<test member uuid> \
node tests/acceptance/beginner-acceptance.mjs
```

If something in front of the script injects the real token (a credential proxy), set `STAGING_USER_JWT` to any
placeholder. The script sends it as the bearer token and the proxy replaces it.

Check the script without a staging project. This uses `fake-supabase.mjs`, checks the script and not the app's
behaviour on a real database, and is never an acceptance result:

```bash
FAKE=1 node tests/acceptance/beginner-acceptance.mjs
```

### Configuration

The four `STAGING_*` names are the ones `tools/staging-check.mjs` uses.

| Variable | Required | Meaning |
|---|---|---|
| `STAGING_URL` | yes | `https://<project-ref>.supabase.co`, the staging project. |
| `STAGING_ANON_KEY` | yes | The staging anon (publishable) key. |
| `STAGING_USER_ID` | yes | The test member's uuid. The run stops unless the token belongs to this member. |
| `STAGING_USER_JWT` | yes | That member's access token. Held in memory; never printed or saved. |
| `EXPECT_SHA` | no | Stop unless `HEAD` is this commit. |
| `LIVE_SITE` | no | Site whose bytes the app file is compared with. Default `https://theblueprint.site`; `off` skips it. |
| `SUPABASE_JS_UMD_FILE` | no | A local copy of the supabase-js bundle the app loads. Without it, the bundle is fetched once from the URL the app names. To get a local copy, `npm pack` that version; the file is `package/dist/umd/supabase.js`. |
| `ACCEPTANCE_OUT_DIR` | no | Where the result JSON goes. Default: a new private temp directory. |
| `PW_CHROMIUM_PATH` | no | A Chromium binary (see `tests/e2e/harness.js`). |
| `NODE_USE_ENV_PROXY=1` | no | Only when this machine reaches the network through an `HTTPS_PROXY`, on a Node version that supports it. |

`FAKE=1` needs none of the `STAGING_*` variables.

### What it does and does not do

- Every request the page makes to the Supabase host compiled into the app (production's) is intercepted and
  answered from `STAGING_URL`. None reaches production. The host is read from `app/index.html`, and the script
  refuses to start (exit 8) if `STAGING_URL` names it.
- Every other host is blocked. The one exception is the supabase-js bundle, served from `SUPABASE_JS_UMD_FILE`
  or fetched once from the URL the app names.
- Auth writes (sign-out, token refresh, user update) are answered locally, so the run cannot revoke the test
  member's sessions or change their profile.
- The membership answer is whatever the staging database returns from `claim_membership()`. Nothing is
  synthesised.
- What reaches staging is what the app itself sends for that member: the `user_data` row, the membership claim
  and, where those tables exist, analytics events and push-subscription updates.
- The page is served exactly as it is on disk. EQ stays off: `EQ_SESSIONS_ENABLED` is asserted `false`, and the
  app file is asserted unmodified at the end.
- It stops unless the token belongs to `STAGING_USER_ID` (exit 5). Member ids are masked in the output.

### Reading the result

The run prints nine sections, `0` (the reset, and the page under test) to `8` (overall health), then a summary.

| Exit code | Meaning |
|---|---|
| 0 | Every check passed. |
| 1 | A check failed, or the run stopped part-way. |
| 2 | Missing configuration, or the supabase-js bundle could not be fetched. |
| 3 | The token was rejected. |
| 4 | The row is not a signup-state row with the old default. |
| 5 | The token is not `STAGING_USER_ID`'s. |
| 6 | `HEAD` is not `EXPECT_SHA`. |
| 7 | The working tree is not clean. |
| 8 | `STAGING_URL` is the app's production host. |

The last line printed is `result file: <path>`. It holds counts, check names, the write log and the first 120
characters of each non-2xx answer.

### After a run

The member now holds test data: two sessions, 20 XP, a goal, plans and an explicit Intermediate. Running again
needs the account back in signup state; the script stops (exit 4) otherwise.

Once the database default has been changed to Beginner, the script stops at that same check, because it requires
the old default. That is intended: it answers the question for the app layer *before* the migration.

### Known behaviour: issue 214

On real staging the app also saves when a device only signs in or reloads. Each of those saves advances the row's
revision, so another open device's next save is refused once (HTTP 409) and then recovered. Nothing was lost in the
run that showed this, but it is why the checks accept refusals of stale writes, and require that nothing else is
refused. Issue 214 records the evidence and how to investigate it. When it is fixed, tighten the checks: expect no
refusal before device B's stale save, and no write on a reload.

### What stays out of the repository

Tokens, keys, member ids or emails, project URLs and raw run output (console logs, result files). The script keeps
them out of its source and masks ids in its output. Read the result file before sharing it, and do not commit it.

### Status

The checks pass against the stand-in. They were also checked offline against the write log of the one real staging
run (app at `8682356`). They have not been run live on staging since they were corrected.

## `fake-supabase.mjs`

A local stand-in for the Supabase endpoints the app uses. The signup row carries the old column default and the
real `diff_unlocked_date` default. Writes follow the revision guard in soft mode: a write naming a stale `base_rev`
is refused with HTTP 409, one naming none is accepted, and every accepted write advances `rev`. `claim_membership()`
always answers `true`.

It does not model Postgres `jsonb` (rows are plain JSON, so object key order is kept exactly as sent), row-level
security, real latency, or the real guard's triggers. Those gaps matter for issue 214: the stand-in did not
reproduce two of the three saves-on-open that real staging showed.
