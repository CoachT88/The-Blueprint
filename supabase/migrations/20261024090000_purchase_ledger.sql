-- The purchase ledger, and the entitlement rules that read from it.
--
-- NOT YET APPLIED ANYWHERE. public.purchases does not exist in production.
-- This file is rewritten in place rather than superseded, because nothing
-- has run it.
--
-- SUPERSEDES supabase/migrations/20261023180000_claim_membership_require_confirmed_email.sql.
-- That one carried only the confirmed-email safeguard; this carries it plus
-- the revocation rules. Run this one, not both.
--
-- ---------------------------------------------------------------------------
-- WHY A LEDGER RATHER THAN COLUMNS ON members
--
-- public.members holds one row per email, because the Ko-fi webhook upserts
-- with resolution=merge-duplicates on email. A man who buys twice still has
-- one row, so transaction columns on it could hold exactly one reference.
-- Refund his first purchase and that row gets stamped refunded, access is
-- cut, and the second purchase he paid for is invisible to the system that
-- just cut him off.
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGED IN REVIEW, AND WHY IT MATTERS
--
-- The first draft of this file BACKFILLED public.purchases with one synthetic
-- row per existing members row: provider 'kofi', no reference, status 'paid',
-- created_at taken from claimed_at or now().
--
-- That was wrong. It fabricates a transaction record. It asserts that a
-- specific purchase happened, for an unknown amount, on a date derived from
-- when the member happened to claim rather than when they paid. Ko-fi
-- history was never captured, so the honest statement is that the payment
-- history of existing members is UNKNOWN, and a row claiming otherwise is a
-- lie the system would then reason from.
--
-- So there is no backfill. Instead members gains `pre_ledger`, which records
-- the one thing actually known: this entitlement existed before the ledger
-- did. revoke_if_unpaid() refuses to revoke such a row, so incomplete
-- payment history can never cost a legacy member their access. Removing
-- legacy access stays a human decision, which is how refunds already worked.
--
-- ENTIRELY ADDITIVE. Two new tables, two new nullable or defaulted columns,
-- two new functions, and three clauses added to claim_membership(). No
-- existing row is modified except to set pre_ledger, which grants nothing
-- and takes nothing away.

begin;

-- ---------------------------------------------------------------------------
-- 1. The ledger. One row per transaction, and only real transactions.
-- ---------------------------------------------------------------------------
create table if not exists public.purchases (
    id            bigint generated always as identity primary key,
    provider      text        not null,              -- 'kofi' | 'stripe'
    provider_ref  text,                              -- processor transaction id
    /* NULLABLE on purpose. A refund or dispute can arrive BEFORE the
       checkout completion that created the purchase, and a charge object
       does not reliably carry an address. Recording the refund with a null
       address is honest: the refund is real, the address is not yet known.
       The completion that follows fills it in. A null address simply never
       matches an email lookup, which is the correct behaviour until it is
       known. */
    email         text,
    amount_cents  integer,
    currency      text,
    status        text        not null default 'paid'
                  check (status in ('paid', 'refunded', 'disputed')),
    created_at    timestamptz not null default now(),
    resolved_at   timestamptz                        -- when refunded or disputed
);

/* One row per processor transaction, so a replayed webhook cannot create a
   second purchase. Partial so a future provider without a reference does not
   collide, though nothing writes a null reference today. */
create unique index if not exists purchases_provider_ref_uniq
    on public.purchases (provider, provider_ref)
    where provider_ref is not null;

/* The lookup revoke_if_unpaid makes, on the same normalisation members and
   claim_membership already use. */
create index if not exists purchases_email_status
    on public.purchases (lower(btrim(email)), status);

/* The reconciliation lookup: has this transaction already been recorded as
   refunded or disputed by an event that arrived out of order? */
create index if not exists purchases_ref_lookup
    on public.purchases (provider, provider_ref);

alter table public.purchases enable row level security;
revoke all on public.purchases from public, anon, authenticated;
grant select, insert, update on public.purchases to service_role;

-- ---------------------------------------------------------------------------
-- 2. The processing ledger for webhook events.
--
-- status is the fix for a real bug in the first version of the handler. It
-- inserted the event id BEFORE doing the work, so a failure partway through
-- left the event marked seen: Stripe retried, the handler saw a duplicate,
-- answered 200, and the purchase was silently dropped with the customer's
-- money taken.
--
-- Now an event is 'processing' until the work finishes and only then 'done'.
-- A retry of a 'processing' row is allowed to proceed, which is safe because
-- every write the handler makes is idempotent. See the handler for the audit
-- of that claim, operation by operation.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_events (
    id           text        primary key,   -- the processor's own event id
    provider     text        not null,
    type         text        not null,
    status       text        not null default 'processing'
                 check (status in ('processing', 'done')),
    attempts     integer     not null default 1,
    last_error   text,
    received_at  timestamptz not null default now(),
    completed_at timestamptz
);

/* Existing installs, if any, get the new columns. There are none today, and
   this costs nothing and makes the file safe to re-run. */
alter table public.payment_events
    add column if not exists status       text        not null default 'processing',
    add column if not exists attempts     integer     not null default 1,
    add column if not exists last_error   text,
    add column if not exists completed_at timestamptz;

alter table public.payment_events enable row level security;
revoke all on public.payment_events from public, anon, authenticated;
grant select, insert, update on public.payment_events to service_role;

-- ---------------------------------------------------------------------------
-- 3. members gains two columns.
-- ---------------------------------------------------------------------------
alter table public.members
    add column if not exists revoked_at timestamptz,
    add column if not exists pre_ledger boolean not null default false;

-- ---------------------------------------------------------------------------
-- 4. Mark every entitlement that predates the ledger.
--
-- THIS IS NOT A BACKFILL AND IT INVENTS NOTHING. It records one fact that is
-- actually known: this row existed before purchase tracking began, so its
-- payment history is unavailable. No amount, no date, no transaction
-- reference is asserted, because none is known.
--
-- Every row present when this migration runs is marked, including rows with
-- user_id null that nobody has claimed yet. A Ko-fi purchase recorded after
-- this point gets pre_ledger false from the column default, which is correct:
-- from here on the ledger is the record.
--
-- Expect: updated count equals the current members count. Record it.
-- ---------------------------------------------------------------------------
update public.members set pre_ledger = true where pre_ledger = false;

-- ---------------------------------------------------------------------------
-- 5. Revocation.
--
-- THE RULES, in order:
--
--   1. At least one paid purchase in the ledger  ->  keep access.
--      This is what makes a man who bought twice and refunded once keep the
--      access he paid for twice.
--
--   2. No paid purchase, but the entitlement predates the ledger  ->  keep
--      access, and say so. Incomplete payment history must never cost a
--      legacy member their access. Removing it is a human decision.
--
--   3. No paid purchase and the entitlement is from the ledger era  ->
--      revoke.
--
-- Returns text rather than boolean so the handler can log which rule fired,
-- and so rule 2 is visible for review rather than looking like a success.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_if_unpaid(p_email text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_email     text := lower(btrim(p_email));
  v_remaining integer;
  v_legacy    boolean;
begin
  select count(*) into v_remaining
  from public.purchases
  where lower(btrim(email)) = v_email
    and status = 'paid';

  if v_remaining > 0 then
    return 'kept_paid';
  end if;

  select bool_or(coalesce(pre_ledger, false)) into v_legacy
  from public.members
  where lower(btrim(email)) = v_email;

  if v_legacy is null then
    /* No entitlement row at all. Nothing to revoke. */
    return 'no_member';
  end if;

  if v_legacy then
    /* Rule 2. The ledger cannot speak for this member's history, so it does
       not get to end their access. */
    return 'kept_legacy';
  end if;

  /* Rule 3. Clears the attachment and marks the row. Deliberately touches
     NOTHING else: not user_data, not progress_checkins, not day_plans, not
     push_subscriptions, and not the progress-photos bucket. A refunded
     member who repurchases finds his training history and his photographs
     where he left them, and a disputed charge later won restores access to
     intact data. */
  update public.members
     set user_id    = null,
         revoked_at = now()
   where lower(btrim(email)) = v_email;

  return 'revoked';
end;
$function$;

revoke all on function public.revoke_if_unpaid(text) from public, anon, authenticated;
grant execute on function public.revoke_if_unpaid(text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Restoring access when a dispute is won.
--
-- Clears revoked_at and leaves user_id null on purpose, so the member
-- re-attaches through claim_membership() on next sign-in. One attach path.
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
--   IT CANNOT LOCK OUT AN EXISTING MEMBER. The already-attached check runs
--   first and does not consult email_confirmed_at, so anyone currently
--   attached keeps working regardless of their confirmation state. Only a
--   FIRST claim requires a confirmed address.
--
-- CHANGE B: revoked_at is null, on the already-attached check and on the
-- attach. Without it a revoked row stays claimable and a refund would not
-- actually remove access.
--
-- UNCHANGED: identity comes from auth.uid() and never from an argument; the
-- function takes no arguments; the attach is guarded by user_id is null,
-- which both stops an entitlement being taken from its owner and makes
-- concurrent calls safe; claimed_at is wrapped in coalesce so a repeat call
-- cannot rewrite the original stamp; every unattached row sharing the
-- address is claimed, because a man who bought twice owns both.
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

  if exists (
    select 1 from public.members
    where user_id = v_uid
      and revoked_at is null        -- CHANGE B
  ) then
    return true;
  end if;

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
-- Checks. Read only. Run after the above and record every number.
-- ---------------------------------------------------------------------------

-- Expect: ZERO ROWS. Nothing is backfilled, so the ledger starts empty.
-- A row here means something invented a transaction.
select provider, status, count(*) from public.purchases group by 1, 2;

-- Expect: pre_ledger true for every existing row, and total unchanged from
-- before the migration. Record all three numbers.
select count(*) as total,
       count(*) filter (where pre_ledger)        as marked_legacy,
       count(*) filter (where not pre_ledger)    as ledger_era,
       count(user_id)                            as attached,
       count(revoked_at)                         as revoked
from public.members;

-- Expect: security_definer true, search_path pinned, service_role only for
-- the two new functions, authenticated only for claim_membership.
select p.proname, p.prosecdef,
       array_to_string(p.proconfig, ', ') as config,
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

-- Expect: 'kept_legacy' for any existing member, proving rule 2 holds before
-- a single Stripe event has ever arrived. Substitute a real address.
-- select public.revoke_if_unpaid('<an existing member address>');
