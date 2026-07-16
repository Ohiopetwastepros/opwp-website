export const CHURN_ELIGIBILITY = Object.freeze({
  CONFIRMED: "Confirmed",
  NEVER_STARTED: "Never Started",
  PLAN_CHANGE: "Plan Change",
  NEEDS_VALIDATION: "Needs Validation",
  EXCLUDED: "Excluded",
});

export function classifyChurnEligibility({
  businessLine,
  reasonCategory,
  replacementSubscriptionId = "",
  completedServiceBefore = false,
  paidInvoiceBefore = false,
} = {}) {
  if (businessLine === "addon") {
    return { isChurn: false, status: CHURN_ELIGIBILITY.EXCLUDED, reviewStatus: "Complete", evidence: "Add-on cancellation; excluded from customer churn." };
  }
  if (reasonCategory === "Modification of subscription type" || replacementSubscriptionId) {
    return { isChurn: false, status: CHURN_ELIGIBILITY.PLAN_CHANGE, reviewStatus: "Plan Replacement", evidence: replacementSubscriptionId ? `Replacement subscription ${replacementSubscriptionId} detected.` : "Cancellation reason identifies a subscription modification." };
  }
  if (completedServiceBefore || paidInvoiceBefore) {
    const evidence = [completedServiceBefore ? "Completed service exists before cancellation." : "", paidInvoiceBefore ? "Finalized paid invoice exists before cancellation." : ""].filter(Boolean).join(" ");
    return { isChurn: true, status: CHURN_ELIGIBILITY.CONFIRMED, reviewStatus: "Complete", evidence };
  }
  return {
    isChurn: false,
    status: CHURN_ELIGIBILITY.NEEDS_VALIDATION,
    reviewStatus: "Needs Validation",
    evidence: "No completed-service or paid-invoice evidence was found before cancellation; excluded until validated.",
  };
}
