// A subscription ending is not necessarily the customer ending service.
export const CONTINUITY_KEY = "subscription_continuity_v1";
const clean = value => String(value ?? "").trim().toLowerCase();
const name = row => clean(row.client_name || row.full_name || `${row.first_name || ""} ${row.last_name || ""}`);
const ref = row => clean(row.client_ref || row.client || row.client_id);
const email = row => clean(row.client_email || row.email);
export function sameLifecycleCustomer(a, b) {
  if (ref(a) && ref(b)) return ref(a) === ref(b);
  return Boolean(name(a) && name(a) === name(b) && email(a) && email(a) === email(b));
}
export function lifecycleTime(value) {
  if (!value) return NaN;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric * (numeric < 1e12 ? 1000 : 1) : Date.parse(value);
}
export function isCorePlan(plan) {
  return /(?:^|\s|-\s*)\d+d-(?:\d+x[WM]|bW)\b/i.test(String(plan || ""));
}
export function continuityReplacement(cancellation, created) {
  if (!sameLifecycleCustomer(cancellation, created)) return false;
  if (!created.subscription_id || String(created.subscription_id) === String(cancellation.subscription_id)) return false;
  if (!isCorePlan(cancellation.plan || cancellation.subscription_name) || !isCorePlan(created.subscription_name || created.service_plan)) return false;
  const difference = lifecycleTime(created.created_at) - lifecycleTime(cancellation.canceled_at);
  // Arrival time is deliberately irrelevant: delayed/reordered webhooks retain their event time.
  if (!Number.isFinite(difference) || Math.abs(difference) > 86400000) return false;
  const reason = cancellation.reason_category || cancellation.termination_reason || "No reason provided";
  // Explicit reasons for ending the relationship retain gross churn when service later resumes.
  return ["No reason provided", "Modification of subscription type", "Moved", "Other", "Billing Cycle not suitable"].includes(reason);
}

export function continuityProposal(cancellation, events, activeClients, subscriptions) {
  const clients = activeClients.filter(client => sameLifecycleCustomer(cancellation, client));
  if (clients.length !== 1) return null;
  const client = clients[0];
  const replacements = events.filter(event => continuityReplacement(cancellation, event));
  replacements.sort((a, b) => lifecycleTime(b.created_at) - lifecycleTime(a.created_at));
  if (replacements.length) return { client, replacementId: String(replacements[0].subscription_id), evidence: `Verified same customer in current Sweep & Go recurring clients; replacement subscription ${replacements[0].subscription_id} created within 24 hours of cancellation. Service continued through an administrative subscription change.` };
  // v2 billing exports omit subscription IDs. Use an exact email + name bridge to
  // the ID-matched live client, and same-day start; never invent a replacement ID.
  const day = String(cancellation.canceled_at || "").slice(0, 10);
  const reason = cancellation.reason_category || "No reason provided";
  if (!["No reason provided", "Modification of subscription type", "Moved", "Other", "Billing Cycle not suitable"].includes(reason)) return null;
  const matches = subscriptions.filter(row => row.status === "active" && isCorePlan(row.service_plan) && name(row) === name(client) && email(row) && email(row) === email(client) && row.start_date === day && (!row.end_date || row.end_date > day));
  if (matches.length !== 1) return null;
  return { client, replacementId: null, evidence: `Verified current Sweep & Go recurring client ID and one active core billing subscription with matching name/email beginning ${day}, the cancellation date. Service continued through an administrative subscription change; billing export does not supply a subscription ID.` };
}
