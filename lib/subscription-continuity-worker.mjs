import { CONTINUITY_KEY, continuityProposal, sameLifecycleCustomer } from "./subscription-continuity.mjs";
import { fetchSngBillingCollection } from "./subscription-reconciliation.mjs";
import { outboundFetch } from "./outbound-request.js";

const BASE = "https://api.airtable.com/v0/appcAWPBQB8GmOrcT";
const CHURN = "tblyhWKl99rwpiIRI", CUSTOMERS = "tblhi8MGUOsWNmd37";
async function airtable(env, path, options = {}) {
  const response = await outboundFetch(`${BASE}/${path}`, { ...options, headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}`, "Content-Type": "application/json" } }, { provider: "airtable", operation: "subscription_continuity", timeoutMs: 15000, retryable: true, retries: 1 });
  if (!response.ok) throw new Error(`Continuity Airtable request returned ${response.status}.`);
  return response.json();
}
async function records(env, table) {
  const rows = []; let offset = "";
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ pageSize: "100" });
    if (offset) query.set("offset", offset);
    const data = await airtable(env, `${table}?${query}`);
    if (!Array.isArray(data.records)) throw new Error("Invalid continuity source records.");
    rows.push(...data.records); offset = data.offset;
    if (!offset) return rows;
  }
  throw new Error("Continuity source exceeded 2,000 records; existing classifications retained.");
}
const sameFields = (actual, expected) => Object.entries(expected).every(([key, value]) => value === null || value === "" ? actual[key] === undefined || actual[key] === null || actual[key] === "" : value === false ? !actual[key] : value === 0 ? Number(actual[key] || 0) === 0 : actual[key] === value);
async function verifiedPatch(env, table, record, fields) {
  if (!sameFields(record.fields || {}, fields)) {
    await airtable(env, table, { method: "PATCH", body: JSON.stringify({ records: [{ id: record.id, fields }] }) });
    const saved = await airtable(env, `${table}/${record.id}`);
    if (!sameFields(saved.fields || {}, fields)) throw new Error("Continuity correction was not verified in Airtable; retry required.");
    return saved;
  }
  return record;
}

export async function reconcileSubscriptionContinuity(env, activeClients, {
  fetchSubscriptions = () => fetchSngBillingCollection(env, "subscriptions"),
  listRecords = table => records(env, table),
  patch = (table, record, fields) => verifiedPatch(env, table, record, fields),
} = {}) {
  if (!env.DB || !env.AIRTABLE_API_KEY || !env.SNG_API_KEY) throw new Error("Subscription continuity requires configured sources.");
  const checkedAt = new Date().toISOString();
  const previous = await env.DB.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?").bind(CONTINUITY_KEY).first();
  let prior = {}; try { prior = JSON.parse(previous?.payload || "{}"); } catch {}
  const audit = { checkedAt, resolved: prior.resolved || [], pending: [], checked: 0 };
  try {
    const result = await env.DB.prepare(`SELECT c.*,e.payload AS source_payload FROM subscription_cancellations c LEFT JOIN sng_events e ON e.id=c.source_event_id WHERE c.business_line='scooping' ORDER BY c.canceled_at DESC LIMIT 2001`).all();
    if (result.results.length > 2000) throw new Error("Continuity cancellation scan exceeded its bound.");
    const candidates = result.results.map(row => {
      let data = {}; try { data = JSON.parse(row.source_payload || "{}").data || {}; } catch {}
      return { ...data, ...row };
    }).filter(row => activeClients.some(client => sameLifecycleCustomer(row, client)));
    audit.checked = candidates.length;
    if (candidates.length) {
      const eventResult = await env.DB.prepare(`SELECT payload FROM sng_events WHERE event_type='client:subscription_created' AND EXISTS (SELECT 1 FROM subscription_cancellations c WHERE c.business_line='scooping' AND (c.client_ref=json_extract(sng_events.payload,'$.data.client') OR lower(c.client_name)=lower(json_extract(sng_events.payload,'$.data.client_name')))) ORDER BY received_at DESC LIMIT 5001`).all();
      if (eventResult.results.length > 5000) throw new Error("Continuity event scan exceeded its bound.");
      const events = eventResult.results.flatMap(row => { try { const event = JSON.parse(row.payload); return [{ ...event.data, created_at: event.created }]; } catch { return []; } });
      const subscriptions = await fetchSubscriptions();
      const [churnRows, customers] = await Promise.all([listRecords(CHURN), listRecords(CUSTOMERS)]);
      const verified = { churn: [], customers: [] };
      let writes = 0;
      for (const row of candidates) {
        const proposal = continuityProposal(row, events, activeClients, subscriptions);
        if (!proposal) continue; // Current activity alone never erases a real earlier cancellation.
        const churn = churnRows.filter(record => record.fields?.["Event ID"] === `SNG-SUB-${row.subscription_id}`);
        const matches = customers.filter(record => String(record.fields?.["SNG Client ID"] || "") === String(proposal.client.client || proposal.client.client_id || ""));
        // No name-only writes: duplicates or missing stable IDs are genuine identity questions.
        if (churn.length !== 1 || matches.length !== 1) {
          audit.pending.push({ subscriptionId: row.subscription_id, customer: row.client_name, ownerActionRequired: true, question: `Which Airtable customer/churn record belongs to Sweep & Go client ${row.client_ref}? The identity links are missing or duplicated.`, churnMatches: churn.length, customerMatches: matches.length });
          continue;
        }
        const fields = { "Event Type": "Plan Change", "Is Churn": false, "Lost MRR ($)": 0, "Eligibility Status": "Plan Change", "Eligibility Evidence": proposal.evidence, "Review Status": "Plan Replacement", "Reactivated Date": null, "Deactivated Date": null, "Replacement Subscription ID": proposal.replacementId || null };
        const clientFields = { Status: "Active", "Date Churned": null, "Churn MRR ($)": 0, "Churn Reason": "" };
        if (proposal.client.address) clientFields.Address = proposal.client.address;
        if (proposal.client.zip_code) clientFields.ZIP = String(proposal.client.zip_code);
        const needsWrite = row.eligibility_status !== "Plan Change" || Number(row.is_customer_churn) !== 0 || Number(row.lost_mrr) !== 0 || row.reactivated_at || !sameFields(churn[0].fields, fields) || !sameFields(matches[0].fields, clientFields);
        if (needsWrite && writes >= 25) { audit.pending.push({ subscriptionId: row.subscription_id, ownerActionRequired: false, state: "queued" }); continue; }
        if (needsWrite) writes++;
        // External writes are idempotent and verified before the ledger closes. A crash
        // at any point leaves the same candidate available on the next scheduled run.
        const savedChurn = await patch(CHURN, churn[0], fields);
        const savedCustomer = await patch(CUSTOMERS, matches[0], clientFields);
        if (!sameFields(savedChurn.fields || {}, fields) || !sameFields(savedCustomer.fields || {}, clientFields)) throw new Error("Continuity post-write verification failed.");
        if (needsWrite) {
          await env.DB.prepare(`UPDATE subscription_cancellations SET eligibility_status='Plan Change',eligibility_evidence=?,review_status='Plan Replacement',is_customer_churn=0,lost_mrr=0,reactivated_at=NULL,replacement_subscription_id=?,updated_at=CURRENT_TIMESTAMP WHERE subscription_id=? AND canceled_at=?`).bind(proposal.evidence, proposal.replacementId, row.subscription_id, row.canceled_at).run();
          const saved = await env.DB.prepare("SELECT eligibility_status,is_customer_churn,lost_mrr,reactivated_at FROM subscription_cancellations WHERE subscription_id=?").bind(row.subscription_id).first();
          if (!saved || saved.eligibility_status !== "Plan Change" || Number(saved.is_customer_churn) !== 0 || Number(saved.lost_mrr) !== 0 || saved.reactivated_at) throw new Error("Continuity ledger verification failed.");
        }
        verified.churn.push(savedChurn); verified.customers.push(savedCustomer);
        const old = audit.resolved.find(item => item.subscriptionId === row.subscription_id);
        audit.resolved = audit.resolved.filter(item => item.subscriptionId !== row.subscription_id);
        audit.resolved.push({ subscriptionId: row.subscription_id, customer: row.client_name, replacementId: proposal.replacementId, evidence: proposal.evidence, verifiedAt: checkedAt, before: old?.before || { isChurn: row.is_customer_churn, lostMrr: row.lost_mrr, eligibility: row.eligibility_status, reactivatedAt: row.reactivated_at } });
      }
      // Update the already-cached source rows, so dashboards do not retain false churn
      // while waiting for their full refresh. Compare-and-set avoids overwriting a refresh.
      if (verified.churn.length) {
        const cached = await env.DB.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key='business_cockpit'").first();
        if (cached?.payload) {
          const data = JSON.parse(cached.payload);
          for (const table of ["churn", "customers"]) if (Array.isArray(data.opwp?.[table])) {
            for (const record of verified[table]) {
              const index = data.opwp[table].findIndex(item => item.id === record.id);
              if (index >= 0) data.opwp[table][index] = record;
              else data.opwp[table].push(record);
            }
          }
          await env.DB.prepare("UPDATE airtable_cockpit_snapshots SET payload=?,updated_at=CURRENT_TIMESTAMP WHERE snapshot_key='business_cockpit' AND payload=?").bind(JSON.stringify(data), cached.payload).run();
        }
      }
      audit.updated = writes;
    }
    audit.resolved = audit.resolved.slice(-500);
    await saveAudit(env.DB, audit, "success");
    return audit;
  } catch (error) {
    // An unavailable provider is retried automatically, never presented as an owner question.
    await saveAudit(env.DB, { ...audit, state: "retrying", error: String(error.message).slice(0, 250), ownerActionRequired: false }, "failed");
    throw error;
  }
}
async function saveAudit(db, audit, status) {
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status=excluded.status,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`).bind(CONTINUITY_KEY, JSON.stringify(audit), status, audit.checkedAt).run();
}
