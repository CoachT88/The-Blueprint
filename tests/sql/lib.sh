PSQL="psql -h /var/tmp/bp-pgproof-sock -p 54329 -U postgres -X -q -v ON_ERROR_STOP=0 -d proof"
# PostgREST-shaped upsert: merge-duplicates, only the payload's columns are in SET.
# usage: upsert '<json object>' ; columns are taken from the object's keys
upsert_sql() { python3 - "$1" <<'PY'
import json,sys
o=json.loads(sys.argv[1]); cols=list(o.keys())
q=lambda c:'"%s"'%c
print('INSERT INTO public.user_data(%s) SELECT %s FROM json_populate_recordset(null::public.user_data, %s::json) _ ON CONFLICT ("id") DO UPDATE SET %s;'
 %(",".join(map(q,cols)),",".join(map(q,cols)),"'["+json.dumps(o).replace("'","''")+"]'",",".join("%s=EXCLUDED.%s"%(q(c),q(c)) for c in cols if c!="id")))
PY
}
row() { $PSQL -At -F'|' -c "select rev, coalesce(base_rev::text,'-'), coalesce(last_write_id,'-'), total_xp from public.user_data where id='00000000-0000-0000-0000-00000000000a'"; }
