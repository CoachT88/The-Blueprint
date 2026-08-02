-- ===========================================================================
-- The Blueprint — product analytics
--
-- First-party only. Events go into this project's own database and nowhere
-- else; no third-party tracker is involved. Rows are keyed on the auth UUID and
-- carry no email, matching the rest of the schema where email lives only in
-- `members` and in auth.
--
-- Nothing a member types is ever recorded: no session notes, no measurements,
-- no photos, no free text of any kind. Only event names and numeric or
-- enumerated properties.
--
-- SETUP: run the "Schema" section once in the Supabase SQL editor.
-- USE:   the "Queries" section is meant to be run ad hoc in the same editor.
--        The dashboard connects as a privileged role, so it bypasses the RLS
--        below and can read everything. Members cannot read any of it.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Schema  (run once)
-- ---------------------------------------------------------------------------

create table if not exists public.analytics_events (
    id          bigint generated always as identity primary key,
    user_id     uuid        not null references auth.users(id) on delete cascade,
    event       text        not null,
    props       jsonb       not null default '{}'::jsonb,
    created_at  timestamptz not null default now()
);

-- Every query below filters or orders by one of these.
create index if not exists analytics_events_event_created_idx
    on public.analytics_events (event, created_at desc);
create index if not exists analytics_events_user_idx
    on public.analytics_events (user_id, created_at desc);

alter table public.analytics_events enable row level security;

-- Members may only append their own rows. Deliberately NO select, update or
-- delete policy: with RLS on and no policy for a command, that command is
-- denied. So a member cannot read anyone's activity, including their own, and
-- cannot rewrite history.
drop policy if exists "members insert own events" on public.analytics_events;
create policy "members insert own events"
    on public.analytics_events
    for insert
    to authenticated
    with check (auth.uid() = user_id);

-- Optional housekeeping: this table grows forever otherwise. Run occasionally,
-- or schedule it with pg_cron if that is enabled on the project.
-- delete from public.analytics_events where created_at < now() - interval '12 months';


-- ---------------------------------------------------------------------------
-- Queries
-- ---------------------------------------------------------------------------

-- 1. Onboarding funnel, with drop-off at each step.
--    Read the last column: it is the share of people who got this far.
with steps as (
    select 'signed_up'          as step, 1 as ord, count(distinct user_id) as users from public.analytics_events where event = 'signup'
    union all
    select 'accepted_waiver',    2, count(distinct user_id) from public.analytics_events where event = 'welcome_accepted'
    union all
    select 'saw_intro',          3, count(distinct user_id) from public.analytics_events where event = 'intro_shown'
    union all
    select 'finished_intro',     4, count(distinct user_id) from public.analytics_events where event = 'intro_completed'
    union all
    select 'chose_goal',         5, count(distinct user_id) from public.analytics_events where event = 'goal_selected'
    union all
    select 'started_a_session',  6, count(distinct user_id) from public.analytics_events where event = 'session_started'
    union all
    select 'finished_a_session', 7, count(distinct user_id) from public.analytics_events where event = 'session_completed'
)
select
    step,
    users,
    round(100.0 * users / nullif(max(users) over (), 0), 1) as pct_of_signups,
    users - lag(users) over (order by ord)                  as lost_at_this_step
from steps
order by ord;


-- 2. Where people abandon a session, by how far in they got.
select
    props->>'routineType'          as mission,
    (props->>'exerciseIndex')::int as stopped_at_exercise,
    count(*)                       as abandons
from public.analytics_events
where event = 'session_abandoned'
group by 1, 2
order by abandons desc
limit 20;


-- 3. Session completion rate: of the sessions started, how many finished.
select
    date_trunc('week', created_at)::date                                as week,
    count(*) filter (where event = 'session_started')                   as started,
    count(*) filter (where event = 'session_completed')                 as completed,
    round(100.0 * count(*) filter (where event = 'session_completed')
          / nullif(count(*) filter (where event = 'session_started'), 0), 1) as pct_completed
from public.analytics_events
where event in ('session_started', 'session_completed')
group by 1
order by week desc
limit 12;


-- 4. Week-one retention: of members who signed up in a given week, how many
--    were still completing sessions 7 to 14 days later.
with signups as (
    select user_id, min(created_at) as joined_at
    from public.analytics_events
    where event = 'signup'
    group by user_id
),
returned as (
    select distinct s.user_id
    from signups s
    join public.analytics_events e
      on e.user_id = s.user_id
     and e.event = 'session_completed'
     and e.created_at between s.joined_at + interval '7 days'
                          and s.joined_at + interval '14 days'
)
select
    date_trunc('week', s.joined_at)::date            as cohort_week,
    count(*)                                         as signed_up,
    count(r.user_id)                                 as still_active_week_2,
    round(100.0 * count(r.user_id) / nullif(count(*), 0), 1) as pct_retained
from signups s
left join returned r on r.user_id = s.user_id
group by 1
order by cohort_week desc;


-- 5. What members say they are here for.
select
    props->>'goal'                                            as goal,
    count(*)                                                  as chosen,
    round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1) as pct
from public.analytics_events
where event = 'goal_selected'
group by 1
order by chosen desc;


-- 6. Which missions actually get run.
select props->>'mission' as mission, count(*) as runs
from public.analytics_events
where event = 'mission_selected'
group by 1
order by runs desc;


-- 7. Are people skipping the guidance, and how far in do they bail?
select
    event,
    count(*)                                      as times,
    round(avg((props->>'stop')::numeric), 1)      as avg_stop_index
from public.analytics_events
where event in ('tour_started', 'tour_completed', 'tour_skipped', 'intro_skipped')
group by 1
order by times desc;


-- 8. People who are being turned away at the door.
select
    props->>'reason' as reason,
    count(*)         as times,
    count(distinct user_id) as people
from public.analytics_events
where event = 'membership_denied'
group by 1
order by times desc;


-- 9. Raw recent activity, for eyeballing when something looks off.
select created_at, event, props
from public.analytics_events
order by created_at desc
limit 100;
