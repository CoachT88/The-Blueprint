-- ===========================================================================
-- The Blueprint — Coach Tee daily usage cap
--
-- Coach Tee costs money on every question. Now that the endpoint is
-- authenticated, the remaining exposure is a single shared or compromised
-- member account being used to burn the API budget. This caps it.
--
-- The endpoint FAILS OPEN if any of this is missing or erroring, so running
-- this file is recommended but not required for Coach Tee to work. Until it is
-- run, there is simply no cap.
--
-- SETUP: run once in the Supabase SQL editor.
-- ===========================================================================


create table if not exists public.coach_usage (
    user_id uuid    not null references auth.users(id) on delete cascade,
    day     date    not null,
    count   integer not null default 0,
    primary key (user_id, day)
);

-- Only the service role touches this table, and the service role bypasses RLS.
-- Enabling it with no policies means a member's own JWT cannot read or edit
-- their counter, which is the point.
alter table public.coach_usage enable row level security;


-- Increment and return the new count in one round trip, so two questions sent
-- at the same moment cannot both read the old value and each write count+1.
create or replace function public.bump_coach_usage(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    new_count integer;
begin
    insert into public.coach_usage (user_id, day, count)
    values (p_user, (now() at time zone 'utc')::date, 1)
    on conflict (user_id, day)
        do update set count = coach_usage.count + 1
    returning count into new_count;
    return new_count;
end;
$$;

-- The function runs as its owner, so it must not be callable by members
-- directly. Only the service role, which the edge function uses, may call it.
revoke all on function public.bump_coach_usage(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------------

-- One row per member per active day. Old rows answer nothing; drop them
-- occasionally, or schedule this with pg_cron.
-- delete from public.coach_usage where day < current_date - 90;


-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------

-- Today's heaviest users. A member far above the rest is worth a look.
select user_id, count
from public.coach_usage
where day = (now() at time zone 'utc')::date
order by count desc
limit 20;

-- Questions per day across everyone, which is also your Coach Tee cost curve.
select day, sum(count) as questions, count(*) as members
from public.coach_usage
group by day
order by day desc
limit 30;
