import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as pure from '../lib/dog-food-collections.mjs';
import * as logic from '../lib/dog-food-operations.mjs';
import {readBoundedProviderJson} from '../lib/bounded-body.mjs';
import {fixture} from './helpers/dog-food-fixture.mjs';

const staff='+14195550101',from='+14192622371';
function setup() {
  const f=fixture();
  f.sql.prepare("UPDATE dog_food_ops_state SET collector_phone=?,collector_verified_at=CURRENT_TIMESTAMP,collector_reply_mode='automatic',collector_webhook_id='WH-staff-fixture',collector_enabled=1,alerts_enabled=1,default_recipient='owner@example.test'").run(staff);
  f.sql.prepare("INSERT INTO dog_food_collection_items(sale_id,reference,customer_name,sale_date,balance_cents,status,recipient,issued_at) VALUES ('recABCDEFGH',?,'Real Buyer','2026-10-02',12000,'open',?,'2026-10-01 12:00:00')").run(pure.collectionReference('recABCDEFGH'),staff);
  const src=fs.readFileSync(new URL('../lib/dog-food-collections.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const sends=[];
  const context={...logic,...pure,...f.service,crypto,TextEncoder,URL,Date,console,readBoundedProviderJson,
    outboundFetch:async(url,options)=>{sends.push(JSON.parse(options.body));return Response.json({data:{id:'AC-outbound'}});},
    sendTransactionalEmail:async(env,message)=>{sends.push(message);return 'email-1';},transactionalEmailConfig:()=>({configured:true})};
  const service=runPrivateInNewContext(`${src}\n({recordFoodCollectionReply,processFoodCollectionReplies,reconcileFoodCollections,runFoodCollectionNotifications,foodCollectionCommand,recordFoodCollectionDelivery})`,context);
  const env={...f.env,QUO_API_KEY:'test',DOG_FOOD_QUO_WEBHOOK_SIGNING_KEY:'test',QUO_FROM_NUMBER:from,SMS_PROVIDER:'quo'};
  const event={eventId:'EV1',providerMessageId:'AC1',from:staff,to:from,createdAt:'2026-10-07T15:00:00Z',text:`PAID ${pure.collectionReference('recABCDEFGH')} $100 cash 2026-10-07 ref paper-123`};
  return {...f,service,env,event,sends};
}
test('complete payment report parses strictly; done, promises, negation and multi-sale reports stay review-only',()=>{
  const at=new Date('2026-10-07T16:00:00Z'),sample='PAID DF-ABCDEFGH $100 cash 2026-10-07 ref paper-123';
  assert.equal(pure.parseCollectionReply(sample,at).amountCents,10000);
  for(const value of ['done','all collected','Will '+sample,'Not '+sample,sample+'\n'+sample,sample.replace('$100','$100.001'),sample.replace('2026-10-07','2026-10-08'),sample.replace('2026-10-07','2026-02-30')])assert.equal(pure.parseCollectionReply(value,at).valid,false,value);
});
test('SMS contains only customer names and combined amounts, holding conflicting customers for office review',()=>{
  const rows=[{name:"Jessie Example",balanceCents:6000,warnings:[]},{name:"Jessie Example",balanceCents:6000,warnings:[]},
    {name:"Example Person",balanceCents:12000,notes:'Still owes $20',warnings:['Note mismatch']},{name:"Example Person",balanceCents:6000,warnings:[]},
    {name:"Bambi Example",balanceCents:18000,warnings:[]}];
  const sms=pure.collectionSms(rows);
  assert.equal(sms,"OPWP dog-food collections\nJessie Example: $120.00\nBambi Example: $180.00");
  assert.equal(pure.collectableSales(rows).length,3);assert.ok(pure.smsSegments(sms)<=16);
  assert.equal(pure.smsSegments('a'.repeat(160)),1);assert.equal(pure.smsSegments('a'.repeat(161)),2);assert.equal(pure.smsSegments('['.repeat(81)),2);
});

test('SNG-related sales are excluded before staff eligibility and customer totals',()=>{
  const cash={name:'Buyer',balanceCents:6000,warnings:[],paymentMethod:'Cash'};
  const variants=[{sngJobId:'job-123'},{sngRelated:true},{source:'SNG'},{source:'Sweep & Go'},
    {source:'Sweep and Go'},{paymentMethod:'sng_manual'},{paymentReference:'external:sng:invoice-1'},
    {notes:'Billed through sweepandgo'},{receipts:[{method:'Sweep & Go',reference:'invoice-1'}]}];
  const rows=[cash,...variants.map(v=>({...cash,balanceCents:12000,...v}))];
  assert.equal(pure.collectorSales({unpaid:rows},{collector_name:staffPrivate.primaryShort,collector_phone:staff}).length,1);
  assert.equal(pure.collectionSms(rows),'OPWP dog-food collections\nBuyer: $60.00');
  assert.equal(pure.isSngCollectionSale({...cash,notes:'Collect cash on next visit.'}),false);
  const model=logic.operationModel({tables:{Sales:[{id:'sng',fields:{'Sold To':'Buyer','Amount Collected':120,'Source':{name:'Sweep & Go'},'SNG Job ID':123,'Payment Reference':'SNG:123'}}]}});
  assert.equal(model.unpaid[0].source,'Sweep & Go');assert.equal(model.unpaid[0].sngJobId,'123');
  assert.equal(pure.collectorSales(model,{collector_name:staffPrivate.primaryShort,collector_phone:staff}).length,0);
});

test('scheduled and manual reminders send no text for an SNG-only queue',async()=>{
  for(const manual of [false,true]) {
    const f=setup(),schema=JSON.parse(fs.readFileSync(new URL('../data/dog-food-airtable-schema.json',import.meta.url),'utf8')).tables.Sales.fields;
    f.records.Sales[0].fields[schema.Source]='SNG';
    const result=await f.service.runFoodCollectionNotifications(f.env,{manual,at:Date.parse('2026-10-12T01:00:00Z')});
    assert.equal(result.skipped,true);assert.equal(f.sends.length,0);assert.equal(f.records['Payment Receipts'].length,0);
  }
});

test('native SNG billing links are excluded even when the Airtable projection has no SNG label',async()=>{
  for(const link of ['customer','order','payment','subscription','direct','cash']) {
    const f=setup(),schema=JSON.parse(fs.readFileSync(new URL('../data/dog-food-airtable-schema.json',import.meta.url),'utf8')).tables.Sales.fields;
    f.sql.exec(`INSERT INTO dog_food_customers(id,first_name,last_name,email,phone) VALUES ('buyer','Real','Buyer','buyer@example.test','4195550180');
      INSERT INTO dog_food_addresses(id,customer_id,line1,city,postal_code) VALUES ('address','buyer','123 Test','Toledo','43614');
      INSERT INTO dog_food_orders(id,order_number,customer_id,address_id,order_type) VALUES ('order','EDF-TEST','buyer','address','on_demand');`);
    f.records.Sales[0].fields[schema['Website Order ID']]='order';
    if(link==='customer')f.sql.exec("UPDATE dog_food_customers SET sng_client_id='sng-123'");
    if(link==='order')f.sql.exec("UPDATE dog_food_orders SET source='sng_import'");
    if(link==='payment')f.sql.exec("INSERT INTO dog_food_payments(id,order_id,provider,idempotency_key,amount_cents,status) VALUES ('pay','order','sng_manual','test-payment',100,'failed')");
    if(link==='subscription')f.sql.exec("INSERT INTO dog_food_subscriptions(id,customer_id,address_id,payment_provider,next_charge_at,next_delivery_date) VALUES ('plan','buyer','address','sng','2026-10-12','2026-10-14')");
    if(link==='direct') {
      delete f.records.Sales[0].fields[schema['Website Order ID']];
      f.sql.exec("UPDATE dog_food_customers SET sng_client_id='sng-123'; INSERT INTO dog_food_direct_sale_links(sale_id,customer_id,recorded_by) VALUES ('recABCDEFGH','buyer','admin')");
    }
    await f.service.runFoodCollectionNotifications(f.env,{at:Date.parse('2026-10-12T01:00:00Z')});
    assert.equal(f.sends.length,link==='cash'?1:0,link);assert.equal(f.records['Payment Receipts'].length,0);
  }
});
test('only the configured staff phone and OPWP inbox can enter the staff payment queue',async()=>{
  const f=setup();assert.equal((await f.service.recordFoodCollectionReply(f.env,{...f.event,from:"+14195550181"})).handled,false);
  assert.equal((await f.service.recordFoodCollectionReply(f.env,{...f.event,to:"+14195550181"})).handled,false);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_collection_replies').get().n,0);
  assert.equal((await f.service.recordFoodCollectionReply(f.env,{...f.event,text:'Lunch at noon?'})).ignored,true);
});
test('signed staff report is queued once, paid against fresh balances and does not double-deduct bags',async()=>{
  const f=setup();assert.equal((await f.service.recordFoodCollectionReply(f.env,f.event)).queued,true);
  assert.equal((await f.service.recordFoodCollectionReply(f.env,f.event)).duplicate,true);
  await f.service.processFoodCollectionReplies(f.env,{limit:1});
  const row=f.sql.prepare('SELECT * FROM dog_food_collection_replies').get();assert.equal(row.status,'recorded');assert.equal(f.records['Payment Receipts'].length,1);
  const snap=JSON.parse(f.sql.prepare('SELECT payload FROM dog_food_ops_snapshots WHERE id=(SELECT snapshot_id FROM dog_food_ops_state)').get().payload);
  assert.equal(logic.operationModel(snap).unpaid[0].balanceCents,2000);assert.equal(logic.operationModel(snap).products[0].onHand,8);
  await f.service.processFoodCollectionReplies(f.env);assert.equal(f.records['Payment Receipts'].length,1);
});
test('overpayment, source-note conflict and duplicate check reference require office review without another receipt',async()=>{
  const f=setup();await f.service.recordFoodCollectionReply(f.env,{...f.event,text:f.event.text.replace('$100','$130')});
  await f.service.processFoodCollectionReplies(f.env);assert.equal(f.sql.prepare('SELECT status FROM dog_food_collection_replies').get().status,'review');assert.equal(f.records['Payment Receipts'].length,0);
  const sale=f.records.Sales[0];const schema=JSON.parse(fs.readFileSync(new URL('../data/dog-food-airtable-schema.json',import.meta.url),'utf8'));sale.fields[schema.tables.Sales.fields.Notes]='Still owes $20';
  await f.service.recordFoodCollectionReply(f.env,{...f.event,eventId:'EV2',providerMessageId:'AC2'});await f.service.processFoodCollectionReplies(f.env);assert.equal(f.sql.prepare("SELECT status FROM dog_food_collection_replies WHERE message_id='AC2'").get().status,'review');assert.equal(f.records['Payment Receipts'].length,0);
});
test('Airtable-paid closes a task but cancelled, archived and missing do not claim payment',async()=>{
  const f=setup();let model=logic.operationModel({tables:{Sales:[{id:'recABCDEFGH',fields:{'Sold To':'Buyer','Amount Collected':120,'Payment Status':'Paid','Sale Date':'2026-10-02'}}]}});
  await f.service.reconcileFoodCollections(f.db,model);assert.equal(f.sql.prepare('SELECT status FROM dog_food_collection_items').get().status,'paid');
  model.sales[0].cancelled=true;await f.service.reconcileFoodCollections(f.db,model);assert.equal(f.sql.prepare('SELECT status FROM dog_food_collection_items').get().status,'closed');
  model.sales=[];await f.service.reconcileFoodCollections(f.db,model);assert.equal(f.sql.prepare('SELECT status FROM dog_food_collection_items').get().status,'missing');
});
test('another assigned staff member is excluded from primary technician SMS',()=>{
  const model={unpaid:[{responsible:staffPrivate.primaryShort,responsiblePhone:'',nextFollowUp:''},{responsible:'Another staff member',responsiblePhone:'',nextFollowUp:''}],sales:[]};
  assert.equal(pure.collectorSales(model,{collector_name:staffPrivate.primaryName,collector_phone:staff}).length,1);
});
test('STOP pauses staff reminders and does not create a receipt or customer lead',async()=>{
  const f=setup();await f.service.recordFoodCollectionReply(f.env,{...f.event,text:'STOP'});assert.equal(f.sql.prepare('SELECT collector_enabled FROM dog_food_ops_state').get().collector_enabled,0);assert.equal(f.records['Payment Receipts'].length,0);
});
test('missing verified staff configuration blocks manual sends; schedule sends nothing on Saturday',async()=>{
  const f=setup();f.sql.exec('UPDATE dog_food_ops_state SET collector_verified_at=NULL');await assert.rejects(f.service.runFoodCollectionNotifications(f.env,{manual:true,at:Date.parse('2026-10-07T15:00:00Z')}),/Verify/);
  assert.equal((await f.service.runFoodCollectionNotifications(f.env,{at:Date.parse('2026-10-10T13:00:00Z')})).skipped,true);assert.equal(f.sends.length,0);
});
test('only primary technician receives SMS, once per local day; owner email configuration is unnecessary',async()=>{
  const f=setup(),at=Date.parse('2026-10-07T15:00:00Z');await f.service.runFoodCollectionNotifications(f.env,{manual:true,at});
  assert.equal(f.sends.length,1);assert.equal(f.sends[0].to[0],staff);assert.equal(f.sends[0].content,'OPWP dog-food collections\nReal Buyer: $120.00');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dog_food_ops_alerts WHERE channel='email'").get().n,0);
  await f.service.runFoodCollectionNotifications(f.env,{manual:true,at});assert.equal(f.sends.length,1);
  await f.service.recordFoodCollectionDelivery(f.db,{type:'message.delivered',data:{object:{direction:'outgoing',id:'AC-outbound',to:[staff]}}});
  assert.equal(f.sql.prepare("SELECT delivery_status FROM dog_food_ops_alerts WHERE channel='quo'").get().delivery_status,'delivered');
});
test('manual mode sends reminders without a staff webhook but never processes texts or enables automatic mode through settings',async()=>{
  const f=setup();f.sql.exec("UPDATE dog_food_ops_state SET collector_reply_mode='manual',collector_webhook_id=NULL");delete f.env.DOG_FOOD_QUO_WEBHOOK_SIGNING_KEY;
  await f.service.runFoodCollectionNotifications(f.env,{manual:true,at:Date.parse('2026-10-07T15:00:00Z')});
  assert.equal(f.sends.length,1);assert.equal(f.sends[0].content,'OPWP dog-food collections\nReal Buyer: $120.00');
  assert.equal((await f.service.recordFoodCollectionReply(f.env,f.event)).ignored,true);
  assert.equal((await f.service.recordFoodCollectionReply(f.env,{...f.event,text:'STOP'})).ignored,true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM dog_food_collection_replies').get().n,0);
  assert.equal((await f.service.processFoodCollectionReplies(f.env)).skipped,true);assert.equal(f.records['Payment Receipts'].length,0);
  await f.service.foodCollectionCommand(f.env,{action:'collection_settings',recipient:'owner@example.test',name:staffPrivate.primaryName,phone:staff,enabled:true,smsEnabled:true,weekdaysOnly:true,hour:9,collector_reply_mode:'automatic'},'owner');
  assert.equal(f.sql.prepare('SELECT collector_reply_mode FROM dog_food_ops_state').get().collector_reply_mode,'manual');
  assert.equal(f.sql.prepare('SELECT collector_enabled FROM dog_food_ops_state').get().collector_enabled,1);
  const state=f.sql.prepare('SELECT alert_hour,weekdays_only FROM dog_food_ops_state').get();assert.equal(state.alert_hour,21);assert.equal(state.weekdays_only,0);
});

test('Sunday 9 PM schedule stays Eastern through daylight saving changes and excludes other minutes',()=>{
  for(const at of ['2026-10-12T01:00:00Z','2026-11-02T02:00:00Z','2027-03-15T01:00:00Z'])assert.equal(pure.isCollectionReminderTime(at),true,at);
  for(const at of ['2026-10-11T01:00:00Z','2026-10-12T00:00:00Z','2026-10-12T01:10:00Z','2026-11-02T01:00:00Z','2026-10-09T13:00:00Z'])assert.equal(pure.isCollectionReminderTime(at),false,at);
});

test('legacy weekday settings cannot send daily emails or prevent the new weekly text',async()=>{
  const f=setup();f.sql.exec("UPDATE dog_food_ops_state SET alert_hour=9,weekdays_only=1,default_recipient=NULL,collector_reply_mode='manual'");
  for(const at of ['2026-10-09T13:00:00Z','2026-10-10T13:00:00Z','2026-10-11T13:00:00Z'])assert.equal((await f.service.runFoodCollectionNotifications(f.env,{at:Date.parse(at)})).skipped,true);
  await f.service.runFoodCollectionNotifications(f.env,{at:Date.parse('2026-10-12T01:00:00Z')});assert.equal(f.sends.length,1);
  assert.equal(f.sql.prepare('SELECT alert_date FROM dog_food_ops_alerts').get().alert_date,'2026-10-11');
  await f.service.runFoodCollectionNotifications(f.env,{at:Date.parse('2026-10-12T01:00:00Z')});
  await f.service.runFoodCollectionNotifications(f.env,{at:Date.parse('2026-10-12T01:10:00Z')});assert.equal(f.sends.length,1);
  await f.service.runFoodCollectionNotifications(f.env,{at:Date.parse('2026-10-19T01:00:00Z')});assert.equal(f.sends.length,2);
});

test('empty, deferred, conflicting and disabled collection queues send nothing',async()=>{
  for(const scenario of ['paid','deferred','conflict','disabled']) {
    const f=setup(),fields=f.records.Sales[0].fields,schema=JSON.parse(fs.readFileSync(new URL('../data/dog-food-airtable-schema.json',import.meta.url),'utf8')).tables.Sales.fields;
    if(scenario==='paid')fields[schema['Payments Received']]=120;
    if(scenario==='deferred')fields[schema['Next Follow-up']]='2026-10-20';
    if(scenario==='conflict')fields[schema.Notes]='Still owes $20';
    if(scenario==='disabled')f.sql.exec('UPDATE dog_food_ops_state SET alerts_enabled=0');
    const result=await f.service.runFoodCollectionNotifications(f.env,{at:Date.parse('2026-10-12T01:00:00Z')});
    assert.equal(result.skipped,true,scenario);assert.equal(f.sends.length,0,scenario);assert.equal(f.records['Payment Receipts'].length,0,scenario);
  }
});
test('duplicate actual receipt references and group messages cannot post another payment',async()=>{
  const f=setup();assert.equal((await f.service.recordFoodCollectionReply(f.env,{...f.event,isGroup:true})).ignored,true);
  await f.service.recordFoodCollectionReply(f.env,f.event);await f.service.processFoodCollectionReplies(f.env);
  await f.service.recordFoodCollectionReply(f.env,{...f.event,eventId:'EV2',providerMessageId:'AC2',text:f.event.text.replace('$100','$20')});await f.service.processFoodCollectionReplies(f.env);
  assert.equal(f.sql.prepare("SELECT status FROM dog_food_collection_replies WHERE message_id='AC2'").get().status,'review');assert.equal(f.records['Payment Receipts'].length,1);
});
test('staff webhook routing precedes lead intake and all admin mutations retain MFA/origin/rate gates',()=>{
  const route=fs.readFileSync(new URL('../app/api/webhooks/quo-messages/route.js',import.meta.url),'utf8');assert.ok(route.indexOf('const staffResult')<route.indexOf('const claim'));assert.match(route,/verifyQuoSignature/);assert.match(route,/scopedNumber !== configuredNumber/);
  const admin=fs.readFileSync(new URL('../app/api/admin/dog-food/operations/route.js',import.meta.url),'utf8');assert.match(admin,/verifyAdminRequest/);assert.match(admin,/get\('origin'\)/);assert.match(admin,/failClosed:true/);
});
