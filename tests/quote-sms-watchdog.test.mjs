import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {leadTestDatabase} from "./helpers/lead-inbox-fixture.mjs";
import {getInitialSmsHealth,recordInitialSmsHeartbeat,INITIAL_SMS_WATCHDOG_KEY,INITIAL_SMS_HEARTBEAT_KEY} from "../lib/quote-sms-health.mjs";
import {runScheduledInitialQuoteSms} from "../lib/quote-initial-sms.mjs";
import {patchInitialSmsWatchdog} from "../scripts/patch-sms-watchdog-worker.mjs";
import {patchQuoteWorker} from "../scripts/patch-quote-follow-up-worker.mjs";
import {verifyInitialSmsWorker} from "../scripts/check-initial-sms-worker.mjs";

const bundled=await build({entryPoints:["lib/quote-sms-monitor.js"],bundle:true,platform:"node",format:"esm",write:false,
  plugins:[{name:"owner-alert",setup(b){
    b.onResolve({filter:/^\.\/submission-notifications$/},()=>({path:"email",namespace:"test"}));
    b.onLoad({filter:/.*/,namespace:"test"},()=>({contents:"export function transactionalEmailConfig(env){return {configured:env.EMAIL_READY!==false,recipient:'owner@example.com'};} export async function sendTransactionalEmail(){throw Error('Use a mock owner email sender');}"}));
  }}]});
const {runInitialSmsWatchdog}=await import("data:text/javascript;base64,"+Buffer.from(bundled.outputFiles[0].text).toString("base64"));
const now=Date.now();
const at=minutes=>new Date(now+minutes*60000).toISOString();
const env=db=>({DB:db,QUOTE_INITIAL_SMS_ENABLED:"true"});
function snapshot(db,key,value){db.sqlite.prepare("INSERT OR REPLACE INTO airtable_cockpit_snapshots(snapshot_key,payload) VALUES (?,?)").run(key,JSON.stringify(value));}
async function heartbeat(db,minutes=0,status="success") {await recordInitialSmsHeartbeat(db,{status,startedAt:at(minutes),completedAt:at(minutes)});}
async function stalled(db,{status="queued",historical=false,reason=null,attempts=0,due=-3,channel="customer_sms"}={}){
  const id=crypto.randomUUID(),parent=crypto.randomUUID(),delivery=historical?crypto.randomUUID():"quote-initial-sms-v1:"+id;
  db.sqlite.prepare("INSERT INTO submissions(id,kind,source,status,payload) VALUES (?,'partial_quote','website','follow_up_pending','{}')").run(id);
  db.sqlite.prepare("INSERT INTO quote_follow_ups(id,submission_id,recipient,consent_text,consent_version,consent_at,scheduled_at) VALUES (?,?,'4192620100','consent','quote_service_sms_v1',?,?)").run(parent,id,at(-5),at(-5));
  db.sqlite.prepare("INSERT INTO quote_follow_up_deliveries(id,follow_up_id,submission_id,channel,status,error_message,attempt_count,created_at,sending_at,next_attempt_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(delivery,parent,id,channel,status,reason,attempts,at(-5),at(-3),at(due));
  return {id,delivery};
}

test("overdue checks use the SMS delivery deadline and include failures requiring review",async()=>{
  const db=leadTestDatabase();await heartbeat(db);
  await stalled(db);await stalled(db,{status:"failed",attempts:5,reason:"delivery_unconfirmed_check_quo_before_resending"});
  await stalled(db,{status:"sending"});await stalled(db,{status:"cancelled",reason:"initial_contact_window_expired"});
  const health=await getInitialSmsHealth(db,{now});assert.equal(health.status,"attention");assert.equal(health.overdue,4);
});

test("historical queues, completed texts, future deadlines and valid suppressions produce no alert",async()=>{
  const db=leadTestDatabase();await heartbeat(db);
  await stalled(db,{historical:true});await stalled(db,{channel:"customer_email"});await stalled(db,{channel:"sng_lead"});
  await stalled(db,{status:"sent"});await stalled(db,{status:"queued",due:5});
  for(const reason of ["opted_out","manual_takeover","contact_preference","invalid_or_changed_phone"])await stalled(db,{status:"cancelled",reason});
  assert.equal((await getInitialSmsHealth(db,{now})).incidents.length,0);
});

test("a stopped SMS scheduler is detected by an independently running watchdog",async()=>{
  const db=leadTestDatabase();snapshot(db,INITIAL_SMS_WATCHDOG_KEY,{firstCheckedAt:at(-10),lastCheckedAt:at(0)});
  const missing=await getInitialSmsHealth(db,{now});assert.ok(missing.incidents.some(item=>item.reason==="sms_scheduler_heartbeat_missing"));
  await heartbeat(db,-4);assert.ok((await getInitialSmsHealth(db,{now})).incidents.some(item=>item.state==="scheduler"));
  await heartbeat(db,0,"failed");assert.ok((await getInitialSmsHealth(db,{now})).incidents.some(item=>item.reason==="sms_scheduler_failed"));
  await heartbeat(db);assert.equal((await getInitialSmsHealth(db,{now})).status,"healthy");
});

test("startup grace is bounded and a missing watchdog is visible with a working sender",async()=>{
  const db=leadTestDatabase();snapshot(db,INITIAL_SMS_WATCHDOG_KEY,{firstCheckedAt:at(0)});
  assert.equal((await getInitialSmsHealth(db,{now})).status,"starting");
  assert.equal((await getInitialSmsHealth(db,{now:now+4*60000})).status,"attention");
  const second=leadTestDatabase();await heartbeat(second,-10);await heartbeat(second);
  const value=await getInitialSmsHealth(second,{now});assert.ok(value.incidents.some(item=>item.state==="watchdog"));
});

test("one owner email is claimed across repeated and concurrent watchdog invocations",async()=>{
  const db=leadTestDatabase();await heartbeat(db);await stalled(db);
  const before=db.sqlite.prepare("SELECT * FROM quote_follow_up_deliveries").all();
  const sent=[];const sendEmail=async(environment,message)=>{sent.push(message);return "mock-owner-alert";};
  await Promise.all([runInitialSmsWatchdog(env(db),{now,sendEmail}),runInitialSmsWatchdog(env(db),{now,sendEmail})]);
  await runInitialSmsWatchdog(env(db),{now:now+60000,sendEmail});
  assert.equal(sent.length,1);assert.equal(sent[0].to,"owner@example.com");assert.match(sent[0].idempotencyKey,/quote_initial_sms_alert:delivery:/);
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM quote_follow_up_deliveries").all(),before);
});

test("alert failures retry with the same email idempotency key and expose exhausted attempts",async()=>{
  const db=leadTestDatabase();await heartbeat(db);await stalled(db);
  const keys=[];const sendEmail=async(environment,message)=>{keys.push(message.idempotencyKey);throw Error("temporary owner email failure");};
  for(let attempt=0;attempt<6;attempt++){
    await heartbeat(db,attempt);
    const result=await runInitialSmsWatchdog(env(db),{now:now+attempt*60000,sendEmail});assert.equal(result.failed,1);
  }
  assert.equal(keys.length,5);assert.equal(new Set(keys).size,1);
});

test("a fresh quiet pipeline records checks without sending email",async()=>{
  const db=leadTestDatabase();await heartbeat(db);let calls=0;
  const result=await runInitialSmsWatchdog(env(db),{now,sendEmail:async()=>{calls++;}});
  assert.equal(result.status,"healthy");assert.equal(calls,0);
  const state=JSON.parse(db.sqlite.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?").get(INITIAL_SMS_WATCHDOG_KEY).payload);
  assert.equal(state.lastCheckedAt,at(0));
});

test("recorded incidents do not prevent later overdue texts from reaching the alert batch",async()=>{
  const db=leadTestDatabase();await heartbeat(db);
  for(let index=0;index<22;index++)await stalled(db);
  const keys=[];const sendEmail=async(environment,message)=>{keys.push(message.idempotencyKey);return "mock-alert";};
  assert.equal((await getInitialSmsHealth(db,{now})).hasMore,true);
  for(let tick=0;tick<5;tick++){
    await heartbeat(db,tick);
    await runInitialSmsWatchdog(env(db),{now:now+tick*60000,sendEmail});
  }
  assert.equal(keys.length,22);assert.equal(new Set(keys).size,22);
});

test("scheduled sender heartbeat records success and a real queue-processing failure",async()=>{
  const db=leadTestDatabase();await runScheduledInitialQuoteSms(env(db));
  const read=()=>JSON.parse(db.sqlite.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?").get(INITIAL_SMS_HEARTBEAT_KEY).payload);
  assert.equal(read().status,"success");
  const original=db.prepare;let fail=true;
  db.prepare=sql=>{if(fail&&sql.includes("ORDER BY created_at LIMIT 8")){fail=false;throw new TypeError("queue read failed");}return original(sql);};
  await assert.rejects(()=>runScheduledInitialQuoteSms(env(db)),/queue read failed/);
  assert.equal(read().status,"failed");assert.equal(read().failureClass,"TypeError");
});

test("the build refuses a missing scheduler or watchdog despite another cron branch",()=>{
  const base='export default { async scheduled(controller, env, ctx) { if (controller.cron === "*/10 * * * *") ctx.waitUntil(other()); }}';
  const monitored=patchInitialSmsWatchdog(base),complete=patchQuoteWorker(monitored);
  assert.equal(verifyInitialSmsWorker(complete),true);assert.equal(patchInitialSmsWatchdog(monitored),monitored);
  assert.throws(()=>verifyInitialSmsWorker(monitored),/independent watchdog/);
  assert.throws(()=>verifyInitialSmsWorker(patchQuoteWorker(base)),/independent watchdog/);
  assert.throws(()=>verifyInitialSmsWorker(base),/independent watchdog/);
  assert.ok(complete.includes('ctx.waitUntil(other())'));
});
