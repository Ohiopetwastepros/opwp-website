import assert from "node:assert/strict";
import {
  CLEANUP_ENTITIES,
  CLEANUP_REPORTS,
  buildArDiagnostics,
  safeExportName,
  validatedDateRange,
} from "../lib/quickbooks-cleanup-logic.mjs";

assert.deepEqual(validatedDateRange("2026-01-01", "2026-01-31", 186), {
  start: "2026-01-01",
  end: "2026-01-31",
  days: 31,
});
assert.throws(() => validatedDateRange("2026-02-30", "2026-03-01", 186));
assert.throws(() => validatedDateRange("2026-02-01", "2026-01-01", 186));
assert.throws(() => validatedDateRange("2025-01-01", "2026-01-01", 186));
assert.ok(CLEANUP_ENTITIES.includes("Payment"));
assert.ok(CLEANUP_REPORTS.includes("GeneralLedgerDetail"));
assert.equal(safeExportName("../../ar", "2026-01-01", "2026-01-31"), "opwp-qbo-------ar-2026-01-01-to-2026-01-31.json");

const diagnostics = buildArDiagnostics({
  customers: [{ Id: "1", DisplayName: "Test Customer" }],
  invoices: [{ Id: "10", CustomerRef: { value: "1" }, TxnDate: "2026-01-01", DocNumber: "INV-1", TotalAmt: 90, Balance: 33 }],
  payments: [{
    Id: "20",
    CustomerRef: { value: "1" },
    TxnDate: "2026-01-10",
    PaymentRefNum: "PAY-1",
    TotalAmt: 90,
    UnappliedAmt: 57,
    Line: [{ Amount: 33, LinkedTxn: [{ TxnId: "10", TxnType: "Invoice" }] }],
  }],
  creditMemos: [{ Id: "30", CustomerRef: { value: "1" }, TxnDate: "2026-01-05", TotalAmt: 5, Balance: 5 }],
});

assert.equal(diagnostics.totals.openInvoiceAmount, 33);
assert.equal(diagnostics.totals.unappliedPaymentAmount, 57);
assert.equal(diagnostics.totals.openCreditAmount, 5);
assert.equal(diagnostics.paymentCandidates.length, 1);
assert.equal(diagnostics.paymentCandidates[0].coversInvoice, true);
assert.equal(diagnostics.paymentCandidates[0].exactAmount, false);
assert.equal(diagnostics.unappliedPayments[0].linkedTransactions[0].transactionId, "10");

console.log("QuickBooks cleanup smoke tests passed.");
