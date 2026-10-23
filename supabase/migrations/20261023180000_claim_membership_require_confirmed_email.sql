-- claim_membership(): require a confirmed email before a first claim.
--
-- This file captures the function as it runs in production, with one change,
-- so that the definition is reviewable in version control rather than
-- readable only from the database. Everything else here is the live
-- definition transcribed, not a redesign.
--
-- THE CHANGE. The lookup of the caller's address in auth.users now also
-- requires email_confirmed_at to be set. An account that has not confirmed
-- its address resolves no address, so it takes the existing null branch and
-- returns false without attaching anything.
--
--   before:  where u.id = v_uid
--   after:   where u.id = v_uid and u.email_confirmed_at is not null
--
-- WHAT IS DELIBERATELY NOT CHANGED, AND WHY.
--
-- The already-claimed check stays ahead of the confirmation check. A member
-- whose entitlement is already attached to their user id keeps returning
-- true regardless of confirmation state. Putting confirmation first would
-- revoke app access from anyone whose address later entered an unconfirmed
-- state, for example partway through an email change, and losing access to
-- a product already paid for is a worse outcome than the narrow case the
-- confirmation check is there to cover. All nine currently attached records
-- belong to confirmed accounts, so this ordering changes nothing for them.
--
-- The update still matches every unattached row sharing the address. Someone
-- who bought twice owns both entitlements, so claiming both is correct.
--
-- The comparison stays lower(btrim(email)) on both sides, matching the
-- normalisation in supabase/members-email-normalise.sql.
--
-- ---------------------------------------------------------------------------
-- OPERATIONAL DEPENDENCY. READ THIS BEFORE RELYING ON THE CHANGE.
--
-- email_confirmed_at only means a human proved control of the address when
-- the project requires confirmation at sign-up. With "Confirm email" turned
-- off, Supabase stamps email_confirmed_at at sign-up without sending
-- anything, every account is confirmed from birth, and this check passes for
-- everyone.
--
-- So the safeguard is worth exactly as much as that project setting, and the
-- setting is not something a migration can assert. Check it in
-- Authentication, Sign In / Providers, Email, "Confirm email", and treat
-- this change as defence in depth rather than as the control itself.
--
-- The platform already refuses to issue a session to an unconfirmed account
-- when confirmation is required, which means that in the configuration where
-- this check has teeth, the caller it rejects could not have reached the
-- function anyway. That is the normal shape of defence in depth and it is
-- not an argument against adding it.
-- ---------------------------------------------------------------------------
--
-- IDEMPOTENT. create or replace, and grants that restate the live state.
-- Running it twice does nothing the first run did not already do.
--
-- ROLLBACK. Re-run this file with the and-clause on line marked CHANGE
-- removed. There is no data migration to undo: the function writes only
-- members.user_id and members.claimed_at, and this change can only cause
-- fewer writes, never different ones.

create or replace function public.claim_membership()
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  -- No session, nothing to attach to.
  if v_uid is null then
    return false;
  end if;

  -- Already attached. Answer from the existing row and write nothing.
  if exists (
    select 1 from public.members
    where user_id = v_uid
  ) then
    return true;
  end if;

  -- The address comes from the auth record, never from the caller, and
  -- never from user metadata, which an account can set for itself.
  select lower(btrim(email))
    into v_email
  from auth.users
  where id = v_uid
    and email_confirmed_at is not null;   -- CHANGE: confirmed addresses only

  if v_email is null or v_email = '' then
    return false;
  end if;

  -- user_id is null is what makes this safe to run concurrently and what
  -- stops an entitlement already owned by another account being taken. A
  -- second caller blocks on the row lock, re-reads after the first commits,
  -- no longer matches, and updates nothing.
  update public.members
     set user_id = v_uid,
         claimed_at = coalesce(claimed_at, now())
   where lower(btrim(email)) = v_email
     and user_id is null;

  return exists (
    select 1 from public.members
    where user_id = v_uid
  );
end;
$function$;

-- Execute rights, restated so this file is a complete description of the
-- function rather than of its body alone. These match the live state: the
-- app calls this from a signed-in session, and nothing calls it anonymously.
revoke all on function public.claim_membership() from public;
revoke all on function public.claim_membership() from anon;
grant execute on function public.claim_membership() to authenticated;

-- ---------------------------------------------------------------------------
-- Checks. Read only, run after the above.
-- ---------------------------------------------------------------------------

-- Expect: security_definer true, config {search_path=public, pg_temp},
--         can_execute {authenticated}.
select p.prosecdef as security_definer,
       array_to_string(p.proconfig, ', ') as config,
       array(select rolname from pg_roles r
             where has_function_privilege(r.rolname, p.oid, 'execute')
               and r.rolname in ('anon', 'authenticated', 'service_role')) as can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'claim_membership';

-- Expect: unchanged by this migration. Record the numbers before and after.
select count(*) as total,
       count(user_id) as attached,
       count(*) - count(user_id) as unattached
from public.members;
