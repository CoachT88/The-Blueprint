-- Preserve the legacy selected time; new clients explicitly opt into extras.
alter table public.push_subscriptions
    add column if not exists custom_enabled boolean not null default true;

-- Only the server may reserve or acknowledge notification events.
create table if not exists public.notification_deliveries (
    user_id uuid not null references auth.users(id) on delete cascade,
    event_key text not null check (length(event_key) between 1 and 160),
    kind text not null check (kind in ('daily_reminder', 'completion_praise')),
    created_at timestamptz not null default now(),
    sent_at timestamptz,
    primary key (user_id, event_key)
);
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from public, anon, authenticated;
grant select, insert, update on public.notification_deliveries to service_role;
create index if not exists notification_deliveries_recent_user
    on public.notification_deliveries (user_id, created_at desc);

-- Reserve before contacting a push provider. Concurrent cron calls cannot
-- send the same event twice. An uncertain send is not automatically repeated.
create or replace function public.claim_training_notification(
    p_user_id uuid, p_event_key text, p_kind text
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed integer;
begin
    insert into public.notification_deliveries (user_id, event_key, kind)
    values (p_user_id, p_event_key, p_kind)
    on conflict (user_id, event_key) do nothing;
    get diagnostics claimed = row_count;
    return claimed = 1;
end;
$$;
revoke all on function public.claim_training_notification(uuid,text,text)
    from public, anon, authenticated;
grant execute on function public.claim_training_notification(uuid,text,text)
    to service_role;

-- Carry the old delivered marker into the new per-message tracking. There
-- is no invented completion event or modification of training history.
insert into public.notification_deliveries (user_id,event_key,kind,sent_at)
select user_id,
    'reminder:' || last_notified_date::text || ':' || reminder_time,
    'daily_reminder', now()
from public.push_subscriptions
where last_notified_date is not null
  and reminder_time ~ '^[0-2][0-9]:[0-5][0-9]$'
on conflict (user_id,event_key) do nothing;
