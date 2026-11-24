import {classifyPlaybookIntent} from './lead-playbook-classifier.mjs';
import {generateValidatedStructuredPlaybookReply} from './lead-playbook-replies-v2.mjs';
import {loadPlaybookServiceAreaFacts} from './lead-playbook-service-area.mjs';
import {queuePlaybookOwnerNotice} from './lead-playbook-notifications.mjs';
import {PLAYBOOK_POLICY_VERSION} from './lead-playbook.mjs';
import {suppressLeadPhone} from './lead-opt-out.mjs';
import {redactPlaybookSlots} from './playbook-redaction.mjs';

const ORG = 'org-opwp';

// The caller has already checked ownership, customer admission and suppression.
// Reuse the established draft/transport pipeline rather than calling Quo here.
export async function prepareStructuredPlaybookInbound(db, env, {
  conversation, lead, flatLead, state, priorStateJson, inbound, event, context,
}, {now = new Date(),classifierOptions = {},replyOptions = {},serviceArea} = {}) {
  const classification = await classifyPlaybookIntent(event.text, context, {db,env,now,...classifierOptions});
  await db.prepare("UPDATE playbook_turns SET intent=?,slots_json=? WHERE provider_message_id=? AND thread_id IN (SELECT id FROM playbook_threads WHERE organization_id=? AND source_id='live-quo-business')")
    .bind(classification.intent || 'unclear',JSON.stringify(redactPlaybookSlots(classification.slots || {})),event.providerMessageId,ORG).run();
  if ((classification.intents || []).some(intent=>['stop','wrong_number'].includes(intent))) {
    const reason = classification.intents.includes('wrong_number') ? 'wrong_number' : 'opted_out';
    await suppressLeadPhone(db,env,{phone:lead.phone,eventId:event.providerMessageId,at:event.createdAt || now,reason});
    await db.prepare("UPDATE lead_playbook_state SET prior_state_json=state_json,state_json=json_set(state_json,'$.last_inbound_message_id',?),revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND organization_id=? AND state_json=?").bind(inbound.id,conversation.id,ORG,priorStateJson).run();
    return {stopped:true,result:{escalated:false,reason}};
  }
  const area = serviceArea || await loadPlaybookServiceAreaFacts(db, {now});
  const decision = await generateValidatedStructuredPlaybookReply({classification,lead:flatLead,state,conversation,serviceArea:area,now}, replyOptions);
  if (!decision.body) throw new Error('structured_reply_unavailable');
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
    const eventKey = `${reason}:${inbound.id}`;
    await queuePlaybookOwnerNotice(db,env,{kind:'lead_review',submissionId:lead.id,conversationId:conversation.id,eventKey});
    decision.staffEventKey = eventKey;
    decision.staffEventKeys.push(eventKey);
  }
  if (reasons.length) await db.prepare("UPDATE growth_leads SET next_action='Craig: review the conversation topic',next_action_at=CURRENT_TIMESTAMP,priority='high',updated_at=CURRENT_TIMESTAMP WHERE submission_id=? AND organization_id=?").bind(lead.id,ORG).run();
  const {createPlaybookDraft} = await import('./lead-playbook-service.js');
  const result = await createPlaybookDraft(db,env,{conversation,lead,inboundMessageId:inbound.id,decision:{...decision,priorState:state,priorStateJson}});
  console.log(JSON.stringify({event:'structured_playbook_reply_prepared',conversationId:conversation.id,
    draftId:result.draft?.id || null,classifierReason:classification.reason || '',
    intents:classification.intents || [],replyReason:decision.reason || '',notifyReasons:reasons}));
  return {result,decision,classification};
}
