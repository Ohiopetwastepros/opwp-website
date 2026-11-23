import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {build} from 'esbuild';
import {leadTestDatabase} from './helpers/lead-inbox-fixture.mjs';
import {saveFunnelMode} from '../lib/lead-funnel-admin.mjs';

const built=await build({stdin:{contents:`export {POST as website} from './app/api/lead/route.js'; export {POST as meta} from './app/api/webhooks/meta-leads/route.js'; export {POST as quo} from './app/api/webhooks/quo-messages/route.js'; export {GET as overview,POST as approve,PATCH as settings} from './app/api/admin/lead-funnel/route.js';`,resolveDir:process.cwd()},
  bundle:true,write:false,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'runtime-only',setup(b){
    b.onResolve({filter:/(?:^|\/)cloudflare(?:\.js)?$/},()=>({path:'runtime',namespace:'fixture'}));
    b.onResolve({filter:/(?:^|\/)admin-auth(?:\.js)?$/},()=>({path:'auth',namespace:'fixture'}));
    b.onResolve({filter:/^next\/headers$/},()=>({path:'headers',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:{runtime:'export const getRuntimeEnv=()=>globalThis.funnelHttpEnv; export const getCloudflareContext=()=>({ctx:{waitUntil:p=>globalThis.funnelHttpTasks.push(p)}});',auth:'export const verifyAdminRequest=async()=>globalThis.funnelHttpAuth;',headers:'export const headers=async()=>new Headers();'}[args.path]}));
  }}]});
const routes=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const request=(path,body,extra={})=>new Request('https://opwp.test'+path,{method:'POST',headers:{'Content-Type':'application/json',origin:'https://opwp.test','sec-fetch-site':'same-origin',...extra},body:JSON.stringify(body)});

test('real website and signed Facebook handlers merge, send once, record receipts and honor signed STOP',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-16T16:00:00Z')});
  const db=leadTestDatabase();await saveFunnelMode(db,'auto','owner@example.com');
  const env={DB:db,APP_ENV:'production',LEAD_FUNNEL_ENABLED:'true',QUOTE_INITIAL_SMS_ENABLED:'true',SMS_PROVIDER:'quo',QUO_FROM_NUMBER:'+14192622371',QUO_API_KEY:'fixture',
    META_APP_SECRET:'fixture-meta',META_PAGE_ACCESS_TOKEN:'fixture-page',META_GRAPH_API_VERSION:'v26.0',META_ALLOWED_PAGE_IDS:'page-fixture',META_AUTOMATION_ENABLED:'true',META_AUTOMATION_APPROVAL_ID:'fixture-release',
    META_APPROVED_SMS_FORMS:JSON.stringify({'form-fixture':{pageId:'page-fixture',consentCheckboxKey:'sms_box',version:'fixture-v1',disclosure:'Requested quote texts. Reply STOP.'}}),QUO_WEBHOOK_KEY:'whsec_'+Buffer.from('fixture-webhook-key').toString('base64')};
  db.sqlite.exec("INSERT INTO meta_automation_releases(id,organization_id,policy_version,approved_by,approved_at,evidence) VALUES ('fixture-release','org-opwp','lead-funnel-initial-v1','fixture-owner',CURRENT_TIMESTAMP,'fixture-only')");
  globalThis.funnelHttpEnv=env;globalThis.funnelHttpTasks=[];globalThis.funnelHttpAuth={authorized:true,email:'owner@example.com'};
  let sends=0;
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    const address=String(url);
    if(address.startsWith('https://graph.facebook.com/'))return Response.json({id:'lead-fixture',form_id:'form-fixture',created_time:new Date().toISOString(),custom_disclaimer_responses:[{checkbox_key:'sms_box',is_checked:'1'}],field_data:[{name:'full_name',values:['Avery Example']},{name:'email',values:['avery@example.com']},{name:'phone_number',values:['+14192620100']},{name:'contact_preference',values:['Text']}]});
    if(address.startsWith('https://api.openphone.com/')){
      if(options.method==='POST'){sends++;return Response.json({data:{id:'AC-fixture-'+sends,status:'queued'}},{status:202});}
      if(address.endsWith('/phone-numbers'))return Response.json({data:[{id:'PNfixture',number:'+14192622371'}]});
      return Response.json({data:[]});
    }
    throw Error('Unexpected external request in isolated HTTP test');
  };
  try {
    const form={source:'partial_quote',funnel_id:'fixture-funnel-123456',name:'Avery Example',email:'avery@example.com',phone:'4192620100',zip:'43551',follow_up_consent:true,dogs:2,frequency:'once_a_week',yard_size:'tiny',last_cleaned:'one_month'};
    let response=await routes.website(request('/api/lead/',form));assert.equal(response.status,200);const saved=await response.json();assert.ok(saved.routeToken);
    await Promise.all(globalThis.funnelHttpTasks);assert.equal(sends,1);
    response=await routes.website(request('/api/lead/',{...form,funnel_id:'fixture-other-browser-123',phone:'+1 (419) 262-0100'}));assert.equal((await response.json()).id,saved.id);
    await Promise.all(globalThis.funnelHttpTasks);assert.equal(sends,1);
    const event={object:'page',entry:[{id:'page-fixture',changes:[{field:'leadgen',value:{leadgen_id:'lead-fixture',form_id:'form-fixture',page_id:'page-fixture'}}]}]};
    const raw=JSON.stringify(event),signature='sha256='+createHmac('sha256',env.META_APP_SECRET).update(raw).digest('hex');
    response=await routes.meta(request('/api/webhooks/meta-leads/',event,{'x-hub-signature-256':signature}));assert.equal(response.status,200);
    await Promise.all(globalThis.funnelHttpTasks);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM submissions').get().n,1);assert.equal(sends,1);
    function quoRequest(type,resource,context) {
      const body={id:'EV-fixture-'+type,apiVersion:'2026-03-30',type,data:{resource,context}},raw=JSON.stringify(body),stamp=String(Math.floor(Date.now()/1000)),id='delivery-'+type;
      return request('/api/webhooks/quo-messages/',body,{'webhook-id':id,'webhook-timestamp':stamp,'webhook-signature':'v1,'+createHmac('sha256',Buffer.from('fixture-webhook-key')).update(`${id}.${stamp}.${raw}`).digest('base64')});
    }
    response=await routes.quo(quoRequest('message.delivered',{id:'AC-fixture-1',direction:'outgoing',text:'Fixture'}, {senderIdentifier:'+14192622371',recipientIdentifiers:['+14192620100']}));assert.equal(response.status,200);
    assert.equal(db.sqlite.prepare("SELECT delivery_status FROM lead_messages WHERE direction='outbound'").get().delivery_status,'delivered');
    response=await routes.quo(quoRequest('message.received',{id:'AC-stop',direction:'incoming',text:'STOP'},{senderIdentifier:'+14192620100',recipientIdentifiers:['+14192622371'],conversationId:'CNfixture'}));assert.equal(response.status,200);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM lead_suppressions').get().n,1);assert.equal(sends,1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM meta_sms_jobs WHERE status='queued'").get().n,0);
  } finally {globalThis.fetch=originalFetch;}
});

test('initial-text APIs enforce session, owner, same origin and bounded input before mutation',async()=>{
  const db=leadTestDatabase();globalThis.funnelHttpEnv={DB:db,ADMIN_USERNAME:'owner@example.com',LEAD_FUNNEL_ENABLED:'true'};
  globalThis.funnelHttpAuth={authorized:false};assert.equal((await routes.settings(request('/api/admin/lead-funnel/',{initialTextMode:'auto'}))).status,401);
  globalThis.funnelHttpAuth={authorized:true,email:'staff@example.com'};assert.equal((await routes.settings(request('/api/admin/lead-funnel/',{initialTextMode:'auto'}))).status,403);
  globalThis.funnelHttpAuth={authorized:true,email:'owner@example.com'};
  assert.equal((await routes.settings(request('/api/admin/lead-funnel/',{initialTextMode:'auto'},{origin:'https://other.test'}))).status,403);
  assert.equal((await routes.settings(request('/api/admin/lead-funnel/',{initialTextMode:'invented'}))).status,400);
  assert.equal((await routes.settings(request('/api/admin/lead-funnel/',{initialTextMode:'approval'}))).status,200);
});
