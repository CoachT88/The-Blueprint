-- ===========================================================================
-- The Blueprint — harden public.handle_new_user()
--
-- READ THIS FIRST. This function does NOT exist anywhere in this repository.
-- `grep -rn handle_new_user` over the whole tree returns nothing: no SQL file
-- creates it, and no application code calls it. It exists only in the live
-- project, created outside version control.
--
-- That has one hard consequence. A `revoke execute` has to name the exact
-- signature, and a `create or replace` has to match the existing return type
-- and argument list or it fails outright. Neither can be written from here
-- with any confidence. So section 0 is not optional and its output decides
-- whether the rest of this file is correct as written.
--
-- Everything here is idempotent.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. DISCOVER THE TRUTH FIRST. Run this alone and read it before going on.
-- ---------------------------------------------------------------------------
select
    n.nspname                                        as schema_name,
    p.proname,
    pg_get_function_identity_arguments(p.oid)        as arguments,
    pg_get_function_result(p.oid)                    as returns,
    p.prosecdef                                      as is_security_definer,
    p.proconfig                                      as config,
    pg_get_userbyid(p.proowner)                      as owner,
    has_function_privilege('anon',          p.oid, 'execute') as anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'execute') as auth_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'handle_new_user';

-- And the full current body, so there is something to restore to.
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'handle_new_user';

-- Every non-internal trigger on the two tables that matter. More than one
-- row on auth.users naming this function means provisioning runs twice.
select tgname, tgrelid::regclass as table_name, pg_get_triggerdef(oid)
from pg_trigger
where not tgisinternal
  and tgrelid in ('public.user_data'::regclass, 'auth.users'::regclass)
order by table_name, tgname;

-- CHECK BEFORE PROCEEDING:
--   * `arguments` is empty. If it is not, every `revoke` below must name the
--     types, and the replacement body must take the same arguments.
--   * `returns` is `trigger`. If it is not, this is not the function this
--     file was written for.
--   * exactly ONE trigger on auth.users references it.
--   * `owner` is a role that may insert into public.user_data. Replacing a
--     function does not change its owner, so a security definer function
--     keeps running as that role.


-- ---------------------------------------------------------------------------
-- 1. The replacement
--
-- Two changes only, and nothing else about the behaviour moves:
--
--   search_path pinned. A security definer function with a mutable
--   search_path can be pointed at a schema the caller controls. `pg_temp`
--   goes LAST deliberately: putting it first would let a temporary object
--   shadow a real one, which is the attack this is meant to close.
--
--   on conflict (id) do nothing. Provisioning becomes idempotent, so a
--   duplicate trigger or a retried signup cannot fail the insert. See the
--   caveat in section 3: this also hides a genuine failure, which is a real
--   tradeoff and not a free win.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    insert into public.user_data (id)
    values (new.id)
    on conflict (id) do nothing;
    return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. Remove direct RPC exposure
--
-- Supabase exposes any function in `public` over PostgREST as an RPC, so a
-- signed-in member could call this directly. A trigger does NOT need EXECUTE
-- to be granted to the caller: it runs as part of the triggering statement,
-- under the trigger's own authority. Revoking from anon and authenticated
-- therefore closes the RPC door without touching signup.
--
-- If section 0 reported arguments, replace the two lines below with the
-- argument types, for example:
--   revoke execute on function public.handle_new_user(uuid) from anon;
-- ---------------------------------------------------------------------------

revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;

-- PUBLIC is where the implicit grant actually lives on a fresh function, and
-- leaving it would make both revokes above cosmetic.
revoke execute on function public.handle_new_user() from public;


-- ---------------------------------------------------------------------------
-- 3. Checks, read-only
-- ---------------------------------------------------------------------------

-- Expect: is_security_definer true, config {search_path=public, pg_temp},
--         anon_can_execute false, auth_can_execute false.
select
    p.proname,
    pg_get_function_identity_arguments(p.oid)        as arguments,
    p.prosecdef                                      as is_security_definer,
    p.proconfig                                      as config,
    has_function_privilege('anon',          p.oid, 'execute') as anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'execute') as auth_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'handle_new_user';

-- Still exactly one trigger, still on auth.users.
select tgname, tgrelid::regclass as table_name, pg_get_triggerdef(oid)
from pg_trigger
where not tgisinternal and tgrelid = 'auth.users'::regclass
order by tgname;

-- Does on-conflict hide anything today? Any auth user with no user_data row
-- is a provisioning failure that already happened, and `do nothing` will stop
-- a later retry from reporting it. Expect zero.
select count(*) as auth_users_without_user_data
from auth.users u
left join public.user_data d on d.id = u.id
where d.id is null;


-- ---------------------------------------------------------------------------
-- 4. Rollback
--
-- Restore the body captured by pg_get_functiondef() in section 0. Do NOT
-- restore EXECUTE to anon or authenticated as a way of fixing a broken
-- signup: that reopens the RPC and cannot be the cause, because a trigger
-- never needed that grant. If signup breaks after this file, look at the
-- function OWNER's insert privilege on public.user_data, and at the trigger
-- definition, in that order.
-- ---------------------------------------------------------------------------
