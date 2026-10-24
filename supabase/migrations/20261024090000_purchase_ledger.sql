-- The purchase ledger, and the entitlement rules that read from it.
--
-- SUPERSEDES supabase/migrations/20261023180000_claim_membership_require_confirmed_email.sql.
-- Neither file has been applied. That one carried only the confirmed-email
-- safeguard; this one carries it plus the revocation clauses, so running
-- this alone is correct and complete. Do not run both.
--
-- ---------------------------------------------------------------------------
-- WHY A LEDGER RATHER THAN COLUMNS ON members
--
-- public.members holds one row per email, because the Ko-fi webhook upserts
-- with resolution=merge-duplicates on email. A man who buys twice still has
-- one row, so transaction columns on that row can hold exactly one
-- reference. Refund his first purchase and the single row gets stamped
-- refunded, access is revoked, and the second purchase he paid for is
-- invisible to the system that just cut him off.
--
-- So the entitlement and the purchase record are separated. members answers
-- "may this person use the app". purchases answers "what was bought, by
-- whom, for how much, and does it still stand". The first is derived from
-- the second.
--
-- ENTIRELY ADDITIVE. Two new tables, one new nullable column, one new
-- function, and two clauses added to an existing function. No existing row
-- is modified except by the backfill, which only inserts.

begin;

-- ---------------------------------------------------------------------------
-- 1. The ledger. One row per transaction.
-- ---------------------------------------------------------------------------
create table if not exists public.purchases (
    id            bigint generated always as identity primary key,
    provider      text        not null,              -- 'kofi' | 'stripe'
    provider_ref  text,                              -- processor transaction id
    email         text        not null,
    amount_cents  integer,
    currency      text,
    status        text        not null default 'paid'
                  check (status in ('paid', 'refunded', 'disputed')),
    created_at    timestamptz not null default now(),
    resolved_at   timestamptz                        -- when refunded or disputed
);

/* One row per processor transaction, so a replayed webhook cannot create a
   second purchase. Partial, because the backfilled Ko-fi rows carry no
   reference and must not collide with each other. */
create unique index if not exists purchases_provider_ref_uniq
    on public.purchases (provider, provider_ref)
    where provider_ref is not null;

/* The lookup revoke_if_unpaid makes, on the same normalisation members and
   claim_membership already use. */
create index if not exists purchases_email_status
    on public.purchases (lower(btrim(email)), status);

alter table public.purchases enable row level security;
revoke all on public.purchases from public, anon, authenticated;
grant select, insert, update on public.purchases to service_role;

-- ---------------------------------------------------------------------------
-- 2. The replay gate.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_events (
    id          text        primary key,   -- the processor's own event id
    provider    text        not null,
    type        text        not null,
    received_at timestamptz not null default now()
);

alter table public.payment_events enable row level security;
revoke all on public.payment_events from public, anon, authenticated;
grant select, insert on public.payment_events to service_role;

-- ---------------------------------------------------------------------------
-- 3. members gains one column.
-- ---------------------------------------------------------------------------
alter table public.members
    add column if not exists revoked_at timestamptz;

-- ---------------------------------------------------------------------------
-- 4. BACKFILL. This is what protects every existing Ko-fi purchaser.
--
-- Without it the ledger has no record of them, so the first Stripe refund
-- for any address would find zero remaining paid purchases and revoke
-- someone who never asked for a refund.
--
-- Guarded by `not exists` rather than `on conflict`, because the unique
-- index above is partial and would not catch a repeat run on null
-- references. Re-running this migration inserts nothing.
--
-- Expect it to insert exactly as many rows as members holds.
-- ---------------------------------------------------------------------------
insert into public.purchases (provider, provider_ref, email, status, created_at)
select 'kofi', null, m.email, 'paid', coalesce(m.claimed_at, now())
from public.members m
where not exists (
    select 1 from public.purchases p
    where lower(btrim(p.email)) = lower(btrim(m.email))
);

-- ---------------------------------------------------------------------------
-- 5. Revocation that respects multiple purchases.
--
-- THE RULE: access survives while at least one paid purchase remains for
-- that address.
--
-- The refund handler marks one ledger row and then calls this. It never
-- decides revocation itself, which is what keeps the rule in one place.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_if_unpaid(p_email text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_email     text := lower(btrim(p_email));
  v_remaining integer;
begin
  select count(*) into v_remaining
  from public.purchases
  where lower(btrim(email)) = v_email
    and status = 'paid';

  /* At least one purchase still stands. The refunded one is already marked
     in the ledger, and the man keeps the access he paid for twice. */
  if v_remaining > 0 then
    return false;
  end if;

  /* Nothing left that was paid for. Clear the attachment and mark the row.
     Deliberately touches NOTHING else: not user_data, not
     progress_checkins, not day_plans, not push_subscriptions, and not the
     progress-photos bucket. A refunded member who repurchases finds his
     training history and his photographs where he left them, and a
     disputed charge later won restores access to intact data. */
  update public.members
     set user_id    = null,
         revoked_at = now()
   where lower(btrim(email)) = v_email;

  return true;
end;
$function$;

revoke all on function public.revoke_if_unpaid(text) from public, anon, authenticated;
grant execute on function public.revoke_if_unpaid(text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Restoring access when a dispute is won.
--
-- Clears revoked_at and leaves user_id null on purpose, so the member
-- re-attaches through claim_membership() on next sign-in. One attach path
-- rather than two.
-- ---------------------------------------------------------------------------
create or replace function public.restore_if_paid(p_email text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_email     text := lower(btrim(p_email));
  v_remaining integer;
begin
  select count(*) into v_remaining
  from public.purchases
  where lower(btrim(email)) = v_email
    and status = 'paid';

  if v_remaining = 0 then
    return false;
  end if;

  update public.members
     set revoked_at = null
   where lower(btrim(email)) = v_email
     and revoked_at is not null;

  return true;
end;
$function$;

revoke all on function public.restore_if_paid(text) from public, anon, authenticated;
grant execute on function public.restore_if_paid(text) to service_role;

-- ---------------------------------------------------------------------------
-- 7. claim_membership(), with both changes.
--
-- CHANGE A, from the superseded migration: the address lookup requires
-- email_confirmed_at, so an unconfirmed account resolves no address and
-- returns false without attaching anything.
--
--   Worth exactly as much as one project setting. With "Confirm email" off,
--   Supabase stamps email_confirmed_at at sign-up without sending anything
--   and this passes for everyone. With it on, the platform refuses a session
--   to an unconfirmed account, so the caller this rejects could not have
--   reached the function. Defence in depth, not the control itself.
--
-- CHANGE B, new here: revoked_at is null on both the already-attached check
-- and the attach. Without it a revoked row stays claimable and a refund
-- would not actually remove access.
--
-- UNCHANGED: identity comes from auth.uid() and never from an argument; the
-- function takes no arguments; the attach is guarded by user_id is null,
-- which is both what stops an entitlement being taken from its owner and
-- what makes concurrent calls safe; claimed_at is wrapped in coalesce so a
-- repeat call cannot rewrite the original stamp; every unattached row
-- sharing the address is claimed, because a man who bought twice owns both.
-- ---------------------------------------------------------------------------
create or replace function public.claim_membership()
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    return false;
  end if;

  -- Already attached, and not revoked. Answer from the row, write nothing.
  if exists (
    select 1 from public.members
    where user_id = v_uid
      and revoked_at is null        -- CHANGE B
  ) then
    return true;
  end if;

  -- The address comes from the auth record, never from the caller, and
  -- never from user metadata, which an account can set for itself.
  select lower(btrim(email))
    into v_email
  from auth.users
  where id = v_uid
    and email_confirmed_at is not null;   -- CHANGE A

  if v_email is null or v_email = '' then
    return false;
  end if;

  update public.members
     set user_id    = v_uid,
         claimed_at = coalesce(claimed_at, now())
   where lower(btrim(email)) = v_email
     and user_id is null
     and revoked_at is null;        -- CHANGE B

  return exists (
    select 1 from public.members
    where user_id = v_uid
      and revoked_at is null        -- CHANGE B
  );
end;
$function$;

revoke all on function public.claim_membership() from public;
revoke all on function public.claim_membership() from anon;
grant execute on function public.claim_membership() to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Checks. Read only. Run after the above and record the numbers.
-- ---------------------------------------------------------------------------

-- Expect: backfilled = total members, every row 'paid', provider 'kofi'.
select provider, status, count(*) from public.purchases group by 1, 2 order by 1, 2;

-- Expect: these two numbers are equal.
select (select count(*) from public.members)   as members,
       (select count(*) from public.purchases) as purchases;

-- Expect: unchanged from before the migration. Record both.
select count(*) as total, count(user_id) as attached,
       count(revoked_at) as revoked
from public.members;

-- Expect: security_definer true, search_path pinned, authenticated only.
select p.proname, p.prosecdef, array_to_string(p.proconfig, ', ') as config,
       array(select rolname from pg_roles r
             where has_function_privilege(r.rolname, p.oid, 'execute')
               and r.rolname in ('anon', 'authenticated', 'service_role')) as can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('claim_membership', 'revoke_if_unpaid', 'restore_if_paid')
order by p.proname;

-- Expect: no rows. The client roles must have nothing on either new table.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('purchases', 'payment_events')
  and grantee in ('anon', 'authenticated', 'PUBLIC');
