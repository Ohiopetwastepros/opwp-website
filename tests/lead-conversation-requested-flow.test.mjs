import test from 'node:test';
import assert from 'node:assert/strict';
import {PRICING, YARD_TIERS} from '../lib/lead-pricing.mjs';
import {classifyPlaybookRules, nextPlaybookResponse, renderPlaybookTemplate, lintPlaybookText} from '../lib/lead-playbook.mjs';
import {faqThread, prices, customerPhone} from './helpers/lead-faq-thread.mjs';
import {playbookHash} from '../lib/lead-playbook-links.mjs';

const missingProperty = {dogs:2, frequency:'once_a_week', city:'', zip:'43551', yardTier:null, yardAcres:null, lastCleaned:null, address:''};
const raw = (state,text,extra={}) => nextPlaybookResponse({conversation:{owner:'backend'},lead:missingProperty,state,text,...extra});
const initial = {stage:'confirm_details_sent',details_confirmed:false,details:{...missingProperty}};

test('published starting rates use the website grid without creating a personal quote or route authority', () => {
  const reply=raw(initial,'How much is it for 2 dogs weekly?');
  assert.equal(reply.templateKey,'published_plan_rate');
  assert.deepEqual(prices(reply.body),[PRICING.monthly.once_a_week[2]]);
  assert.ok(reply.body.includes(YARD_TIERS.find(t=>t.id==='tiny').label.toLowerCase()));
  assert.match(reply.body,/starts at|starting/i);
  assert.match(reply.body,/larger.*cost more/i);
  assert.match(reply.body,/first cleanup.*separately/i);
  assert.equal(reply.state.details_confirmed,false);
  assert.ok(reply.state.details.yardTier==null);
  assert.ok(reply.state.details.lastCleaned==null);
  assert.equal(reply.state.details.address,'');
  assert.equal(reply.state.quote,undefined);
  assert.equal(reply.slots.day,undefined);
  assert.deepEqual(lintPlaybookText(reply.body,{templateKey:reply.templateKey,intent:reply.intent,slots:reply.slots,state:initial}),[]);
  const changed={...reply.slots,plan_rate:1};
  assert.equal(renderPlaybookTemplate('published_plan_rate',changed),reply.body,'a supplied amount cannot override the shared grid');
  const signup=raw(reply.state,'Ok sign me up');
  assert.notEqual(signup.templateKey,'signup_handoff');
  assert.notEqual(signup.templateKey,'quote_recurring');
  assert.equal(signup.state.details_confirmed,false);
});

test('general coverage questions preserve the real property while actual moves retain outside-area protection', () => {
  const question=raw(initial,'Do you service Elmore?');
  assert.equal(question.templateKey,'coverage_decline');
  assert.match(question.body,/don.t service Elmore/i);
  assert.equal(question.state.stage,initial.stage);
  assert.equal(question.state.details.zip,'43551');
  assert.equal(question.state.details.city,'');
  const moved=raw(initial,'Actually my yard is in Elmore, ZIP 43416.');
  assert.equal(moved.state.stage,'closed_lost');
  assert.equal(moved.state.details.city,'Elmore');
  assert.equal(moved.state.details.zip,'43416');
  assert.equal(raw(moved.state,'Ok sign me up').body,'');
});

test('the exact morning question uses the published no-time-guarantee policy', () => {
  const rule=classifyPlaybookRules('Can you come in the morning?',initial);
  assert.equal(rule.faq.topic,'time_of_day');
  const turn=raw(initial,'Can you come in the morning?');
  assert.equal(turn.templateKey,'time_of_day');
  assert.match(turn.body,/can.t guarantee a time of day/i);
  assert.doesNotMatch(turn.body,/we can come.*morning|we.ll (?:come|arrive).*morning/i);
  assert.equal(turn.escalate,false);
});

test('only price-review information can answer a held thread, without bypassing owner, customer or suppression gates', () => {
  const price=raw(initial,"That's too expensive, can you do better?");
  assert.equal(price.state.stage,'escalated');
  assert.equal(price.state.escalation_reason,'price_objection');
  assert.match(price.body,/owner.*follow up/i);
  assert.doesNotMatch(price.body,/discount|\$|biweekly|cheaper/i);
  for(const message of ['Can I pay cash?','Ok sign me up']) {
    const response=raw(price.state,message);
    assert.ok(response.body);
    assert.equal(response.state.stage,'escalated');
    assert.equal(response.state.escalation_reason,'price_objection');
    assert.equal(response.state.quote,undefined);
    assert.equal(response.state.details_confirmed,false);
    assert.equal(raw(price.state,message,{suppressed:true}).body,'');
    assert.equal(raw(price.state,message,{conversation:{owner:'craig'}}).body,'');
    assert.equal(raw(price.state,message,{lead:{...missingProperty,existing_customer:true}}).body,'');
    assert.equal(raw({...price.state,escalation_reason:'human_request'},message).body,'');
    const capped=raw({...price.state,turns:20},message);
    assert.equal(capped.body,'');
    assert.equal(capped.reason,'conversation_turn_limit');
  }
  assert.equal(raw(price.state,'Yes, how much for 2 dogs weekly?').body,'','a price hold cannot restart a sales quote');
});

test('the seven requested turns traverse real ingestion and delivery, preserve the handoff, and STOP prevents another provider send', async t => {
  const f=await faqThread(t,{details:missingProperty,stage:'confirm_details_sent'});
  f.env.LEAD_PLAYBOOK_NOTIFY_ENABLED='false';
  const transport=globalThis.fetch,requests=[];
  t.mock.method(globalThis,'fetch',async (url,options={})=>{
    const path=new URL(String(url)).pathname;
    requests.push({path,method:options.method||'GET'});
    assert.ok(!path.replace(/\/$/,'').endsWith('/api/onboard'),'SMS FAQ must never call onboarding');
    return transport(url,options);
  });
  const quote=await f.inbound('How much is it for 2 dogs weekly?');
  assert.ok(quote.body);
  assert.deepEqual(prices(quote.body),[PRICING.monthly.once_a_week[2]]);
  assert.equal(quote.state.quote,undefined);
  assert.equal(quote.state.details_confirmed,false);
  const area=await f.inbound('Do you service Elmore?');
  assert.match(area.body,/don.t service Elmore/i);
  assert.equal(area.state.details.zip,'43551');
  assert.notEqual(area.state.stage,'closed_lost');
  const time=await f.inbound('Can you come in the morning?');
  assert.match(time.body,/can.t guarantee a time of day/i);
  const objection=await f.inbound("That's too expensive, can you do better?");
  assert.match(objection.body,/owner.*follow up/i);
  assert.equal(objection.state.stage,'escalated');
  assert.doesNotMatch(objection.body,/\$|discount|cheaper|biweekly/i);
  const review=f.db.sqlite.prepare('SELECT next_action,priority FROM growth_leads WHERE submission_id=?').get(f.submissionId);
  assert.match(review.next_action,/review playbook escalation/i);
  assert.equal(review.priority,'high');
  const cash=await f.inbound('Can I pay cash?');
  assert.match(cash.body,/check.*works/i);
  assert.match(cash.body,/cash.*offline.*owner/i);
  assert.equal(cash.state.stage,'escalated');
  assert.doesNotMatch(cash.body,/want me to get|cash (?:works|is fine)/i);
  const signup=await f.inbound('Ok sign me up');
  assert.match(signup.body,/https:\/\/www\.ohiopetwastepros\.com\/free-quote\//);
  assert.match(signup.body,/price review.*owner/i);
  assert.match(signup.body,/doesn.t book service or create an account/i);
  assert.equal(signup.state.stage,'escalated');
  assert.equal(signup.state.escalation_reason,'price_objection');
  assert.equal(signup.state.quote,undefined);
  assert.equal(signup.state.details_confirmed,false);
  const ownership=f.db.sqlite.prepare('SELECT owner,automation_mode FROM lead_conversations WHERE id=?').get(f.conversationId);
  assert.equal(ownership.owner,'backend');
  assert.equal(ownership.automation_mode,'approved');
  assert.deepEqual(f.db.sqlite.prepare('SELECT next_action,priority FROM growth_leads WHERE submission_id=?').get(f.submissionId),review,'informational responses preserve the staff pricing task');
  const stopped=await f.inbound('STOP');
  assert.equal(stopped.body,'');
  assert.equal(f.db.sqlite.prepare("SELECT reason FROM lead_suppressions WHERE organization_id='org-opwp' AND phone_hash=?").get(await playbookHash(customerPhone)).reason,'opted_out');
  const before=f.customer.length,providerBefore=requests.filter(r=>r.method==='POST').length;
  assert.equal((await f.inbound('Please send me another quote.')).body,'');
  assert.equal(f.customer.length,before);
  assert.equal(requests.filter(r=>r.method==='POST').length,providerBefore);
  assert.equal(f.customer.length,6);
  assert.deepEqual(f.notices,[]);
});
