import {normalizePhone} from './lead-assistant.mjs';
import {controlledLeadRecipientAllowed,isCraigMetaTest} from './lead-rollout-policy.mjs';
import {formatMetaSms} from './meta-lead-policy.mjs';
import {isFirstLeadMessage} from './lead-first-contact.mjs';

const ORG='org-opwp';
const at=value=>Date.parse(String(value||'').replace(' ','T')+(/Z$|[+-]\d\d:\d\d$/.test(String(value||''))?'':'Z'));
const changes=result=>Number(result?.meta?.changes||0)===1;

function eventScope(env,event,now){
  if(env.LEAD_CONVERSATION_V2_ENABLED!=='true'||env.LEAD_PLAYBOOK_ENABLED!=='true'||event?.direction!=='outbound'||event.isGroup)return null;
  if(typeof event.providerMessageId!=='string'||!event.providerMessageId||event.providerMessageId.length>160||typeof event.text!=='string'||!event.text||event.text.length>4000)return null;
  const from=normalizePhone(event.from),to=normalizePhone(event.to),clock=new Date(now).getTime(),created=at(event.createdAt);
  if(!from||from!==normalizePhone(env.QUO_FROM_NUMBER)||!to||!controlledLeadRecipientAllowed(env,to))return null;
  return {from,to,clock,created,text:event.text};
}
function rowMatches(row,scope,event){
  if(normalizePhone(row.phone)!==scope.to)return false;
  if(row.external_thread_id&&row.external_thread_id!==event.conversationId)return false;
  const claimAt=at(row.claimed_at||row.attempted_at);
  return Number.isFinite(scope.clock)&&Number.isFinite(scope.created)&&Number.isFinite(claimAt)
    &&claimAt>=scope.clock-5*60000&&claimAt<=scope.clock+60000
    &&scope.created>=claimAt-5000&&scope.created<=claimAt+120000&&scope.created<=scope.clock+60000;
}

async function claimDraft(db,event,scope){
  const rows=await db.prepare(`SELECT d.id,d.send_claim,d.claimed_at,d.final_body,d.conversation_id,s.phone,c.external_thread_id
    FROM lead_reply_drafts d JOIN lead_conversations c ON c.id=d.conversation_id AND c.organization_id=d.organization_id AND c.submission_id=d.submission_id
    JOIN submissions s ON s.id=d.submission_id
    WHERE d.organization_id=? AND d.template_key='structured_playbook_v2' AND d.status='sending' AND d.provider_message_id IS NULL
      AND d.send_claim IS NOT NULL AND d.final_body=? AND julianday(d.claimed_at)>=julianday(?)
    ORDER BY d.claimed_at DESC,d.id LIMIT 20`).bind(ORG,scope.text,new Date(scope.clock-5*60000).toISOString()).all();
  const matches=(rows.results||[]).filter(row=>rowMatches(row,scope,event));
  if(matches.length!==1)return false;
  const row=matches[0];
  const result=await db.prepare(`UPDATE lead_reply_drafts SET provider_message_id=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND organization_id=? AND conversation_id=? AND send_claim=? AND claimed_at=? AND final_body=? AND status='sending' AND provider_message_id IS NULL`)
    .bind(event.providerMessageId,row.id,ORG,row.conversation_id,row.send_claim,row.claimed_at,scope.text).run();
  if(changes(result))return true;
  return Boolean(await db.prepare("SELECT 1 matched FROM lead_reply_drafts WHERE id=? AND organization_id=? AND status='sending' AND send_claim=? AND provider_message_id=?").bind(row.id,ORG,row.send_claim,event.providerMessageId).first());
}

async function knownMetaReceipt(db,event,scope){
  const row=await db.prepare(`SELECT s.phone,c.external_thread_id FROM meta_sms_jobs j
    JOIN lead_conversations c ON c.id=j.conversation_id AND c.organization_id=j.organization_id AND c.submission_id=j.submission_id
    JOIN submissions s ON s.id=j.submission_id
    WHERE j.organization_id=? AND j.purpose='confirmation' AND j.provider_message_id=? LIMIT 1`).bind(ORG,event.providerMessageId).first();
  return Boolean(row&&normalizePhone(row.phone)===scope.to&&(!row.external_thread_id||row.external_thread_id===event.conversationId));
}

async function claimMeta(db,env,event,scope){
  const rows=await db.prepare(`SELECT j.id,j.submission_id,j.conversation_id,j.attempted_at,j.message_body,s.phone,c.external_thread_id
    FROM meta_sms_jobs j JOIN lead_conversations c ON c.id=j.conversation_id AND c.organization_id=j.organization_id AND c.submission_id=j.submission_id
    JOIN submissions s ON s.id=j.submission_id
    WHERE j.organization_id=? AND j.purpose='confirmation' AND j.status='sending' AND j.provider_message_id IS NULL
      AND j.attempted_at IS NOT NULL AND julianday(j.attempted_at)>=julianday(?)
    ORDER BY j.attempted_at DESC,j.id LIMIT 20`).bind(ORG,new Date(scope.clock-5*60000).toISOString()).all();
  const matches=[];
  for(const row of rows.results||[]){
    if(!rowMatches(row,scope,event))continue;
    const firstMessage=isCraigMetaTest(env,row.phone)||await isFirstLeadMessage(db,row);
    if(formatMetaSms(row.message_body,{firstMessage})===scope.text)matches.push(row);
  }
  if(matches.length!==1)return false;
  const row=matches[0];
  const result=await db.prepare(`UPDATE meta_sms_jobs SET provider_message_id=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND organization_id=? AND conversation_id=? AND attempted_at=? AND message_body=? AND purpose='confirmation' AND status='sending' AND provider_message_id IS NULL`)
    .bind(event.providerMessageId,row.id,ORG,row.conversation_id,row.attempted_at,row.message_body).run();
  if(changes(result))return true;
  return Boolean(await db.prepare("SELECT 1 matched FROM meta_sms_jobs WHERE id=? AND organization_id=? AND status='sending' AND attempted_at=? AND provider_message_id=?").bind(row.id,ORG,row.attempted_at,event.providerMessageId).first());
}

// The caller supplies a verified Quo delivery callback. Binding an early ID is
// receipt reconciliation only: it never sends a message, completes a draft or
// advances playbook state while the HTTP provider request is still in flight.
export async function claimEarlyPlaybookDraftReceipt(db,env,event,{now=new Date()}={}){
  const scope=eventScope(env,event,now);
  if(!scope||!Number.isFinite(scope.clock)||!Number.isFinite(scope.created))return false;
  return claimDraft(db,event,scope);
}
export async function claimEarlyAutomatedLeadReceipt(db,env,event,{now=new Date()}={}){
  const scope=eventScope(env,event,now);
  if(!scope)return false;
  if(await knownMetaReceipt(db,event,scope))return true;
  if(!Number.isFinite(scope.clock)||!Number.isFinite(scope.created))return false;
  return await claimDraft(db,event,scope)||await claimMeta(db,env,event,scope);
}
