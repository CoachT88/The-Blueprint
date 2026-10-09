-- ===========================================================================
-- The Blueprint — analytics_events, hardening on top of analytics.sql
--
-- READ THIS FIRST. This file does NOT create the table. `analytics.sql` in
-- this same directory already defines public.analytics_events, with its two
-- indexes, its RLS and its dashboard queries. Introducing a second CREATE for
-- the same table is how a project ends up with two files that disagree about
-- the same object.
--
-- The difference matters. analytics.sql declares:
--     id bigint generated always as identity primary key
-- A proposed replacement using `id uuid default gen_random_uuid()` would NOT
-- take effect if analytics.sql has ever been applied, because both are
-- `create table if not exists`: the second is a silent no-op and the table
-- keeps its bigint key while the newer file claims otherwise. Nothing warns
-- you. So:
--
--   STEP 1. Determine whether the table exists at all (section 0 below).
--   STEP 2. If it does NOT exist, run the Schema section of analytics.sql.
--           Not a minimal rewrite: that file also creates the two indexes
--           its own dashboard queries depend on, and the insert-only RLS.
--   STEP 3. Run this file to add the constraints and tighten the grants.
--
-- Everything here is idempotent and safe to re-run.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Does it exist, and what shape is it? Run this alone, first.
-- ---------------------------------------------------------------------------
select
    c.relname                                as table_name,
    a.attname                                as column_name,
    format_type(a.atttypid, a.atttypmod)     as data_type,
    a.attnotnull                             as not_null,
    pg_get_expr(d.adbin, d.adrelid)          as column_default
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
where n.nspname = 'public' and c.relname = 'analytics_events'
order by a.attnum;
-- Zero rows  => the table does not exist. Go run analytics.sql first.
-- Rows with id of type bigint => analytics.sql is already applied. Expected.
-- Rows with id of type uuid   => something else created it. STOP and reconcile
--                                before running anything below.


-- ---------------------------------------------------------------------------
-- 1. Constraints that match the CLIENT contract, verified against the code
--
--   event : track() does String(event).slice(0,60) and refuses a falsy event,
--           so the real range is 1 to 60. The bound below is 100, which is
--           deliberately looser than the client so a future event name cannot
--           be rejected by the database at 61 characters. It still blocks the
--           unbounded case.
--
--   props : _cleanProps() admits only finite numbers, booleans and strings of
--           40 characters or fewer, and always returns a plain object. It does
--           NOT bound the NUMBER of keys, which is the only way props can grow
--           without limit, so the size check is the one that earns its place.
--           4 KB is far above any event this app emits and far below a payload
--           that would matter.
-- ---------------------------------------------------------------------------

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'analytics_events_event_length') then
        alter table public.analytics_events
            add constraint analytics_events_event_length
            check (char_length(event) between 1 and 100);
    end if;

    if not exists (select 1 from pg_constraint where conname = 'analytics_events_props_object') then
        alter table public.analytics_events
            add constraint analytics_events_props_object
            check (jsonb_typeof(props) = 'object');
    end if;

    if not exists (select 1 from pg_constraint where conname = 'analytics_events_props_size') then
        alter table public.analytics_events
            add constraint analytics_events_props_size
            check (pg_column_size(props) <= 4096);
    end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Grants
--
-- The client calls .insert(batch) and never .select() after it: verified at
-- app/index.html, flushAnalytics() and _flushAnalyticsFor(). So INSERT is the
-- only privilege any member needs, and withholding SELECT is not a limitation
-- the app has to work around.
--
-- analytics.sql already enables RLS and creates an insert-own-only policy with
-- no select, update or delete policy, which denies those commands outright.
-- This section removes the broad table grants that a default Supabase project
-- hands to anon and authenticated, so the policy is not the only thing
-- standing between a member and the whole table.
-- ---------------------------------------------------------------------------

revoke all on public.analytics_events from anon;
revoke all on public.analytics_events from authenticated;
grant insert on public.analytics_events to authenticated;

-- The identity sequence needs no grant: `generated always as identity` is
-- assigned server side and the client never supplies id.


-- ---------------------------------------------------------------------------
-- 3. Checks, read-only
-- ---------------------------------------------------------------------------

-- RLS on, and exactly one policy: insert, to authenticated, own rows only.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename = 'analytics_events';

select policyname, cmd, roles, qual, with_check from pg_policies
where schemaname = 'public' and tablename = 'analytics_events'
order by policyname;

-- Expect: anon false for every privilege, authenticated true for INSERT only.
select
    has_table_privilege('anon',          'public.analytics_events', 'select') as anon_select,
    has_table_privilege('anon',          'public.analytics_events', 'insert') as anon_insert,
    has_table_privilege('authenticated', 'public.analytics_events', 'select') as auth_select,
    has_table_privilege('authenticated', 'public.analytics_events', 'insert') as auth_insert,
    has_table_privilege('authenticated', 'public.analytics_events', 'update') as auth_update,
    has_table_privilege('authenticated', 'public.analytics_events', 'delete') as auth_delete;

-- The three constraints.
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.analytics_events'::regclass and contype = 'c'
order by conname;

-- Size and retention. There is no cleanup job: analytics.sql carries a
-- commented-out 12 month delete and nothing schedules it. Decide explicitly.
select
    count(*)                            as event_count,
    max(pg_column_size(props))          as max_props_bytes,
    min(created_at)                     as oldest_event,
    max(created_at)                     as newest_event
from public.analytics_events;


-- ---------------------------------------------------------------------------
-- 4. OPEN DECISION, not a check: created_at is supplied by the CLIENT
--
-- track() builds each row with `created_at: new Date().toISOString()`, so the
-- column default never applies and a skewed device clock reaches the database
-- directly. The buffer also persists offline, so a row can be inserted days
-- after the moment it describes.
--
-- Those two facts pull in opposite directions, which is why this is a decision
-- and not a fix:
--
--   Keep the client value       event time is right for offline events, but a
--                               wrong clock is stored verbatim.
--   Drop it, use the default    always trustworthy, but an offline event is
--                               stamped when it finally flushed, not when it
--                               happened.
--
-- The option that loses nothing is to keep the client's value as its claim and
-- add a server stamp beside it:
--
--   alter table public.analytics_events
--       add column if not exists received_at timestamptz not null default now();
--
-- One nullable-free column, no client change, no data loss, and every query
-- that needs a timestamp it can trust has one. Left commented because adding
-- it is your call, not a migration this file should make silently.
-- ---------------------------------------------------------------------------
