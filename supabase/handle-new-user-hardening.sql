-- ===========================================================================
-- The Blueprint — harden public.handle_new_user()
--
-- BEHAVIOUR PRESERVING. Two things change and nothing else: the mutable
-- search_path is pinned, and the function stops being callable as an RPC.
-- The insert itself is left exactly as production has it.
--
-- In particular there is deliberately NO `on conflict (id) do nothing`. An
-- earlier draft added it for idempotency, and that was wrong for this pass:
-- production shows one trigger, zero auth users without a user_data row, and
-- no duplicate-provisioning condition, so there is nothing to make idempotent.
-- Swallowing a conflict would change failure semantics and could hide a
-- provisioning defect that currently announces itself. If duplicate
-- provisioning is ever observed, that is its own change with its own
-- evidence.
--
-- This function is NOT in version control anywhere else: it was created
-- directly in the live project. The body below is the production body with
-- the two hardening changes applied, transcribed from the live definition.
--
-- LIVE FACTS THIS FILE WAS WRITTEN AGAINST (verified in production):
--     arguments           none
--     returns             trigger
--     owner               postgres
--     security definer    true
--     search_path         UNSET            <- fixed here
--     execute granted to  PUBLIC, anon, authenticated, postgres, service_role
--     trigger             on_auth_user_created
--                         AFTER INSERT ON auth.users FOR EACH ROW
--     auth users with no user_data row      0
--
-- Idempotent: safe to re-run.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Re-confirm, and capture a rollback target. Run this alone, first.
--
-- Save the pg_get_functiondef() output somewhere before section 1 replaces
-- the function. It is the only copy of the pre-change definition.
-- ---------------------------------------------------------------------------
select
    pg_get_function_identity_arguments(p.oid)        as arguments,
    pg_get_function_result(p.oid)                    as returns,
    pg_get_userbyid(p.proowner)                      as owner,
    p.prosecdef                                      as is_security_definer,
    p.proconfig                                      as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'handle_new_user';
-- Expect: arguments empty, returns trigger, owner postgres,
--         is_security_definer true, config NULL.

select pg_get_functiondef(p.oid) as rollback_target
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'handle_new_user';

select tgname, tgrelid::regclass as table_name, pg_get_triggerdef(oid)
from pg_trigger
where not tgisinternal and tgrelid = 'auth.users'::regclass
order by tgname;
-- Expect exactly one row: on_auth_user_created, AFTER INSERT, FOR EACH ROW.


-- ---------------------------------------------------------------------------
-- 1. The replacement
--
-- `create or replace` keeps the owner (postgres) and leaves the trigger
-- attachment untouched: a trigger references the function by oid, and replace
-- does not change the oid. So on_auth_user_created continues to fire.
--
-- search_path is pinned with pg_temp LAST, deliberately. A security definer
-- function with a mutable search_path can be pointed at a schema the caller
-- controls; putting pg_temp first would instead let a temporary object shadow
-- a real one, which is the same attack wearing a different hat.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    insert into public.user_data (id)
    values (new.id);
    return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. Remove direct RPC exposure
--
-- Supabase exposes functions in `public` over PostgREST, so a signed-in
-- member can currently call this directly. A trigger does NOT need the caller
-- to hold EXECUTE: it runs as part of the triggering statement under the
-- trigger's own authority. Revoking from these three therefore closes the RPC
-- door without touching signup.
--
-- PUBLIC is where the implicit grant actually lives. Without that line the
-- other two are cosmetic, because anon and authenticated would still inherit
-- EXECUTE through PUBLIC.
--
-- postgres and service_role are deliberately left alone: the owner must keep
-- EXECUTE for the trigger path, and service_role is the privileged backend
-- identity. Narrowing those is not part of this pass.
-- ---------------------------------------------------------------------------

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;


-- ---------------------------------------------------------------------------
-- 3. Checks, read-only
-- ---------------------------------------------------------------------------

-- Expect: is_security_definer true, config {"search_path=public, pg_temp"},
--         anon false, authenticated false, postgres true, service_role true,
--         owner still postgres.
select
    pg_get_function_identity_arguments(p.oid)                     as arguments,
    pg_get_userbyid(p.proowner)                                   as owner,
    p.prosecdef                                                   as is_security_definer,
    p.proconfig                                                   as config,
    has_function_privilege('anon',          p.oid, 'execute')     as anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'execute')     as auth_can_execute,
    has_function_privilege('postgres',      p.oid, 'execute')     as postgres_can_execute,
    has_function_privilege('service_role',  p.oid, 'execute')     as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'handle_new_user';

-- The trigger survived the replace. Expect the same single row as section 0.
select tgname, tgrelid::regclass as table_name, pg_get_triggerdef(oid)
from pg_trigger
where not tgisinternal and tgrelid = 'auth.users'::regclass
order by tgname;

-- The body really is the hardened one, and really has no ON CONFLICT.
select pg_get_functiondef(p.oid) as current_definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'handle_new_user';

-- Provisioning integrity, before and after. Production reported 0 before this
-- file; it must still be 0 after, and after the first new signup.
select count(*) as auth_users_without_user_data
from auth.users u
left join public.user_data d on d.id = u.id
where d.id is null;


-- ---------------------------------------------------------------------------
-- 4. Rollback
--
-- Restore the definition captured in section 0.
--
-- Do NOT restore EXECUTE to PUBLIC, anon or authenticated as a way of fixing
-- a broken signup. That reopens the RPC and cannot be the cause: a trigger
-- never required those grants. If signup breaks after this file, check in
-- this order:
--
--   1. does the owner (postgres) still hold insert on public.user_data
--   2. is on_auth_user_created still attached to auth.users
--   3. the actual insert error from the signup attempt
--
-- A `set search_path` clause can be removed on its own if it is ever
-- implicated, without reverting anything else:
--
--   alter function public.handle_new_user() reset search_path;
-- ---------------------------------------------------------------------------
