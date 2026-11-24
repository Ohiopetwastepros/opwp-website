import test from 'node:test';
import assert from 'node:assert/strict';
import {composeCraigSignup as compose,buildCraigMetaOpener,createCraigSignupDecision,validateCraigSignupReply} from '../lib/lead-craig-signup.mjs';
import {CRAIG_RATES,CRAIG_CLEANUP,CRAIG_ADDONS} from '../lib/lead-craig-pricing.mjs';
import {CLASSIFIER_PROVIDER_SCHEMA,CRAIG_SIGNUP_PROVIDER_SCHEMA,validateStructuredClassifierResult} from '../lib/lead-playbook-classifier-schema.mjs';
import {metaAirtableFields} from '../lib/meta-airtable-leads.mjs';
import {metaCadenceApproved} from '../lib/meta-lead-workflow.mjs';
import {goldenConversations,leads,reply,messyMessages} from './fixtures/lead-craig-signup.mjs';

function customerCopy(body) {
  assert.ok((body.match(/\?/g)||[]).length<=1,body);
  assert.doesNotMatch(body,/[\u2013\u2014]|\$\d+\.\d+|\bthe owner\b|have Craig|doggie door|\/api\/onboard|(?:be there|come|arrive) (?:at|by) \d/i);
}
const cfg=(phase,expected,details={},extra={})=>({craigSignup:{phase,expected,details:{...leads.weekly,...details},...extra}});
const give=(text,extracted)=>reply(text,undefined,extracted);
const yes=reply('yep',['confirm_yes'],{},{confirms_details:'yes'});
function drive(lead,turns,state={}){
  const output=[];
  for(const turn of turns){
    const next=compose({...turn,lead,state});
    customerCopy(next.body);
    output.push(next);
    state=next.state;
  }
  return {output,state:state.craigSignup};
}
const scenarios=[
  [1,'biweekly',()=>assert.match(compose({...yes,lead:leads.biweekly}).body,/\$80 per month/)],
  [2,'monthly',()=>assert.match(compose({...yes,lead:leads.monthly}).body,/\$55 per month/)],
  [3,'twice weekly',()=>assert.match(compose({...yes,lead:leads.twice}).body,/\$225 per month/)],
  [4,'one-time converts to weekly',()=>{const x=drive(goldenConversations[2].lead,goldenConversations[2].turns);assert.match(x.output[1].body,/\$95 to \$120.*\$70 to \$80.*\$105/);assert.match(x.output[2].body,/next month of service paid up front/);assert.equal(x.state.convertedTrial,true);}],
  [5,'one-time stays one-time',()=>{const x=drive(goldenConversations[3].lead,goldenConversations[3].turns);assert.equal(x.state.details.frequency,'one_time');assert.ok(x.output.every(v=>!/prefer haul-away/.test(v.body)));assert.doesNotMatch(x.output.at(-1).body,/service day/);}],
  [6,'large dog count and long gap',()=>{const a=drive({...leads.weekly,dogs:6},[yes,yes,reply('2 weeks')]);assert.match(a.output[0].body,/\$150/);assert.match(a.output[2].body,/don't have a set range for 6 dogs/);const b=drive(leads.weekly,[yes,yes,reply('six months')]);assert.match(b.output[2].body,/exact price.*recommend a sanitization treatment/);assert.doesNotMatch(b.output[2].body,/\$/);}],
  [7,'large yard',()=>{const x=compose({...reply('my yard is half an acre, same price?',['question_yard_size'],{yardAcres:0.5}),state:cfg('gap','gap')});assert.match(x.body,/upcharge.*office reviews.*How long/);assert.ok(x.notifyReasons.includes('property_walk'));}],
  [8,'coverage',()=>{for(const [city,zip,copy] of [['Elmore','43416',/don't currently service Elmore/],['Genoa','43430',/far west side only.*address/],['Tontogany','43565',/check on that address/],['Elsewhere','99999',/check on that address/]]){const x=compose({...reply('Do you service '+city+' '+zip+'?',['question_service_area'],{city,zip}),lead:leads.weekly});assert.match(x.body,copy);assert.doesNotMatch(x.body,/\$/);}
    const {output}=drive({...leads.weekly,city:'Genoa',zip:'43430'},[yes,give('123 Main Street Genoa',{address:'123 Main Street Genoa'})]);assert.ok(output[1].notifyReasons.includes('coverage_review'));assert.doesNotMatch(output[1].body,/\$/);}],
  [9,'active client',()=>{const x=compose({...reply('skip next week',['skip_request']),activeCustomer:true});assert.match(x.body,/office will follow up/);assert.deepEqual(x.notifyReasons,['existing_customer']);assert.equal(x.state.craigSignup.phase,'closed');}],
  [10,'returning client',()=>{const x=drive(leads.weekly,[reply('love to start up again',['ready_to_sign_up']),yes,yes,reply('since summer'),reply('no thanks',['decline_step'])],cfg('confirm','confirm',{}, {returning:true}));assert.match(x.output[0].body,/would like weekly service again\?/);assert.ok(x.output.some(v=>/set back up/.test(v.body)));assert.equal(x.state.details.email,'jen@example.test');}],
  [11,'discount once then office',()=>{const x=drive(leads.weekly,[reply('kinda high',['objection_price']),reply('still too much',['objection_price']),reply('do i need to be home',['question_home'])],cfg('rate','rate',{}, {rate:105}));assert.match(x.output[0].body,/\$15 off your first full month/);assert.equal(x.state.discount_offered,15);assert.match(x.output[1].body,/office will follow up/);assert.match(x.output[2].body,/Nobody needs to be home/);}],
  [12,'spring deferral',()=>{const x=drive(leads.weekly,[reply('maybe in spring',['spring_followup']),yes]);assert.equal(x.state.spring_followup,true);assert.deepEqual(x.output[0].notifyReasons,['spring_followup']);assert.equal(x.output[1].body,'');}],
  [13,'timing',()=>{const x=compose({...reply('can you come today morning?',['question_service_day']),state:cfg('rate','rate')});assert.match(x.body,/can't promise a time/);assert.doesNotMatch(x.body,/today|morning/);}],
  [14,'access and dogs',()=>{const x=drive(leads.weekly,[reply('do i need to be home',['question_home']),give('code is 1234',{gateLock:'code'}),give('dog barks at strangers',{dogBehavior:'nervous'})],cfg('collect','gateLock', {address:'123 Maple Lane',gateSide:'right'}));assert.match(x.output[0].body,/Nobody needs to be home/);assert.equal(x.state.details.gateLock,'code');assert.equal(x.state.dog_caution,true);assert.doesNotMatch(x.output.map(v=>v.body).join(' '),/1234|must be inside/);}],
  [15,'front yard',()=>assert.match(compose({...reply('could you do the front yard',['faq_question'],{},{playbook_topics:['front_yard']}),lead:leads.weekly}).body,/\$21 per month/)],
  [16,'deodorization',()=>{const x=compose({...reply('anything for the smell',['question_deodorization']),lead:leads.weekly});assert.match(x.body,/\$25 per treatment/);assert.doesNotMatch(x.body,/enzym|sanitiz/i);}],
  [17,'snow and winter pause',()=>{const x=drive(leads.weekly,[reply('what about snow',['question_snow']),reply('can we pause over winter',['winter_pause'])]);assert.match(x.output[0].body,/heavy snow/);assert.ok(x.output[1].notifyReasons.includes('off_playbook'));assert.doesNotMatch(x.output[1].body,/90 days/);}],
  [18,'bot and person',()=>{const x=drive(leads.weekly,[reply('is this a bot',['is_this_ai']),reply('a real person please',['request_person']),reply('are mornings possible',['question_service_day'])]);assert.match(x.output[0].body,/AI assistant/);assert.equal(x.output[1].body,'No problem, our office staff will follow up with you.');assert.match(x.output[2].body,/can't promise a time/);}],
  [19,'Spanish',()=>{const x=compose(reply('Hola, cuánto cuesta para 2 perros?',['spanish','question_price']));assert.match(x.body,/Nuestra oficina/);assert.doesNotMatch(x.body,/\$|\?/);assert.ok(x.notifyReasons.includes('spanish'));}],
  [20,'commercial',()=>{const x=drive(leads.weekly,[reply('I manage an HOA with 4 pet stations',['commercial']),give('500 Oak Commons Perrysburg',{address:'500 Oak Commons Perrysburg'})]);assert.match(x.output[0].body,/property address\?/);assert.ok(x.output[1].notifyReasons.includes('commercial'));assert.doesNotMatch(x.output[1].body,/\$/);}],
  [21,'quiet lead has no follow-up',async()=>{assert.equal(await metaCadenceApproved(null,{META_CADENCE_ENABLED:'true',LEAD_CONVERSATION_V2_ENABLED:'true',LEAD_CRAIG_SIGNUP_ENABLED:'true'}),false);}],
  [22,'wrong number and spam',()=>{const x=compose(reply('who is this? I never filled anything out',['wrong_number']));assert.match(x.body,/won't text you again/);assert.equal(x.suppressAfterReply,true);const y=compose(reply('CLICK to claim your prize www.example.test',['spam']));assert.equal(y.body,'');assert.deepEqual(y.notifyReasons,['spam']);}],
  [23,'complaint',()=>{const x=compose(reply('your guy left the gate open',['complaint']));assert.equal(x.body,"Sorry about that, I'll look into it right away.");assert.deepEqual(x.notifyReasons,['complaint']);}],
  [24,'several questions',()=>{const x=compose({...reply('how much is haul away and do you take checks?',['question_haul_away','question_check']),state:cfg('collect','address')});assert.match(x.body,/\$21 per month/);assert.match(x.body,/accept checks/);assert.match(x.body,/service address\?$/);customerCopy(x.body);}],
];
for(const [number,name,verify] of scenarios)test('Craig scenario '+number+': '+name,verify);

for (const scenario of goldenConversations) test('golden conversation: '+scenario.name,()=>{
  const opener=buildCraigMetaOpener(scenario.lead);
  assert.match(opener,/\n\nReply STOP to opt out$/);
  assert.equal((opener.match(/\?/g)||[]).length,1);
  const {output,state}=drive(scenario.lead,scenario.turns);
  assert.equal(state.readyForAccountSetup,true,JSON.stringify(output.map(v=>v.body)));
  assert.equal(output.at(-1).notifyReasons.includes('signup_ready'),true);
  assert.match(output.at(-1).body,/link to add your card on file/);
  assert.ok(output.every(row=>!/(Reply STOP|month to month|checks)/i.test(row.body)));
  assert.ok(output.every((row,i)=>/how much/i.test(scenario.turns[i].text)||!/sanitization treatment is \$/.test(row.body)));
  for (const {body} of output) if (scenario.lead.email)assert.doesNotMatch(body,/best email/);
});

test('110 messy SMS fixtures exercise the structured contract and deterministic reply guard',()=>{
  assert.equal(messyMessages.length,110);
  for(const turn of messyMessages){
    const result=validateStructuredClassifierResult(turn.classification);
    assert.ok(result,turn.text);
    assert.ok(result.intents.includes(turn.classification.intents[0]));
    const state=cfg('collect','address');
    const x=createCraigSignupDecision({...turn,classification:result,lead:leads.weekly,state});
    customerCopy(x.body);
    if(turn.classification.intents[0]==='stop')assert.equal(x.body,'',turn.text);
    if(x.body)assert.deepEqual(validateCraigSignupReply(x.body,x.slots.craigSignupContext),[],turn.text);
  }
});

test('unsupported plans propose weekly and wait for consent to switch',()=>{
  for(const [frequency,dogs,limit,rate] of [['once_a_month',3,2,120],['every_other_week',4,3,130]]){
    const x=drive({...leads.weekly,frequency,dogs},[yes,yes]);
    assert.match(x.output[0].body,new RegExp('up to '+limit+' dogs'));
    assert.ok(x.output[0].body.includes('$'+rate));
    assert.equal(x.output[0].state.craigSignup.details.frequency,frequency);
    assert.equal(x.state.details.frequency,'once_a_week');
  }
  const x=drive({...leads.weekly,dogs:8},[yes]);
  assert.match(x.output[0].body,/custom quote/);assert.doesNotMatch(x.output[0].body,/\$/);
});

test('recurring vs standalone billing, only with user-requested checks and contract terms',()=>{
  const ask=reply('what do you bill me for',['question_billing']);
  const regular=compose({...ask,state:cfg('rate','rate')});
  assert.match(regular.body,/rest of this month, prorated/);assert.doesNotMatch(regular.body,/next month|checks|contract/);
  const once=compose({...ask,state:cfg('setup','setup',{frequency:'one_time'})});
  assert.match(once.body,/one-time cleanup and any add-ons/);assert.doesNotMatch(once.body,/1st|monthly|checks/);
  const contract=compose({...reply('is there a contract',['question_contract']),state:cfg('setup','setup')});
  assert.match(contract.body,/month to month with no contract/);
  const mislabel=compose({...reply('hello',['question_check','question_contract','question_sanitization_price']),state:cfg('sanitize','sanitize')});
  assert.doesNotMatch(mislabel.body,/checks|contract|\$/);
});

test('correction, details already volunteered, cash, and no repeated trash question',()=>{
  const correction={...reply("Actually it's 3 dogs",['correction'],{dogs:3},{confirms_details:'partial',corrections:{dogs:3}}),lead:leads.weekly};
  assert.match(compose(correction).body,/3 dogs.*\$120/);
  const x=drive(leads.weekly,[give('not using my trash can',{disposal:'declined_trash'}),reply('how much for haul away',['question_haul_away']),yes],cfg('collect','disposal',{address:'123 Maple Lane',gateSide:'left',gateLock:'unlocked'}));
  assert.ok(x.output.every(v=>!/outdoor trash can/.test(v.body)));
  assert.equal(x.state.details.disposal,'haul_away');
  const cash=compose({...reply('I can pay cash',['request_cash']),state:cfg('rate','rate')});
  assert.ok(cash.notifyReasons.includes('cash'));assert.doesNotMatch(cash.body,/checks|accept cash/i);
});

test('unanswered gibberish twice, recovery after handoff, and STOP before any other intent',()=>{
  const x=drive(leads.weekly,[reply('asdfg',['unclear']),reply('ggh??',['unclear']),reply('do i need to be home',['question_home']),reply('STOP but what is the price',['question_price'])]);
  assert.match(x.output[0].body,/didn't quite catch that/);
  assert.deepEqual(x.output[1].notifyReasons,['unclear_repeated']);
  assert.match(x.output[2].body,/Nobody needs/);assert.equal(x.output[3].body,'');
  assert.equal(compose({...yes,paused:true}).body,'');
});

test('proposed prices and existing Airtable Notes marker are exact and idempotent',()=>{
  assert.deepEqual(CRAIG_RATES,{twice_a_week:[175,190,225,245,275,305,335],once_a_week:[95,105,120,130,140,150,160],every_other_week:[72,80,92],once_a_month:[55,65]});
  assert.deepEqual(CRAIG_CLEANUP.initial.two_months,[[60,70],[70,80],[80,90],[90,110],[120,140]]);
  assert.deepEqual(CRAIG_CLEANUP.one_time.one_week[0],[27.72,37.5]);
  assert.deepEqual(CRAIG_ADDONS,{sanitization:35,recurringSanitization:30,deodorization:25,haulAway:21,haulAwayLarge:31,frontYard:21,dogFood:59});
  const row={meta_lead_id:'test-1',next_action:'Ready for account setup'};
  const fields=metaAirtableFields(row,{Notes:'Manual note'});
  assert.equal(fields.Notes,'Manual note\nReady for account setup');
  assert.equal(fields.Converted,undefined);
  assert.equal(metaAirtableFields(row,{Notes:fields.Notes}).Notes,undefined);
  assert.ok(CRAIG_SIGNUP_PROVIDER_SCHEMA.properties.intents.items.enum.includes('question_billing'));
  assert.ok(!CLASSIFIER_PROVIDER_SCHEMA.properties.intents.items.enum.includes('question_billing'));
});

test('a requested add-on does not accept a recurring quote or repeat a known question',()=>{
  const x=drive(leads.weekly,[
    reply('can you do the front yard',['faq_question'],{},{playbook_topics:['front_yard']}),
    yes,
    reply('how much for 4 dogs?',['question_price'],{dogs:4}),
  ],cfg('rate','rate',{}, {rate:105}));
  assert.match(x.output[0].body,/\$21 per month.*Would you like to add that\?/);
  assert.deepEqual(x.state.addons,['front_yard']);
  assert.equal(x.state.planAccepted,undefined);
  assert.equal(x.state.details.dogs,2);
  assert.match(x.output[2].body,/4 dogs.*\$130 per month/);
  assert.doesNotMatch(x.output[2].body,/\$105/);
});

test('a gate PIN stays in the original thread and only its access type reaches signup fields',()=>{
  const x=createCraigSignupDecision({...reply('gate code is 1234',['unclear'],{},{fallbackReply:true}),
    state:cfg('collect','gateLock',{address:'123 Maple Lane',gateSide:'right'})});
  assert.equal(x.state.craigSignup.details.gateLock,'code');
  assert.doesNotMatch(JSON.stringify(x),/1234/);
  assert.doesNotMatch(x.body,/gate locked/);
});

test('the turn limit alerts Craig after 40 and leaves the thread closed',()=>{
  const x=drive(leads.weekly,[reply('when can you come',['question_service_day']),reply('what day',['question_service_day'])],cfg('rate','rate',{}, {turns:40}));
  assert.deepEqual(x.output[0].notifyReasons,['turn_limit']);
  assert.equal(x.output[1].body,'');
});
