# Staging buyer-journey setup (nothing here is applied yet)

Purpose: let the staging project (ref `ynxuglvthghsdzzhabso`) test the real
entitlement-claim path and the full experience across all four goals, with the
purchase simulated. **Staging only. Production already has all of this and is
never touched.** Production schema is used as a reference only: no rows, payment
records or credentials are copied. No change to project-wide email-confirmation
settings is needed: the existing confirmed test account is reused.

## Files, in order

| File | Does | Writes |
|---|---|---|
| `01-setup.sql` | identity check, marker + base `members` (`created_at` nullable, default `now()`) + the production ledger migration verbatim | schema only |
| `02-verify.sql` | Part A structure checks (read-only). Part B claim matrix, always rolls back | nothing persists |
| `03-simulate-purchase.sql` | one `simulated` purchase, event and unclaimed `members` row for the single confirmed test user | 3 rows |
| `99a-rollback-simulation.sql` | removes exactly what 03 wrote | deletes |
| `99b-rollback-everything.sql` | drops everything 01 added | drops |

## Is this really staging? (identity, and its limit)

A marker table alone proves nothing, and Postgres cannot report a Supabase
project ref (`current_database()` is `postgres` on every project). So:

**In the database.** 01 will not run until the owner pastes the disposable test
account's user id (from the STAGING dashboard: Authentication > Users) over the
zero UUID in `01-setup.sql`. It then refuses unless a confirmed auth user with
that id exists, refuses a project with more than 25 auth users, and refuses an
unmarked project that already has `purchases` (production's shape). The id is
stored in the marker; 02, 03, 99a and 99b re-check that the same account still
exists and the same user cap, and 03 uses only that account's address. Pasting
into production fails at the first check, before anything is created, because
production has no such user.

**What the database cannot prove.** It cannot detect that the test user was
also created in production, or tell two staging-like projects apart. That
boundary is held by procedure:

Before you run (owner):
1. Open the SQL editor from the project whose URL contains `ynxuglvthghsdzzhabso`
   and confirm that ref in the browser address bar and Project Settings.
2. Copy the test account's id from that same project's Users page.
3. Paste it into the one marked line of `01-setup.sql`. Do not commit the edited file.
4. Never run 01 from a production tab. If anything in the checks above disagrees, stop.

Other guards: 03 and the rollbacks refuse without the marker; 99b refuses if
any purchase is not `simulated`. Each file runs as one SQL-editor batch, so a
refusal changes nothing.

## Run (after approval)

1. Do the "Before you run" steps, then run `01-setup.sql`.
2. Run `02-verify.sql` Part A (every row `true`), then Part B on its own: the
   expected result is an error reading `MATRIX PASS: 17 checks (rolled back…)`.
   That error is the report and the rollback. `MATRIX FAIL` lists each failed check.
3. Run `03-simulate-purchase.sql`. Expect one row: `unclaimed = true, active = true, paid_purchases = 1`.

Re-running any file is safe.

## What the matrix proves (against the production functions as shipped)

No session returns false · unconfirmed email never claims · confirmed user with
no purchase gets nothing · case differences and padding still match · claim
stamps `claimed_at` and is idempotent · a second account on an attached address
cannot take it · a revoked membership cannot be claimed and is claimable again
after `restore_if_paid` · `revoke_if_unpaid` returns `kept_paid`, `kept_legacy`,
`no_member`, `revoked` correctly · anon/authenticated have no table access;
`claim_membership` is executable by `authenticated` only.

Local proof (no real database): `tests/sql/run.sh` runs these files on a
throwaway PostgreSQL with a stub of `auth` (29 checks, including a mutant
claim function that the matrix must, and does, fail).

## Rollback

- Undo only the simulation: `99a-rollback-simulation.sql`.
- Return staging to before this package: `99a` then `99b`.
- Neither touches `auth.users`, `user_data`, or production.

## Focused test plan (after 03; fresh token via the secure credential form)

Real app, bridged to staging only, fixed Sunday clock, EQ flag flipped in-page only.

1. **Claim path.** Sign in as the test account → `claim_membership()` returns true,
   `members.user_id` = the account, `claimed_at` set; app unlocks. Sign out/in: still true.
2. **Refund path (service role / SQL editor).** `revoke_if_unpaid(email)` → `kept_paid`
   while the simulated purchase is paid; mark it `refunded`, call again → `revoked`;
   sign in → no access, `user_data` untouched; `restore_if_paid` + sign in → access back, history intact.
3. **Size, Stamina, All of It.** For each goal: set the goal, walk Sunday/Wednesday/Friday,
   complete a session, confirm the Today card, week strip, progression and sync-guard rev advance with no conflict banner.
4. **Erection Quality.** With the flag flipped in-page: three 3-step sessions
   (breathing, Pelvic Floor Release, one mobility), supporting-day practice, full rest
   on days 2 and 6, pain pauses the release. The "no Length/Girth" assertion is expected
   to fail against the shipped flag (old EQ preset, #184) and is re-run after real activation.
5. **Cross-goal switch.** Size → Stamina → EQ → All of It keeps history and does not duplicate practice.
6. Clean up: `99a`; owner deletes the saved staging token and `STAGING_ANON_KEY`.

Out of scope here: the Stripe webhook leg (evaluated separately), production
migrations, and EQ activation. `EQ_SESSIONS_ENABLED` stays `false`.
