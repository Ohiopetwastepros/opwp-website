import { canonicalChurnReason, churnReviewStatus } from "../lib/churn.js";
import { classifyChurnEligibility } from "../lib/churn-eligibility.js";

const reasons = [
  ["Don’t need service any more", "Don't need service anymore"],
  ["Dog died/gone", "Dog died/gone"],
  ["Paused no response/ Unresponsive", "Paused no response/Unresponsive"],
  ["", "No reason provided"],
];

for (const [input, expected] of reasons) {
  const actual = canonicalChurnReason(input);
  if (actual !== expected) throw new Error(`${input} normalized to ${actual}; expected ${expected}`);
}

if (churnReviewStatus("Other", "") !== "Needs Comment") throw new Error("Other must require a comment.");
if (churnReviewStatus("Moved", "") !== "Complete") throw new Error("Moved must not require a comment.");
if (churnReviewStatus("Modification of subscription type", "", "123") !== "Plan Replacement") {
  throw new Error("A matched replacement must close as Plan Replacement.");
}

const neverStarted = classifyChurnEligibility({ businessLine: "scooping" });
if (neverStarted.isChurn || neverStarted.status !== "Needs Validation") throw new Error("Unproven cancellations must be excluded pending validation.");
const serviced = classifyChurnEligibility({ businessLine: "scooping", completedServiceBefore: true });
if (!serviced.isChurn || serviced.status !== "Confirmed") throw new Error("Completed service must confirm churn eligibility.");
const planChange = classifyChurnEligibility({ businessLine: "scooping", replacementSubscriptionId: "456" });
if (planChange.isChurn || planChange.status !== "Plan Change") throw new Error("Replacement subscriptions must be excluded as plan changes.");

console.log("Churn rules passed.");
