"use client";

import { useState } from "react";
import { buildMetaConfirmation } from "@/lib/meta-lead-policy.mjs";
import { metaCleanupSummary, metaFollowUpDrafts, nextMetaResponse } from "@/lib/meta-conversation.mjs";
import styles from "../growth-desk.module.css";
import previewStyles from "./preview.module.css";

const SAMPLE = { name: "Jamie Example", number_of_dogs: 2, zip: "43615", clean_up_frequency: "Weekly" };
const SCENARIOS = {
  standard: { label: "Recurring service · sample consent", lead: SAMPLE, consent: true },
  missing: { label: "Missing answers · sample consent", lead: { ...SAMPLE, number_of_dogs: null, clean_up_frequency: "" }, consent: true },
  one_time: { label: "One-time cleanup · sample consent", lead: { ...SAMPLE, clean_up_frequency: "One Time" }, consent: true },
  no_consent: { label: "Current form · no separate SMS consent", lead: SAMPLE, consent: false },
};

export default function ConversationPreview() {
  const [scenario, setScenario] = useState("standard");
  const [state, setState] = useState({});
  const [messages, setMessages] = useState([{ direction: "outbound", body: buildMetaConfirmation(SAMPLE) }]);
  const [reply, setReply] = useState("");
  const sample = SCENARIOS[scenario];
  function reset(value = scenario) {
    const selected = SCENARIOS[value];
    setScenario(value); setState({}); setReply("");
    setMessages(selected.consent ? [{ direction: "outbound", body: buildMetaConfirmation(selected.lead) }] : []);
  }
  function simulate(text) {
    if (!sample.consent || !text.trim()) return;
    const result = nextMetaResponse({ lead: sample.lead, state, text: text.trim().slice(0, 500), confirmationSent: true });
    setState(result.state);
    setMessages((current) => [...current, { direction: "inbound", body: text.trim().slice(0, 500) }, ...(result.response ? [{ direction: "outbound", body: `${result.response}${result.response.includes("Reply STOP") ? "" : " Reply STOP to opt out."}` }] : [])]);
    setReply("");
  }
  const suggestions = state.expected === "yard" ? ["A", "B", "unsure"] : state.expected === "cleaned" ? ["about 1 month", "2 months ago", "never"] : state.expected === "address" ? ["123 Example Street, Toledo"] : state.expected === "dogs" ? ["2 dogs"] : state.expected === "frequency" ? ["weekly"] : ["yes", "actually 3 dogs", "STOP"];
  return <div className={previewStyles.preview}>
    <section className={styles.panel} style={{ padding: 24, marginTop: 24 }}>
      <h2>Facebook conversation preview</h2>
      <p><strong>Simulation only. No texts are sent and no lead records are created.</strong> All names, answers and consent here are examples. This preview cannot enable automatic texting.</p>
      <label htmlFor="meta-scenario">Example form </label>
      <select id="meta-scenario" value={scenario} onChange={(event) => reset(event.target.value)} style={{ maxWidth: "100%", padding: 10 }}>
        {Object.entries(SCENARIOS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
      </select>{" "}<button type="button" onClick={() => reset()}>Restart example</button>
      <p>Jamie Example · {sample.lead.number_of_dogs || "Dog count missing"} {sample.lead.number_of_dogs ? "dogs" : ""} · ZIP {sample.lead.zip} · {sample.lead.clean_up_frequency || "Frequency missing"}</p>
      {!sample.consent ? <p role="status"><strong>Texting blocked.</strong> The form can create a YardOps lead and Airtable sync task, but choosing “text” does not provide separate SMS consent.</p> : <>
        <div aria-live="polite" aria-label="Simulated text conversation" className={styles.deliveryList}>
          {messages.map((message, index) => <div key={index} className={`${styles.message} ${previewStyles.bubble}`} style={{ background: message.direction === "inbound" ? "#f0f8ed" : "#f6f7f9", padding: 14, borderRadius: 12, margin: "12px 0", marginLeft: message.direction === "inbound" ? "8%" : 0, marginRight: message.direction === "outbound" ? "8%" : 0 }}>
            <strong>{message.direction === "outbound" ? "Ohio Pet Waste Pros · preview" : "Example customer"}</strong><p style={{ marginBottom: 0 }}>{message.body}</p>
          </div>)}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); simulate(reply); }} style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <label htmlFor="meta-preview-reply" style={{ width: "100%" }}>Try a customer reply</label>
          <input id="meta-preview-reply" value={reply} onChange={(event) => setReply(event.target.value)} maxLength={500} style={{ flex: "1 1 230px", padding: 12 }} />
          <button type="submit" disabled={!reply.trim()}>Preview reply</button>
        </form>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>{suggestions.map((text) => <button type="button" key={text} onClick={() => simulate(text)}>{text}</button>)}</div>
      </>}
    </section>
    <section className={styles.panel} style={{ padding: 24, marginTop: 20 }}>
      <h2>Qualification and cleanup estimate</h2>
      <p style={{ whiteSpace: "pre-line" }}>{metaCleanupSummary(state)}</p>
      {state.ready_for_route_audit ? <p><strong>Waiting for Craig’s service-day audit.</strong> In the live workflow, fresh Airtable routing guides the review before a signup invitation. This example does not approve or promise a day.</p> : state.handoff ? <p><strong>Craig review required.</strong> The automatic conversation stops here.</p> : <p>Confirm service details, yard size and time since the last thorough cleanup to see the chart-based estimate.</p>}
      <details><summary>Proposed reminders · not activated</summary>{metaFollowUpDrafts(SAMPLE.name).map((touch) => <p key={touch.day}><strong>Day {touch.day}:</strong> {touch.body}</p>)}<p>Any customer reply cancels pending initial reminders.</p></details>
    </section>
  </div>;
}
