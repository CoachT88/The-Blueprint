-- ═══════════════════════════════════════════════════════════════════════════
-- STAGING ONLY. 99a: undo the simulated purchase and nothing else.
-- ═══════════════════════════════════════════════════════════════════════════
-- Removes the rows file 03 created and detaches the test account, leaving the
-- schema in place for another run. Does not touch auth.users, user_data, or
-- any real row (there are none: staging holds only simulated purchases).
-- ═══════════════════════════════════════════════════════════════════════════
do $guard$
begin
    if to_regclass('public._staging_marker') is null then
        raise exception 'REFUSED: no staging marker. This file is for the marked staging project only.';
    end if;
end
$guard$;

delete from public.members
 where lower(btrim(email)) in (select lower(btrim(email)) from public.purchases where provider = 'simulated');
delete from public.payment_events where provider = 'simulated';
delete from public.purchases      where provider = 'simulated';

select (select count(*) from public.members)        as members_left,
       (select count(*) from public.purchases)      as purchases_left,
       (select count(*) from public.payment_events) as events_left;
