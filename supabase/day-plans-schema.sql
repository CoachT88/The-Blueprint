-- ===========================================================================
-- The Blueprint, Phase 3S.1 (PR B): day-plan storage schema
--
-- Run this by hand in the Supabase SQL editor. It is the whole migration.
--
-- Two nullable columns on public.user_data. No table is created, no column is
-- altered, no data is rewritten, nothing is dropped. Every statement is
-- idempotent: running this twice changes nothing the second time.
--
-- WHAT WAS VERIFIED, AND WHEN
--
-- The column inventory below was confirmed in the dashboard at Phase 2B.1 and
-- is carried forward here, not re-confirmed:
--
--   session_log            jsonb,   nullable YES,  default '[]'
--   schedule               jsonb,   nullable YES
--   completed_days         jsonb,   nullable YES
--   diff_unlocked_date     jsonb,   nullable YES
--   difficulty             text,    nullable YES,  default 'intermediate'
--   first_session_date     text,    nullable YES,  default ''
--   all_time_session_count integer, nullable YES,  default 0
--   progression_ledger     jsonb,   nullable YES,  default '[]'  (added 2B.1)
--   programme_start_date   date,    nullable YES,  no default     (added 2B.1)
--   triggers on public.user_data: NONE
--
-- Section 3 re-asserts the parts that matter after this file runs. If the
-- trigger check in section 3 returns any row, stop: something has changed
-- since 2B.1 that this file was not written against.
--
-- The house style is: nullable, with a default only where a non-null zero
-- value is meaningful. Both columns below follow it.
--
-- DEPLOY ORDER IS FREE
--
-- The application carries a two-tier unknown-column fallback. A deploy that
-- lands before this file has been run drops only `programme` and `day_plans`
-- from the upsert and keeps writing everything else, including
-- progression_ledger. Running this first costs nothing; running it second
-- costs one extra upsert round trip per browser runtime, after which the two
-- columns begin persisting from the next page load. Nothing is lost either
-- way: both fields are in the localStorage backup throughout, and no code in
-- this phase reads them.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. programme
--
-- The member's current programme: which track they are on and at what
-- version. One object, not a history.
--
-- NULLABLE WITH NO DEFAULT, for the same reason programme_start_date has no
-- default. Three states have to stay distinguishable:
--
--   null                     no programme has ever been generated
--   an object                a programme exists
--   an object, but empty     a programme exists and says nothing
--
-- A default of '{}'::jsonb would collapse the first into the third, and the
-- first is the state every existing row is in on the day this runs. The
-- application reads absence as null and treats it as "nothing generated
-- yet", which is true and is the only honest reading.
--
-- NOTHING IS BACKFILLED. No row gets a programme from this file. Inferring
-- one from an existing schedule is a separate, reviewed migration (PR D),
-- precisely because a hand-edited week must not be silently reinterpreted as
-- a preset the member never chose.
--
-- The shape is deliberately not constrained here. jsonb enforces nothing and
-- is not asked to: the application validates on read, and this phase stores
-- the column without interpreting it.
-- ---------------------------------------------------------------------------

alter table public.user_data
    add column if not exists programme jsonb;


-- ---------------------------------------------------------------------------
-- 2. day_plans
--
-- Dated plans, one per date, oldest first. See src/dayPlan.js for the record
-- shape and for what makes one valid.
--
--   [
--     {
--       "date": "2026-10-05",
--       "mode": "prescribed",
--       "status": "pending",
--       "primarySession": { ... },
--       "supportingWork": [ ... ],
--       "dailyPractice":  [ ... ],
--       "generatedFrom": { "programmeKey": "...", "version": 1 }
--     }
--   ]
--
-- default '[]'::jsonb, matching session_log and progression_ledger. An empty
-- list is a real and correct state: every member, including long-tenured
-- ones, is in it the moment this runs.
--
-- NO HISTORICAL BACKFILL, and this is a migration invariant rather than a
-- convenience. For a date before day plans existed the honest value is
-- absent. A past week is never re-derived from a model that did not exist
-- when it elapsed, and progression_ledger.targetSessions stays the
-- historical truth for every week already recorded.
--
-- jsonb enforces no shape. Unlike progression_ledger, this phase does not
-- normalise the records on read either: it guarantees the container is an
-- array and carries the contents through untouched. Dropping a record this
-- build cannot parse would persist the loss on the next save, and the reader
-- that can parse it arrives in a later phase.
--
-- NO SIZE BOUND YET. session_log and measurements are trimmed to a byte
-- budget because the application appends to them on a schedule. Nothing
-- writes day plans in this phase, so the bound belongs with the generator,
-- where the natural size of a plan is known. Until then the existing 2 MB
-- import cap is the only ceiling.
-- ---------------------------------------------------------------------------

alter table public.user_data
    add column if not exists day_plans jsonb default '[]'::jsonb;


-- ---------------------------------------------------------------------------
-- 3. Checks, read-only. Run these after the above.
-- ---------------------------------------------------------------------------

-- Expect exactly two rows:
--   day_plans  jsonb  YES  '[]'::jsonb
--   programme  jsonb  YES  (null default)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'user_data'
  and column_name in ('programme', 'day_plans')
order by column_name;

-- Still no triggers. Adding a column should not have created one, and this
-- also re-asserts the 2B.1 finding against today's table. Expect 0 rows.
select tgname
from pg_trigger
where tgrelid = 'public.user_data'::regclass
  and not tgisinternal;

-- Nobody should have a programme yet: it is written by the application, never
-- by this migration and never by a backfill. Expect 0.
select count(*) as rows_with_programme
from public.user_data
where programme is not null;

-- Every existing row should now hold an empty plan list, not null, because of
-- the default. Expect null_plans = 0 and empty_plans = total_rows.
select count(*) filter (where day_plans is null)         as null_plans,
       count(*) filter (where day_plans = '[]'::jsonb)   as empty_plans,
       count(*)                                          as total_rows
from public.user_data;


-- ===========================================================================
-- ROLLBACK
--
-- Safe at any point in this phase. Neither column is read by any code that
-- predates it, nothing in the application branches on either one, and no
-- existing column is modified by this file, so dropping them returns the
-- table to exactly its current shape.
--
-- What is lost: nothing, while this phase is the current one. No programme is
-- generated and no plan is written until PR C, so both columns hold only
-- their defaults. Once generation lands, a rollback costs every member their
-- current programme and every stored plan, and the cost grows from there.
--
--   alter table public.user_data drop column if exists day_plans;
--   alter table public.user_data drop column if exists programme;
--
-- ===========================================================================
