import {verifiedTextSafety} from "./helpers/airtable-text-safety-fixture.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {classifyPlaybookRules, leadPlaybookDetails, nextPlaybookResponse} from "../lib/lead-playbook.mjs";
import {classifyPlaybookIntent} from "../lib/lead-playbook-classifier.mjs";
import {processPlaybookInbound as processPlaybookInboundWithSafety} from "../lib/lead-playbook-ingest.js";
import {leadTestDatabase} from "./helpers/lead-inbox-fixture.mjs";

const replies = [
  "yes", "yep", "yeah", "yup", "correct", "that's correct", "that\u2019s correct",
  "that is correct", "yes that is correct", "Yes, that's correct!", "YEP. THAT IS RIGHT.",
  "  Yes,  that is correct.  ", "yes please", "all correct", "you got it",
];
const conversation = {owner: "backend"};
const form = {number_of_dogs: 1, clean_up_frequency: "Weekly", zip: "43528", name: "Example Lead", email: "lead@example.test"};
const initial = {stage: "confirm_details_sent", meta_confirmation_sent: true, details_confirmed: false};

test("bounded affirmative replies are deterministic with or without form details and never call a model", async () => {
  for (const text of replies) {
    for (const context of [{}, initial, {...initial, details: leadPlaybookDetails(form)}]) {
      const result = await classifyPlaybookIntent(text, context, {
        env: {LEAD_CLASSIFIER_ENABLED: "true"},
        usageStore: {claim() {assert.fail("An explicit affirmative must not claim model usage");}},
        provider() {assert.fail("An explicit affirmative must not call a model");},
      });
      assert.equal(result.intent, "confirm_yes", text);
      assert.equal(result.confidence, 1, text);
      assert.deepEqual(result.slots, {}, text);
      assert.equal(result.reason, "deterministic_rule", text);
    }
    for (const stage of ["quote_sent", "discount_offered"]) {
      assert.equal(classifyPlaybookRules(text, {stage}).intent, "ready_to_sign_up", `${stage}: ${text}`);
    }
  }
});

test("every bounded affirmative after the minimal Meta confirmation asks for the missing yard size", () => {
  for (const text of replies) {
    const decision = nextPlaybookResponse({conversation, lead: form, state: initial, text});
    assert.equal(decision.templateKey, "ask_yard", text);
    assert.equal(decision.escalate, false, text);
    assert.equal(decision.state.expected, "yardTier", text);
    assert.equal(decision.state.details.dogs, 1, text);
    assert.equal(decision.state.details.frequency, "once_a_week", text);
    assert.equal(decision.state.details.zip, "43528", text);
    assert.equal(decision.state.details_confirmed, false, text);
    assert.doesNotMatch(decision.body, /\$/, text);
  }
});

test("known-customer flags keep affirmatives silent and a lead reporting a service or billing problem gets a staff handoff", () => {
  for (const flags of [{existing_customer: true}, {is_existing_customer: true}, {existing_customer: true, is_existing_customer: true}]) {
    const lead = {...form, ...flags};
    const affirmed = nextPlaybookResponse({conversation, lead, state: initial, text: "Yes that is correct"});
    assert.equal(affirmed.templateKey, null);
    assert.equal(affirmed.escalate, true);
    assert.equal(affirmed.reason, "existing_customer");
    assert.equal(affirmed.body, "");
  }
  for (const [text, reason, acknowledgement] of [
    ["You missed my service", "complaint", /sorry.*(?:looked at|follow up)/i],
    ["I have a billing issue", "account_billing", /office.*(?:bill|invoice)/i],
  ]) {
    const service = nextPlaybookResponse({conversation, lead: form, state: initial, text});
    assert.equal(service.escalate, true, text);
    assert.equal(service.reason, reason, text);
    assert.equal(service.state.stage, "escalated", text);
    assert.match(service.body, acknowledgement, text);
    assert.doesNotMatch(service.body, /get you set up|on the schedule|\$|Reply STOP|\bpoop\b|[\u2013\u2014]/i, text);
  }
});

test("affirmatives preserve collected details and advance through cleanup, confirmation, address and the audited weekly quote", () => {
  let state = initial;
  const route = {day: "Tuesday", confirmed: true};
  const turn = text => {
    const decision = nextPlaybookResponse({conversation, lead: form, state, text, route});
    state = decision.state;
    return decision;
  };
  assert.equal(turn("Yes that is correct").templateKey, "ask_yard");
  assert.equal(turn("A").templateKey, "ask_last_cleaned");
  assert.equal(turn("B").templateKey, "confirm_details");
  assert.equal(state.details.yardTier, "tiny");
  assert.equal(state.details.lastCleaned, "two_weeks");
  assert.equal(turn("That is correct!").templateKey, "ask_address");
  assert.equal(state.details_confirmed, true);
  const quoted = turn("123 Example Road");
  assert.equal(quoted.templateKey, "quote_recurring");
  assert.equal(quoted.slots.monthly, 95);
  assert.equal(quoted.slots.dogs, 1);
  assert.equal(quoted.slots.yardTier, "tiny");
  assert.equal(quoted.slots.lastCleaned, "two_weeks");
  assert.match(quoted.body, /weekly service is \$95 per month/);
  assert.equal(turn("Yes, that\u2019s correct.").templateKey, "ready_access");
});

test("affirmative wording does not swallow questions, corrections or negative answers", () => {
  const details = {...leadPlaybookDetails(form), yardTier: "tiny", lastCleaned: "two_weeks"};
  const context = {...initial, details};
  for (const [text, intent] of [
    ["Yes, that is correct, but actually 2 dogs", "correction"],
    ["Yes, we have nine dogs", "correction"],
    ["Yes, the yard is one acre", "correction"],
    ["That's correct, how much?", "question_price"],
    ["Yes, how much?", "question_price"],
    ["Yes, what day?", "question_service_day"],
    ["No thanks", "not_interested"],
    ["Yes, stop texting me", "stop"],
    ["Yes, wrong number", "wrong_number"],
    ["Yes, except the cleanup is for a school campus", "other"],
    ["Yup, except the cleanup is for a school campus", "other"],
    ["Yup, actually 2 dogs", "correction"],
    ["Yup, how much?", "question_price"],
    ["That is not correct", "other"],
    ["Correct?", "other"],
  ]) {
    const classification = classifyPlaybookRules(text, context);
    assert.equal(classification.intent, intent, text);
    assert.notEqual(classification.intent, "confirm_yes", text);
    const decision = nextPlaybookResponse({conversation, lead: form, state: context, text, classification});
    assert.equal(decision.state.details_confirmed, false, text);
    assert.notEqual(decision.templateKey, "quote_recurring", text);
  }
});

test("bounded affirmative variants also confirm signup identity without dropping explicit access details", () => {
  const quotedDetails = {...leadPlaybookDetails(form), yardTier: 'tiny', lastCleaned: 'one_month', address: '123 Fictional Avenue'};
  const quote = {monthly: 95, low: 48, high: 58, frequencyId: 'once_a_week', day: 'Friday'};
  for (const text of replies) {
    const state = {stage: "access_questions_sent", expected: "signupIdentity", details_confirmed: true, quote,
      details: {...quotedDetails, gateSide: "left", trashLocation: "by the garage"}};
    const decision = nextPlaybookResponse({conversation, lead: form, state, text});
    assert.equal(decision.templateKey, "signup_handoff", text);
    assert.equal(decision.state.signup_identity_confirmed, true, text);
    assert.equal(decision.state.details.gateSide, "left", text);
    assert.equal(decision.state.details.trashLocation, "by the garage", text);
    const missingName = nextPlaybookResponse({conversation, lead: {...form, name: ""},
      state: {stage: "access_questions_sent", expected: "signupName", details_confirmed: true, quote, details: {...quotedDetails, name: ''}}, text});
    assert.equal(missingName.templateKey, "ask_signup_name", text);
    assert.equal(missingName.state.details.name, "", text);
  }
  const state = {stage: "access_questions_sent", expected: "signupAccess", details_confirmed: true, quote, details: quotedDetails};
  const decision = nextPlaybookResponse({conversation, lead: form, state, text: "Yes that is correct, the gate is on the left. Trash is by the garage."});
  assert.equal(decision.templateKey, "signup_handoff");
  assert.equal(decision.state.signup_identity_confirmed, true);
  assert.equal(decision.state.details.gateSide, "left");
  assert.equal(decision.state.details.trashLocation, "by the garage");
});

test("an exactly scoped controlled-test Meta affirmative advances once despite an existing-customer match", async t => {
  for (const matchedDirectory of ["/api/v1/clients/active", "/api/v1/clients/active_no_subscription"]) {
    const db = leadTestDatabase();
    t.after(() => db.sqlite.close());
    const phone = "+14195550100", business = "+14195550188", stateJson = JSON.stringify(initial);
    const consent = {valid: true, formId: 'affirmative-form', pageId: 'affirmative-page', field: 'sms_consent', answer: 'yes', version: 'fixture-v1', disclosure: 'Fixture consent', capturedAt: '2026-11-21T15:00:00Z'};
    db.sqlite.prepare(`INSERT INTO submissions(id,kind,source,status,name,phone,email,payload)
      VALUES ('affirmative-lead','question','facebook','new',?,?,?,?)`)
      .run(form.name, phone, form.email, JSON.stringify({...form, follow_up_consent: true, sms_consent_evidence: consent}));
    db.sqlite.exec(`INSERT INTO growth_leads(submission_id,organization_id,stage,updated_by) VALUES ('affirmative-lead','org-opwp','contacted','fixture');
      INSERT INTO lead_conversations(id,submission_id,organization_id,channel,owner,automation_mode,last_outbound_at,last_inbound_at)
        VALUES ('affirmative-thread','affirmative-lead','org-opwp','facebook_lead','backend','approved',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
      INSERT INTO lead_messages(id,conversation_id,organization_id,direction,channel,provider_message_id,body,delivery_status,created_by)
        VALUES ('affirmative-inbound','affirmative-thread','org-opwp','inbound','quo_sms','affirmative-provider-message','Yes that is correct','delivered','quo-webhook');
      UPDATE lead_automation_settings SET assistant_enabled=1,human_review_required=0;`);
    db.sqlite.exec(`INSERT INTO meta_lead_intakes(submission_id,organization_id,meta_lead_id,form_id,page_id,source_url,review_reason)
      VALUES ('affirmative-lead','org-opwp','affirmative-meta-lead','affirmative-form','affirmative-page','fixture://meta','fixture');`);
    db.sqlite.prepare(`INSERT INTO lead_playbook_state(conversation_id,submission_id,stage,state_json)
      VALUES ('affirmative-thread','affirmative-lead','confirm_details_sent',?)`).run(stateJson);
    let modelCalls = 0;
    const directoryReads = [], customerSends = [];
    const env = {LEAD_PLAYBOOK_ENABLED: "true", LEAD_PLAYBOOK_AUTO_SEND_ENABLED: "true",
      LEAD_AUTOMATION_CONTROLLED_TEST_ONLY: "true", META_TEST_RECIPIENTS: phone,
      META_TEST_FORM_IDS: 'affirmative-form',
      LEAD_PLAYBOOK_CUSTOMER_TEST_EXCEPTION: JSON.stringify({approvalId: 'affirmative-approved-test', approvedBy: 'fixture-owner', approvedAt: '2026-11-21T16:00:00Z', expiresAt: '2026-11-21T18:00:00Z', organizationId: 'org-opwp', submissionId: 'affirmative-lead', conversationId: 'affirmative-thread', phone, formId: 'affirmative-form', metaLeadId: 'affirmative-meta-lead'}),
      LEAD_PLAYBOOK_CRAIG_CELL: phone, QUO_FROM_NUMBER: business,
      LEAD_CLASSIFIER_ENABLED: "true", AI: {run() {modelCalls++; assert.fail("An exact affirmative must not call a model");}}};
    const event = {providerMessageId: "affirmative-provider-message", direction: "inbound", from: phone, to: business,
      text: "Yes that is correct", createdAt: "2026-11-21T04:57:01Z"};
    const result = await processPlaybookInbound(db, env,
      {conversationId: "affirmative-thread", submissionId: "affirmative-lead", event}, {
        now: new Date('2026-11-21T17:00:00Z'),
        loadCustomerDirectory: async path => {
          directoryReads.push(path);
          return {ok: true, complete: true, rows: path === matchedDirectory ? [{cell_phone_number: phone}] : []};
        },
        sender(_db, _env, lead, body) {
          customerSends.push({phone: lead.phone, body});
          return {provider_message_id: "affirmative-fake-yard-question"};
        },
      });
    assert.equal(result.escalated, false);
    assert.equal(result.draft.template_key, "ask_yard");
    assert.equal(result.draft.status, "sent");
    assert.deepEqual(directoryReads, []);
    const saved = db.sqlite.prepare("SELECT * FROM lead_playbook_state WHERE conversation_id='affirmative-thread'").get();
    assert.equal(saved.prior_state_json, stateJson);
    const state = JSON.parse(saved.state_json);
    assert.equal(state.stage, "collect_details");
    assert.equal(state.expected, "yardTier");
    assert.equal(state.escalation_reason, undefined);
    assert.equal(result.draft.inbound_message_id, "affirmative-inbound");
    const duplicate = await processPlaybookInbound(db, env,
      {conversationId: "affirmative-thread", submissionId: "affirmative-lead", event}, {
        now: new Date('2026-11-21T17:00:00Z'),
        loadCustomerDirectory() {assert.fail("A duplicate must not query SNG");},
        sender() {assert.fail("A duplicate must not send another question");},
      });
    assert.equal(duplicate.duplicate, true);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM lead_reply_drafts").get().n, 1);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM lead_classifier_calls").get().n, 0);
    assert.equal(db.sqlite.prepare("SELECT count(*) n FROM lead_messages WHERE direction='outbound'").get().n, 0);
    assert.equal(modelCalls, 0);
    assert.equal(customerSends.length, 1);
    assert.equal(customerSends[0].phone, phone);
    assert.match(customerSends[0].body, /About how big is the area of the yard/);
  }
});

function processPlaybookInbound(db, env, input, options = {}) {
  return processPlaybookInboundWithSafety(db, env, input, {textSafety: verifiedTextSafety, ...options});
}
