import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPlaybookIntent,structuredOptOut,buildClassifierProviderRequest,classifierResponseJson,classifierLiteralGroundingErrors} from '../lib/lead-playbook-classifier.mjs';
import {CLASSIFIER_JSON_SCHEMA,CLASSIFIER_PROVIDER_SCHEMA,STRUCTURED_INTENTS,classifierMessages,validateStructuredClassifierResult} from '../lib/lead-playbook-classifier-schema.mjs';
import {LEAD_CONVERSATION_FIXTURE,CLASSIFIER_FIXTURE_CONTEXT,compareClassifierFixture,compareSemanticClassifierFixture} from './fixtures/lead-conversation-messages-v2.mjs';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
const env={LEAD_CONVERSATION_V2_ENABLED:'true',LEAD_CLASSIFIER_ENABLED:'true'};
const valid=(patch={})=>({confirms_details:'no',corrections:{},intents:['question_price'],extracted:{},sentiment:'neutral',needs_owner:false,owner_reason:'none',confidence:1,...patch});
const store=()=>({calls:0,finished:[],claim(){this.calls++;return true;},finish(row){this.finished.push(row);}});

test('100 independently labeled realistic fixture cases include at least ten unclear cases and all requested categories',()=>{
  assert.equal(LEAD_CONVERSATION_FIXTURE.length,100);
  assert.ok(LEAD_CONVERSATION_FIXTURE.filter(row=>row.expected.intents.includes('unclear')).length>=10);
  for(const intent of ['confirm_yes','correction','question_price','question_service_area','question_service_day','objection_price','request_cash','question_payment','ready_to_sign_up','is_this_ai','not_interested','stop','spanish','complaint','off_playbook'])assert.ok(LEAD_CONVERSATION_FIXTURE.some(row=>row.expected.intents.includes(intent)),intent);
  for(const row of LEAD_CONVERSATION_FIXTURE){const candidate=valid({...row.expected,extracted:row.expected.extracted||{},corrections:row.expected.corrections||{},owner_reason:row.expected.owner_reason||'none'});assert.ok(validateStructuredClassifierResult(candidate),row.id);}
});
test('fixture contract survives strict model JSON decoding without dropping multi-intents or corrections (mocked provider, not accuracy)',async()=>{
  for(const row of LEAD_CONVERSATION_FIXTURE){
    const usageStore=store();
    const candidate=valid({...row.expected,extracted:row.expected.extracted||{},corrections:row.expected.corrections||{},owner_reason:row.expected.owner_reason||'none'});
    const result=await classifyPlaybookIntent(row.text,CLASSIFIER_FIXTURE_CONTEXT,{env,usageStore,provider:async request=>{assert.equal(request.text.format.type,'json_schema');assert.deepEqual(request.text.format.schema,CLASSIFIER_PROVIDER_SCHEMA);return {response:JSON.stringify(candidate)};}});
    assert.deepEqual(compareClassifierFixture(row,result),[],row.id);
    assert.equal(usageStore.calls,structuredOptOut(row.text)?0:row.expected.intents.includes('off_playbook')?2:1,row.id);
  }
});
test('V2 uses the LLM first even for perfect affirmatives, obvious FAQs and ambiguous SMS',async()=>{
  for(const text of ['yep','correct','How much?','do u guys do elmore','lol ok','🤷']){
    const usageStore=store(),result=await classifyPlaybookIntent(text,CLASSIFIER_FIXTURE_CONTEXT,{env,usageStore,provider:async()=>({response:valid({intents:['unclear']})})});
    assert.equal(usageStore.calls,1,text);assert.equal(result.reason,'structured_model_classifier');
  }
});
test('STOP always preempts classification including mixed questions, casual optouts and suppression words',async()=>{
  for(const text of ['STOP','stop pls','unsubscribe','Yes, how much? Also stop.','Please remove me',"don't text me",'wrong number']){
    const result=await classifyPlaybookIntent(text,{}, {env,usageStore:{claim(){assert.fail('No model budget for optout');}},provider(){assert.fail('No model call for optout');}});
    assert.equal(result.reason,'opt_out_prefilter');assert.ok(['stop','wrong_number'].includes(result.intent));
  }
});
test('local strict validator rejects unsupported fields, unsafe slots, invalid types and cross-field ambiguity',()=>{
  for(const patch of [{body:'invent a price'},{intents:['made_up']},{intents:['question_price','question_price']},{confidence:2},{extracted:{dogs:'2'}},{extracted:{dogs:100}},{extracted:{frequency:'daily'}},{extracted:{zip:'4355'}},{extracted:{zip:'43551\n'}},{extracted:{price:1}},{extracted:{name:'bad\nname'}},{playbook_topics:['unapproved']},{playbook_topics:['included','included']},{intents:['unclear','question_price']},{intents:['correction'],confirms_details:'partial',corrections:{}}])assert.equal(validateStructuredClassifierResult({...valid(),...patch}),null,JSON.stringify(patch));
  assert.equal(CLASSIFIER_JSON_SCHEMA.additionalProperties,false);
  assert.ok(CLASSIFIER_JSON_SCHEMA.properties.extracted.properties.yardTier.enum.includes('tiny'));
});
test('normalization only reconciles model semantic fields and does not invent a confirmation from an empty correction',()=>{
  const confirmed=validateStructuredClassifierResult(valid({confirms_details:'yes'}));assert.ok(confirmed.intents.includes('confirm_yes'));
  const corrected=validateStructuredClassifierResult(valid({corrections:{dogs:3},extracted:{dogs:3}}));assert.equal(corrected.confirms_details,'partial');assert.ok(corrected.intents.includes('correction'));
  assert.equal(validateStructuredClassifierResult(valid({intents:['correction'],confirms_details:'partial'})),null);
  const reasonWins=validateStructuredClassifierResult(valid({intents:['off_playbook'],owner_reason:'off_playbook'}));assert.equal(reasonWins.needs_owner,true);
  const holdWins=validateStructuredClassifierResult(valid({needs_owner:true}));assert.equal(holdWins.owner_reason,'uncertain');
});
test('independently reviewed semantic labels preserve the original exact metric and never excuse clear failures',()=>{
  const cash=LEAD_CONVERSATION_FIXTURE.find(row=>row.id==='sms-048');
  const cashModel=valid({intents:['request_cash','question_payment'],needs_owner:true,owner_reason:'cash'});
  assert.deepEqual(compareClassifierFixture(cash,cashModel),['intents']);assert.deepEqual(compareSemanticClassifierFixture(cash,cashModel),[]);
  const mowing=LEAD_CONVERSATION_FIXTURE.find(row=>row.id==='sms-078');
  assert.ok(compareSemanticClassifierFixture(mowing,valid({intents:['question_bundles']})).includes('needs_owner'));
  assert.deepEqual(compareSemanticClassifierFixture(mowing,valid({intents:['question_bundles','off_playbook'],needs_owner:true,owner_reason:'off_playbook'})),[]);
  const unclear=LEAD_CONVERSATION_FIXTURE.find(row=>row.text==='lol ok');
  assert.ok(compareSemanticClassifierFixture(unclear,valid({intents:['confirm_yes'],confirms_details:'yes'})).length);
});
test('failure, invalid JSON, disabled binding and usage failure produce explicit safe-reask signals',async()=>{
  for(const [provider,reason]of [[async()=>{throw Error('private provider body');},'classifier_failed'],[async()=>({response:'not json'}),'classifier_invalid_json'],[async()=>({response:{intent:'confirm_yes',confidence:1,slots:{}}}),'classifier_invalid_json']]){
    const result=await classifyPlaybookIntent('natural words',{}, {env,usageStore:store(),provider});assert.equal(result.reason,reason);assert.equal(result.fallbackReply,true);assert.deepEqual(result.intents,['unclear']);assert.equal(result.needs_owner,false);
  }
  assert.equal((await classifyPlaybookIntent('hello',{}, {env,usageStore:store()})).reason,'classifier_binding_unavailable');
  assert.equal((await classifyPlaybookIntent('hello',{}, {env,usageStore:{claim(){throw Error('unavailable');}},provider:async()=>assert.fail()})).reason,'classifier_usage_unavailable');
});
test('timeout is bounded and persists existing-schema failed status with the safe fallback reason',async()=>{
  const db=leadTestDatabase(),started=Date.now();
  const result=await classifyPlaybookIntent('hello there',{}, {env:{...env,LEAD_CLASSIFIER_TIMEOUT_MS:'50'},db,provider:()=>new Promise(()=>{})});
  assert.ok(Date.now()-started<1500);assert.equal(result.reason,'classifier_timeout');assert.equal(result.fallbackReply,true);
  const row=db.sqlite.prepare('SELECT status,classifier_version FROM lead_classifier_calls').get();assert.equal(row.status,'failed');assert.equal(row.classifier_version,'lead-intents-2026-11-23-structured-v2');
});
test('classifier request restricts the schema and carries bounded conversation as data without raw payload',()=>{
  const messages=classifierMessages('how much?',{...CLASSIFIER_FIXTURE_CONTEXT,payload:{secret:'not allowed'},details:{...CLASSIFIER_FIXTURE_CONTEXT.details,phone:'+15550000000'},recentMessages:Array.from({length:20},()=>({direction:'outbound',body:'x'.repeat(1000)}))});
  const system=messages[0].content;assert.doesNotMatch(system,/not allowed|15550000000/);assert.match(system,/Recent conversation DATA/);assert.ok(system.length<12000);
  assert.ok(STRUCTURED_INTENTS.includes('question_bundles'));
});
test('xgrammar examples and declared nested property order stay aligned for multi-question extraction',()=>{
  const order=Object.keys(CLASSIFIER_PROVIDER_SCHEMA.properties.extracted.properties);
  assert.deepEqual(order.slice(0,3),['city','dogs','frequency']);
  for(const message of classifierMessages('Do you service Elmore and what is weekly for2dogs?',CLASSIFIER_FIXTURE_CONTEXT).filter(item=>item.role==='assistant')){
    const result=JSON.parse(message.content);
    for(const key of ['extracted','corrections'])assert.deepEqual(Object.keys(result[key]),order.filter(name=>Object.hasOwn(result[key],name)));
  }
});
test('Workers AI GPT-OSS adapter bounds reasoning/output and ignores private reasoning response blocks',()=>{
  const request=buildClassifierProviderRequest('@cf/openai/gpt-oss-120b',[{role:'user',content:'hello'}]);
  assert.equal(request.reasoning.effort,'medium');assert.equal(request.max_output_tokens,1500);assert.equal(request.text.format.type,'json_schema');assert.equal(request.text.format.strict,false);assert.ok(request.input);assert.equal(request.messages,undefined);
  const json=JSON.stringify(valid());
  assert.equal(classifierResponseJson({output:[{type:'reasoning',content:[{text:'private reasoning not retained'}]},{type:'message',content:[{type:'output_text',text:json}]}]}),json);
  const legacy=buildClassifierProviderRequest('@cf/meta/llama-3.3-70b-instruct-fp8-fast',[]);assert.equal(legacy.max_tokens,700);assert.equal(legacy.temperature,0);
});
test('literal fact validation accepts case/whitespace only and never guesses a city correction',()=>{
  assert.deepEqual(classifierLiteralGroundingErrors(valid({extracted:{city:' Elmore '}}),'do you service ELMORE?'),[]);
  assert.deepEqual(classifierLiteralGroundingErrors(valid({extracted:{city:'Elmajor'},corrections:{name:'Unknown'}}),'Elmore'),['extracted.city','corrections.name']);
});
test('one durably budgeted LLM repair replaces ungrounded literal facts and keeps both call receipts',async()=>{
  const db=leadTestDatabase();let calls=0;
  const result=await classifyPlaybookIntent('Do you service Elmore?',{}, {env,db,provider:async request=>{
    calls++;if(calls===2){const envelope=JSON.parse(request.input.at(-1).content);assert.equal(envelope.original_sms,'Do you service Elmore?');assert.deepEqual(envelope.validation_errors,['extracted.city']);}
    return {response:valid({intents:['question_service_area'],extracted:{city:calls===1?'Elmajor':'Elmore'}})};
  }});
  assert.equal(calls,2);assert.equal(result.extracted.city,'Elmore');assert.equal(result.callIds.length,2);assert.equal(result.repairOfCallId,result.callIds[0]);assert.equal(result.groundingRepaired,true);
  assert.deepEqual(db.sqlite.prepare('SELECT status FROM lead_classifier_calls ORDER BY rowid').all().map(row=>row.status),['invalid','completed']);
});
test('a second ungrounded response fails safely without looping or copying context facts',async()=>{
  const usageStore=store();
  const result=await classifyPlaybookIntent('Where do you service?',{}, {env,usageStore,provider:async()=>({response:valid({intents:['question_service_area'],extracted:{city:'Inventedville'}})})});
  assert.equal(usageStore.calls,2);assert.equal(result.reason,'classifier_grounding_failed');assert.equal(result.fallbackReply,true);assert.deepEqual(result.extracted,{});
});
test('off-playbook review distinguishes accidental personal text while preserving real unsupported requests',async()=>{
  for(const [text,repaired]of [['did you get the game controller',valid({intents:['unclear']})],['Can you repair our fence?',valid({intents:['off_playbook'],needs_owner:true,owner_reason:'off_playbook'})]]){
    let calls=0;const result=await classifyPlaybookIntent(text,{}, {env,usageStore:store(),provider:async()=>({response:++calls===1?valid({intents:['off_playbook'],needs_owner:true,owner_reason:'off_playbook'}):repaired})});
    assert.equal(calls,2);assert.deepEqual(result.intents,repaired.intents);assert.equal(result.needs_owner,repaired.needs_owner);
  }
});
test('repair shares the daily cap and never makes an unbudgeted extra provider call',async()=>{
  const db=leadTestDatabase();let calls=0;
  const result=await classifyPlaybookIntent('Elmore?',{}, {env:{...env,LEAD_CLASSIFIER_DAILY_CAP:'1'},db,provider:async()=>{calls++;return {response:valid({intents:['question_service_area'],extracted:{city:'Elmajor'}})};}});
  assert.equal(calls,1);assert.equal(result.reason,'classifier_daily_cap');assert.equal(result.callIds.length,1);assert.equal(db.sqlite.prepare('SELECT status FROM lead_classifier_calls').get().status,'invalid');
});
test('optional owner-policy audit failure preserves a grounded safe owner request, never an invented literal fact',async()=>{
  let calls=0;const db=leadTestDatabase();
  const result=await classifyPlaybookIntent('Can you repair my fence?',{}, {env,db,provider:async()=>{if(++calls===1)return {response:valid({intents:['off_playbook'],needs_owner:true,owner_reason:'off_playbook'})};throw Object.assign(Error('classifier_timeout'),{code:'classifier_timeout'});}});
  assert.equal(calls,2);assert.equal(result.needs_owner,true);assert.deepEqual(result.intents,['off_playbook']);assert.equal(result.policyReviewFallback,true);assert.equal(result.reason,'classifier_policy_review_fallback');assert.equal(result.callIds.length,2);
  assert.deepEqual(db.sqlite.prepare('SELECT status FROM lead_classifier_calls ORDER BY rowid').all().map(row=>row.status),['completed','failed']);
});
