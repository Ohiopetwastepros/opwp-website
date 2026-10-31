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
  invoiceBefore = false,
  serviceEvidenceAvailable = false,
  invoiceEvidenceAvailable = false,
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
  if (businessLine === "scooping" && serviceEvidenceAvailable && invoiceEvidenceAvailable && !invoiceBefore) {
    return {
      isChurn: false,
      status: CHURN_ELIGIBILITY.NEVER_STARTED,
      reviewStatus: "Complete",
      evidence: "Automatic check found no completed service or finalized invoice before cancellation. Service never started; excluded from churn and lost MRR.",
    };
  }
  return {
    isChurn: false,
    status: CHURN_ELIGIBILITY.NEEDS_VALIDATION,
    reviewStatus: "Needs Validation",
    evidence: invoiceBefore
      ? "A finalized invoice exists, but no completed service or paid invoice was found before cancellation; excluded pending review."
      : "Service or invoice history could not establish churn eligibility; excluded pending validation.",
  };
}
