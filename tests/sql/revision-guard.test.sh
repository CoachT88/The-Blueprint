#!/bin/bash
cd "$(dirname "$0")"; source ./lib.sh
ID=00000000-0000-0000-0000-00000000000a; PASS=0; FAIL=0
chk(){ if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1   expected [$3] got [$2]"; fi; }
up(){ out=$($PSQL -v VERBOSITY=verbose -c "$(upsert_sql "$1")" 2>&1); if echo "$out" | grep -q PT409; then echo "$out" | grep -o "PT409: [a-z_]*" | head -1; elif echo "$out" | grep -qi "error"; then echo "ERR $out"; else echo OK; fi; }
log(){ $PSQL -At -c "select session_log::text from public.user_data where id='$ID'"; }
setmode(){ $PSQL -c "update private.user_data_rev_config set enforce=$1" >/dev/null; }
reset(){ $PSQL -c "delete from public.user_data; insert into public.user_data(id) values ('$ID')" >/dev/null; }
$PSQL -f 00_setup.sql >/dev/null 2>&1; $PSQL -f "${MIG:-../../supabase/revision-guard.sql}" >/dev/null 2>&1
chk "migration leaves existing row at rev 0" "$(row)" "0|-|-|0"
echo "--- legacy writes (current client: no base_rev), SOFT mode"
chk "legacy upsert lands" "$(up '{"id":"'$ID'","total_xp":5}')" OK
chk "legacy bumps rev, base_rev stays null, no write id" "$(row)" "1|-|-|5"
echo "--- protected writes"
chk "base 1 accepted" "$(up '{"id":"'$ID'","total_xp":10,"base_rev":1,"last_write_id":"w-a"}')" OK
chk "rev 2, id w-a, base_rev reset" "$(row)" "2|-|w-a|10"
chk "base 2 accepted" "$(up '{"id":"'$ID'","total_xp":11,"base_rev":2,"last_write_id":"w-b"}')" OK
chk "STALE base 1 refused" "$(up '{"id":"'$ID'","total_xp":99,"base_rev":1,"last_write_id":"w-x"}')" "PT409: rev_conflict"
chk "base AHEAD (9) refused" "$(up '{"id":"'$ID'","total_xp":99,"base_rev":9,"last_write_id":"w-y"}')" "PT409: rev_conflict"
chk "refused writes changed nothing" "$(row)" "3|-|w-b|11"
chk "partial payload (merge-duplicates): only sent columns change" "$(up '{"id":"'$ID'","session_log":[{"sid":"s0"}],"base_rev":3,"last_write_id":"w-c"}'; row)" "$(printf 'OK\n4|-|w-c|11')"
echo "--- legacy write after a protected one (soft): lands, and is NOT mistaken for anyone's confirmed write"
chk "legacy lands over protected state" "$(up '{"id":"'$ID'","total_xp":1}')" OK
chk "rev bumped, last_write_id cleared" "$(row)" "5|-|-|1"
echo "--- HARD mode"
$PSQL -f ../../supabase/revision-guard-enforce.sql >/dev/null 2>&1   # the real hard-mode file
chk "legacy refused" "$(up '{"id":"'$ID'","total_xp":2}')" "PT409: rev_required"
chk "legacy refusal changed nothing" "$(row)" "5|-|-|1"
chk "protected still accepted" "$(up '{"id":"'$ID'","total_xp":3,"base_rev":5,"last_write_id":"w-d"}')" OK
chk "stale protected refused in hard mode too" "$(up '{"id":"'$ID'","total_xp":4,"base_rev":5,"last_write_id":"w-e"}')" "PT409: rev_conflict"
setmode false
echo "--- sync_meta (trimming memory) survives legacy writes untouched"
reset; up '{"id":"'$ID'","total_xp":1,"base_rev":0,"last_write_id":"m0","sync_meta":{"trimmed":["s:a"],"floor":"2026-01-01"}}' >/dev/null
up '{"id":"'$ID'","total_xp":2}' >/dev/null
chk "a legacy write does not wipe or alter sync_meta" "$($PSQL -At -c "select sync_meta::text from public.user_data where id='$ID'")" '{"floor": "2026-01-01", "trimmed": ["s:a"]}'
echo "--- concurrency, deterministic: A holds its transaction, B (same base) blocks, then must be refused"
reset; R=$(row | cut -d'|' -f1)
( $PSQL -c "BEGIN; $(upsert_sql '{"id":"'$ID'","total_xp":100,"base_rev":'$R',"last_write_id":"A"}') SELECT pg_sleep(2); COMMIT;" >/dev/null 2>&1 ) &
sleep 0.6
T0=$(date +%s.%N); B=$(up '{"id":"'$ID'","total_xp":200,"base_rev":'$R',"last_write_id":"B"}'); T1=$(date +%s.%N)
wait
chk "B (same base) refused after A commits" "$B" "PT409: rev_conflict"
chk "B actually waited on A's lock (>1s)" "$(python3 -c "print('yes' if $T1-$T0>1 else 'no')")" yes
chk "A's write stands" "$(row)" "1|-|A|100"
echo "--- concurrency, 20 simultaneous writers on the same base"
reset; rm -f res.*; for i in $(seq 1 20); do ( up '{"id":"'$ID'","total_xp":'$i',"base_rev":0,"last_write_id":"r'$i'"}' > res.$i ) & done; wait
chk "exactly one winner" "$(cat res.* | grep -c '^OK$')" 1
chk "19 refused with rev_conflict" "$(cat res.* | grep -c 'PT409: rev_conflict')" 19
chk "rev advanced exactly once" "$(row | cut -d'|' -f1)" 1
W=$(grep -l '^OK$' res.* | sed 's/res\.//'); chk "winner's content and id are what is stored" "$(row)" "1|-|r$W|$W"
rm -f res.*
echo "--- timeout outcomes (client lost the response). Evidence is last_write_id + rev, never a timestamp"
reset; up '{"id":"'$ID'","session_log":[{"sid":"s1"}],"base_rev":0,"last_write_id":"w1"}' >/dev/null
chk "U1 landed-but-unacked: re-read shows OUR id => confirmed" "$(row | cut -d'|' -f1,3)" "1|w1"
reset
chk "U2 not landed: re-read shows rev==base, id!=ours => still UNKNOWN (retry same write)" "$(row | cut -d'|' -f1,3)" "0|-"
chk "U2 retry (same id, same base) lands" "$(up '{"id":"'$ID'","session_log":[{"sid":"s1"}],"base_rev":0,"last_write_id":"w1"}')" OK
chk "U2b original arrives late after the retry: refused" "$(up '{"id":"'$ID'","session_log":[{"sid":"s1"}],"base_rev":0,"last_write_id":"w1"}')" "PT409: rev_conflict"
chk "U2b re-read shows our id => confirmed, no duplicate" "$(row | cut -d'|' -f1,3)" "1|w1"
reset; up '{"id":"'$ID'","session_log":[{"sid":"other"}],"base_rev":0,"last_write_id":"w2"}' >/dev/null
chk "U3 other writer landed: rev advanced, id!=ours => ours can never land" "$(row | cut -d'|' -f1,3)" "1|w2"
chk "U3 our late original (base 0) is refused" "$(up '{"id":"'$ID'","session_log":[{"sid":"s1"}],"base_rev":0,"last_write_id":"w1"}')" "PT409: rev_conflict"
chk "U3 our entry is absent => replay needed" "$(log)" '[{"sid": "other"}]'
reset; up '{"id":"'$ID'","session_log":[{"sid":"s1"}],"base_rev":0,"last_write_id":"w1"}' >/dev/null; up '{"id":"'$ID'","session_log":[]}' >/dev/null
chk "U4 landed then overwritten by a LEGACY write: id no longer ours => NOT confirmed (no false positive)" "$(row | cut -d'|' -f3)" "-"
chk "U4 content lacks our entry => replay restores it" "$(log)" "[]"
echo "--- roles: SECURITY DEFINER guard works for a Supabase-style member role; its config is not readable"
reset
$PSQL -c "set role authenticated; $(upsert_sql '{"id":"'$ID'","total_xp":7,"base_rev":0,"last_write_id":"m1"}')" >/dev/null 2>&1
chk "authenticated upsert accepted via the guard" "$(row)" "1|-|m1|7"
chk "authenticated cannot read the config" "$($PSQL -At -c 'set role authenticated; select * from private.user_data_rev_config' 2>&1 | grep -c 'permission denied')" 1
chk "authenticated cannot flip the mode" "$($PSQL -At -c 'set role authenticated; update private.user_data_rev_config set enforce=true' 2>&1 | grep -c 'permission denied')" 1
echo; echo "RESULT: $PASS passed, $FAIL failed"; [ $FAIL -eq 0 ]
