const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const CLEANUP_ENTITIES = Object.freeze([
  "Account",
  "Customer",
  "Invoice",
  "Payment",
  "CreditMemo",
  "RefundReceipt",
  "Deposit",
  "Purchase",
  "JournalEntry",
  "Transfer",
  "Item",
]);

export const CLEANUP_REPORTS = Object.freeze([
  "BalanceSheet",
  "ProfitAndLoss",
  "ProfitAndLossDetail",
  "TrialBalance",
  "CashFlow",
  "CustomerBalance",
  "CustomerBalanceDetail",
  "AgedReceivables",
  "AgedReceivableDetail",
  "GeneralLedgerDetail",
  "CustomerSales",
  "ItemSales",
  "AccountListDetail",
]);

function realIsoDate(value) {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validatedDateRange(start, end, maxDays = 730) {
  if (!realIsoDate(start) || !realIsoDate(end)) throw new Error("Dates must use YYYY-MM-DD.");
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  if (startTime > endTime) throw new Error("The start date must not be after the end date.");
  const days = Math.floor((endTime - startTime) / 86400000) + 1;
  if (days > maxDays) throw new Error(`The requested range exceeds ${maxDays} days.`);
  return { start, end, days };
}

export function customerId(transaction) {
  return String(transaction?.CustomerRef?.value || "");
}

export function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function linkedTransactions(payment) {
  return (payment?.Line || []).flatMap((line) =>
    (line?.LinkedTxn || []).map((link) => ({
      amount: money(line?.Amount),
      transactionId: String(link?.TxnId || ""),
      transactionType: String(link?.TxnType || ""),
    })),
  );
}

function dateDistance(left, right) {
  const leftTime = Date.parse(`${left || "1900-01-01"}T00:00:00Z`);
  const rightTime = Date.parse(`${right || "1900-01-01"}T00:00:00Z`);
  return Math.abs(leftTime - rightTime) / 86400000;
}

export function buildArDiagnostics({ customers = [], invoices = [], payments = [], creditMemos = [] }) {
  const names = new Map(customers.map((customer) => [
    String(customer.Id),
    customer.DisplayName || customer.FullyQualifiedName || customer.CompanyName || `Customer ${customer.Id}`,
  ]));
  const openInvoices = invoices
    .filter((invoice) => money(invoice.Balance) > 0)
    .map((invoice) => ({
      id: String(invoice.Id),
      customerId: customerId(invoice),
      customer: names.get(customerId(invoice)) || invoice?.CustomerRef?.name || "Unknown customer",
      date: invoice.TxnDate || null,
      dueDate: invoice.DueDate || null,
      documentNumber: invoice.DocNumber || null,
      originalAmount: money(invoice.TotalAmt),
      openAmount: money(invoice.Balance),
    }));
  const unappliedPayments = payments
    .filter((payment) => money(payment.UnappliedAmt) > 0)
    .map((payment) => ({
      id: String(payment.Id),
      customerId: customerId(payment),
      customer: names.get(customerId(payment)) || payment?.CustomerRef?.name || "Unknown customer",
      date: payment.TxnDate || null,
      referenceNumber: payment.PaymentRefNum || null,
      totalAmount: money(payment.TotalAmt),
      unappliedAmount: money(payment.UnappliedAmt),
      linkedTransactions: linkedTransactions(payment),
    }));
  const openCredits = creditMemos
    .filter((credit) => money(credit.Balance) > 0)
    .map((credit) => ({
      id: String(credit.Id),
      customerId: customerId(credit),
      customer: names.get(customerId(credit)) || credit?.CustomerRef?.name || "Unknown customer",
      date: credit.TxnDate || null,
      documentNumber: credit.DocNumber || null,
      originalAmount: money(credit.TotalAmt),
      openAmount: money(credit.Balance),
    }));
  const paymentCandidates = [];
  for (const invoice of openInvoices) {
    for (const payment of unappliedPayments.filter((item) => item.customerId === invoice.customerId)) {
      const exact = Math.abs(payment.unappliedAmount - invoice.openAmount) < 0.005;
      const covers = payment.unappliedAmount >= invoice.openAmount;
      paymentCandidates.push({
        customer: invoice.customer,
        invoiceId: invoice.id,
        invoiceNumber: invoice.documentNumber,
        invoiceDate: invoice.date,
        invoiceOpenAmount: invoice.openAmount,
        paymentId: payment.id,
        paymentDate: payment.date,
        paymentReference: payment.referenceNumber,
        paymentUnappliedAmount: payment.unappliedAmount,
        exactAmount: exact,
        coversInvoice: covers,
        daysApart: Math.round(dateDistance(invoice.date, payment.date)),
        reviewPriority: exact ? "exact-amount" : covers ? "payment-covers-invoice" : "partial-amount",
      });
    }
  }
  paymentCandidates.sort((left, right) =>
    Number(right.exactAmount) - Number(left.exactAmount)
    || left.daysApart - right.daysApart
    || left.customer.localeCompare(right.customer),
  );
  return {
    totals: {
      openInvoiceCount: openInvoices.length,
      openInvoiceAmount: money(openInvoices.reduce((sum, item) => sum + item.openAmount, 0)),
      unappliedPaymentCount: unappliedPayments.length,
      unappliedPaymentAmount: money(unappliedPayments.reduce((sum, item) => sum + item.unappliedAmount, 0)),
      openCreditCount: openCredits.length,
      openCreditAmount: money(openCredits.reduce((sum, item) => sum + item.openAmount, 0)),
      candidateCount: paymentCandidates.length,
      exactAmountCandidateCount: paymentCandidates.filter((item) => item.exactAmount).length,
    },
    openInvoices,
    unappliedPayments,
    openCredits,
    paymentCandidates,
  };
}

export function safeExportName(dataset, start, end) {
  const safeDataset = String(dataset).replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
  return `opwp-qbo-${safeDataset}-${start}-to-${end}.json`;
}
