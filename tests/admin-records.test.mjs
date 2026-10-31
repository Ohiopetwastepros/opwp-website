import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {validateRecordFields,recordVersion,RecordError} from '../lib/admin-record-policy.mjs';
import {saveBusinessRecord,readBusinessRecord,recordHistory,listBusinessRecords,withRecordLease,patchCockpitRecord} from '../lib/admin-record-store.mjs';

const base='appcAWPBQB8GmOrcT',table='tblhi8MGUOsWNmd37',id='rec12345678901234';
const name='fld12345678901234',note='fld23456789012345',status='fld34567890123456',computed='fld45678901234567';
const schema={id:table,name:'Customers',primaryFieldId:name,fields:[{id:name,name:'Client Name',type:'singleLineText'},{id:note,name:'Notes',type:'multilineText'},{id:status,name:'Status',type:'singleSelect',options:{choices:[{id:'sel1',name:'Active'},{id:'sel2',name:'Paused'}]}},{id:computed,name:'Computed',type:'formula'}]};
function fixture({failWrite=false}={}) {
  const sql=new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,captured_at TEXT,updated_at TEXT,error TEXT)');
  const db={prepare(query){let values=[];const statement={bind(...args){values=args;return statement;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const r=sql.prepare(query).run(...values);return {meta:{changes:Number(r.changes)}};}};return statement;}};
  let current={id,fields:{'Client Name':'Test Customer',Notes:'Original',Status:'Active'}},writes=0,providerCalls=0;
  sql.prepare("INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload) VALUES ('business_cockpit',?)").run(JSON.stringify({opwp:{customers:[current]},untouched:{value:'preserve me'}}));
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async(input,options={})=>{
    providerCalls++;
    const url=new URL(input);
    assert.equal(url.hostname,'api.airtable.com');
    if(url.pathname.includes('/meta/'))return Response.json({tables:[schema]});
    if(options.method){writes++;if(failWrite)return Response.json({}, {status:503});const body=JSON.parse(options.body);assert.equal(body.typecast,false);for(const [key,value] of Object.entries(body.fields)){const f=schema.fields.find(f=>f.id===key);if(value===null)delete current.fields[f.name];else current.fields[f.name]=value;}return Response.json(current);}
    if(url.pathname.endsWith('/'+id))return Response.json(current);
    if(url.pathname.endsWith('/'+table))return Response.json({records:[current]});
    return Response.json({}, {status:404});
  };
  return {env:{AIRTABLE_API_KEY:'test-only',DB:db},db,sql,current:()=>current,mutate:()=>{current.fields.Notes='Concurrent edit';},writes:()=>writes,calls:()=>providerCalls,close(){globalThis.fetch=oldFetch;sql.close();}};
}
const body=version=>({base,table,recordId:id,action:'update',version,commandId:crypto.randomUUID(),fields:{[note]:'Corrected'}});
test('record edits are read back, atomically update the cockpit, retain history and can restore previous values',async()=>{
  const f=fixture();try{
    const opened=await readBusinessRecord(f.env,base,table,id),command=body(opened.version);
    const saved=await saveBusinessRecord(f.env,command,'owner');
    assert.equal(saved.record.fields.Notes,'Corrected');
    const snapshot=JSON.parse(f.sql.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key='business_cockpit'").get().payload);
    assert.equal(snapshot.opwp.customers[0].fields.Notes,'Corrected');assert.equal(snapshot.untouched.value,'preserve me');
    const history=await recordHistory(f.env,base,table,id);assert.equal(history[0].state,'applied');assert.equal(history[0].fields[0].before,'Original');
    const replay=await saveBusinessRecord(f.env,command,'owner');assert.equal(replay.replayed,true);assert.equal(f.writes(),1);
    const restored=await saveBusinessRecord(f.env,{...body(saved.version),action:'undo',changeId:command.commandId},'owner');
    assert.equal(restored.record.fields.Notes,'Original');
  }finally{f.close();}
});
test('stale edits, foreign bases/tables/records, calculated fields and invalid selections never write',async()=>{
  const f=fixture();try{
    const opened=await readBusinessRecord(f.env,base,table,id);
    for(const change of [{version:'stale'},{base:'appForeign0000000'},{table:'tbl99999999999999'},{recordId:'rec99999999999999'},{fields:{[computed]:9}},{fields:{[status]:'Not a real choice'}},{fields:{__proto__:'bad'}},{fields:{[note]:{nested:'data'}}}])await assert.rejects(saveBusinessRecord(f.env,{...body(opened.version),...change},'owner'),RecordError);
    assert.equal(f.writes(),0);
  }finally{f.close();}
});
test('cleared values are removed from the dashboard snapshot and concurrent unrelated values are preserved',async()=>{
  const f=fixture();try{
    const version=await recordVersion(f.current());
    await saveBusinessRecord(f.env,{...body(version),fields:{[note]:null}},'owner');
    const snapshot=JSON.parse(f.sql.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key='business_cockpit'").get().payload);
    assert.equal(snapshot.opwp.customers[0].fields.Notes,undefined);assert.equal(snapshot.opwp.customers[0].fields.Status,'Active');
  }finally{f.close();}
});
test('unconfirmed provider writes are retained and cannot be replayed as a duplicate mutation',async()=>{
  const f=fixture({failWrite:true});try{
    const command=body(await recordVersion(f.current()));
    await assert.rejects(saveBusinessRecord(f.env,command,'owner'),/not been confirmed/);
    assert.equal((await recordHistory(f.env,base,table,id))[0].state,'unconfirmed');
    await assert.rejects(saveBusinessRecord(f.env,command,'owner'),/unconfirmed/);
    assert.equal(f.writes(),1);
  }finally{f.close();}
});
test('restoring an older edit never overwrites a newer change and save locks fail closed',async()=>{
  const f=fixture();try{
    const command=body(await recordVersion(f.current()));await saveBusinessRecord(f.env,command,'owner');f.mutate();
    await assert.rejects(saveBusinessRecord(f.env,{...body(await recordVersion(f.current())),action:'undo',changeId:command.commandId},'owner'),/changed again/);
    await withRecordLease(f.db,'test',async()=>assert.rejects(withRecordLease(f.db,'test',async()=>{}),/Another save/));
    await withRecordLease(f.db,'long-running-google-check',async()=>assert.rejects(withRecordLease(f.db,'long-running-google-check',async()=>{},0),/Another save/),900000);
    assert.equal(f.writes(),1);
  }finally{f.close();}
});
test('record searches bound pagination and linked identifiers and escape literal formula input',async()=>{
  const f=fixture();try{
    assert.equal((await listBusinessRecords(f.env,{base,table,search:"O'Brien\\test"})).records.length,1);
    await assert.rejects(listBusinessRecords(f.env,{base,table,ids:['../foreign']}),/valid linked/);
    await assert.rejects(listBusinessRecords(f.env,{base,table,search:'x'.repeat(121)}),/too long/);
  }finally{f.close();}
});
test('calculated and website-owned projections are read only; field values cannot smuggle objects or script URLs',()=>{
  for(const [type,value] of [['number',Infinity],['checkbox','yes'],['date','2026-02-30'],['dateTime','not a date'],['url','javascript:alert(1)'],['email','bad'],['singleLineText',{}]])assert.throws(()=>validateRecordFields({id:table,fields:[{id:name,name:'Value',type}]},null,{[name]:value}),RecordError);
  assert.throws(()=>validateRecordFields({...schema,id:'tblCrdvGKkGobRWxL'},null,{[note]:'wrong workflow'}),RecordError);
});
