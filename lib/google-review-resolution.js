import { readGoogleReviewTracker, runScheduledGoogleReviewSync } from './google-review-sync';
import { buildGoogleReviewAudit, saveGoogleReviewAudit, getGoogleReviewHealth, getGoogleReviewDecisions, GOOGLE_REVIEW_DECISIONS_KEY } from './google-review-state.mjs';
import { matchGoogleReviews, parseReviewAliases, reviewRatingNumber } from './google-review-matching.mjs';
import { withRecordLease, readPrivateState, savePrivateState, recordProvider, patchCockpitRecord } from './admin-record-store.mjs';
import { RecordError, RECORD_ID } from './admin-record-policy.mjs';
const BASE='appcAWPBQB8GmOrcT',TABLE='tblzRg9DZKdIRQDrn';
export function reviewRows(records) {
  return records.map(({id,fields:f})=>({id,customer:f['Client Name']||'Unknown',clientType:f['Client Type']||'Unknown',customerStatus:f['Customer Status']||'Unknown',reviewStatus:f['Google Review']||'Not reviewed',reviewName:f['Review Name']||'',reviewAliases:f['Google Review Aliases']||'',reviewDate:f['Review Date']||'',reviewRating:f['Review Rating']||null,reviewNotes:f.Notes||'',lastCompleted:f['Last Completed Job']||'',completedJobs:Number(f['Completed Jobs'])||0,priority:f['Follow-up Priority']||''}));
}
export async function reviewResolutionData(env) {
  const [health,decisions,snapshot]=await Promise.all([getGoogleReviewHealth(env.DB,env),getGoogleReviewDecisions(env.DB),readPrivateState(env.DB,'business_cockpit')]);
  return {health,decisionVersion:decisions.updatedAt||'',decisions:decisions.reviews||{},rows:reviewRows(snapshot?.opwp?.reviewTracker||[])};
}
export async function resolveGoogleReview(env,body,actor) {
  if (body.action==='check') { await runScheduledGoogleReviewSync(env,{refreshRoster:false}); return reviewResolutionData(env); }
  const {action,reviewId,recordId,reason='',commandId,decisionVersion}=body;
  if(!['assign','ignore','reopen'].includes(action)||typeof reviewId!=='string'||reviewId.length>200||['__proto__','constructor','prototype'].includes(reviewId)||typeof reason!=='string'||reason.length>1000||!/^[a-f0-9-]{36}$/.test(commandId||'')) throw new RecordError('Choose a valid review action.');
  if (['assign','ignore'].includes(action)&&!reason.trim()) throw new RecordError('Add a short reason for this review decision.');
  return withRecordLease(env.DB,'google-reviews',async()=>{
    const commandKey='google_review_change:'+commandId;
    const previous=await readPrivateState(env.DB,commandKey);
    if(previous){if(previous.actor!==actor||previous.reviewId!==reviewId||previous.action!==action||previous.recordId!==(recordId||''))throw new RecordError('This save identifier belongs to another decision.',409);if(previous.state==='applied')return reviewResolutionData(env);throw new RecordError('The previous save is unconfirmed. Reload the review and inspect its current match before retrying.',409);}
    const decisions=await getGoogleReviewDecisions(env.DB);
    if (typeof decisionVersion!=='string'||decisionVersion!==(decisions.updatedAt||'')) throw new RecordError('Review decisions have changed. Reload the list before saving.',409);
    const old=await readPrivateState(env.DB,'google_review_audit_v1');
    if(old?.source!=='google_api'||!Array.isArray(old.reviews))throw new RecordError('Use Check Google now to load the review details first.',409);
    const review=old.reviews.find(r=>r.reviewId===reviewId);
    if(!review)throw new RecordError('This review was not found in the last Google check.',404);
    const records=await readGoogleReviewTracker(env);
    const record=action==='assign'&&records.find(r=>r.id===recordId&&r.fields['Client Type']!=='Unmatched review');
    if(action==='assign'&&(!RECORD_ID.test(recordId||'')||!record))throw new RecordError('Choose a customer from this review tracker.',404);
    const audit={actor,action,reviewId,recordId:recordId||'',reason:reason.trim(),state:'pending',createdAt:new Date().toISOString(),previous:decisions.reviews[reviewId]||null};
    await savePrivateState(env.DB,commandKey,audit,'pending');
    const next={...decisions,reviews:{...decisions.reviews},updatedAt:new Date().toISOString()};
    if(action==='reopen')delete next.reviews[reviewId];
    else next.reviews[reviewId]={action,recordId:recordId||'',reason:reason.trim(),actor,updatedAt:next.updatedAt};
    try {
      if(record){
        const aliases=parseReviewAliases(record.fields['Google Review Aliases']);
        const displayName=review.reviewer?.displayName||'';
        if(displayName&&displayName!=='Anonymous'&&!aliases.some(a=>a===displayName))aliases.push(displayName);
        const aliasValue=aliases.join('\n');
        if(aliases.length>20||aliasValue.length>500)throw new RecordError('This customer has too many saved aliases. Edit their aliases before adding another.');
        const fields={'Google Review':'Reviewed','Follow-up Priority':'Do not contact - reviewed','Review Name':displayName,'Google Review Aliases':aliasValue};
        const rating=reviewRatingNumber(review.starRating);if(rating)fields['Review Rating']=rating;
        if(Number.isFinite(Date.parse(review.createTime)))fields['Review Date']=new Date(review.createTime).toISOString().slice(0,10);
        const returned=await recordProvider(env,'/'+BASE+'/'+TABLE+'/'+record.id,{method:'PATCH',body:JSON.stringify({fields,typecast:false})});
        const verified=await recordProvider(env,'/'+BASE+'/'+TABLE+'/'+record.id);
        if(returned.id!==record.id||Object.entries(fields).some(([k,v])=>String(verified.fields[k]??'')!==String(v)))throw new RecordError('The customer update could not be verified. Reload before another decision.',502);
        record.fields={...record.fields,...verified.fields};
        await patchCockpitRecord(env.DB,TABLE,verified);
      }
      await savePrivateState(env.DB,GOOGLE_REVIEW_DECISIONS_KEY,next);
      const result=matchGoogleReviews(records,old.reviews,next.reviews);
      const updatedAudit={...buildGoogleReviewAudit(records,old.reviews,result,{now:old.capturedAt}),resolvedAt:next.updatedAt};
      await saveGoogleReviewAudit(env.DB,updatedAudit);
      audit.state='applied';audit.verifiedAt=new Date().toISOString();await savePrivateState(env.DB,commandKey,audit);
      return reviewResolutionData(env);
    }catch(error){audit.state='unconfirmed';await savePrivateState(env.DB,commandKey,audit,'failed');throw error;}
  });
}
