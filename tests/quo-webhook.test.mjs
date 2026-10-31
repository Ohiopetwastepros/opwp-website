import assert from "node:assert/strict";
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
