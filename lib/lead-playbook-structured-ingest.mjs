import {classifyPlaybookIntent} from './lead-playbook-classifier.mjs';
import {generateValidatedStructuredPlaybookReply} from './lead-playbook-replies-v2.mjs';
import {loadPlaybookServiceAreaFacts} from './lead-playbook-service-area.mjs';
import {queuePlaybookOwnerNotice} from './lead-playbook-notifications.mjs';
import {PLAYBOOK_POLICY_VERSION} from './lead-playbook.mjs';
import {suppressLeadPhone} from './lead-opt-out.mjs';
import {redactPlaybookSlots} from './playbook-redaction.mjs';
import {craigSignupEnabled,createCraigSignupDecision} from './lead-craig-signup.mjs';
import {isCraigMetaTest} from './lead-rollout-policy.mjs';

const ORG = 'org-opwp';

// The caller has already checked ownership, customer admission and suppression.
// Reuse the established draft/transport pipeline rather than calling Quo here.
export async function prepareStructuredPlaybookInbound(db, env, {
  conversation, lead, flatLead, state, priorStateJson, inbound, event, context, activeCustomer,
}, {now = new Date(),classifierOptions = {},replyOptions = {},serviceArea} = {}) {
  const signup = craigSignupEnabled(env);
  const classification = activeCustomer ? {intent:'existing_customer',intents:[],confidence:1,reason:'existing_customer_admission'} : await classifyPlaybookIntent(event.text, signup ? {
    ...context,craigSignupFlow:true,stage:state.craigSignup?.phase||'confirm',expected:state.craigSignup?.expected||'confirm',
    details:{...context.details,...state.craigSignup?.details},
  } : context, {db,env,now,...classifierOptions});
  await db.prepare("UPDATE playbook_turns SET intent=?,slots_json=? WHERE provider_message_id=? AND thread_id IN (SELECT id FROM playbook_threads WHERE organization_id=? AND source_id='live-quo-business')")
    .bind(classification.intent || 'unclear',JSON.stringify(redactPlaybookSlots(classification.slots || {})),event.providerMessageId,ORG).run();
  if ((classification.intents || []).some(intent=>intent==='stop'||!signup&&intent==='wrong_number')) {
    const reason = classification.intents.includes('wrong_number') ? 'wrong_number' : 'opted_out';
    await suppressLeadPhone(db,env,{phone:lead.phone,eventId:event.providerMessageId,at:event.createdAt || now,reason});
    await db.prepare("UPDATE lead_playbook_state SET prior_state_json=state_json,state_json=json_set(state_json,'$.last_inbound_message_id',?),revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND organization_id=? AND state_json=?").bind(inbound.id,conversation.id,ORG,priorStateJson).run();
    return {stopped:true,result:{escalated:false,reason}};
  }
  const decision = signup
    ? createCraigSignupDecision({classification,text:event.text,lead:flatLead,state,activeCustomer,controlledTest:isCraigMetaTest(env,lead.phone)})
    : await generateValidatedStructuredPlaybookReply({classification,lead:flatLead,state,conversation,serviceArea:serviceArea || await loadPlaybookServiceAreaFacts(db, {now}),now}, replyOptions);
  decision.policyVersion = PLAYBOOK_POLICY_VERSION;
  decision.state = {...decision.state,last_inbound_message_id:inbound.id,classifier_receipt:{
    version:classification.classifierVersion || '',provider:classification.provider || '',
    callId:classification.callId || null,
    callIds:classification.callIds || (classification.callId ? [classification.callId] : []),
    repairOfCallId:classification.repairOfCallId || null,
    reason:classification.reason || '',intents:classification.intents || [],
    confirms_details:classification.confirms_details || 'no',confidence:classification.confidence,
    fallback:Boolean(classification.fallbackReply),
  }};
  const reasons = [...new Set(decision.notifyReasons || [])];
  decision.staffEventKeys=[];
  for (const reason of reasons) {
    const eventKey = reason==='signup_ready' ? 'craig-signup:signup_ready:'+inbound.id : `${reason}:${inbound.id}`;
    decision.staffEventKey = eventKey;
    decision.staffEventKeys.push(eventKey);
    if(reason==='signup_ready') continue; // Queue only after the closing text is accepted and state is committed.
    await queuePlaybookOwnerNotice(db,env,{kind:'lead_review',submissionId:lead.id,conversationId:conversation.id,eventKey});
  }
  if (reasons.some(reason=>reason!=='signup_ready')) await db.prepare("UPDATE growth_leads SET next_action=CASE WHEN next_action='Ready for account setup' THEN next_action WHEN ? THEN 'Office: March check-in requested' ELSE 'Craig: review the conversation topic' END,next_action_at=CURRENT_TIMESTAMP,priority='high',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=?").bind(reasons.includes('spring_followup')?1:0,lead.id,ORG).run();
  if (!decision.body) {
    if(!signup) throw new Error('structured_reply_unavailable');
    await db.prepare("UPDATE lead_playbook_state SET prior_state_json=state_json,state_json=?,stage=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND organization_id=? AND state_json=? AND ?=(SELECT id FROM lead_messages WHERE conversation_id=? AND direction='inbound' ORDER BY created_at DESC,rowid DESC LIMIT 1)")
      .bind(JSON.stringify(decision.state),decision.state.stage,conversation.id,ORG,priorStateJson,inbound.id,conversation.id).run();
    return {result:{skipped:decision.reason},decision,classification};
  }
  const {createPlaybookDraft} = await import('./lead-playbook-service.js');
  const result = await createPlaybookDraft(db,env,{conversation,lead,inboundMessageId:inbound.id,decision:{...decision,priorState:state,priorStateJson}});
  console.log(JSON.stringify({event:'structured_playbook_reply_prepared',conversationId:conversation.id,
    draftId:result.draft?.id || null,classifierReason:classification.reason || '',
    intents:classification.intents || [],replyReason:decision.reason || '',notifyReasons:reasons}));
  return {result,decision,classification};
}
