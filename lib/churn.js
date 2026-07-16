export const CHURN_REASONS = [
  "Too expensive",
  "Moved",
  "Dog died/gone",
  "Don't need service anymore",
  "Dissatisfied",
  "Billing Cycle not suitable",
  "Seasonal",
  "Temporary",
  "Gift Certificate used up",
  "Non-Payment",
  "No reason provided",
  "Modification of subscription type",
  "Reducing expenses",
  "Can not service",
  "Free service ended",
  "Paused no response/Unresponsive",
  "Signed with competitor",
  "Other",
];

const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/[\u2018\u2019']/g, "").replace(/[^a-z0-9]/g, "");
const REASON_BY_KEY = new Map(CHURN_REASONS.map((reason) => [normalize(reason), reason]));
REASON_BY_KEY.set(normalize("Don't need service any more"), "Don't need service anymore");
const COMMENT_REQUIRED = new Set([
  normalize("Don't need service anymore"),
  normalize("Dissatisfied"),
  normalize("Other"),
]);

export function canonicalChurnReason(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "No reason provided";
  return REASON_BY_KEY.get(normalize(raw)) ?? "Other";
}

export function churnReasonRequiresComment(reason) {
  return COMMENT_REQUIRED.has(normalize(reason));
}

export function churnReviewStatus(reason, comment, replacementSubscriptionId = "") {
  const category = canonicalChurnReason(reason);
  if (category === "Modification of subscription type") return replacementSubscriptionId ? "Plan Replacement" : "Needs Validation";
  if (churnReasonRequiresComment(category) && !String(comment ?? "").trim()) return "Needs Comment";
  return "Complete";
}
