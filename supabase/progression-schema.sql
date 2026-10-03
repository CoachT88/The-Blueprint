-- ===========================================================================
-- The Blueprint — Phase 2B.1: progression schema
--
-- Run this by hand in the Supabase SQL editor. It is the whole migration.
--
-- Two nullable columns on public.user_data. No table is created, no column is
-- altered, no data is rewritten, nothing is dropped. Every statement is
-- idempotent: running this twice changes nothing the second time.
--
-- WRITTEN AGAINST VERIFIED PRODUCTION FACTS
--
-- Confirmed in the dashboard before this file was written:
--   session_log            jsonb,   nullable YES,  default '[]'
--   schedule               jsonb,   nullable YES
--   completed_days         jsonb,   nullable YES
--   diff_unlocked_date     jsonb,   nullable YES
--   difficulty             text,    nullable YES,  default 'intermediate'
--   first_session_date     text,    nullable YES,  default ''
--   all_time_session_count integer, nullable YES,  default 0
--   triggers on public.user_data: NONE (no rows from pg_trigger)
--
-- So the house style is: nullable, with a default only where a non-null
-- zero value is meaningful. Both columns below follow it.
--
-- WHY THESE TWO COLUMNS AND NOT A TABLE
--
-- The app reads one row with one .single() call and writes it back with one
-- debounced upsert, mirrored to localStorage. A second table would mean a
-- second read on every load, a second write path that can fail
-- independently of the first, a new RLS policy surface, and a partial-write
-- failure mode that does not exist today. The ledger is at most 26 rows of
-- four small fields per member. It belongs in the row.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. programme_start_date
--
-- When this member's programme actually began.
--
-- NULLABLE WITH NO DEFAULT, and the absence of a default is the point. Three
-- states have to be distinguishable and a default would collapse two of them:
--
--   null  + all_time_session_count = 0   never started
--   null  + all_time_session_count > 0   established, start date unknowable
--   a date                               established, start date known
--
-- The middle state is the one that matters. session_log is pruned
-- oldest-first at 300 KB, so a long-tenured member's earliest sessions may be
-- gone. Inventing a date for them would reset them to week one of a
-- programme they have been running for a year. Null-with-history says
-- "established, we cannot date it", which is true, and no second column is
-- needed to express it.
--
-- `date` rather than `text`: this is a real calendar date and should sort and
-- compare as one. first_session_date is text, but it is a legacy field that
-- stores an ISO timestamp recorded by a UI tap, and is not the pattern to
-- copy.
-- ---------------------------------------------------------------------------

alter table public.user_data
    add column if not exists programme_start_date date;


-- ---------------------------------------------------------------------------
-- 2. progression_ledger
--
-- One record per week, written while that week is the current week.
--
--   [
--     {
--       "weekKey": "2025_w14",
--       "targetSessions": 4,
--       "qualifyingSessions": 3,
--       "verdict": "qualified"
--     }
--   ]
--
-- verdict is one of qualified | missed | neutral | unknown. All four consume
-- a chronological slot in the rolling window; only `qualified` earns
-- progression credit, and only `missed` may ever produce member-facing
-- missed-week language.
--
-- Oldest first, bounded to 26 entries by the application (see
-- src/progressionPolicy.js ledgerMaxWeeks). At roughly 80 bytes an entry
-- that is about 2 KB fully grown.
--
-- jsonb enforces no shape, so everything read back goes through
-- normaliseLedger() in src/progressionLedger.js before it is trusted.
-- Anything unparseable becomes `unknown`, which takes its slot and earns
-- nothing. The database is not asked to validate this.
--
-- WHY IT EXISTS AT ALL. Progression needs to know how many sessions were
-- SCHEDULED in a past week. Nothing stores that. The rejected alternative
-- was to apply the member's current schedule backwards, which would silently
-- re-judge every past week of anyone who ever changed their schedule. The
-- target is therefore written down while it is still true and never
-- recomputed.
--
-- There is deliberately no cumulative deload column. The stale rule bounds
-- how long a deload cycle can run, so the counter is always recomputable
-- from the retained weeks; see requiredLedgerWeeks().
--
-- default '[]'::jsonb, matching session_log. An empty ledger is a real and
-- correct state: every member, including long-tenured ones, starts with one
-- at launch. No synthetic history is written by this migration or by any
-- backfill.
-- ---------------------------------------------------------------------------

alter table public.user_data
    add column if not exists progression_ledger jsonb default '[]'::jsonb;


-- ---------------------------------------------------------------------------
-- 3. Checks — read-only, run these after the above
-- ---------------------------------------------------------------------------

-- Expect exactly two rows:
--   programme_start_date  date   YES  (null default)
--   progression_ledger    jsonb  YES  '[]'::jsonb
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'user_data'
  and column_name in ('programme_start_date', 'progression_ledger')
order by column_name;

-- Still no triggers. Adding a column should not have created one, but the
-- original audit asserted none and this re-asserts it.
select tgname
from pg_trigger
where tgrelid = 'public.user_data'::regclass
  and not tgisinternal;

-- Nobody should have a start date yet: it is written by the app on the first
-- completed qualifying session, never by this migration. Expect 0.
select count(*) as rows_with_start_date
from public.user_data
where programme_start_date is not null;

-- Every existing row should now hold an empty ledger, not null, because of
-- the default. Expect null_ledgers = 0.
select count(*) filter (where progression_ledger is null)     as null_ledgers,
       count(*) filter (where progression_ledger = '[]'::jsonb) as empty_ledgers,
       count(*)                                                as total_rows
from public.user_data;


-- ===========================================================================
-- ROLLBACK
--
-- Safe at any point. Neither column is read by any code that predates this
-- phase, and no existing column is modified by this file, so dropping them
-- returns the table to exactly its current shape.
--
-- What is lost: any programme_start_date and any ledger weeks accumulated
-- since the migration. Both are derived and re-accumulate, though ledger
-- history restarts from the rollback date, which costs members their
-- progress toward the 4-of-8 gate. That is the real cost of a rollback and
-- it grows the longer the columns have been live.
--
--   alter table public.user_data drop column if exists progression_ledger;
--   alter table public.user_data drop column if exists programme_start_date;
--
-- ===========================================================================
