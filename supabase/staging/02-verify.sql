-- ═══════════════════════════════════════════════════════════════════════════
-- STAGING ONLY. 02 of 4: verification. Writes nothing that survives.
-- ═══════════════════════════════════════════════════════════════════════════
-- Part A is read-only. Part B (the claim matrix) inserts synthetic users and
-- rows inside one transaction and ENDS BY RAISING AN EXCEPTION, which rolls
-- all of it back, including the auth.users rows and any user_data rows the
-- signup trigger created for them. The exception text is the report:
--   "MATRIX PASS: n checks"  or  "MATRIX FAIL: ..." listing every failure.
-- Run Part A and Part B as separate runs of the SQL editor.
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

-- ── Part A: structure (every row should read ok = true) ────────────────────
select 'tables exist' as check, bool_and(to_regclass('public.'||t) is not null) as ok
from unnest(array['members','purchases','payment_events']) t
union all
select 'functions exist', bool_and(to_regprocedure(f) is not null)
from unnest(array['public.claim_membership()','public.revoke_if_unpaid(text)','public.restore_if_paid(text)']) f
union all
select 'row level security on', bool_and(c.relrowsecurity)
from pg_class c where c.oid in ('public.members'::regclass,'public.purchases'::regclass,'public.payment_events'::regclass)
union all
select 'anon and authenticated have no table privileges', not exists (
  select 1 from unnest(array['members','purchases','payment_events']) t, unnest(array['anon','authenticated']) r
  where has_table_privilege(r, 'public.'||t, 'select,insert,update,delete'))
union all
select 'claim_membership: authenticated yes, anon no',
  has_function_privilege('authenticated','public.claim_membership()','execute')
  and not has_function_privilege('anon','public.claim_membership()','execute')
union all
select 'revoke/restore: service_role only', not exists (
  select 1 from unnest(array['public.revoke_if_unpaid(text)','public.restore_if_paid(text)']) f, unnest(array['anon','authenticated']) r
  where has_function_privilege(r, f, 'execute'))
  and has_function_privilege('service_role','public.revoke_if_unpaid(text)','execute')
union all
select 'claim_membership is security definer with a pinned search_path',
  (select prosecdef and coalesce(proconfig::text,'') like '%search_path%' from pg_proc where oid='public.claim_membership()'::regprocedure)
union all
select 'handle_new_user exists (signup creates user_data)', to_regprocedure('public.handle_new_user()') is not null
union all
select 'no real purchases present (staging holds only simulated rows)',
  not exists (select 1 from public.purchases where provider <> 'simulated');

-- ── Part B: the claim matrix (run separately; it always rolls back) ────────
do $matrix$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  u4 uuid := gen_random_uuid(); u5 uuid := gen_random_uuid();
  fails text[] := '{}'; n int := 0; r boolean; t text;
begin

  insert into auth.users (id, email, email_confirmed_at) values
    (u1, 'Matrix.Buyer@example.invalid',  now()),   -- confirmed, case differs from purchase
    (u2, 'matrix.unconfirmed@example.invalid', null),
    (u3, 'matrix.nobuy@example.invalid',  now()),
    (u4, ' matrix.second@example.invalid ', now()), -- confirmed, padded
    (u5, 'matrix.second@example.invalid', now());   -- same address as u4: second claimant

  insert into public.members (email) values
    ('matrix.buyer@example.invalid'),
    ('matrix.unconfirmed@example.invalid'),
    ('matrix.second@example.invalid'),
    ('matrix.refunded@example.invalid'),
    ('matrix.legacy@example.invalid');
  update public.members set pre_ledger = true where email = 'matrix.legacy@example.invalid';
  insert into public.purchases (provider, provider_ref, email, amount_cents, currency, status)
  values ('simulated','matrix_1','matrix.buyer@example.invalid',100,'usd','paid');

  -- 1. no session: nothing attaches
  perform set_config('request.jwt.claims', '', true);
  select public.claim_membership() into r; n := n + 1;
  if r is not false then fails := fails || 'no session must return false'::text; end if;

  -- 2. unconfirmed email never claims
  perform set_config('request.jwt.claims', json_build_object('sub', u2)::text, true);
  select public.claim_membership() into r; n := n + 1;
  if r is not false then fails := fails || 'unconfirmed email claimed'::text; end if;
  n := n + 1;
  if exists (select 1 from public.members where user_id = u2) then fails := fails || 'unconfirmed email attached'::text; end if;

  -- 3. confirmed user with no purchase row gets nothing
  perform set_config('request.jwt.claims', json_build_object('sub', u3)::text, true);
  select public.claim_membership() into r; n := n + 1;
  if r is not false then fails := fails || 'user with no purchase claimed'::text; end if;

  -- 4. confirmed, address differs only by case: claims, and stamps claimed_at
  perform set_config('request.jwt.claims', json_build_object('sub', u1)::text, true);
  select public.claim_membership() into r; n := n + 1;
  if r is not true then fails := fails || 'confirmed buyer did not claim'::text; end if;
  n := n + 1;
  if not exists (select 1 from public.members where email='matrix.buyer@example.invalid' and user_id = u1 and claimed_at is not null)
    then fails := fails || 'claim did not attach and stamp the row'::text; end if;

  -- 5. claiming again is a no-op that stays true
  select claimed_at::text into t from public.members where email='matrix.buyer@example.invalid';
  select public.claim_membership() into r; n := n + 1;
  if r is not true or t is distinct from (select claimed_at::text from public.members where email='matrix.buyer@example.invalid')
    then fails := fails || 'second claim not idempotent'::text; end if;

  -- 6. padded address claims once; a second account on the same address cannot take it
  perform set_config('request.jwt.claims', json_build_object('sub', u4)::text, true);
  select public.claim_membership() into r; n := n + 1;
  if r is not true then fails := fails || 'padded confirmed address did not claim'::text; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u5)::text, true);
  select public.claim_membership() into r; n := n + 1;
  if r is not false then fails := fails || 'second account took an attached membership'::text; end if;
  n := n + 1;
  if not exists (select 1 from public.members where email='matrix.second@example.invalid' and user_id = u4)
    then fails := fails || 'first claimant lost the row'::text; end if;

  -- 7. refund: revoke detaches; a revoked row cannot be claimed; restore re-opens it
  t := public.revoke_if_unpaid('matrix.refunded@example.invalid'); n := n + 1;
  if t <> 'revoked' then fails := fails || ('refund without paid purchase returned ' || t)::text; end if;
  insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), 'matrix.refunded@example.invalid', now());
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email='matrix.refunded@example.invalid'))::text, true);
  select public.claim_membership() into r; n := n + 1;
  if r is not false then fails := fails || 'revoked membership was claimable'::text; end if;
  insert into public.purchases (provider, provider_ref, email, status)
  values ('simulated','matrix_2','matrix.refunded@example.invalid','paid');
  n := n + 1;
  if public.restore_if_paid('matrix.refunded@example.invalid') is not true then fails := fails || 'restore_if_paid did not restore'::text; end if;
  select public.claim_membership() into r; n := n + 1;
  if r is not true then fails := fails || 'restored membership was not claimable'::text; end if;

  -- 8. revoke rules: paid purchase keeps, legacy keeps, unknown has nothing
  t := public.revoke_if_unpaid('Matrix.Buyer@example.invalid'); n := n + 1;
  if t <> 'kept_paid' then fails := fails || ('paid buyer revoke returned ' || t)::text; end if;
  t := public.revoke_if_unpaid('matrix.legacy@example.invalid'); n := n + 1;
  if t <> 'kept_legacy' then fails := fails || ('legacy member revoke returned ' || t)::text; end if;
  t := public.revoke_if_unpaid('matrix.nobody@example.invalid'); n := n + 1;
  if t <> 'no_member' then fails := fails || ('unknown address revoke returned ' || t)::text; end if;

  if array_length(fails, 1) is null then
    raise exception 'MATRIX PASS: % checks (rolled back, nothing persisted)', n;
  else
    raise exception 'MATRIX FAIL: % of % checks: %', array_length(fails, 1), n, array_to_string(fails, '; ');
  end if;
end
$matrix$;
