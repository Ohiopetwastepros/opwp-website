import assert from "node:assert/strict";
import test from "node:test";
import { classifyPlaybookRules, nextPlaybookResponse } from "../lib/lead-playbook.mjs";
import { FAQ_TEMPLATES } from "../lib/lead-playbook-faq.mjs";

test("singular and plural checks and cheques receive the approved checks-yes, cash-no reply", () => {
  const lead = {name: "Craig Fixture", phone: "+14192620424", payload: {number_of_dogs: 2, zip: "43551", clean_up_frequency: "Weekly"}};
  for (const text of ["Do you take checks?", "Do you accept cheques?", "Can I pay by check?", "Can I pay by cheque?"]) {
    assert.equal(classifyPlaybookRules(text).intent, "question_payment", text);
    const reply = nextPlaybookResponse({lead, conversation: {owner: "backend", automation_mode: "approved"}, state: {stage: "details_confirmed", details_confirmed: true}, text});
    assert.equal(reply.templateKey, "payment", text);
    assert.equal(reply.body, FAQ_TEMPLATES.payment, text);
    assert.match(reply.body, /check works/i);
    assert.match(reply.body, /don't take cash/i);
    assert.doesNotMatch(reply.body, /Reply STOP|[\u2013\u2014]/);
    assert.equal(reply.escalate, false);
  }
  assert.notEqual(classifyPlaybookRules("Can you check the route?").intent, "question_payment");
});
