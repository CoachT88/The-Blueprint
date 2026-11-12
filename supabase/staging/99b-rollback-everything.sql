-- ═══════════════════════════════════════════════════════════════════════════
-- STAGING ONLY. 99b: remove everything file 01 added.
-- ═══════════════════════════════════════════════════════════════════════════
-- Returns staging to its state before this package: no members, purchases or
-- payment_events tables, no claim/revoke/restore functions, no marker. Refuses
-- if any purchases row is not simulated. auth.users and user_data are not
-- touched. The marker goes last so a failure leaves the guard armed.
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

do $chk$
begin
    if exists (select 1 from public.purchases where provider <> 'simulated') then
        raise exception 'REFUSED: purchases holds a non-simulated row. Not dropping.';
    end if;
end
$chk$;

drop function if exists public.claim_membership();
drop function if exists public.revoke_if_unpaid(text);
drop function if exists public.restore_if_paid(text);
drop table if exists public.payment_events;
drop table if exists public.purchases;
drop table if exists public.members;
drop table if exists public._staging_marker;
