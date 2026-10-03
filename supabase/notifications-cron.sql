-- ===========================================================================
-- The Blueprint — PARTS B and C: Vault secrets, and the schedule
--
-- DO NOT RUN THIS UNTIL THE SMOKE TEST PASSES.
--
-- Part A is supabase/notifications-schema.sql and must be applied first. It is
-- safe on its own: it creates tables and nothing else. This file is the one
-- that starts sending, so it comes last and only after a green smoke test:
--
--     curl -s -X POST https://<PROJECT-REF>.supabase.co/functions/v1/send-notifications \
--       -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
--       -H "x-cron-secret: <CRON_SECRET>"
--
--     expect {"checked":0,"dropped":0,"rejected":0,"sent":0,"keySource":"..."}
--
-- checked:0 with no error is a pass. An "error" field of any kind is not, and
-- scheduling on top of one means scheduling a failure to run hourly.
--
--   PART B  Vault secrets        safe, stores two values, sends nothing
--   PART C  cron.schedule        STARTS THE HOURLY JOB
--
-- Part B alone is harmless. Part C is the switch.
-- ===========================================================================


create extension if not exists pg_cron;
create extension if not exists pg_net;


-- ── The two credentials, stored in Vault ───────────────────────────────────
--
-- Invoking the function needs BOTH, in different headers:
--
--   Authorization: Bearer <project JWT>   Supabase's gateway checks this
--   x-cron-secret: <CRON_SECRET>          the function itself checks this
--
-- They used to share the Authorization header, which could never work: the
-- gateway reads it first and expects a JWT, so a random CRON_SECRET was
-- rejected with 401 and the function was never reached.
--
-- Use the ANON key for the gateway, not the service role key. The gateway
-- cannot tell them apart, the function never reads the value, and the anon key
-- is already public in the page source. The service role key bypasses row
-- level security, and cron.job stores its command as plain text in this
-- database, so putting it there would leave an RLS-bypassing key sitting in a
-- table in exchange for nothing.
--
-- The anon key is NOT what protects this endpoint. It satisfies the platform.
-- CRON_SECRET is the authentication.
--
-- Both values go in Vault so the schedule below holds only their names. Run
-- these two once, replacing the placeholders:

select vault.create_secret(
    '<CRON_SECRET>', 'bp_cron_secret',
    'x-cron-secret header for the send-notifications edge function');

select vault.create_secret(
    '<SUPABASE_ANON_KEY>', 'bp_anon_key',
    'Project anon key, used only to satisfy the Supabase gateway on pg_net calls');

-- Changing one later, without creating a duplicate:
-- select vault.update_secret(
--     (select id from vault.secrets where name = 'bp_cron_secret'), '<NEW_CRON_SECRET>');

-- Confirm they are readable. Shows names only, never values.
select name, created_at from vault.secrets where name in ('bp_cron_secret', 'bp_anon_key');


-- ── The schedule ───────────────────────────────────────────────────────────
--
-- Hourly on the hour. Every member's chosen reminder time falls inside some
-- hour, and the function skips everyone whose hour it is not, so this single
-- schedule covers every timezone including the half-hour ones.
--
-- Replace <PROJECT-REF> with the project ref from the Supabase dashboard URL.
-- The secrets are read from Vault at call time, so nothing sensitive is stored
-- in cron.job.command, which is plain text and readable by anyone who can read
-- the table.
--
-- vault.decrypted_secrets is restricted to privileged roles. A pg_cron job runs
-- as the role that scheduled it, so postgres can read these while anon and
-- authenticated cannot.

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
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'bp_anon_key'),
            'x-cron-secret',              (select decrypted_secret from vault.decrypted_secrets where name = 'bp_cron_secret')
        ),
        body        := '{}'::jsonb,
        timeout_milliseconds := 55000
    );
    $$
);


-- ── Fallback, only if Vault is unavailable on this project ─────────────────
--
-- Works identically, but writes both secrets into cron.job.command in plain
-- text. Prefer the Vault version above. If you use this one, treat CRON_SECRET
-- as exposed to anyone with database read access.
--
-- select cron.schedule(
--     'send-training-reminders',
--     '0 * * * *',
--     $$
--     select net.http_post(
--         url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/send-notifications',
--         headers := jsonb_build_object(
--             'Content-Type',  'application/json',
--             'Authorization', 'Bearer <SUPABASE_ANON_KEY>',
--             'x-cron-secret', '<CRON_SECRET>'
--         ),
--         body        := '{}'::jsonb,
--         timeout_milliseconds := 55000
--     );
--     $$
-- );


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


-- 2. What did the function actually reply?
--
--    200 with {"checked":N,...}                  working
--    401 {"error":"missing-cron-secret-header"}  the x-cron-secret header did
--                                                not arrive; check the schedule
--    401 {"error":"cron-secret-mismatch"}        Vault and the function secret
--                                                hold different values
--    503 {"error":"cron-secret-not-configured"}  CRON_SECRET is not set on the
--                                                function
--    401 with an HTML or gateway-shaped body     the Authorization JWT was
--                                                rejected before the function
--                                                ran; check bp_anon_key
--
--    A 200 body of {"checked":N,"sent":0,...} at every hour of the day means it
--    is running but nobody's reminder hour is being matched.
select id, status_code, content, created
from net._http_response
order by created desc
limit 20;


-- 3. How many members could receive anything at all.
select count(*) as subscriptions,
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
