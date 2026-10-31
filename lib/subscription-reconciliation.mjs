import { outboundFetch } from "./outbound-request.js";
import { controlledSngFetch } from "./sng-request-control.mjs";

export const REVENUE_RECONCILIATION_KEY = "subscription_revenue_reconciliation_v1";
export const normalizeIdentity = value => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const nameOf = client => String(client.client_name || client.full_name || `${client.first_name || ""} ${client.last_name || ""}`).trim();
const addressOf = client => String(client.address || client.client_address || "").split(",")[0].trim();
export const revenueClientKey = client => `${normalizeIdentity(nameOf(client))}|${normalizeIdentity(addressOf(client))}`;
const money = value => Math.round(value * 100) / 100;
const factors = { monthly: 1, annually: 1 / 12, "semi-annually": 1 / 6, every_four_months: 1 / 4, quarterly: 1 / 3, every_two_months: 1 / 2, "4_weeks": 13 / 12, "bi-weekly": 26 / 12, weekly: 52 / 12 };

export function sameRevenueCustomer(client, candidate) {
  if (normalizeIdentity(nameOf(client)) !== normalizeIdentity(nameOf(candidate))) return false;
  const address = normalizeIdentity(addressOf(client));
  const otherAddress = normalizeIdentity(addressOf(candidate));
  const email = String(client.email || client.client_email || "").trim().toLowerCase();
  const otherEmail = String(candidate.email || candidate.client_email || "").trim().toLowerCase();
  // Shared names alone cannot transfer another customer's financial baseline.
  return Boolean(address && otherAddress && address === otherAddress) || Boolean(!otherAddress && email && email === otherEmail);
}

export function subscriptionRevenueProposal(client, subscriptions, today = new Date().toISOString().slice(0, 10)) {
  const rows = subscriptions.filter(row => sameRevenueCustomer(client, row) && row.status === "active" && (!row.start_date || row.start_date <= today) && (!row.end_date || row.end_date > today));
  if (!rows.length) return null;
  const core = [], addons = [];
  for (const row of rows) {
    const plan = String(row.service_plan || row.name || "");
    if (/dog.?food|extreme dog|fuel|bag/i.test(plan) || row.billing_interval === "one_time") continue;
    const factor = factors[row.billing_interval];
    // Per-visit/postpaid plans and promotions need supporting terms; never assume monthly pricing.
    if (row.category !== "prepaid" || !factor || row.price === null || row.price === "" || !Number.isFinite(Number(row.price)) || Number(row.price) <= 0 || Number(row.price) > 10000 || row.coupon_code || Number(row.coupon_total) || Number(row.coupon_percent)) return null;
    const item = { plan, amount: money(Number(row.price) * factor), price: Number(row.price), interval: row.billing_interval, startDate: row.start_date };
    if (/^\d+d-(?:\d+x[WM]|bW)$/i.test(plan)) core.push(item);
    else if (/saniti|deodor|haul|front yard/i.test(plan)) addons.push(item);
    else return null;
  }
  if (core.length !== 1) return null;
  return { coreMrr: core[0].amount, addonMrr: money(addons.reduce((sum, row) => sum + row.amount, 0)), coreCount: 1, addonCount: addons.length, source: "Sweep & Go live subscriptions", lines: [...core, ...addons] };
}

export async function fetchSngBillingCollection(env, collection) {
  if (!env.SNG_API_KEY || !["subscriptions", "invoices"].includes(collection)) throw new Error("SNG billing source is not configured.");
  const rows = [];
  for (let page = 1; page <= 40; page++) {
    const url = new URL(`https://openapi.sweepandgo.com/api/v2/${collection}`);
    url.searchParams.set("page", page); url.searchParams.set("length", "50");
    if (collection === "invoices") url.searchParams.set("type", "recurring");
    const response = await controlledSngFetch(env, url, { headers: { Authorization: `Bearer ${env.SNG_API_KEY}`, Accept: "application/json" } });
    if (!response.ok) throw new Error(`SNG ${collection} returned ${response.status}.`);
    const data = (await response.json())[collection];
    if (!Array.isArray(data?.data) || !Number.isInteger(data.last_page) || data.last_page < page || data.current_page !== page || data.data.length > 50) throw new Error(`SNG ${collection} pagination could not be verified.`);
    rows.push(...data.data);
    if (page === data.last_page) {
      if (!Number.isInteger(data.total) || rows.length !== data.total) throw new Error(`SNG ${collection} result count is incomplete.`);
      return rows;
    }
  }
  throw new Error(`SNG ${collection} exceeded the 2,000-record reconciliation limit.`);
}

async function saveReconciliation(db, value) {
  const payload = JSON.stringify(value);
  if (new TextEncoder().encode(payload).length > 500000) throw new Error("Revenue reconciliation exceeded its storage budget.");
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,'success',?,CURRENT_TIMESTAMP)
    ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status=excluded.status,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`).bind(REVENUE_RECONCILIATION_KEY, payload, value.checkedAt).run();
}

async function supportingSources(env, clients) {
  const checks = {}, evidence = {};
  const names = clients.map(nameOf);
  const check = async (name, work) => {
    try { evidence[name] = await work(); checks[name] = "checked"; }
    catch (error) { checks[name] = "retrying"; console.error(JSON.stringify({ event: "revenue_source_retry", source: name, message: String(error.message).slice(0, 200) })); }
  };
  await check("airtable", async () => {
    if (!env.AIRTABLE_API_KEY) throw new Error("Airtable is not configured.");
    const rows = []; let offset = "";
    for (let page = 0; page < 10; page++) {
      const url = new URL("https://api.airtable.com/v0/appcAWPBQB8GmOrcT/tblhi8MGUOsWNmd37");
      url.searchParams.set("pageSize", "100"); if (offset) url.searchParams.set("offset", offset);
      const response = await outboundFetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` } }, { provider: "airtable", operation: "revenue_evidence", retryable: true, retries: 1, timeoutMs: 20000 });
      if (!response.ok) throw new Error(`Airtable returned ${response.status}.`);
      const data = await response.json(); if (!Array.isArray(data.records)) throw new Error("Invalid Airtable records.");
      rows.push(...data.records); offset = data.offset || ""; if (!offset) return rows;
    }
    throw new Error("Airtable evidence pagination limit reached.");
  });
  await check("sngInvoices", () => fetchSngBillingCollection(env, "invoices"));
  await check("invoiceArchive", async () => {
    const result = await env.DB.prepare(`SELECT i.invoice_id,i.client_name,i.invoice_created_at,e.payload FROM sng_invoices i LEFT JOIN sng_events e ON e.id=i.source_event_id WHERE i.client_name IN (${names.map(() => "?").join(",")}) ORDER BY i.invoice_created_at DESC LIMIT 501`).bind(...names).all();
    if (result.results.length > 500) throw new Error("Invoice archive evidence limit reached.");
    return result.results;
  });
  await check("quickbooks", async () => {
    const { getQuickBooksCleanupDataset } = await import("./quickbooks-cleanup.js");
    const end = new Date().toISOString().slice(0, 10), start = new Date(Date.now() - 92 * 86400000).toISOString().slice(0, 10);
    const data = await getQuickBooksCleanupDataset({ dataset: "entity", entity: "Invoice", start, end, accountingMethod: "Accrual" });
    if (!Array.isArray(data.rows)) throw new Error("Invalid QuickBooks invoice response.");
    return data.rows;
  });
  return { checks, evidence };
}

export function supportingRevenueProposal(client, sources) {
  // Explicit recurring terms are usable; a bill total can include initial work, tax, tips, or add-ons.
  const proposals = [];
  for (const invoice of sources.quickbooks || []) {
    const candidate = { client_name: invoice.CustomerRef?.name, client_address: invoice.ShipAddr?.Line1 || invoice.BillAddr?.Line1, client_email: invoice.BillEmail?.Address };
    if (!sameRevenueCustomer(client, candidate)) continue;
    const core = (invoice.Line || []).filter(line => line.DetailType === "SalesItemLineDetail" && /dog|scoop|waste/i.test(line.Description || "") && !/initial|prorat|saniti|haul|food|fuel|bag|front yard/i.test(line.Description || ""));
    if (core.length !== 1) continue;
    const rate = core[0].Description?.match(/\bat\s+\$([\d]+(?:\.\d{1,2})?)\s+monthly\b/i);
    if (rate && Number(rate[1]) > 0 && Number(rate[1]) <= 10000) proposals.push({ amount: Number(rate[1]), invoiceId: invoice.Id, source: "QuickBooks explicit monthly terms" });
  }
  // Conversation excerpts provide review context, but quotes and estimates alone
  // cannot establish an accepted recurring charge.
  const airtable = (sources.airtable || []).filter(row => sameRevenueCustomer(client, { client_name: row.fields?.["Client Name"], address: row.fields?.Address }));
  const rate = airtable.length === 1 ? Number(airtable[0].fields["MRR ($)"]) : 0;
  const unique = [...new Set(proposals.map(row => row.amount))];
  // Two structured records must agree before a fallback becomes a financial baseline.
  if (unique.length !== 1 || !Number.isFinite(rate) || Math.abs(unique[0] - rate) > 0.005 || !/^\d+d-(?:\d+x[WM]|bW)$/i.test(String(client.subscription_names || ""))) return null;
  return { coreMrr: rate, addonMrr: 0, coreCount: 1, addonCount: 0, source: "Airtable + corroborated recurring terms", lines: proposals };
}

async function quoRevenueContext(env, client, prior = {}) {
  if (!env.QUO_API_KEY) return { complete: true, status: "not_configured", excerpts: [] };
  const digits = String(client.cell_phone || client.home_phone || "").replace(/\D/g, "");
  const phone = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : "";
  if (!phone) return { complete: true, status: "no_matching_phone", excerpts: [] };
  const get = async (path, params = {}) => {
    const url = new URL(path, "https://api.openphone.com");
    for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, String(value));
    const r = await outboundFetch(url, { headers: { Authorization: env.QUO_API_KEY, Accept: "application/json" } }, { provider: "quo", operation: "revenue_evidence", timeoutMs: 15000, retryable: true, retries: 1 });
    if (!r.ok) throw new Error(`Quo evidence returned ${r.status}.`);
    return r.json();
  };
  const numbers = await get("/v1/phone-numbers");
  const inbox = numbers.data?.find(row => row.number === env.QUO_FROM_NUMBER);
  if (!inbox?.id) throw new Error("Configured Quo inbox could not be matched.");
  const before = prior.before || new Date().toISOString(), after = prior.after || new Date(Date.now() - 92 * 86400000).toISOString();
  const state = { ...prior, before, after, excerpts: prior.excerpts || [], status: "checked" };
  const params = { phoneNumberId: inbox.id, participants: phone, createdAfter: after, createdBefore: before };
  if (!state.messagesComplete) {
    const data = await get("/v1/messages", { ...params, maxResults: 100, pageToken: state.messageCursor });
    if (!Array.isArray(data.data)) throw new Error("Invalid Quo messages response.");
    state.messageCursor = data.nextPageToken || null; state.messagesComplete = !state.messageCursor;
    for (const row of data.data) if (/\$\s*\d|monthly|per month/i.test(row.text || "")) state.excerpts.push({ id: row.id, source: "Quo message", text: String(row.text).slice(0, 500), date: row.createdAt, direction: row.direction });
  }
  if (!state.callsComplete) {
    const data = await get("/v1/calls", { ...params, maxResults: 10, pageToken: state.callCursor });
    if (!Array.isArray(data.data)) throw new Error("Invalid Quo calls response.");
    state.callCursor = data.nextPageToken || null; state.callsComplete = !state.callCursor;
    for (const call of data.data) {
      try {
        const transcript = await get(`/v1/call-transcripts/${encodeURIComponent(call.id)}`);
        const text = JSON.stringify(transcript.data || "");
        if (/\$\s*\d|monthly|per month/i.test(text)) state.excerpts.push({ id: call.id, source: "Quo call transcript", text: text.slice(0, 800) });
      } catch (error) {
        // A call without a recording/transcript supplies no monetary evidence.
        if (!/returned 404/.test(error.message)) throw error;
      }
    }
  }
  state.excerpts = state.excerpts.slice(-6);
  state.complete = Boolean(state.messagesComplete && state.callsComplete);
  return state;
}

export async function reconcileMissingRevenueBaselines(env, activeClients, { fetchSubscriptions = () => fetchSngBillingCollection(env, "subscriptions"), fetchSupporting = clients => supportingSources(env, clients), fetchCommunications = (client, prior) => quoRevenueContext(env, client, prior) } = {}) {
  const baseline = (await env.DB.prepare("SELECT client_key,client_name,address FROM subscription_client_baseline").all()).results || [];
  // Existing legacy rows already use name aliases in the daily snapshot. Do not
  // create a second baseline merely because their imported street format differs.
  const candidates = [...new Map(activeClients.filter(client => !baseline.some(row => sameRevenueCustomer(client, row) || normalizeIdentity(row.client_name) === normalizeIdentity(nameOf(client)))).map(client => [revenueClientKey(client), client])).values()];
  const previous = await env.DB.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key=?").bind(REVENUE_RECONCILIATION_KEY).first();
  let prior = {}; try { prior = JSON.parse(previous?.payload || "{}"); } catch {}
  const checkedAt = new Date().toISOString();
  const result = { checkedAt, resolved: [], pending: [], checks: {}, attempts: Number(prior.attempts || 0) + 1 };
  if (!candidates.length) { await saveReconciliation(env.DB, { ...result, resolved: prior.resolved || [], attempts: 0 }); return result; }
  let subscriptions = [];
  try { subscriptions = await fetchSubscriptions(); result.checks.sngSubscriptions = "checked"; }
  catch (error) { result.checks.sngSubscriptions = "retrying"; console.error(JSON.stringify({ event: "revenue_source_retry", source: "sngSubscriptions", message: String(error.message).slice(0, 200) })); }
  candidates.sort((a, b) => String(prior.pending?.find(row => row.key === revenueClientKey(a))?.checkedAt || "").localeCompare(String(prior.pending?.find(row => row.key === revenueClientKey(b))?.checkedAt || "")));
  const batch = candidates.slice(0, 25);
  const proposals = new Map(batch.map(client => [revenueClientKey(client), subscriptionRevenueProposal(client, subscriptions)]));
  const unresolved = batch.filter(client => !proposals.get(revenueClientKey(client)));
  let supporting = { checks: {}, evidence: {} };
  if (unresolved.length) supporting = await fetchSupporting(unresolved);
  result.checks = { ...result.checks, ...supporting.checks };
  let communicationChecks = 0;
  for (const client of batch) {
    const key = revenueClientKey(client);
    let proposal = proposals.get(key) || supportingRevenueProposal(client, supporting.evidence);
    if (!proposal) {
      const checks = { ...result.checks };
      let communications = prior.pending?.find(row => row.key === key)?.communications || {};
      if (communications.complete) checks.quo = "checked";
      else if (communicationChecks < 5) {
        communicationChecks++;
        try { communications = await fetchCommunications(client, communications); checks.quo = communications.complete ? "checked" : "partial"; }
        catch (error) { checks.quo = "retrying"; console.error(JSON.stringify({ event: "revenue_source_retry", source: "quo", message: String(error.message).slice(0, 200) })); }
      } else checks.quo = "queued";
      proposal = communications.complete ? supportingRevenueProposal(client, { ...supporting.evidence, communications }) : null;
      if (!proposal) {
      const complete = ["sngSubscriptions", "airtable", "sngInvoices", "invoiceArchive", "quickbooks", "quo"].every(source => checks[source] === "checked");
      result.pending.push({ key, customer: nameOf(client), checkedAt, state: complete ? "needs_answer" : "retrying", ownerActionRequired: complete, checks, communications,
        evidence: { airtableMatches: (supporting.evidence.airtable || []).filter(row => sameRevenueCustomer(client, { client_name: row.fields?.["Client Name"], address: row.fields?.Address })).length, sngInvoices: (supporting.evidence.sngInvoices || []).filter(row => normalizeIdentity(row.client_name) === normalizeIdentity(nameOf(client))).length, archivedInvoices: (supporting.evidence.invoiceArchive || []).filter(row => normalizeIdentity(row.client_name) === normalizeIdentity(nameOf(client))).length },
        reason: complete ? "Current subscription terms, Airtable, invoice archive, live SNG invoices, QuickBooks and available Quo history did not establish one unambiguous recurring rate." : "Automatic source checks are still pending or retrying; no financial estimate has been substituted.",
        question: complete ? `What is the current agreed monthly scooping rate for ${nameOf(client)}? The connected records did not establish a single amount.` : null });
      continue;
      }
    }
    const write = await env.DB.prepare(`INSERT OR IGNORE INTO subscription_client_baseline(client_key,client_name,address,core_subscription_count,addon_subscription_count,core_mrr,addon_mrr,total_mrr,source_file) VALUES (?,?,?,?,?,?,?,?,?)`).bind(key, nameOf(client), addressOf(client), proposal.coreCount, proposal.addonCount, proposal.coreMrr, proposal.addonMrr, money(proposal.coreMrr + proposal.addonMrr), `automatic:${proposal.source}`).run();
    const saved = await env.DB.prepare("SELECT core_mrr,addon_mrr,source_file FROM subscription_client_baseline WHERE client_key=?").bind(key).first();
    if (!saved || Math.abs(Number(saved.core_mrr) - proposal.coreMrr) > 0.005 || Math.abs(Number(saved.addon_mrr) - proposal.addonMrr) > 0.005) throw new Error("Revenue baseline verification failed; existing values retained.");
    result.resolved.push({ key, customer: nameOf(client), ...proposal, checkedAt, inserted: Number(write.meta?.changes) === 1 });
  }
  result.pending.push(...candidates.slice(25).map(client => ({ ...prior.pending?.find(row => row.key === revenueClientKey(client)), key: revenueClientKey(client), customer: nameOf(client), state: "queued", ownerActionRequired: false })));
  const retained = (prior.resolved || []).filter(row => !result.resolved.some(next => next.key === row.key));
  await saveReconciliation(env.DB, { ...result, resolved: [...result.resolved, ...retained].slice(0, 250) });
  return result;
}
