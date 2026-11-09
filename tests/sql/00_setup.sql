-- Sandbox stand-ins for Supabase roles and a user_data shaped like the real one (types are representative).
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
drop schema if exists private cascade;
drop table if exists public.user_data;
create table public.user_data (
  id uuid primary key,
  schedule jsonb, session_log jsonb not null default '[]', total_xp integer default 0,
  updated_at timestamptz default now()
);
grant all on public.user_data to authenticated;
insert into public.user_data(id, session_log, total_xp) values ('00000000-0000-0000-0000-00000000000a','[]',0);
