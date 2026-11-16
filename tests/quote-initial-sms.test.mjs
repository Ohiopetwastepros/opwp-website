import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { leadTestDatabase } from "./helpers/lead-inbox-fixture.mjs";
import { initialQuoteSmsId, initialSmsPhone, runInitialQuoteSms } from "../lib/quote-initial-sms.mjs";
import { buildCustomerQuoteFollowUpSms } from "../lib/quote-funnel.mjs";
import { patchQuoteWorker } from "../scripts/patch-quote-follow-up-worker.mjs";

const bundled = await build({
  entryPoints:["lib/db.js"],bundle:true,platform:"node",format:"esm",write:false,
  plugins:[{name:"isolate-queue",setup(b) {
    b.onResolve({filter:/^\.\/cloudflare$/},()=>({path:"context",namespace:"test"}));
    b.onResolve({filter:/^\.\/lead-assistant$/},()=>({path:"assistant",namespace:"test"}));
    b.onLoad({filter:/.*/,namespace:"test"},args=>({contents:args.path==="context"
      ? "export const getRuntimeEnv=()=>globalThis.initialSmsTestEnv;"
      : "export async function queueLeadSync(){}"}));
  }}],
});
const {queuePartialQuoteFollowUp} = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));

async function fixture({phone="4192620100",body={},historical=false}={}) {
  const db = leadTestDatabase();
  const id = crypto.randomUUID();
  const consentAt = new Date().toISOString();
  const form = {name:"Casey Demo",phone,follow_up_consent:true,follow_up_allowed:true,
    follow_up_consent_version:"quote_service_sms_v1",follow_up_consent_at:consentAt,
    quote_context:{dogs:2,frequency:"once_a_week"},...body};
  db.sqlite.prepare(`INSERT INTO submissions(id,kind,source,status,phone,email,payload)
    VALUES (?,'partial_quote','website','follow_up_pending',?,'casey@example.com',?)`).run(id,phone,JSON.stringify(form));
  db.sqlite.prepare(`INSERT INTO lead_conversations(id,submission_id,organization_id) VALUES (?,?,'org-opwp')`).run(crypto.randomUUID(),id);
  globalThis.initialSmsTestEnv = {DB:db};
  await queuePartialQuoteFollowUp({submissionId:id,phone,consentAt});
  if (historical) db.sqlite.prepare("UPDATE quote_follow_up_deliveries SET id=? WHERE id=?").run(crypto.randomUUID(),initialQuoteSmsId(id));
  const calls = [];
  const fetcher = async (url,options={})=>{
    calls.push({url,options});
    if (options.method==="POST") return Response.json({data:{id:"ACmock",status:"queued"}},{status:202});
    if (url.endsWith("/phone-numbers")) return Response.json({data:[{number:"+14192622371",id:"PNmock"}]});
    assert.equal(new URL(url).searchParams.get("participants[]"),initialSmsPhone(phone));
    return Response.json({data:[]});
  };
  const env = {DB:db,QUOTE_INITIAL_SMS_ENABLED:"true",SMS_PROVIDER:"quo",QUO_FROM_NUMBER:"+14192622371",QUO_API_KEY:"mock"};
  const delivery = ()=>db.sqlite.prepare("SELECT * FROM quote_follow_up_deliveries WHERE submission_id=? AND channel='customer_sms'").get(id);
  return {db,id,env,fetcher,calls,delivery};
}

test("quote-specific patch survives existing ten-minute branches and preserves scheduled tasks",()=>{
  const original = `export default { async scheduled(controller, env, ctx) {
    if (controller.cron === "*/10 * * * *") ctx.waitUntil(food());
    const task = subscriptions(); ctx.waitUntil(task);
  }};`;
  const patched = patchQuoteWorker(original);
  assert.match(patched,/runInitialQuoteSms\(env\)/);
  assert.ok(patched.includes('const task = subscriptions(); ctx.waitUntil(task);'));
  assert.equal(patchQuoteWorker(patched),patched);
  assert.equal((patched.match(/OPWP_INITIAL_QUOTE_SMS_V1/g)||[]).length,1);
  assert.doesNotMatch(patched,/runScheduledQuoteFollowUps|runScheduledYardOps|runFailedPaymentRecovery|processFieldMessages/);
  assert.throws(()=>patchQuoteWorker("export default {}"),/scheduled handler/);
  const config=JSON.parse(readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8"));
  for (const cron of ["* * * * *","*/10 * * * *","0 * * * *","5 * * * *","15 * * * *","35 * * * *"]) assert.ok(config.triggers.crons.includes(cron));
});

test("SMS is due immediately while parent, email and SNG keep their schedule",async()=>{
  const {db,id,delivery}=await fixture();
  const parent=db.sqlite.prepare("SELECT * FROM quote_follow_ups WHERE submission_id=?").get(id);
  assert.ok(delivery().next_attempt_at<parent.scheduled_at);
  const others=db.sqlite.prepare("SELECT * FROM quote_follow_up_deliveries WHERE submission_id=? AND channel!='customer_sms'").all(id);
  assert.ok(others.every(row=>row.next_attempt_at===parent.scheduled_at));
  assert.equal(delivery().id,initialQuoteSmsId(id));
});

test("approved wording handles missing fields and uses only supplied service details",()=>{
  assert.match(buildCustomerQuoteFollowUpSms(),/^Hello, this is Craig/);
  assert.match(buildCustomerQuoteFollowUpSms({name:"Casey Demo",quote_context:{dogs:2,frequency:"once_a_week"}}),/Hello Casey,.*weekly cleanup for your 2 dogs/);
  const unsafe=buildCustomerQuoteFollowUpSms({name:"<script>",quote_context:{dogs:null,frequency:"invented $1"}});
  assert.doesNotMatch(unsafe,/script|\$1|your dog/);
  assert.match(unsafe,/Text STOP to unsubscribe/);
});

test("invalid and reserved numbers fail closed",()=>{
  for (const phone of ["1234567890","4195550100","+441234567890","4192620424 ext 5",""]) assert.equal(initialSmsPhone(phone),"");
  assert.equal(initialSmsPhone("(419) 262-0100"),"+14192620100");
});

test("initial sender personalizes, records a durable key and accepts only one concurrent attempt",async()=>{
  const f=await fixture();
  const before=f.db.sqlite.prepare("SELECT * FROM quote_follow_up_deliveries WHERE channel!='customer_sms'").all();
  await Promise.all([runInitialQuoteSms(f.env,{fetcher:f.fetcher}),runInitialQuoteSms(f.env,{fetcher:f.fetcher})]);
  await runInitialQuoteSms(f.env,{fetcher:f.fetcher});
  const posts=f.calls.filter(call=>call.options.method==="POST");
  assert.equal(posts.length,1);
  assert.match(JSON.parse(posts[0].options.body).content,/Hello Casey,.*weekly cleanup for your 2 dogs/);
  assert.equal(f.delivery().status,"sent");
  const state=JSON.parse(f.db.sqlite.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'quote_initial_sms:%'").get().payload);
  assert.equal(state.status,"accepted");assert.equal(state.providerId,"ACmock");assert.ok(state.idempotencyKey);
  assert.deepEqual(f.db.sqlite.prepare("SELECT * FROM quote_follow_up_deliveries WHERE channel!='customer_sms'").all(),before);
});

test("historical deliveries and disabled rollout never dispatch or mutate",async()=>{
  for (const historical of [true,false]) {
    const f=await fixture({historical});
    if (!historical) f.env.QUOTE_INITIAL_SMS_ENABLED="false";
    const before=f.delivery();
    await runInitialQuoteSms(f.env,{fetcher:f.fetcher});
    assert.deepEqual(f.delivery(),before);assert.equal(f.calls.length,0);
  }
});

test("consent, preferences, opt-outs, stale leads and manual takeover suppress visibly",async()=>{
  const cases=[
    {body:{follow_up_consent:false},reason:"consent_missing"},
    {body:{follow_up_consent_at:""},reason:"consent_missing"},
    {body:{preferred_channel:"email"},reason:"contact_preference"},
    {body:{sms_opt_out:true},reason:"opted_out"},
    {phone:"4195550100",reason:"invalid_or_changed_phone"},
    {sql:"UPDATE lead_conversations SET automation_mode='paused'",reason:"manual_takeover"},
    {sql:"UPDATE lead_conversations SET last_outbound_at=CURRENT_TIMESTAMP",reason:"manual_takeover"},
    {sql:"UPDATE submissions SET created_at=datetime('now','-1 hour')",reason:"window_expired"},
    {sql:"UPDATE submissions SET status='converted'",reason:"cancelled"},
  ];
  for (const scenario of cases) {
    const f=await fixture(scenario);if(scenario.sql)f.db.sqlite.exec(scenario.sql);
    await runInitialQuoteSms(f.env,{fetcher:f.fetcher});
    assert.equal(f.delivery().status,"cancelled");assert.match(f.delivery().error_message,new RegExp(scenario.reason));
    assert.equal(f.calls.length,0);
    assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) count FROM growth_lead_events").get().count,1);
  }
});

test("phone-level suppression and duplicate submissions cannot create another initial text",async()=>{
  const f=await fixture();
  await runInitialQuoteSms(f.env,{fetcher:f.fetcher});
  const original=f.db.sqlite.prepare("SELECT * FROM submissions WHERE id=?").get(f.id);
  const next=crypto.randomUUID();
  f.db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,phone,email,payload) VALUES (?,'partial_quote','website','follow_up_pending',?,'other@example.com',?)").run(next,original.phone,original.payload);
  f.db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id) VALUES (?,?,'org-opwp')").run(crypto.randomUUID(),next);
  globalThis.initialSmsTestEnv=f.env;
  await queuePartialQuoteFollowUp({submissionId:next,phone:original.phone,consentAt:JSON.parse(original.payload).follow_up_consent_at});
  await runInitialQuoteSms(f.env,{fetcher:f.fetcher});
  assert.equal(f.calls.filter(call=>call.options.method==="POST").length,1);
  const hash=Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(initialSmsPhone(original.phone)))).toString("hex");
  const suppressed=await fixture();
  suppressed.db.sqlite.prepare("INSERT INTO lead_suppressions VALUES ('org-opwp',?,'opted_out','test','owner',CURRENT_TIMESTAMP)").run(hash);
  await runInitialQuoteSms(suppressed.env,{fetcher:suppressed.fetcher});
  assert.equal(suppressed.delivery().error_message,"phone_suppressed");assert.equal(suppressed.calls.length,0);
});

test("Quo messages or calls and takeover during preflight suppress dispatch",async()=>{
  for (const path of ["/messages?","/calls?","takeover"]) {
    const f=await fixture();
    const fetcher=async(url,options)=>{
      if (path==="takeover" && url.includes("/calls?")) f.db.sqlite.exec("UPDATE lead_conversations SET automation_mode='paused'");
      if (url.includes(path)) return Response.json({data:[{id:"existing"}]});
      return f.fetcher(url,options);
    };
    await runInitialQuoteSms(f.env,{fetcher});
    assert.equal(f.delivery().status,"cancelled");assert.equal(f.calls.filter(call=>call.options.method==="POST").length,0);
  }
});

test("failed preflight retries safely but ambiguous POST outcomes are never replayed",async()=>{
  const f=await fixture();let postCount=0;
  await runInitialQuoteSms(f.env,{fetcher:async()=>{throw new Error("network");}});
  assert.equal(f.delivery().status,"failed");assert.equal(f.delivery().attempt_count,1);
  f.db.sqlite.exec("UPDATE quote_follow_up_deliveries SET next_attempt_at=CURRENT_TIMESTAMP");
  const fetcher=async(url,options)=>{if(options?.method==="POST"){postCount++;throw new Error("timeout");}return f.fetcher(url,options);};
  await runInitialQuoteSms(f.env,{fetcher});
  assert.equal(f.delivery().attempt_count,5);assert.match(f.delivery().error_message,/unconfirmed/);
  await runInitialQuoteSms(f.env,{fetcher});assert.equal(postCount,1);
  const state=JSON.parse(f.db.sqlite.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'quote_initial_sms:%'").get().payload);
  assert.equal(state.status,"unknown");
});

test("simultaneous duplicate forms reserve the normalized phone once",async()=>{
  const f=await fixture();
  const original=f.db.sqlite.prepare("SELECT * FROM submissions WHERE id=?").get(f.id);
  const second=crypto.randomUUID();
  f.db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,phone,email,payload) VALUES (?,'partial_quote','website','follow_up_pending',?,'second@example.com',?)").run(second,original.phone,original.payload);
  f.db.sqlite.prepare("INSERT INTO lead_conversations(id,submission_id,organization_id) VALUES (?,?,'org-opwp')").run(crypto.randomUUID(),second);
  globalThis.initialSmsTestEnv=f.env;
  await queuePartialQuoteFollowUp({submissionId:second,phone:original.phone,consentAt:JSON.parse(original.payload).follow_up_consent_at});
  await Promise.all([runInitialQuoteSms(f.env,{submissionId:f.id,fetcher:f.fetcher}),runInitialQuoteSms(f.env,{submissionId:second,fetcher:f.fetcher})]);
  assert.equal(f.calls.filter(call=>call.options.method==="POST").length,1);
});

test("interrupted workers are quarantined with a visible reason and cannot replay",async()=>{
  const f=await fixture();
  f.db.sqlite.exec("UPDATE quote_follow_up_deliveries SET status='sending',sending_at=datetime('now','-3 minutes') WHERE channel='customer_sms'");
  await runInitialQuoteSms(f.env,{fetcher:f.fetcher});
  assert.equal(f.delivery().status,"failed");assert.match(f.delivery().error_message,/worker_interrupted/);
  assert.equal(f.delivery().attempt_count,5);assert.equal(f.calls.length,0);
});

test("a duplicate consented form during preflight uses the latest service details once",async()=>{
  const f=await fixture();
  const fetcher=async(url,options)=>{
    if (url.includes("/calls?")) {
      const row=f.db.sqlite.prepare("SELECT payload FROM submissions WHERE id=?").get(f.id);
      const body=JSON.parse(row.payload);body.follow_up_consent_at=new Date().toISOString();
      body.quote_context={dogs:3,frequency:"every_other_week"};
      f.db.sqlite.prepare("UPDATE submissions SET payload=? WHERE id=?").run(JSON.stringify(body),f.id);
    }
    return f.fetcher(url,options);
  };
  await runInitialQuoteSms(f.env,{fetcher});
  const posts=f.calls.filter(call=>call.options.method==="POST");
  assert.equal(posts.length,1);assert.match(JSON.parse(posts[0].options.body).content,/every-other-week cleanup for your 3 dogs/);
});

test("owner verification is bound to one funnel and phone, expires, and still enforces permission",async()=>{
  for (const mode of ["approved","expired","wrong_phone","opted_out","suppressed","deleted_test"]) {
    const f=await fixture({body:mode==="opted_out"?{sms_opt_out:true}:{}});
    const funnel=crypto.randomUUID();
    f.db.sqlite.prepare("UPDATE submissions SET funnel_id=? WHERE id=?").run(funnel,f.id);
    const hash=Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(initialSmsPhone("4192620100")))).toString("hex");
    f.db.sqlite.prepare("INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload) VALUES (?,?)")
      .run("quote_initial_sms_verification:"+funnel,JSON.stringify({approvedByOwner:true,
        phoneHash:mode==="wrong_phone"?"wrong":hash,expiresAt:new Date(Date.now()+(mode==="expired"?-60000:10*60000)).toISOString()}));
    f.db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,phone,payload) VALUES (?,'partial_quote','website','converted','4192620100','{}')").run(crypto.randomUUID());
    if (["suppressed","deleted_test"].includes(mode)) f.db.sqlite.prepare("INSERT INTO lead_suppressions VALUES ('org-opwp',?,?,?,'owner',CURRENT_TIMESTAMP)")
      .run(hash,mode==="deleted_test"?"Test":"opted_out",mode==="deleted_test"?"deleted_lead":"quo_webhook");
    const fetcher=async(url,options)=>url.includes("/messages?")?Response.json({data:[{id:"old-test-message"}]}):f.fetcher(url,options);
    await runInitialQuoteSms(f.env,{fetcher});
    await runInitialQuoteSms(f.env,{fetcher});
    const accepted=["approved","deleted_test"].includes(mode);
    assert.equal(f.calls.filter(call=>call.options.method==="POST").length,accepted?1:0);
    assert.equal(f.delivery().status,accepted?"sent":"cancelled");
  }
});

test("normal form entry schedules SMS before owner notification and survives request replay",async()=>{
  const routeBundle=await build({entryPoints:["app/api/lead/route.js"],bundle:true,platform:"node",format:"esm",write:false,
    alias:{"@":process.cwd()},plugins:[{name:"form-entry",setup(b){
      b.onResolve({filter:/cloudflare$/},()=>({path:"context",namespace:"route-test"}));
      b.onResolve({filter:/lead-assistant$/},()=>({path:"assistant",namespace:"route-test"}));
      b.onResolve({filter:/public-api-security$/},()=>({path:"security",namespace:"route-test"}));
      b.onResolve({filter:/submission-notifications$/},()=>({path:"notification",namespace:"route-test"}));
      b.onLoad({filter:/.*/,namespace:"route-test"},args=>({contents:{
        context:"export const getRuntimeEnv=()=>globalThis.initialSmsTestEnv; export const getCloudflareContext=()=>({ctx:{waitUntil:task=>globalThis.initialSmsTasks.push(task)}});",
        assistant:"export async function queueLeadSync(db,id){await db.prepare(\"INSERT OR IGNORE INTO lead_conversations(id,submission_id,organization_id) VALUES (?,?,'org-opwp')\").bind(crypto.randomUUID(),id).run();}",
        security:"export async function protectJsonRequest(r){return {body:await r.json()};} export async function verifyTurnstile(){return {ok:true};}",
        notification:"export async function queueSubmissionNotificationSafe(){return {status:'queued'};}",
      }[args.path]}));
    }}]});
  const {POST}=await import("data:text/javascript;base64,"+Buffer.from(routeBundle.outputFiles[0].text).toString("base64"));
  const f=await fixture();globalThis.initialSmsTestEnv=f.env;globalThis.initialSmsTasks=[];
  const previousFetch=globalThis.fetch;globalThis.fetch=f.fetcher;
  try {
    const body={source:"partial_quote",funnel_id:"test-entry-123456789",name:"Jamie Demo",email:"jamie@example.com",phone:"4192620100",follow_up_consent:true,frequency:"once_a_week",dogs:2};
    const request=()=>new Request("https://example.com/api/lead",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    assert.equal((await POST(request())).status,200);
    await Promise.all(globalThis.initialSmsTasks);
    assert.equal((await POST(request())).status,200);
    await Promise.all(globalThis.initialSmsTasks);
    assert.equal(f.calls.filter(call=>call.options.method==="POST").length,1);
    assert.match(JSON.parse(f.calls.find(call=>call.options.method==="POST").options.body).content,/Hello Jamie/);
  } finally {globalThis.fetch=previousFetch;}
});
