import { findRecentReplacementSubscription, getSngEventContext, hasPaidInvoiceBeforeCancellation, listFailedSngEvents, markSngEventProcessed, reconcileSubscriptionCreated, recordSubscriptionCancellation, recordSubscriptionPause, recordSubscriptionUnpause, updateSubscriptionCancellationLostMrr, upsertSngInvoice } from "./db";
import { classifySngSubscriptionPlan, getSngChurnServiceEvidence, updateSngChurnLifecycle, updateSngCustomerLifecycle, upsertSngJobCompleted, upsertSngShift, upsertSngSubscriptionCanceled, upsertSngSubscriptionPauseEvent } from "./airtable";
import { canonicalChurnReason, churnReviewStatus } from "./churn";
import { classifyChurnEligibility } from "./churn-eligibility";
import { reconcileSngDogFoodPayment } from "./dog-food-payments";

export async function processSngEvent({ id, eventType, externalId, body, allowFinancialMutation = false }) {
  try {
    if (eventType === "job:completed") {
      const context = await getSngEventContext(externalId, ["job:started", "notification:completed_job_notification"]);
      await upsertSngJobCompleted(body, context);
      await markSngEventProcessed(id);
      return { processed: true, destination: "Daily Job Log" };
    }
    if (eventType === "payroll:shift_info") {
      const context = await getSngEventContext(externalId, ["staff:staff_clock_in"]);
      await upsertSngShift(body, context);
      await markSngEventProcessed(id);
      return { processed: true, destination: "Time & Mileage Log" };
    }
    if (eventType === "client:invoice_finalized") {
      await upsertSngInvoice({ eventId: id, body });
      await markSngEventProcessed(id);
      return { processed: true, destination: "D1 Invoice Ledger" };
    }
    if (eventType === "client:client_payment_accepted") {
      if (!allowFinancialMutation) {
        await markSngEventProcessed(id, "archived", "Payment retained without financial mutation because the webhook credential was not verified.");
        return { processed: true, destination: "D1 unverified payment archive", reconciliation: { matched: false, reason: "webhook_not_verified" } };
      }
      const reconciliation = await reconcileSngDogFoodPayment({ eventId: id, body });
      await markSngEventProcessed(id);
      return {
        processed: true,
        destination: reconciliation.matched ? "Dog-food payment reconciliation" : "D1 payment archive",
        reconciliation,
      };
    }
    if (eventType === "client:subscription_canceled") {
      const data = body?.data ?? body ?? {};
      const businessLine = classifySngSubscriptionPlan(data.subscription_name || "");
      const reasonCategory = canonicalChurnReason(data.termination_reason);
      const [replacement, serviceEvidence, paidInvoiceBefore] = await Promise.all([
        findRecentReplacementSubscription({ body, businessLine, classifyPlan: classifySngSubscriptionPlan }),
        businessLine === "scooping" ? getSngChurnServiceEvidence(body) : { completedServiceBefore: false, completedServiceCount: 0 },
        hasPaidInvoiceBeforeCancellation({ body, businessLine }),
      ]);
      const replacementSubscriptionId = replacement?.subscriptionId || "";
      const eligibility = classifyChurnEligibility({ businessLine, reasonCategory, replacementSubscriptionId, completedServiceBefore: serviceEvidence.completedServiceBefore, paidInvoiceBefore });
      const isCustomerChurn = eligibility.isChurn;
      const reasonReviewStatus = churnReviewStatus(reasonCategory, data.termination_comment, replacementSubscriptionId);
      const reviewStatus = eligibility.status === "Confirmed" ? reasonReviewStatus : eligibility.reviewStatus;
      const eligibilityEvidence = `${eligibility.evidence}${serviceEvidence.completedServiceCount ? ` ${serviceEvidence.completedServiceCount} completed Airtable visit(s) matched.` : ""}`.trim();
      await recordSubscriptionCancellation({ eventId: id, body, businessLine, isCustomerChurn, reasonCategory, reviewStatus, replacementSubscriptionId, eligibilityStatus: eligibility.status, eligibilityEvidence });
      if (businessLine !== "addon") {
        const airtableResult = await upsertSngSubscriptionCanceled(body, { businessLine, isCustomerChurn, reasonCategory, reviewStatus, replacementSubscriptionId, eligibilityStatus: eligibility.status, eligibilityEvidence });
        await updateSubscriptionCancellationLostMrr(data.subscription_id, airtableResult.lostMrr);
      }
      if (businessLine === "scooping" && isCustomerChurn) await updateSngCustomerLifecycle(body, { status: "Inactive" });
      await markSngEventProcessed(id);
      const destination = businessLine === "scooping"
        ? "Airtable OPWP Churn Log + D1 cancellation ledger"
        : businessLine === "dog_food"
          ? "Airtable Dog Food Churn + D1 cancellation ledger"
          : "D1 Add-on Cancellation Ledger (excluded from churn)";
      return { processed: true, destination };
    }
    if (eventType === "client:subscription_created") {
      const data = body?.data ?? body ?? {};
      const businessLine = classifySngSubscriptionPlan(data.subscription_name || "");
      if (businessLine !== "addon") {
        const lifecycle = await reconcileSubscriptionCreated({ body, businessLine });
        if (lifecycle.matched) await updateSngChurnLifecycle(lifecycle);
        if (businessLine === "scooping") await updateSngCustomerLifecycle(body, { status: "Active", createIfMissing: true });
      }
      await markSngEventProcessed(id);
      return { processed: true, destination: "D1 subscription lifecycle reconciliation" };
    }
    if (eventType === "client:subscription_paused" || eventType === "client:subscription_unpaused") {
      const data = body?.data ?? body ?? {};
      const businessLine = classifySngSubscriptionPlan(data.subscription_name || "");
      if (eventType === "client:subscription_paused") {
        await recordSubscriptionPause({ eventId: id, body, businessLine });
      } else {
        await recordSubscriptionUnpause({ eventId: id, body, businessLine });
      }
      if (businessLine !== "addon") await upsertSngSubscriptionPauseEvent(body, { eventId: id, eventType, businessLine });
      if (businessLine === "scooping") await updateSngCustomerLifecycle(body, { status: eventType === "client:subscription_paused" ? "Paused" : "Active", createIfMissing: eventType === "client:subscription_unpaused" });
      await markSngEventProcessed(id);
      return { processed: true, destination: businessLine === "addon" ? "D1 add-on pause ledger" : "Airtable lifecycle + D1 pause ledger" };
    }
    if (eventType === "client:changed_status") {
      const data = body?.data ?? body ?? {};
      const status = String(data.status ?? data.client_status ?? "").toLowerCase();
      if (["active", "inactive"].includes(status)) await updateSngCustomerLifecycle(body, { status: status === "active" ? "Active" : "Inactive" });
      await markSngEventProcessed(id);
      return { processed: true, destination: "Airtable customer lifecycle" };
    }
    await markSngEventProcessed(id, "archived");
    return { processed: true, destination: "D1 archive" };
  } catch (error) {
    await markSngEventProcessed(id, "needs_attention", String(error).slice(0, 500));
    console.error(JSON.stringify({ event: "sng_event_processing_error", eventType, eventId: id, message: String(error) }));
    return { processed: false, error: String(error) };
  }
}

export async function recoverFailedSngEvents({ limit = 5, excludeId = null } = {}) {
  const failedEvents = await listFailedSngEvents(limit, excludeId);
  const results = [];
  for (const event of failedEvents) {
    let body = {};
    try { body = JSON.parse(event.payload); } catch { /* the processor records a useful failure */ }
    results.push(await processSngEvent({
      id: event.id,
      eventType: event.event_type,
      externalId: event.external_id,
      body,
      allowFinancialMutation: false,
    }));
  }
  return {
    attempted: results.length,
    recovered: results.filter((result) => result.processed).length,
    remaining: results.filter((result) => !result.processed).length,
  };
}
