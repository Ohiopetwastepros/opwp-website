import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {setup} from './helpers/unified-food-sales-fixture.mjs';
import {customerBody} from './helpers/food-customer-input.mjs';
import * as hub from '../lib/food-customer-hub.mjs';
import {processFoodCustomerMessages} from '../lib/food-customer-messages.mjs';
import * as auth from '../lib/dog-food-account.mjs';
import * as logic from '../lib/dog-food-operations.mjs';
import workflowSchema from '../data/dog-food-workflow-schema.json' with {type:'json'};
const count=(f,t)=>f.sql.prepare('SELECT COUNT(*) n FROM '+t).get().n;
function fixture(){const f=setup();f.sql.exec(`CREATE TABLE IF NOT EXISTS field_message_suppression(phone TEXT PRIMARY KEY,suppressed INTEGER);
CREATE TABLE IF NOT EXISTS lead_suppressions(organization_id TEXT,phone_hash TEXT,reason TEXT);
CREATE TABLE IF NOT EXISTS api_rate_limits(scope TEXT,client_key TEXT,window_start INTEGER,request_count INTEGER,expires_at TEXT,PRIMARY KEY(scope,client_key,window_start));`);return f;}
const source=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
function senders(extra={}){const email=[],sms=[];return {email,sms,options:{emailConfigured:true,smsConfigured:true,origin:'https://example.test',sendEmail:async m=>{email.push(m);return 'email-'+email.length;},sendSms:async m=>{sms.push(m);return 'sms-'+sms.length;},...extra}};}

test('new customer requires complete contact, address, dog and service details before any record or invitation',async()=>{
  const f=fixture();for(const field of ['firstName','lastName','email','phone','address','city','state','zip','dogCount','customerType','frequency','fulfillment','placement','smsConsent']){
    await assert.rejects(hub.foodCustomerCommand(f.db,customerBody({[field]:field==='smsConsent'?false:''}),'seller'));
    assert.equal(count(f,'dog_food_customers'),1);assert.equal(count(f,'dog_food_customer_messages'),0);
  }
  await assert.rejects(hub.foodCustomerCommand(f.db,customerBody({placement:'Other',placementOther:''}),'seller'),/instructions/);
});
test('customer, profile, address and two invitation intents commit once; retries never duplicate or create a portal password',async()=>{
  const f=fixture(),body=customerBody(),saved=await hub.foodCustomerCommand(f.db,body,'seller');
  assert.deepEqual(await hub.foodCustomerCommand(f.db,{...body},'seller'),saved);
  assert.equal(count(f,'dog_food_customers'),2);assert.equal(count(f,'dog_food_customer_profiles'),1);assert.equal(count(f,'dog_food_customer_messages'),2);assert.equal(count(f,'dog_food_accounts'),1);assert.equal(count(f,'dog_food_orders'),0);
  assert.equal(f.sql.prepare('SELECT phone FROM dog_food_customers WHERE id=?').get(saved.id).phone,'+14195550199');
  await assert.rejects(hub.foodCustomerCommand(f.db,{...body,lastName:'Different'},'seller'),/different details/);
  await assert.rejects(hub.foodCustomerCommand(f.db,customerBody(),'other'),/already exists/);
});
test('email and SMS lead to one verified portal account and the same staff sale, address and customer history',async()=>{
  const f=fixture(),body=customerBody({fulfillment:'pickup'}),saved=await hub.foodCustomerCommand(f.db,body,'seller'),provider=senders();
  await processFoodCustomerMessages(f.db,provider.options);await processFoodCustomerMessages(f.db,provider.options);
  assert.equal(provider.email.length,1);assert.equal(provider.sms.length,1);assert.equal(count(f,'dog_food_accounts'),1);
  const temporary=provider.email[0].text.match(/Temporary password: (\S+)/)[1];assert.equal(provider.sms[0].text.includes(temporary),false);
  assert.equal(JSON.stringify(await hub.readFoodCustomerHub(f.db,{id:saved.id})).includes(temporary),false);
  const restricted=await auth.loginFoodAccount(f.db,{email:body.email,password:temporary});assert.equal(restricted.passwordChangeRequired,true);assert.equal(restricted.sessionToken,undefined);
  const result=await auth.redeemFoodEmail(f.db,{token:restricted.setupToken,password:'Customer-choice!2026',passwordConfirm:'Customer-choice!2026'});
  await hub.linkStaffFoodPortalProfile(f.db,result.sessionToken);
  const account=await auth.foodAccountSession(f.db,new Headers({cookie:auth.FOOD_SESSION_COOKIE+'='+result.sessionToken}));assert.equal(account.customer_id,saved.id);
  assert.equal(f.sql.prepare('SELECT preferred_fulfillment FROM dog_food_accounts WHERE id=?').get(account.id).preferred_fulfillment,'pickup');
  const order=await f.save({customerId:saved.id});const portal=await f.readFoodPortal(f.db,account);
  assert.equal(portal.orders[0].id,order.orderId);assert.equal(portal.customer.id,saved.id);assert.equal(portal.addresses[0].line1,body.address);assert.equal(portal.profileRequired,false);
  await assert.rejects(auth.loginFoodAccount(f.db,{email:body.email,password:temporary}),/incorrect/);
});
test('SMS opt-out is honored while the email invitation still sends',async()=>{
  const f=fixture(),saved=await hub.foodCustomerCommand(f.db,customerBody(),'seller'),provider=senders();f.sql.prepare('INSERT INTO field_message_suppression(phone,suppressed) VALUES(?,1)').run('+14195550199');
  await processFoodCustomerMessages(f.db,provider.options);assert.equal(provider.email.length,1);assert.equal(provider.sms.length,0);
  const messages=await hub.foodCustomerMessages(f.db,saved.id);assert.equal(messages.find(m=>m.channel==='sms').status,'suppressed');assert.equal(messages.find(m=>m.channel==='email').status,'accepted');
});
test('uncertain provider acceptance and repeated submission never automatically resend or duplicate a contact',async()=>{
  const f=fixture(),body=customerBody(),saved=await hub.foodCustomerCommand(f.db,body,'seller');let sms=0;const provider=senders({sendSms:async()=>{sms++;throw Error('response lost after provider acceptance');}});
  await processFoodCustomerMessages(f.db,provider.options);await hub.foodCustomerCommand(f.db,body,'seller');await processFoodCustomerMessages(f.db,provider.options);
  assert.equal(sms,1);assert.equal(provider.email.length,1);assert.equal(count(f,'dog_food_customers'),2);assert.equal((await hub.foodCustomerMessages(f.db,saved.id)).find(m=>m.channel==='sms').status,'uncertain');
});
test('unconfigured providers leave a durable queue and never report invitations as delivered',async()=>{
  const f=fixture(),saved=await hub.foodCustomerCommand(f.db,customerBody(),'seller'),provider=senders({emailConfigured:false,smsConfigured:false});await processFoodCustomerMessages(f.db,provider.options);
  assert.equal(provider.email.length+provider.sms.length,0);assert.ok((await hub.foodCustomerMessages(f.db,saved.id)).every(m=>m.status==='queued'));
});
test('office edits preserve historical order addresses, reject stale changes and keep existing portal credentials',async()=>{
  const f=fixture(),body=customerBody(),saved=await hub.foodCustomerCommand(f.db,body,'seller');await f.save({customerId:saved.id,fulfillmentMethod:'delivery'});
  let c=(await hub.readFoodCustomerHub(f.db,{id:saved.id})).customers[0];const oldAddress=c.addresses[0].id;
  const update={...body,action:'update_customer',commandId:crypto.randomUUID(),customerId:saved.id,revision:c.revision,version:c.version,address:'789 Updated Street'};
  await hub.foodCustomerCommand(f.db,update,'owner',{office:true});c=(await hub.readFoodCustomerHub(f.db,{id:saved.id})).customers[0];
  assert.notEqual(c.addresses[0].id,oldAddress);assert.equal(f.sql.prepare('SELECT address_id FROM dog_food_orders WHERE customer_id=?').get(saved.id).address_id,oldAddress);
  await assert.rejects(hub.foodCustomerCommand(f.db,{...update,commandId:crypto.randomUUID()},'owner',{office:true}),/changed/);
  f.sql.prepare("INSERT INTO dog_food_accounts(id,email,customer_id,password_hash) VALUES('new-account',?,?,'keep-this-hash')").run(body.email,saved.id);
  await assert.rejects(hub.foodCustomerCommand(f.db,{...update,commandId:crypto.randomUUID(),revision:c.revision,version:c.version,email:'different@example.test'},'owner',{office:true}),/verification/);
  assert.equal(f.sql.prepare("SELECT password_hash FROM dog_food_accounts WHERE id='new-account'").get().password_hash,'keep-this-hash');
});
test('staff cannot edit other customer records or administer the customer hub; an office header requires owner MFA',async()=>{
  const f=fixture(),created=await hub.foodCustomerCommand(f.db,customerBody(),'seller');await assert.rejects(hub.foodCustomerCommand(f.db,customerBody({action:'update_customer',customerId:created.id}),'seller'),/office/);
  const api=vm.runInNewContext(source('lib/food-sales-api.js')+'\n({foodSalesContext})',{getRuntimeEnv:()=>({DB:f.db,FOOD_SALES_NATIVE_ENABLED:'true'}),verifyFoodSalesRequest:async()=>({authorized:true,member:{id:'seller'}}),verifyAdminRequest:async()=>({authorized:false}),checkRateLimit:async()=>({allowed:true}),rateLimitResponse:()=>{},Response,URL});
  const denied=await api.foodSalesContext(new Request('https://example.test/api/food-sales/',{headers:{'x-food-office':'1'}}));assert.equal(denied.response.status,401);
  const owner=vm.runInNewContext(source('app/api/admin/dog-food/customers/route.js')+'\n({GET,POST})',{verifyAdminRequest:async()=>({authorized:false}),salesHeaders:{},salesError:e=>{throw e;},Response});assert.equal((await owner.GET(new Request('https://example.test/api/admin/dog-food/customers/'))).status,401);
});
test('Airtable projection attaches the native ID to the known source customer without making a duplicate',async()=>{
  const f=fixture(),fields=f.service.foodSchema.tables.Customers.fields,id='rec00000000000001';
  f.records.Customers.push({id,fields:{[fields['Customer Name']]:'New Buyer',[fields.Email]:'new@example.test'}});
  const workflow=vm.runInNewContext(source('lib/dog-food-workflow.js')+'\n({upsertFoodProjection})',{...logic,...f.service,workflowSchema,URLSearchParams,JSON,crypto});
  const value={'Website Customer ID':'native-buyer','Customer Name':'New Buyer',Email:'new@example.test'};
  assert.equal(await workflow.upsertFoodProjection(f.env,f.service.foodSchema.tables.Customers.id,fields,'Website Customer ID',value,id),id);
  assert.equal(f.records.Customers.length,1);assert.equal(f.records.Customers[0].fields[fields['Website Customer ID']],'native-buyer');
  await assert.rejects(workflow.upsertFoodProjection(f.env,f.service.foodSchema.tables.Customers.id,fields,'Website Customer ID',{...value,'Website Customer ID':'wrong-native'},id),/different website record/);
});

for(const blocked of ['email','sms'])for(const reason of ['unconfigured','budget']){
  test(`${reason} ${blocked} backlog does not starve the other invitation channel`,async()=>{
    const f=fixture(),provider=senders(),working=blocked==='email'?'sms':'email';
    for(let i=0;i<6;i++)await hub.foodCustomerCommand(f.db,customerBody({email:`queue-${i}@example.test`}),'seller');
    f.sql.prepare("UPDATE dog_food_customer_messages SET created_at=CASE WHEN channel=? THEN '2026-01-01' ELSE '2026-01-02' END").run(blocked);
    const window=Math.floor(Date.now()/86400000)*86400;
    if(reason==='unconfigured')provider.options[blocked+'Configured']=false;
    else f.sql.prepare("INSERT INTO api_rate_limits VALUES('food_customer_invites',?,?,100,datetime(?,'unixepoch'))").run(blocked,window,window+172800);
    await processFoodCustomerMessages(f.db,provider.options);
    assert.equal(provider[blocked].length,0);assert.equal(provider[working].length,4);
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dog_food_customer_messages WHERE channel=? AND status='queued'").get(blocked).n,6);
    if(reason==='budget')assert.equal(f.sql.prepare("SELECT request_count FROM api_rate_limits WHERE client_key=?").get(blocked).request_count,100);
    await processFoodCustomerMessages(f.db,provider.options);
    assert.equal(provider[working].length,6);assert.equal(provider[blocked].length,0);
    // Making the blocked channel eligible drains its preserved queue once only.
    provider.options[blocked+'Configured']=true;
    if(reason==='budget')f.sql.prepare("UPDATE api_rate_limits SET window_start=? WHERE client_key=?").run(window-86400,blocked);
    await processFoodCustomerMessages(f.db,{...provider.options,limit:10});
    await processFoodCustomerMessages(f.db,provider.options);
    assert.equal(provider[blocked].length,6);assert.equal(provider[working].length,6);
  });
}
test('reaching a channel budget within a bounded pass leaves capacity for the other channel',async()=>{
  const f=fixture(),provider=senders(),window=Math.floor(Date.now()/86400000)*86400;
  for(let i=0;i<6;i++)await hub.foodCustomerCommand(f.db,customerBody({email:`budget-${i}@example.test`}),'seller');
  f.sql.prepare("UPDATE dog_food_customer_messages SET created_at=CASE WHEN channel='sms' THEN '2026-01-01' ELSE '2026-01-02' END").run();
  f.sql.prepare("INSERT INTO api_rate_limits VALUES('food_customer_invites','sms',?,99,datetime(?,'unixepoch'))").run(window,window+172800);
  await processFoodCustomerMessages(f.db,provider.options);
  assert.equal(provider.sms.length,1);assert.equal(provider.email.length,3);
  assert.equal(f.sql.prepare("SELECT request_count FROM api_rate_limits WHERE client_key='sms'").get().request_count,100);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM dog_food_customer_messages WHERE channel='sms' AND status='queued'").get().n,5);
});
