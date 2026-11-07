import assert from 'node:assert/strict';

const base = process.env.PGRST_TEST_URL || 'http://localhost:3000';
const endpoint = base + '/user_data?on_conflict=id';
const headers = {
  'Content-Type':'application/json',
  'Prefer':'resolution=merge-duplicates,return=representation'
};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function upsert(row){
  const resp=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(row)});
  const raw=await resp.text();
  let body;try{body=JSON.parse(raw)}catch{body=raw}
  return {ok:resp.ok,status:resp.status,body};
}
async function get(id){
  const resp=await fetch(base+'/user_data?id=eq.'+encodeURIComponent(id),{headers:{Accept:'application/json'}});
  const raw=await resp.text();
  assert.equal(resp.status,200,raw);
  const rows=JSON.parse(raw);return rows[0];
}
let ready=false;
for(let i=0;i<60;i++){
  try {const r=await fetch(base+'/'); if(r.status < 500){ready=true;break}}catch{}
  await pause(1000);
}
assert.ok(ready,'PostgREST never became available');
function report(name,pass,evidence){console.log('CAS_WIRE_PROOF '+JSON.stringify({name,pass,evidence}));if(!pass)process.exitCode=1;}

// Case 7: inserts work on both generations.
const v1Create=await upsert({id:'v1',schedule:['length','rest','rest','rest','rest','rest','rest']});
const v2Create=await upsert({id:'v2',programme_version:2,rev:10,
  schedule:['rest','rest','rest','rest','rest','rest','rest'],
  programme:{key:'eq-v2'},session_log:[{id:'A'}],measurements:[{id:'M1'}]});
report('insert-v1-and-v2',v1Create.ok&&v2Create.ok,{v1:v1Create.status,v2:v2Create.status});

// Case 1: original unchanged v1 writer stays functional.
const v1Write=await upsert({id:'v1',session_log:[{id:'V1-new'}],total_xp:22});
const v1Read=await get('v1');
report('v1-writer-on-v1-row',v1Write.ok&&v1Read.total_xp===22&&v1Read.session_log[0].id==='V1-new',
  {status:v1Write.status,rev:v1Read.rev,version:v1Read.programme_version});

// Case 2: old upsert on protected v2 row must be rejected atomically.
const before=await get('v2');
const rejected=await upsert({id:'v2',schedule:['length','girth','rest','rest','rest','rest','rest'],
  programme:{key:'size'},session_log:[{id:'old-overwrite'}],total_xp:9000});
const after=await get('v2');
report('legacy-v1-on-v2-atomic-rejection',
 !rejected.ok&&JSON.stringify(before)===JSON.stringify(after),
 {status:rejected.status,error:rejected.body,version:after.programme_version,rev:after.rev});

// Cases 3 and 4: a revision race admits exactly one, next revision continues.
const winner=await upsert({id:'v2',programme_version:2,rev:11,
  session_log:[{id:'A'},{id:'B'}],total_xp:20});
const stale=await upsert({id:'v2',programme_version:2,rev:11,
  session_log:[{id:'A'},{id:'C'}],total_xp:30});
const raced=await get('v2');
report('two-v2-writers-same-rev',winner.ok&&!stale.ok&&raced.rev===11
  &&raced.session_log.some(x=>x.id==='B')&&!raced.session_log.some(x=>x.id==='C'),
 {winner:winner.status,stale:stale.status,rev:raced.rev});
const next=await upsert({id:'v2',programme_version:2,rev:12,total_xp:21});
const nextRow=await get('v2');
report('winner-next-revision',next.ok&&nextRow.rev===12&&nextRow.total_xp===21,
 {status:next.status,rev:nextRow.rev});

// Case 6 (server half ONLY): old dirty backup cannot write unchanged or stale rev.
const oldBackup=await upsert({id:'v2',session_log:[{id:'old-dirty'}],measurements:[],
 total_xp:1});
const oldRev=await upsert({id:'v2',programme_version:2,rev:11,
 session_log:[{id:'old-dirty'}],total_xp:1});
const finalRow=await get('v2');
report('old-dirty-backup-server-only-rejection',
 !oldBackup.ok&&!oldRev.ok&&finalRow.rev===12&&finalRow.session_log.some(x=>x.id==='B'),
 {oldShapeStatus:oldBackup.status,staleRevStatus:oldRev.status,rev:finalRow.rev});

console.log('CAS_WIRE_LIMITS: This is actual PostgREST + temporary PostgreSQL, but NOT an app/index.html _commitWrite()/loadPersisted() integration. Retry/unknown-response, backup quarantine, app auth/RLS, server service-role writers, and complete writer inventory remain UNPROVEN.');
if(process.exitCode)throw Error('One or more CAS wire checks failed');
