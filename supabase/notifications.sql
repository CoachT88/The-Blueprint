-- ===========================================================================
-- The Blueprint — training reminders
--
-- The send-notifications edge function decides who to notify and sends the
-- push. This file gives it the one column it needs and the schedule that runs
-- it. Nothing here reads or writes member progress.
--
-- SETUP: run the "Schema" and "Schedule" sections once, in order, in the
--        Supabase SQL editor. Deploy the function first, and set CRON_SECRET,
--        VAPID_SUBJECT, VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in the project's
--        Edge Function secrets, or every run will return 401 and send nothing.
-- USE:   the "Checks" section is for looking at afterwards.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Schema  (run once)
-- ---------------------------------------------------------------------------

-- The member's own local date on which they were last notified. The function
-- refuses to send twice against the same value, which is what caps delivery at
-- one a day. A date rather than a timestamp because that is the entire
-- question being asked of it.
alter table public.push_subscriptions
    add column if not exists last_notified_date date;

-- The hourly run reads every subscription in user_id order, so give it an index
-- rather than a sort.
create index if not exists push_subscriptions_user_idx
    on public.push_subscriptions (user_id);


-- ---------------------------------------------------------------------------
-- Schedule  (run once)
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Hourly on the hour. Every member's chosen reminder time falls inside some
-- hour, and the function skips everyone whose hour it is not, so this single
-- schedule covers every timezone including the half-hour ones.
--
-- Replace both placeholders before running:
--   <PROJECT-REF>   the project ref from the Supabase dashboard URL
--   <CRON-SECRET>   the same value set as the CRON_SECRET function secret
--
-- The secret is what stops anyone who finds the URL from firing a notification
-- at every member of the app.

select cron.unschedule('send-training-reminders')
    where exists (select 1 from cron.job where jobname = 'send-training-reminders');

select cron.schedule(
    'send-training-reminders',
    '0 * * * *',
    $$
    select net.http_post(
        url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/send-notifications',
        headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer <CRON-SECRET>'
        ),
        body        := '{}'::jsonb,
        timeout_milliseconds := 55000
    );
    $$
);


-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------

-- 1. Is the schedule live, and did it run?
select jobid, jobname, schedule, active from cron.job where jobname = 'send-training-reminders';

select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'send-training-reminders')
order by start_time desc
limit 20;


-- 2. What did the function actually reply? A 401 here means the secret does not
--    match; a 200 body of {"checked":N,"sent":0,...} at every hour of the day
--    means it is running but nobody's reminder hour is being matched.
select id, status_code, content, created
from net._http_response
order by created desc
limit 20;


-- 3. How many members could receive anything at all.
select count(*) as subscriptions,
       count(*) filter (where streak_warn) as want_streak_warnings,
       count(*) filter (where last_notified_date = current_date) as notified_today
from public.push_subscriptions;


-- 4. When members have asked to be reminded, and from where. Sanity check that
--    timezone is being stored and is not all UTC, which would mean the client
--    is not sending it.
select coalesce(timezone, '(none)') as timezone,
       reminder_time,
       count(*) as members
from public.push_subscriptions
group by 1, 2
order by members desc;


-- 5. Anyone whose stamp is stale by more than a couple of days is either not
--    being reached or is training every day. Worth a look if the list is long.
select user_id, timezone, reminder_time, last_notified_date
from public.push_subscriptions
where last_notified_date is null
   or last_notified_date < current_date - 2
order by last_notified_date nulls first
limit 50;
