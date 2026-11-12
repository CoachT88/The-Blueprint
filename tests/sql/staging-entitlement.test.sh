#!/bin/bash
# Proves supabase/staging/*.sql on the throwaway cluster started by run.sh,
# against a stub of the Supabase pieces they rely on (auth.users, auth.uid(),
# roles, handle_new_user). Touches no real database.
cd "$(dirname "$0")"; source ./lib.sh
S=../../supabase/staging; T=11111111-1111-1111-1111-111111111111; PASS=0; FAIL=0
chk(){ if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1   expected [$3] got [$2]"; fi; }
ADM="psql -h /var/tmp/bp-pgproof-sock -p 54329 -U postgres -X -q"
$ADM -c "drop database if exists stg" -c "create database stg" >/dev/null
P="$ADM -v ON_ERROR_STOP=0 -d stg"
run(){ $P -1 -v ON_ERROR_STOP=1 -At -f "$1" 2>&1; }
fresh(){ $ADM -c "drop database if exists stg" -c "create database stg" >/dev/null
$P >/dev/null 2>&1 <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function public.handle_new_user() returns trigger language plpgsql as $$ begin return new; end $$;
SQL
}
sub(){ sed "s/v_test uuid := '00000000-0000-0000-0000-000000000000'/v_test uuid := '$T'/" $S/01-setup.sql > /var/tmp/01-sub.sql; }
sub
fresh
echo "--- identity: 01 refuses unless the pasted test-account id exists here"
chk "01 refuses with the placeholder id untouched" "$(run $S/01-setup.sql | grep -c 'paste the staging test account id')" 1
chk "01 refuses where that account does not exist (wrong project)" "$(run /var/tmp/01-sub.sql | grep -c 'not the staging project')" 1
$P -c "insert into auth.users values ('$T','Tester@Example.invalid', now())" >/dev/null
$P -c "insert into auth.users select gen_random_uuid(), 'bulk'||g||'@example.invalid', now() from generate_series(1,25) g" >/dev/null
chk "01 refuses a project with more than 25 users" "$(run /var/tmp/01-sub.sql | grep -c 'more than 25')" 1
$P -c "delete from auth.users where id <> '$T'" >/dev/null
echo "--- guard: refuses where the ledger already exists unmarked (production's shape)"
$P -c "create table public.purchases(id int)" >/dev/null 2>&1
$P -c "insert into auth.users values ('$T','Tester@Example.invalid', now())" >/dev/null
chk "01 refuses on an unmarked project with purchases" "$(run /var/tmp/01-sub.sql | grep -c 'REFUSED: public.purchases')" 1
chk "01 created nothing there" "$($P -At -c "select to_regclass('public.members') is null and to_regclass('public._staging_marker') is null")" t
fresh
$P -c "insert into auth.users values ('$T','Tester@Example.invalid', now())" >/dev/null
echo "--- 02/03/99 refuse before setup"
for f in 02-verify 03-simulate-purchase 99a-rollback-simulation 99b-rollback-everything; do
  chk "$f refuses without the marker" "$(run $S/$f.sql | grep -c 'REFUSED: no staging marker')" 1; done
echo "--- members matches production: created_at nullable, default now()"
run /var/tmp/01-sub.sql >/dev/null
chk "created_at is nullable with a now() default" "$($P -At -c "select is_nullable||'|'||column_default from information_schema.columns where table_name='members' and column_name='created_at'")" "YES|now()"
echo "--- 01 applies and is idempotent"
chk "01 applies with no error" "$(run /var/tmp/01-sub.sql | grep -c 'ERROR:')" 0
chk "01 re-runs with no error" "$(run /var/tmp/01-sub.sql | grep -c 'ERROR:')" 0
echo "--- 02 part A and the matrix"
chk "02 part A: every check true" "$(run $S/02-verify.sql | grep -E '\|(t|f)$' | grep -c '|f$')" 0
chk "02 part A ran all checks" "$(run $S/02-verify.sql | grep -cE '\|t$')" 9
M=$(run $S/02-verify.sql | grep 'MATRIX')
chk "matrix passes on the shipped functions" "$(echo "$M" | grep -c 'MATRIX PASS')" 1
chk "matrix leaves nothing behind" "$($P -At -c "select (select count(*) from auth.users)-1+(select count(*) from public.members)+(select count(*) from public.purchases)")" 0
echo "--- the matrix detects a broken claim (mutation: unconfirmed email allowed)"
$P -At -c "$(sed 's/    and email_confirmed_at is not null;   -- CHANGE A/;/' /var/tmp/01-sub.sql | sed -n '/create or replace function public.claim_membership/,/^\$function\$;/p')" >/dev/null 2>&1
chk "mutant installed (confirmation check gone)" "$($P -At -c "select prosrc not like '%email_confirmed_at is not null%' from pg_proc where proname='claim_membership'")" t
chk "matrix FAILS on the mutant" "$(run $S/02-verify.sql | grep 'MATRIX' | grep -c 'MATRIX FAIL.*unconfirmed')" 1
run /var/tmp/01-sub.sql >/dev/null
echo "--- later files re-check identity; 03 uses only the marker's account"
chk "02 refuses if the marker's account is gone" "$($P -At -c "begin; delete from auth.users; commit" >/dev/null; run $S/02-verify.sql | grep -c 'marker.s test account does not exist')" 1
$P -c "insert into auth.users values ('$T','Tester@Example.invalid', now())" >/dev/null
$P -c "insert into auth.users values ('22222222-2222-2222-2222-222222222222','other@example.invalid', now())" >/dev/null
run $S/03-simulate-purchase.sql >/dev/null
chk "03 simulates for the marker's account, not the other user" "$($P -At -c "select string_agg(email,',') from public.members")" "tester@example.invalid"
run $S/99a-rollback-simulation.sql >/dev/null
$P -c "delete from auth.users where id='22222222-2222-2222-2222-222222222222'" >/dev/null
echo "--- 03 simulates, the real claim path attaches"
run $S/03-simulate-purchase.sql >/dev/null; run $S/03-simulate-purchase.sql >/dev/null
chk "one simulated purchase after a re-run" "$($P -At -c "select count(*) from public.purchases where provider='simulated'")" 1
chk "member is unclaimed and active" "$($P -At -c "select user_id is null and revoked_at is null from public.members")" t
claim(){ $P -At -c "select set_config('request.jwt.claims','{\"sub\":\"11111111-1111-1111-1111-111111111111\"}',false)" -c "select public.claim_membership()" | tail -1; }
chk "real claim_membership() attaches the test account" "$(claim)" t
chk "member row now carries the account id" "$($P -At -c "select user_id::text from public.members")" 11111111-1111-1111-1111-111111111111
echo "--- rollback"
run $S/99a-rollback-simulation.sql >/dev/null
chk "99a empties members, purchases, events" "$($P -At -c "select (select count(*) from public.members)+(select count(*) from public.purchases)+(select count(*) from public.payment_events)")" 0
chk "99a keeps the schema and the test user" "$($P -At -c "select to_regclass('public.members') is not null and (select count(*) from auth.users)=1")" t
run $S/03-simulate-purchase.sql >/dev/null
$P -c "insert into public.purchases(provider,provider_ref,email) values ('stripe','real_1','x@y.z')" >/dev/null
chk "99b refuses if a non-simulated purchase exists" "$(run $S/99b-rollback-everything.sql | grep -c 'REFUSED: purchases holds')" 1
$P -c "delete from public.purchases where provider='stripe'" >/dev/null
run $S/99b-rollback-everything.sql >/dev/null
chk "99b leaves no ledger objects" "$($P -At -c "select count(*) from pg_proc where proname in ('claim_membership','revoke_if_unpaid','restore_if_paid')")|$($P -At -c "select count(*) from pg_class where relname in ('members','purchases','payment_events','_staging_marker') and relkind='r'")" "0|0"
chk "99b left auth.users and handle_new_user alone" "$($P -At -c "select (select count(*) from auth.users)=1 and to_regprocedure('public.handle_new_user()') is not null")" t
echo; echo "staging entitlement: $PASS passed, $FAIL failed"; [ $FAIL = 0 ]
