import test from 'node:test';
import assert from 'node:assert/strict';
import {structuredThread,structuredClassification as c,craigTestPhone} from './helpers/lead-conversation-v2-thread.mjs';
import {playbookHash} from '../lib/lead-playbook-links.mjs';
import {STRUCTURED_SAFE_FALLBACK,STRUCTURED_UNCLEAR_REPLIES,STRUCTURED_SIGNUP_PATH} from '../lib/lead-playbook-replies-v2.mjs';

test('V2 real ingest and transport answer a natural yes plus quote and every informational topic after a price handoff',async t=>{
  const f=await structuredThread(t);
  const quote=await f.inbound('yes thats right just looking for a quote thx',c(['confirm_yes','question_price'],{confirms_details:'yes'}));
  assert.match(quote.body,/Got it, thank you!/);assert.match(quote.body,/2 dogs starts at \$105 per month/);assert.equal(quote.draft.status,'sent');assert.equal(quote.state.details_confirmed,true);
  assert.equal(f.modelCalls.length,1,'Even a natural confirmation uses the structured model');
  const objection=await f.inbound('thats kinda high',c(['objection_price'],{needs_owner:true,owner_reason:'price_pushback',sentiment:'negative'}));
  assert.match(objection.body,/Craig follow up.*price/);assert.equal(objection.draft.status,'sent');assert.ok(objection.state.topic_holds.includes('price_pushback'));
  assert.doesNotMatch(objection.body,/\$|discount|cheaper|lower rate/i);assert.ok(f.notices.length>0);
  const notice=f.notices.at(-1).text;assert.match(notice,/price|discount/i);assert.ok(notice.includes('thats kinda high'));assert.ok(notice.includes(f.conversationId)||notice.includes(f.submissionId));
  const info=await f.inbound('ok but whats the weekly price again and can i pay cash or check?',c(['question_price','request_cash','question_payment'],{needs_owner:true,owner_reason:'cash'}));
  assert.match(info.body,/\$105 per month/);assert.match(info.body,/A check works/);assert.match(info.body,/Cash.*offline with Craig/);assert.equal(info.draft.status,'sent');assert.ok(info.state.topic_holds.includes('price_pushback'));assert.ok(info.state.topic_holds.includes('cash'));
  const signup=await f.inbound('cool send me sign up',c(['ready_to_sign_up']));assert.ok(signup.body.includes(STRUCTURED_SIGNUP_PATH));assert.equal(signup.draft.status,'sent');
  assert.ok(f.requests.every(r=>!r.path.includes('/api/onboard')));
});

test('V2 actual send path handles multiple area/time/payment questions in one SMS without a time or coverage invention',async t=>{
  const f=await structuredThread(t);
  const turn=await f.inbound('do u guys do elmore can u come mornings and how much 2 dogs every week?',c(['question_service_area','question_service_day','question_price'],{extracted:{city:'Elmore',dogs:2,frequency:'once_a_week'}}));
  assert.match(turn.body,/don't service Elmore/);assert.match(turn.body,/can't promise a morning or any time of day/);assert.match(turn.body,/\$105 per month/);
  assert.equal(turn.state.details.city,'Perrysburg');assert.equal(turn.draft.status,'sent');assert.equal(f.customer.length,1);assert.equal(f.notices.length,0);
});

test('V2 unclear replies use two distinct re-asks, then notify Craig; a later clear question resets the count and still answers',async t=>{
  const f=await structuredThread(t);
  const one=await f.inbound('asdfgh',c(['unclear']));assert.equal(one.body,STRUCTURED_UNCLEAR_REPLIES[0]);assert.equal(one.draft.status,'sent');assert.equal(f.notices.length,0);
  const two=await f.inbound('🦄🍕',c(['unclear']));assert.equal(two.body,STRUCTURED_UNCLEAR_REPLIES[1]);assert.equal(two.draft.status,'sent');assert.equal(f.notices.length,0);
  const three=await f.inbound('the thing from before',c(['unclear']));assert.equal(three.body,STRUCTURED_UNCLEAR_REPLIES[2]);assert.equal(three.draft.status,'sent');assert.ok(f.notices.length>0);assert.match(f.notices.at(-1).text,/two.*clarification|still unclear/i);
  const clear=await f.inbound('how much every week 2 dogs?',c(['question_price'],{extracted:{dogs:2,frequency:'once_a_week'}}));assert.match(clear.body,/\$105 per month/);assert.equal(clear.state.unclear_count,0);assert.equal(clear.draft.status,'sent');
  const again=await f.inbound('???',c(['unclear']));assert.equal(again.body,STRUCTURED_UNCLEAR_REPLIES[0]);
});

test('V2 model rejection, invalid JSON, and timeout each send a safe logged re-ask instead of leaving a pending draft',async t=>{
  for(const [label,plan]of [['failed',async()=>{throw Error('mock model failure');}],['invalid','not JSON'],['timeout',()=>new Promise(()=>{})]]){
    const f=await structuredThread(t,{notifications:false});
    const reply=await f.inbound('messy real text '+label,plan);
    assert.equal(reply.body,STRUCTURED_UNCLEAR_REPLIES[0],label);assert.equal(reply.draft.status,'sent',label);
    const receipt=f.db.sqlite.prepare('SELECT status FROM lead_classifier_calls ORDER BY rowid DESC LIMIT 1').get();assert.ok(['failed','invalid'].includes(receipt.status));
    assert.equal(reply.state.classifier_receipt.fallback,true);assert.equal(reply.draft.confidence,1);
    t.mock.restoreAll();
  }
});

test('V2 validation regenerates once then the real sender accepts only the safe fallback',async t=>{
  const f=await structuredThread(t);
  let attempts=0;
  const reply=await f.inbound('how much for 2 dogs weekly',c(['question_price']),{directOptions:{replyOptions:{drafter:async()=>{attempts++;return "I'll come by 8am for $1 and give you a discount.";}}}});
  assert.equal(attempts,2);assert.equal(reply.body,STRUCTURED_SAFE_FALLBACK);assert.equal(reply.draft.status,'sent');assert.equal(reply.draft.reason,'invalid_reply_fallback');assert.ok(f.notices.length>0);
  assert.equal(f.customer.length,1);assert.doesNotMatch(f.customer[0],/\$1|8am|discount/);
});

test('V2 STOP with a price question wins before the model and no subsequent provider POST is sent',async t=>{
  const f=await structuredThread(t);
  const stopped=await f.inbound('stop pls but how much for weekly',async()=>{throw Error('STOP must not call model');});
  assert.equal(stopped.body,'');assert.equal(f.modelCalls.length,0);
  const suppression=f.db.sqlite.prepare("SELECT reason FROM lead_suppressions WHERE organization_id='org-opwp' AND phone_hash=?").get(await playbookHash(craigTestPhone));assert.equal(suppression.reason,'opted_out');
  const before=f.requests.filter(r=>r.method==='POST').length;
  const after=await f.inbound('how much every week?',c(['question_price']));assert.equal(after.body,'');assert.equal(f.modelCalls.length,0);assert.equal(f.requests.filter(r=>r.method==='POST').length,before);assert.equal(f.customer.length,0);
});

test('V2 controlled test cannot call the model or text another recipient with an existing form thread',async t=>{
  const f=await structuredThread(t,{phone:'+14195550129'});
  const turn=await f.inbound('how much 2 dogs weekly?',c(['question_price']));assert.equal(turn.body,'');assert.equal(f.modelCalls.length,0);assert.equal(f.customer.length,0);assert.equal(f.notices.length,0);
});

test('V2 an explicit human Quo reply matching a pending draft still pauses automation and prevents the next reply',async t=>{
  const f=await structuredThread(t);
  f.env.LEAD_PLAYBOOK_AUTO_SEND_ENABLED='false';
  const pending=await f.inbound('how much 2 dogs weekly?',c(['question_price']));assert.equal(pending.body,'');assert.equal(pending.draft.status,'pending');
  await f.manual(pending.draft.body);
  const ownership=f.db.sqlite.prepare('SELECT owner,automation_mode FROM lead_conversations WHERE id=?').get(f.conversationId);assert.equal(ownership.owner,'craig');assert.equal(ownership.automation_mode,'paused');
  assert.equal(f.db.sqlite.prepare('SELECT status FROM lead_reply_drafts WHERE id=?').get(pending.draft.id).status,'superseded');
  f.env.LEAD_PLAYBOOK_AUTO_SEND_ENABLED='true';const modelBefore=f.modelCalls.length;
  const after=await f.inbound('can i pay by check?',c(['question_payment']));assert.equal(after.body,'');assert.equal(f.modelCalls.length,modelBefore);assert.equal(f.customer.length,0);
});

test('V2 area authority changing after draft creation sends the safe fallback instead of a stale positive claim or silence',async t=>{
  const f=await structuredThread(t);
  f.env.LEAD_PLAYBOOK_AUTO_SEND_ENABLED='false';
  const pending=await f.inbound('do you service Perrysburg?',c(['question_service_area'],{extracted:{city:'Perrysburg'}}));
  assert.equal(pending.body,'');assert.equal(pending.draft.status,'pending');assert.match(pending.draft.body,/active clients in Perrysburg/);
  f.db.sqlite.prepare("UPDATE airtable_cockpit_snapshots SET status='error' WHERE snapshot_key='business_cockpit'").run();
  f.env.LEAD_PLAYBOOK_AUTO_SEND_ENABLED='true';
  await f.sendDraft(pending.draft.id);
  assert.deepEqual(f.customer,[STRUCTURED_SAFE_FALLBACK]);
  const sent=f.db.sqlite.prepare('SELECT status,body,reason FROM lead_reply_drafts WHERE id=?').get(pending.draft.id);
  assert.equal(sent.status,'sent');assert.equal(sent.body,STRUCTURED_SAFE_FALLBACK);assert.equal(sent.reason,'invalid_reply_fallback');
  assert.doesNotMatch(f.customer[0],/active clients|We service Perrysburg/);
});

test('V2 real ingestion handles bounded playbook FAQ topics and shared-grid add-ons without a legacy intent regex',async t=>{
  const f=await structuredThread(t);
  const reply=await f.inbound('will u still come in rain do i gotta be home and how much is sanitizer?',c(['faq_question'],{playbook_topics:['rain_snow','home','treatments']}));
  assert.match(reply.body,/rain or shine/);assert.match(reply.body,/Nobody needs to be home/);assert.match(reply.body,/\$30 per month.*\$35 one time.*\$25 per treatment/);assert.equal(reply.draft.status,'sent');assert.equal(f.notices.length,0);assert.equal(f.modelCalls.length,1);
});
