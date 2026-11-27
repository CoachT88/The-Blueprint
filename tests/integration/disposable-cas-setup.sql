-- DISPOSABLE-DB TEST ONLY. DO NOT RUN IN A PRODUCTION PROJECT.
-- Minimal approximation of user_data for evaluating PostgREST upsert semantics.
create role web_anon nologin;
grant usage on schema public to web_anon;
create table public.user_data (
  id text primary key,
  programme_version integer not null default 1,
  rev integer not null default 0,
  schedule jsonb not null default '[]'::jsonb,
  programme jsonb,
  day_plans jsonb not null default '[]'::jsonb,
  session_log jsonb not null default '[]'::jsonb,
  measurements jsonb not null default '[]'::jsonb,
  total_xp integer not null default 0
);
grant select, insert, update on public.user_data to web_anon;

-- Candidate mechanism only: not a production migration.
create or replace function public.disposable_v2_revision_guard()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'UPDATE' and (OLD.programme_version >= 2 or NEW.programme_version >= 2) then
    if NEW.programme_version < OLD.programme_version
       or NEW.rev is distinct from OLD.rev + 1 then
      raise exception 'stale-or-legacy-writer: oldrev %, newrev %, oldver %, newver %',
        OLD.rev,NEW.rev,OLD.programme_version,NEW.programme_version
        using errcode='P0001';
    end if;
  end if;
  return NEW;
end; $$;
create trigger guard_v2
before update on public.user_data
for each row execute function public.disposable_v2_revision_guard();
notify pgrst, 'reload schema';
