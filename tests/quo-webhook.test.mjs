import assert from "node:assert/strict";
import {verifyQuoStandardSignature,normalizeQuoEnvelope} from '../lib/quo-webhook.mjs';
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";
import { normalizeQuoMessageEvent, verifyQuoSignature } from "../lib/quo-webhook.mjs";

test("verifies current Quo HMAC format and timestamp freshness", async () => {
  const key = randomBytes(32);
  const keyBase64 = key.toString("base64");
  const timestamp = String(Date.now());
  const payload = '{"type":"message.received"}';
  const digest = createHmac("sha256", key).update(`${timestamp}.${payload}`).digest("base64");
  assert.equal(await verifyQuoSignature(payload, `hmac;1;${timestamp};${digest}`, keyBase64), true);
  assert.equal(await verifyQuoSignature(payload, `hmac;1;${Date.now() - 3600000};${digest}`, keyBase64), false);
});

test("normalizes supported Quo message payload versions", () => {
  const event = normalizeQuoMessageEvent({ id: "EV1", type: "message.received", data: { object: { id: "AC1", direction: "incoming", from: "+14195550100", to: ["+14192622371"], text: "How much is service?", conversationId: "CN1" } } });
  assert.equal(event.eventId, "EV1");
  assert.equal(event.text, "How much is service?");
  assert.equal(normalizeQuoMessageEvent({ id: "EV2", type: "message.delivered", data: { object: {} } }), null);
});

test('date-versioned Quo signatures bind the exact raw body, delivery ID and fresh timestamp',async()=>{
  const key=randomBytes(32),secret='whsec_'+key.toString('base64'),timestamp=String(Math.floor(Date.now()/1000));
  const raw='{ "id": "EV-modern", "type": "message.delivered" }',id='msg-fixture';
  const signature=createHmac('sha256',key).update(`${id}.${timestamp}.${raw}`).digest('base64');
  const headers=new Headers({'webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':'v1,'+signature});
  assert.equal(await verifyQuoStandardSignature(raw,headers,secret),true);
  assert.equal(await verifyQuoStandardSignature(JSON.stringify(JSON.parse(raw)),headers,secret),false);
  headers.set('webhook-id','other');assert.equal(await verifyQuoStandardSignature(raw,headers,secret),false);
  headers.set('webhook-id',id);assert.equal(await verifyQuoStandardSignature(raw,headers,secret,Date.now()+6*60000),false);
});

test('date-versioned messages normalize participants and undelivered outcomes without changing legacy payloads',()=>{
  const body={id:'EV-modern',apiVersion:'2026-03-30',type:'message.received',data:{resource:{id:'AC-modern',direction:'incoming',text:'A quote please'},context:{senderIdentifier:'+14192620100',recipientIdentifiers:['+14192622371'],conversationId:'CN-fixture'}}};
  const event=normalizeQuoMessageEvent(body);assert.equal(event.from,'+14192620100');assert.equal(event.to,'+14192622371');assert.equal(event.conversationId,'CN-fixture');
  const failed=normalizeQuoEnvelope({...body,type:'message.undelivered',data:{...body.data,resource:{id:'AC-modern',direction:'outgoing'}}});assert.equal(failed.type,'message.failed');assert.equal(failed.data.object.id,'AC-modern');
  const legacy={data:{object:{id:'legacy'}}};assert.equal(normalizeQuoEnvelope(legacy),legacy);
});
