-- ═══════════════════════════════════════════════════════════════════════════
-- user_data revision guard  (SOFT mode: nothing legacy is refused)
-- ═══════════════════════════════════════════════════════════════════════════
-- NOT APPLIED. Run on a Supabase STAGING project first, then production only
-- on the owner's explicit approval. Additive: three columns, one private table,
-- one trigger. Safe to re-run.
--
-- WHAT IT DOES. Every accepted update to a user_data row advances `rev`. A
-- client that says which revision it last READ (`base_rev`) is refused when the
-- row has moved on, so an out-of-date tab or device can no longer silently
-- overwrite newer progress. A client that says nothing (every client shipped
-- before this one) is still accepted in this soft mode, but its write bumps
-- `rev` and clears `last_write_id`, so protected clients notice it.
--
--   rev            server-controlled; +1 on every accepted update
--   base_rev       the revision the writer last read; reset to null by the trigger
--   last_write_id  the writer's id for THIS write: proof a write landed
--   sync_meta      bounded record of trimmed session ids, so recovery never
--                  re-awards a session that was saved and later trimmed
--
-- HARD enforcement (refusing writers that send no base_rev) is a SEPARATE file,
-- supabase/revision-guard-enforce.sql, needing separate approval.
--
-- PRECONDITION: every member already has a user_data row (see
-- handle-new-user-hardening.sql), so a client's upsert always takes the UPDATE
-- path. Clients send base_rev only after reading a row.
--
-- RLS is untouched. The guard cannot be relaxed by a member: the setting lives
-- in a schema members cannot read, and the function runs as its owner.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.user_data add column if not exists rev           integer not null default 0;
alter table public.user_data add column if not exists base_rev      integer;
alter table public.user_data add column if not exists last_write_id text;
alter table public.user_data add column if not exists sync_meta     jsonb;

create schema if not exists private;
create table if not exists private.user_data_rev_config (
  singleton boolean primary key default true check (singleton),
  enforce   boolean not null default false
);
insert into private.user_data_rev_config (singleton) values (true) on conflict do nothing;

create or replace function private.user_data_rev_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare _enforce boolean;
begin
  if NEW.base_rev is null then
    -- LEGACY writer: did not say what it read.
    select c.enforce into _enforce from private.user_data_rev_config c;
    if coalesce(_enforce, false) then
      raise exception 'rev_required' using errcode = 'PT409',
        hint = 'This client is out of date. Reload to continue.';
    end if;
    NEW.last_write_id := null;           -- a legacy write must not look like anyone's confirmed write
  elsif NEW.base_rev <> OLD.rev then
    raise exception 'rev_conflict' using errcode = 'PT409',
      detail = format('based on revision %s, current is %s', NEW.base_rev, OLD.rev);
  end if;
  NEW.rev      := OLD.rev + 1;
  NEW.base_rev := null;                  -- one-shot: the next legacy write cannot inherit it
  return NEW;
end $$;

drop trigger if exists user_data_rev_guard on public.user_data;
create trigger user_data_rev_guard before update on public.user_data
  for each row execute function private.user_data_rev_guard();

revoke all on schema private from public;
revoke all on private.user_data_rev_config from public;
-- Supabase: also run  revoke usage on schema private from anon, authenticated;
--
-- VERIFY (expect: 4 columns; trigger present; enforce = false):
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='user_data'
--      and column_name in ('rev','base_rev','last_write_id','sync_meta');
--   select tgname from pg_trigger where tgrelid='public.user_data'::regclass and not tgisinternal;
--   select enforce from private.user_data_rev_config;   -- run as the owner role
--
-- ROLLBACK (leaves the columns; they are inert without the trigger):
--   drop trigger if exists user_data_rev_guard on public.user_data;
--   drop function if exists private.user_data_rev_guard();
