-- A new account starts at Beginner: the default for public.user_data.difficulty.
--
-- NOT YET APPLIED ANYWHERE. Staging first, then production, each on its own
-- explicit approval. Nothing in CI applies files in this directory.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- handle_new_user() creates a member's user_data row at signup and inserts only
-- the id (supabase/handle-new-user-hardening.sql). Every other column therefore
-- takes the column default, and the default for `difficulty` is 'intermediate'
-- (confirmed on staging and on production). The app read that default as a tier
-- the member had chosen, so a new buyer's first session ran at the full
-- Intermediate dose for 15 XP instead of Beginner's, and the tier was then
-- saved as if chosen. The app's own "no row, so a brand-new account, so
-- Beginner" branch never runs, because the row always exists by the time the
-- app asks.
--
-- The application now reads an untouched signup row at Beginner whatever this
-- column says (src/startingTier.js), so this change is not what makes the first
-- session correct. It makes the database say what the product says, so a new
-- row is Beginner at rest and nothing downstream has to infer it. It also
-- protects a new account opened in a tab still running the OLD version of the
-- app, which the application change cannot reach.
--
-- ---------------------------------------------------------------------------
-- WHAT IT DOES
--
--   alter table public.user_data alter column difficulty set default 'beginner';
--
-- A column default applies only to rows inserted AFTER it is set. It is a
-- catalog change: no row is read, rewritten, or locked beyond the instant the
-- catalog entry changes, and no table rewrite happens.
--
-- WHAT IT DOES NOT DO
--
--   * It does not change any existing row. The 24 production rows keep exactly
--     the tier they have: 2 beginner, 21 intermediate, 1 other. In particular
--     the 17 accounts that carry Intermediate with no completed sessions are
--     NOT touched, and nothing here decides anything from a session count. Their
--     tier is decided, if at all, by what the app has saved (src/startingTier.js
--     reads a row the app has never saved as new, and leaves every row it has
--     saved alone).
--   * It does not change handle_new_user(), the revision guard, any trigger,
--     any policy, any other column, or any other table.
--   * It does not make the column NOT NULL. The app has always read NULL as
--     Intermediate for old rows, and that reading is unchanged.
--
-- If handle_new_user() is ever changed to set `difficulty` itself, this default
-- is bypassed and that change owns the starting tier.
--
-- ---------------------------------------------------------------------------
-- THE GUARD
--
-- It refuses to run unless the column's current default is one of the three
-- states this change was written against: 'intermediate' (every database today),
-- no default, or 'beginner' (already applied). Anything else means the column
-- has changed since this was written, and the right response is to stop and
-- look, not to overwrite it. It is idempotent: running it again changes nothing.
--
-- ---------------------------------------------------------------------------
-- THE READ-ONLY CHECKS
--
-- supabase/checks/new-accounts-start-at-beginner.sql holds two read-only
-- queries (no row content, nothing written):
--   QUERY 1  what a brand-new account's row really holds, read from the column
--            definitions. Every marker column must read "blank". If any reads
--            NOT BLANK the application change would not recognise a new account
--            on that database, and the default here is the only protection.
--   QUERY 2  how many existing accounts the application would read as "never
--            begun" (and so start at Beginner on first open), including how
--            many of the 17 never-trained Intermediate accounts the app has
--            already saved.
--
-- ---------------------------------------------------------------------------
-- STAGING FIRST. Project ynxuglvthghsdzzhabso (the address bar must show it).
--
--   1. BEFORE. Keep the output of: the two queries under "VERIFY" below (the
--      default, expect 'intermediate'::text, and the tier counts) and QUERY 1
--      of the checks file (every marker column "blank").
--   2. THE APPLICATION LAYER ALONE, on the old default. Reset the staging test
--      account (acceptance-reset.sql re-inserts its row as (id) only), run
--      QUERY 2: untouched_rows_the_app_would_move must count it. Then run the
--      four-goal acceptance with the new build. The first mechanical session
--      must be Beginner (3 rounds, 60 s / 30 s, 10 XP) although the column
--      still says Intermediate. This proves the rule against a real signup row.
--   3. THE DATABASE LAYER. Run this whole file once in the SQL editor. It is
--      one transaction. Expect: the default reads 'beginner'::text, and the
--      tier counts are IDENTICAL to step 1 (no row changed).
--   4. Reset the test account again. Its row must now read difficulty
--      'beginner' at rest, with week_key empty and xp_migrated false; QUERY 2
--      must show it as untouched (untouched_rows_any_tier of at least 1) and
--      NOT as one the app would move (untouched_rows_the_app_would_move of 0).
--
-- PRODUCTION, only after staging has passed, each step on a separate approval.
--   a. Read-only first: the VERIFY queries and both checks. Report QUERY 2's
--      numbers before anything is deployed: of_which_never_saved__would_start_
--      at_beginner is how many existing accounts would start at Beginner when
--      next opened. They are accounts the app has never saved, so they have
--      not begun.
--   b. Deploy the application change.
--   c. Apply this file. Same before and after as staging step 3: the tier
--      counts must be identical.
--   b and c are unordered for correctness, but both are needed: only this
--   default protects a new account opened in a tab still running the old app.
--
-- ROLLBACK
--
--   alter table public.user_data alter column difficulty set default 'intermediate';
--
-- That restores the previous default for rows created from then on. It does not
-- and need not touch any row created while the new default was live: those are
-- Beginner, which is what a new account is meant to be.
--
-- ---------------------------------------------------------------------------
-- VERIFY (read-only; counts only, no email, no id)
--
--   select column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'user_data' and column_name = 'difficulty';
--
--   select coalesce(difficulty, '(null)') as difficulty, count(*) as accounts
--     from public.user_data
--    group by 1 order by 1;
-- ---------------------------------------------------------------------------

begin;

-- Do not queue behind a long transaction and block every read and write on the
-- table while waiting for the catalog lock. If it cannot get the lock quickly,
-- it stops and can be run again.
set local lock_timeout = '5s';

do $guard$
declare
    v_default text;
begin
    if to_regclass('public.user_data') is null then
        raise exception 'REFUSED: public.user_data does not exist.';
    end if;

    select c.column_default into v_default
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'user_data' and c.column_name = 'difficulty';

    if not found then
        raise exception 'REFUSED: public.user_data has no difficulty column.';
    end if;

    -- null is "no default"; the two others are exactly how Postgres prints a text default.
    if v_default is not null
       and v_default not in ('''intermediate''::text', '''beginner''::text') then
        raise exception 'REFUSED: public.user_data.difficulty has an unexpected default (%). Expected ''intermediate'', none, or ''beginner''. Review before changing it.', v_default;
    end if;
end
$guard$;

alter table public.user_data alter column difficulty set default 'beginner';

commit;
