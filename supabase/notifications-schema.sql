-- ===========================================================================
-- The Blueprint — PART A: notification schema
--
-- SAFE TO RUN NOW. This creates and repairs tables only. It schedules nothing,
-- sends nothing, and reads no secrets. Running it cannot cause a notification.
--
-- The cron and the Vault secrets are deliberately in a separate file,
-- supabase/notifications-cron.sql, so that neither can be started by pasting
-- this one in full.
--
-- WHY THIS EXISTS AS ITS OWN FILE
--
-- The sender selects last_notified_date from push_subscriptions. That column
-- is created here, and until this runs the query fails with
--
--     42703  column push_subscriptions.last_notified_date does not exist
--
-- which the function reported as read_failed, an error that points at row
-- level security rather than at a missing column. The schema has to exist
-- before the function can work, and it was previously bundled with the cron
-- setup, so there was no way to apply one without the other.
--
-- Every statement is idempotent. Running it twice changes nothing.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The table
--
-- Created only if it is missing. On an existing table this is a no-op and the
-- column statements below do the work instead, so this file is correct whether
-- the table was never created or merely lacks a column.
--
-- The shape matches exactly what the code reads and writes:
--   app/index.html  _savePushSubscription()  writes every column but the date
--   send-notifications                       reads all of them, writes the date
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
    user_id            uuid primary key references auth.users(id) on delete cascade,
    endpoint           text        not null,
    p256dh             text        not null,
    auth               text        not null,
    reminder_time      text        not null default '19:00',
    streak_warn        boolean     not null default true,
    timezone           text,
    last_notified_date date,
    updated_at         timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 2. Columns, for a table that already exists without them
--
-- last_notified_date is the one that matters today: it is what the sender
-- selects and what caps delivery at one per member per day. The rest are
-- listed so a table created before any of them cannot fail the same way.
-- ---------------------------------------------------------------------------

alter table public.push_subscriptions add column if not exists endpoint           text;
alter table public.push_subscriptions add column if not exists p256dh             text;
alter table public.push_subscriptions add column if not exists auth               text;
alter table public.push_subscriptions add column if not exists reminder_time      text;
alter table public.push_subscriptions add column if not exists streak_warn        boolean;
alter table public.push_subscriptions add column if not exists timezone           text;
alter table public.push_subscriptions add column if not exists last_notified_date date;
alter table public.push_subscriptions add column if not exists updated_at         timestamptz;


-- ---------------------------------------------------------------------------
-- 3. Index
--
-- The hourly run reads every subscription in user_id order.
-- ---------------------------------------------------------------------------

create index if not exists push_subscriptions_user_idx
    on public.push_subscriptions (user_id);


-- ---------------------------------------------------------------------------
-- 4. Row level security
--
-- A member may manage only their own subscription. The sender uses a secret
-- key, which bypasses RLS entirely, so these policies do not affect it.
--
-- Enabling RLS on a table that has none is a real change in behaviour, so it
-- is left commented. Check section 5 first: if RLS is already enabled with
-- working policies, skip this. If it is disabled, this is what it should be.
--
-- alter table public.push_subscriptions enable row level security;
--
-- drop policy if exists "members manage own subscription" on public.push_subscriptions;
-- create policy "members manage own subscription"
--     on public.push_subscriptions
--     for all
--     to authenticated
--     using (auth.uid() = user_id)
--     with check (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 5. Checks — read-only, run these after the above
-- ---------------------------------------------------------------------------

-- Every column the sender touches must appear here.
-- Expect: user_id, endpoint, p256dh, auth, reminder_time, streak_warn,
--         timezone, last_notified_date, updated_at
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'push_subscriptions'
order by ordinal_position;

-- Is RLS on, and what policies exist?
select relrowsecurity as rls_enabled
from pg_class where oid = 'public.push_subscriptions'::regclass;

select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'push_subscriptions';

-- How many members could receive anything at all. Zero is expected until
-- someone enables reminders on a device, and is not a fault.
select count(*) as subscriptions,
       count(*) filter (where streak_warn) as want_streak_warnings,
       count(*) filter (where last_notified_date = current_date) as notified_today
from public.push_subscriptions;


-- ===========================================================================
-- After this file runs, re-run the smoke test. Expect HTTP 200 and
--
--     {"checked":0,"dropped":0,"rejected":0,"sent":0,"keySource":"..."}
--
-- checked:0 with no error is a pass: it means the table is readable and empty.
--
-- Only once that passes should supabase/notifications-cron.sql be considered,
-- and it schedules the job, so it is the last thing to run.
-- ===========================================================================
