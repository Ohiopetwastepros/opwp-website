import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {buildGoogleReviewAudit,saveGoogleReviewAudit,getGoogleReviewHealth,getGoogleReviewDecisions,GOOGLE_REVIEW_DECISIONS_KEY} from '../lib/google-review-state.mjs';
import {matchGoogleReviews,parseReviewAliases,reviewRatingNumber} from '../lib/google-review-matching.mjs';
import {withRecordLease,readPrivateState,savePrivateState,patchCockpitRecord} from '../lib/admin-record-store.mjs';
import {RecordError,RECORD_ID} from '../lib/admin-record-policy.mjs';
const source=fs.readFileSync(new URL('../lib/google-review-resolution.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
async function fixture(){
  const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE airtable_cockpit_snapshots(snapshot_key TEXT PRIMARY KEY,payload TEXT,status TEXT,captured_at TEXT,updated_at TEXT,error TEXT); CREATE TABLE system_sync_runs(sync_name TEXT,status TEXT,error TEXT,completed_at TEXT,started_at TEXT);');
  const db={prepare(query){let args=[];const statement={bind(...values){args=values;return statement;},async first(){return sql.prepare(query).get(...args)||null;},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}};},async all(){return {results:sql.prepare(query).all(...args)};}};return statement;}};
  const records=[{id:'rec12345678901234',fields:{'Client Name':'First Customer','Client Type':'Recurring','Google Review':'Not reviewed','Google Review Aliases':"Example Shared"}},{id:'rec23456789012345',fields:{'Client Name':'Second Customer','Client Type':'Recurring','Google Review':'Not reviewed','Google Review Aliases':"Example Shared"}}];
  const reviews=[{reviewId:'actual-google-review',reviewer:{displayName:"Example Shared"},starRating:'FIVE',comment:'Full review text for comparison.',createTime:'2026-08-01T12:00:00Z'}];
  await savePrivateState(db,'business_cockpit',{opwp:{reviewTracker:records},other:{preserve:true}});
  await saveGoogleReviewAudit(db,buildGoogleReviewAudit(records,reviews,matchGoogleReviews(records,reviews)));
  let writes=0;
  const recordProvider=async(_env,path,options={})=>{const id=path.split('/').at(-1),record=records.find(r=>r.id===id);if(!record)throw new RecordError('Not found',404);if(options.method){writes++;Object.assign(record.fields,JSON.parse(options.body).fields);}return structuredClone(record);};
  const api=runPrivateInNewContext(source+'\n({resolveGoogleReview,reviewResolutionData})',{console,Date,RecordError,RECORD_ID,withRecordLease,readPrivateState,savePrivateState,patchCockpitRecord,recordProvider,buildGoogleReviewAudit,saveGoogleReviewAudit,getGoogleReviewHealth,getGoogleReviewDecisions,GOOGLE_REVIEW_DECISIONS_KEY,matchGoogleReviews,parseReviewAliases,reviewRatingNumber,readGoogleReviewTracker:async()=>structuredClone(records),runScheduledGoogleReviewSync:async()=>{}});
  return {api,env:{DB:db,AIRTABLE_API_KEY:'test'},db,sql,records,writes:()=>writes,close:()=>sql.close()};
}
const command=(overrides={})=>({action:'assign',reviewId:'actual-google-review',recordId:'rec23456789012345',reason:'Confirmed household member',commandId:crypto.randomUUID(),decisionVersion:'',...overrides});
test('owner review assignment is verified in Airtable, backend and persistent decisions; repeated requests do not write twice',async()=>{
  const f=await fixture();try{
    const body=command(),result=await f.api.resolveGoogleReview(f.env,body,'owner');
    assert.equal(result.health.audit.ambiguous.length,0);assert.equal(result.health.audit.verifiedRecordIds[0],body.recordId);assert.equal(result.health.audit.reviews[0].comment,'Full review text for comparison.');
    assert.equal(result.rows.find(r=>r.id===body.recordId).reviewStatus,'Reviewed');
    const decisions=await getGoogleReviewDecisions(f.db);assert.equal(decisions.reviews[body.reviewId].recordId,body.recordId);
    await f.api.resolveGoogleReview(f.env,body,'owner');assert.equal(f.writes(),1);
    const next=matchGoogleReviews(f.records,result.health.audit.reviews,decisions.reviews);assert.equal(next.matches[0].record.id,body.recordId);
    const ignored=await f.api.resolveGoogleReview(f.env,command({action:'ignore',recordId:'',decisionVersion:result.decisionVersion,reason:'Owner set aside after review'}),'owner');
    assert.equal(ignored.health.audit.ignored.length,1);assert.equal(ignored.rows.find(r=>r.id===body.recordId).reviewStatus,'Reviewed');assert.equal(ignored.health.audit.completedNotVerified.length,1);
  }finally{f.close();}
});
test('unknown reviews, foreign customer IDs, stale decisions and missing reasons cannot write a review decision',async()=>{
  const f=await fixture();try{
    for(const overrides of [{reviewId:'not-in-google'},{recordId:'rec99999999999999'},{decisionVersion:'stale'},{reason:''},{reviewId:'__proto__'},{action:'delete'}])await assert.rejects(f.api.resolveGoogleReview(f.env,command(overrides),'owner'),RecordError);
    assert.equal(f.writes(),0);assert.deepEqual((await getGoogleReviewDecisions(f.db)).reviews,{});
  }finally{f.close();}
});
