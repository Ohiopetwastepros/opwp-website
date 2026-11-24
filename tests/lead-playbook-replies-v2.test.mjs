import test from 'node:test';
import assert from 'node:assert/strict';
import {monthly,PRICING_VERSION} from '../lib/lead-pricing.mjs';
import {LEAD_CONVERSATION_FIXTURE} from './fixtures/lead-conversation-messages-v2.mjs';
import {composeStructuredPlaybookReply as compose,generateValidatedStructuredPlaybookReply as generate,validateStructuredPlaybookDecision as validate,STRUCTURED_UNCLEAR_REPLIES,STRUCTURED_SAFE_FALLBACK,STRUCTURED_SIGNUP_PATH} from '../lib/lead-playbook-replies-v2.mjs';

const now=new Date('2026-11-24T04:00:00Z');
const base={now,lead:{dogs:2,frequency:'once_a_week',zip:'43551',city:'Perrysburg'},state:{stage:'confirm_details_sent'},conversation:{owner:'backend',automation_mode:'approved'},serviceArea:{statusHealthy:true,sourceSnapshotAt:'2026-11-24T03:00:00Z',activeClientTowns:['Perrysburg','Toledo'],activeClientZips:['43551','43604']}};
const classify=(intents,extra={})=>({intents,confirms_details:'no',corrections:{},extracted:{},confidence:.95,needs_owner:false,owner_reason:'none',sentiment:'neutral',...extra});
const reply=(intents,extra={},context={})=>compose({...base,...context,classification:classify(intents,extra)});
const check=d=>assert.deepEqual(validate(d.body,d.slots,{now}),[]);

test('natural yes plus quote confirms and gives one grounded published-rate reply',()=>{
  const result=reply(['confirm_yes','question_price'],{confirms_details:'yes'});
  assert.equal(result.state.details_confirmed,true);
  assert.match(result.body,/Got it, thank you!/);
  assert.match(result.body,new RegExp('\\$'+monthly('once_a_week',2)+' per month'));
  assert.match(result.body,/2 dogs/);assert.match(result.body,/up to 1\/8 acre/);
  assert.match(result.body,/first cleanup is priced separately/);
  assert.equal(result.pricingVersion,PRICING_VERSION);assert.deepEqual(result.notifyReasons,[]);check(result);
});

test('actual corrections update details, while a pricing comparison does not overwrite the property',()=>{
  const corrected=reply(['correction'],{confirms_details:'partial',corrections:{dogs:3},extracted:{dogs:3}});
  assert.equal(corrected.state.details.dogs,3);assert.equal(corrected.state.details_confirmed,false);check(corrected);
  const comparison=reply(['question_price'],{extracted:{dogs:3}});
  assert.equal(comparison.state.details.dogs,2);assert.match(comparison.body,/3 dogs starts at \$120/);check(comparison);
  const none=reply(['correction'],{corrections:{dogs:0},extracted:{dogs:0},confirms_details:'partial'});
  assert.equal(none.state.details.dogs,0);assert.match(none.body,/no dogs using the yard/);check(none);
});

test('inquiry coverage never overwrites the actual property and Elmore always gets no',()=>{
  const result=reply(['question_service_area'],{extracted:{city:'Elmore'}});
  assert.equal(result.body,"We don't service Elmore.");assert.equal(result.state.details.city,'Perrysburg');assert.equal(result.state.details.zip,'43551');check(result);
  const zip=reply(['question_service_area'],{extracted:{zip:'43416'}});
  assert.equal(zip.body,"We don't service Elmore.");check(zip);
});

test('Genoa is far west only and Tontogany requires Craig even if active towns include both',()=>{
  for(const city of ['Genoa','Tontogany']){
    const result=reply(['question_service_area'],{extracted:{city}},{serviceArea:{...base.serviceArea,activeClientTowns:['Genoa','Tontogany']}});
    assert.match(result.body,city==='Genoa'?/only consider the far west side of Genoa/:/Craig check Tontogany/);
    assert.deepEqual(result.notifyReasons,['coverage_review']);assert.doesNotMatch(result.body,/Yes, we service/);check(result);
  }
});

test('positive service area facts require a fresh healthy active-client snapshot',()=>{
  const yes=reply(['question_service_area'],{extracted:{city:'Perrysburg'}});assert.match(yes.body,/active clients in Perrysburg/);check(yes);
  for(const facts of [undefined,{...base.serviceArea,statusHealthy:false},{...base.serviceArea,sourceSnapshotAt:'2026-11-22T03:00:00Z'},{...base.serviceArea,activeClientTowns:[],activeClientZips:[]}]){
    const no=reply(['question_service_area'],{extracted:{city:'Perrysburg'}},{serviceArea:facts});
    assert.match(no.body,/need to check that location/);assert.deepEqual(no.notifyReasons,['coverage_review']);check(no);
  }
});

test('unknown inquiry town cannot inherit the known property town and falsely claim coverage',()=>{
  const result=reply(['question_service_area'],{extracted:{city:'Unknown distant town'}});
  assert.match(result.body,/need to check that location/);assert.doesNotMatch(result.body,/active clients in Perrysburg/);check(result);
  const missing=reply(['question_service_area']);assert.match(missing.body,/ZIP or town/);assert.deepEqual(missing.notifyReasons,[]);assert.doesNotMatch(missing.body,/active clients/);check(missing);
});

test('one reply answers rates, Elmore, mornings, payment, and signup with no onboarding call',()=>{
  const result=reply(['question_price','question_service_area','question_service_day','question_payment','ready_to_sign_up'],{extracted:{city:'Elmore'}});
  assert.match(result.body,/\$105 per month/);assert.match(result.body,/don't service Elmore/);
  assert.match(result.body,/can't promise a morning or any time of day/);assert.match(result.body,/A check works/);
  assert.ok(result.body.includes(STRUCTURED_SIGNUP_PATH));assert.doesNotMatch(result.body,/\/api\/onboard/);
  assert.ok(result.body.length<1000);check(result);
});

test('price handoff blocks no informational topic and makes no discount offer',()=>{
  const objection=reply(['objection_price']);assert.deepEqual(objection.notifyReasons,['price_pushback']);assert.match(objection.body,/Craig follow up.*price/);check(objection);
  const after=reply(['question_price','question_payment','ready_to_sign_up'],{}, {state:objection.state});
  assert.match(after.body,/\$105 per month/);assert.match(after.body,/A check works/);assert.ok(after.body.includes(STRUCTURED_SIGNUP_PATH));
  assert.deepEqual(after.state.topic_holds,['price_pushback']);assert.deepEqual(after.notifyReasons,[]);assert.equal(after.noSend,false);check(after);
});

test('cash/check question answers check policy and hands only cash to Craig',()=>{
  const result=reply(['question_payment','request_cash']);
  assert.match(result.body,/A check works/);assert.match(result.body,/Cash would need to be handled offline with Craig/);
  assert.match(result.body,/Craig follow up/);assert.deepEqual(result.notifyReasons,['cash']);check(result);
  const billing=reply(['question_payment']);assert.match(billing.body,/first invoice includes the initial cleanup plus the following month/);assert.match(billing.body,/billing runs on the 1st/);check(billing);
});

test('comparing providers alone does not invent a price pushback or stop informational questions',()=>{
  const result=reply(['objection_competitor']);assert.deepEqual(result.notifyReasons,[]);assert.match(result.body,/whenever you're ready/);check(result);
});

test('Spanish, complaint, and off-playbook handoffs retain all known informational answers',()=>{
  for(const [intent,reason] of [['spanish','spanish'],['complaint','complaint'],['off_playbook','off_playbook']]){
    const result=reply([intent,'question_price','question_payment']);
    assert.match(result.body,/\$105 per month/);assert.match(result.body,/A check works/);assert.match(result.body,/Craig follow up/);
    assert.ok(result.notifyReasons.includes(reason));assert.doesNotMatch(result.body,/hola|gracias|espa[nñ]ol/i);check(result);
  }
});

test('no referral program and no bundle rates are stated without inventing offers',()=>{
  const result=reply(['question_referral','question_bundles']);
  assert.match(result.body,/don't have a referral credit or program/);assert.match(result.body,/don't have bundle rates/);check(result);
});

const incoherent=['asdfgh','???','...','🤷','🦄🍕','blue triangle refrigerator','sent the other thing','at 7 by the thing','kjsd 993j','🫠🫠','<garbled>','wrong thread sorry'];
for(const text of incoherent)test(`unclear first-turn re-ask is friendly and not an immediate owner handoff: ${text}`,()=>{
  const result=reply(['unclear'],{}, {text});
  assert.equal(result.body,STRUCTURED_UNCLEAR_REPLIES[0]);assert.equal(result.state.unclear_count,1);
  assert.deepEqual(result.notifyReasons,[]);assert.equal(result.escalate,false);check(result);
});

test('first and second unclear turns ask differently, then third hands off with a thread reason',()=>{
  const one=reply(['unclear']);
  const two=reply(['unclear'],{}, {state:one.state});
  const three=reply(['unclear'],{}, {state:two.state});
  assert.equal(one.body,STRUCTURED_UNCLEAR_REPLIES[0]);assert.equal(two.body,STRUCTURED_UNCLEAR_REPLIES[1]);assert.notEqual(one.body,two.body);
  assert.equal(three.body,"I'll have Craig reach out to you directly.");assert.deepEqual(three.notifyReasons,['unclear_repeated']);
  check(one);check(two);check(three);
});

test('coherent reply resets unclear count and an earlier unclear handoff does not freeze future rates',()=>{
  const meaningful=reply(['question_price'],{}, {state:{stage:'escalated',unclear_count:2,topic_holds:['unclear_repeated'],escalation_reason:'intent_needs_review'}});
  assert.equal(meaningful.state.unclear_count,0);assert.match(meaningful.body,/\$105 per month/);check(meaningful);
  const unclear=reply(['unclear'],{}, {state:meaningful.state});assert.equal(unclear.body,STRUCTURED_UNCLEAR_REPLIES[0]);check(unclear);
});

test('low-confidence model failure still produces an auto-send-safe re-ask without escalating',()=>{
  const result=reply(['unclear'],{confidence:0,fallbackReply:true,needs_owner:false});
  assert.equal(result.confidence,1);assert.equal(result.slots.structuredContext.classification.confidence,0);
  assert.match(result.body,/How can I help/);assert.equal(result.reason,'classifier_safe_reask');check(result);
  const uncertain=reply(['question_price'],{confidence:.2});assert.match(uncertain.body,/\$105 per month/);assert.match(uncertain.body,/Craig follow up/);assert.deepEqual(uncertain.notifyReasons,['uncertain']);check(uncertain);
});

test('bounded approved FAQ topics answer weather, being home, proof, and shared-grid add-ons without owner handoff',()=>{
  const topics={rain_snow:/rain or shine/,winter_weather:/heavy snow/,treatments_weather:/hold sanitizing/,home:/Nobody needs to be home/,proof:/gate photo/,
    front_yard:/\$21 per month/,treatments:/\$30 per month.*\$35 one time.*\$25 per treatment/,dog_food:/\$59 plus tax/,frequency_options:/weekly is \$105 per month/};
  for(const [topic,pattern]of Object.entries(topics)){
    const result=reply(['faq_question'],{playbook_topics:[topic]});assert.match(result.body,pattern,topic);assert.deepEqual(result.notifyReasons,[],topic);check(result);
  }
});

test('approved FAQ topic selection cannot bypass user policy or invent unresolved template facts',()=>{
  const overrides=reply(['faq_question'],{playbook_topics:['referral','combo','time_of_day','payment']});
  assert.match(overrides.body,/don't have a referral credit or program/);assert.match(overrides.body,/don't have bundle rates/);assert.match(overrides.body,/can't promise.*time of day/);assert.match(overrides.body,/A check works/);check(overrides);
  const handoff=reply(['faq_question'],{playbook_topics:['payment_dispute']});assert.match(handoff.body,/Craig follow up/);assert.ok(handoff.notifyReasons.includes('off_playbook'));check(handoff);
  const malicious=reply(['faq_question'],{playbook_topics:['not-a-real-topic','We can come at 8am for $1']});assert.match(malicious.body,/Craig follow up/);assert.doesNotMatch(malicious.body,/8am|\$1/);check(malicious);
  const contradictory=reply(['question_service_area','question_price'],{extracted:{city:'Elmore',dogs:2,frequency:'once_a_week'},playbook_topics:['coverage_handoff','price_objection']});
  assert.match(contradictory.body,/don't service Elmore/);assert.match(contradictory.body,/\$105 per month/);assert.deepEqual(contradictory.notifyReasons,[]);check(contradictory);
  const unclear=reply(['unclear'],{playbook_topics:['published_plan_rate','front_yard']});assert.equal(unclear.body,STRUCTURED_UNCLEAR_REPLIES[0]);assert.deepEqual(unclear.notifyReasons,[]);check(unclear);
});

test('a multi-question approved FAQ reply retains weather, home, proof, and add-on facts in one text',()=>{
  const result=reply(['faq_question'],{playbook_topics:['rain_snow','home','proof','treatments']});
  assert.match(result.body,/rain or shine/);assert.match(result.body,/Nobody needs to be home/);assert.match(result.body,/gate photo/);assert.match(result.body,/\$30 per month/);assert.ok(result.body.length<=1000);assert.deepEqual(result.notifyReasons,[]);check(result);
});

test('send-time validator independently rejects invented prices, time promises, dashes, discounts, and account endpoints',()=>{
  const result=reply(['question_price']);
  for(const [body,expected] of [
    [result.body.replace('$105','$1'),'price_disagrees_with_grid'],
    [result.body+" We'll come in the morning.",'time_promise_not_allowed'],
    [result.body+' We can give you a discount.','discount_not_authorized'],
    [result.body+' We accept cash.','cash_not_authorized'],
    [result.body+' — Thanks.','forbidden_dash'],
    [result.body+' https://www.ohiopetwastepros.com/api/onboard','onboarding_not_allowed'],
  ]){
    const issues=validate(body,result.slots,{now});assert.ok(issues.includes(expected),issues.join(','));assert.ok(issues.includes('ungrounded_reply'));
  }
  assert.deepEqual(validate('Sure. '+result.body,result.slots,{now}),[]);
});

test('a stale service-area draft cannot be sent with its earlier positive coverage claim',()=>{
  const result=reply(['question_service_area'],{extracted:{city:'Perrysburg'}});
  assert.ok(validate(result.body,result.slots,{now:new Date('2026-11-26T04:00:00Z')}).includes('ungrounded_reply'));
});

test('invalid generated wording is regenerated once and grounded second wording is sent',async()=>{
  let calls=0;
  const result=await generate({...base,classification:classify(['question_price'])},{drafter:async({body,attempt,violations})=>{calls++;if(attempt===0)return body.replace('$105','$5');assert.ok(violations.includes('price_disagrees_with_grid'));return 'Sure. '+body;}});
  assert.equal(calls,2);assert.equal(result.regenerated,true);assert.equal(result.validationFallback,false);assert.match(result.body,/\$105/);check(result);
});

test('two invalid candidates or two drafter failures use a validated short safe reply and notify Craig',async()=>{
  for(const drafter of [async()=>"I'll be there by 8am for $1",async()=>{throw Error('provider unavailable');}]){
    const result=await generate({...base,classification:classify(['question_price'])},{drafter});
    assert.equal(result.body,STRUCTURED_SAFE_FALLBACK);assert.equal(result.validationAttempts,2);assert.equal(result.validationFallback,true);
    assert.ok(result.notifyReasons.includes('invalid_reply_fallback'));check(result);
  }
});

test('STOP, suppression and manual-owner pause always prevent a generated reply, even with another clear question',async()=>{
  for(const context of [{classification:classify(['stop','question_price'])},{suppressed:true},{conversation:{owner:'craig',automation_mode:'paused'}},{conversation:{owner:'backend',automation_mode:'paused'}}]){
    let calls=0;const result=await generate({...base,classification:classify(['question_price']),...context},{drafter:async()=>{calls++;return 'bad';}});
    assert.equal(result.body,'');assert.equal(result.noSend,true);assert.equal(calls,0);check(result);
  }
});

test('malformed durable context fails closed and cannot authorize an arbitrary reply',()=>{
  const result=reply(['question_price']);
  assert.ok(validate('arbitrary reply',{structuredContext:{policyVersion:result.policyVersion,classification:{intents:'broken'},state:{topic_holds:'broken'},serviceArea:null}},{now}).length);
  const stop=reply(['question_price'],{intent:'stop'});assert.equal(stop.body,'');assert.equal(stop.noSend,true);
});

test('a hung optional drafting provider is bounded and still produces a safe answer',async()=>{
  let calls=0;
  const result=await generate({...base,classification:classify(['question_price'])},{drafter:()=>{calls++;return new Promise(()=>{});},timeoutMs:10});
  assert.equal(calls,2);assert.equal(result.body,STRUCTURED_SAFE_FALLBACK);assert.equal(result.validationFallback,true);check(result);
});

test('every independently labeled real-world fixture obeys grounding and reply rules without substituting this for real model accuracy',()=>{
  assert.ok(LEAD_CONVERSATION_FIXTURE.length>=80);
  for(const row of LEAD_CONVERSATION_FIXTURE){
    const classification=classify(row.expected.intents,row.expected),result=compose({...base,classification,text:row.text});
    const note=row.id+': '+row.text;
    const stopped=row.expected.intents.some(i=>['stop','wrong_number'].includes(i));
    assert.equal(Boolean(result.body),!stopped,note);
    assert.deepEqual(validate(result.body,result.slots,{now}),[],note);
    assert.doesNotMatch(result.body,/[\u2013\u2014]|\/api\/onboard/,note);
    if(stopped)continue;
    if(row.expected.intents.includes('unclear')){
      assert.equal(result.body,STRUCTURED_UNCLEAR_REPLIES[0],note);assert.deepEqual(result.notifyReasons,[],note);
    }
    if(row.expected.needs_owner)assert.match(result.body,/Craig follow up|Craig reach out/,note);
    if(row.expected.intents.includes('request_cash')){assert.match(result.body,/A check works/);assert.match(result.body,/Cash.*offline with Craig/);}
    if(row.expected.intents.includes('question_service_day'))assert.match(result.body,/can't promise.*time of day/,note);
    if(row.expected.intents.includes('ready_to_sign_up'))assert.ok(result.body.includes(STRUCTURED_SIGNUP_PATH),note);
    if(row.expected.intents.includes('question_service_area')&&row.expected.extracted?.city==='Elmore')assert.match(result.body,/don't service Elmore/,note);
    if(row.expected.corrections)for(const [key,value]of Object.entries(row.expected.corrections))assert.equal(result.state.details[key],value,note);
    if(row.expected.intents.includes('question_referral'))assert.match(result.body,/don't have a referral credit or program/,note);
    if(row.expected.intents.includes('question_bundles'))assert.match(result.body,/don't have bundle rates/,note);
  }
});
