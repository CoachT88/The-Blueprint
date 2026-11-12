-- ═══════════════════════════════════════════════════════════════════════════
-- STAGING ONLY. 03 of 4: simulate the purchase record for the test account.
-- ═══════════════════════════════════════════════════════════════════════════
-- Writes exactly what functions/api/stripe-webhook.js writes after a paid
-- checkout (a purchases row, a payment_events row, a members row keyed by the
-- address), with provider = 'simulated' so nothing can be mistaken for a real
-- payment and 99a can remove it precisely. It does NOT attach the member:
-- user_id stays null, so the test exercises the REAL claim_membership() path
-- when the account signs in. No card, no Stripe call, no production data.
--
-- It uses only the test account recorded in the marker by 01, so it cannot
-- pick another address.
-- Safe to re-run: every insert is conflict-guarded.
-- ═══════════════════════════════════════════════════════════════════════════
do $guard$
begin
    if to_regclass('public._staging_marker') is null then
        raise exception 'REFUSED: no staging marker. This file is for the marked staging project only.';
    end if;
    if not exists (select 1 from public._staging_marker m
                   join auth.users u on u.id = m.test_user_id) then
        raise exception 'REFUSED: the marker''s test account does not exist here. This is not the project 01 was run on.';
    end if;
    if (select count(*) from auth.users) > 25 then
        raise exception 'REFUSED: more than 25 auth users. This does not look like staging.';
    end if;
end
$guard$;

do $sim$
declare
    v_email text;
begin
    select lower(btrim(u.email)) into v_email
    from public._staging_marker m join auth.users u on u.id = m.test_user_id
    where u.email_confirmed_at is not null and u.email is not null;
    if v_email is null then
        raise exception 'REFUSED: the marker''s test account has no confirmed email.';
    end if;

    insert into public.purchases (provider, provider_ref, email, amount_cents, currency, status)
    select 'simulated', 'sim_staging_buyer_1', v_email, 0, 'usd', 'paid'
    where not exists (select 1 from public.purchases where provider = 'simulated' and provider_ref = 'sim_staging_buyer_1');

    insert into public.payment_events (id, provider, type, status, completed_at)
    values ('evt_sim_staging_buyer_1', 'simulated', 'checkout.session.completed', 'done', now())
    on conflict (id) do nothing;

    insert into public.members (email) values (v_email)
    on conflict (email) do nothing;
end
$sim$;

-- What the test account's membership looks like now (user_id must be empty
-- until the account signs in and claims it).
select m.email, m.user_id is null as unclaimed, m.revoked_at is null as active, m.pre_ledger,
       (select count(*) from public.purchases p where lower(btrim(p.email)) = lower(btrim(m.email)) and p.status='paid') as paid_purchases
from public.members m;
