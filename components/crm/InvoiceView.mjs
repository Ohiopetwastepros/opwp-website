// UI projections only. Native invoice state and stored cent totals remain authoritative.
const collectibleStates = new Set(['approved', 'failed']);
export const invoiceCollectionCutoff = invoice => invoice?.dueDate || invoice?.scheduledChargeAt || invoice?.defaultScheduledChargeAt || null;
function instant(value) { return value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number(value); }
function easternDay(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}
export function invoiceOutstandingCents(invoice) {
  if (!invoice || !collectibleStates.has(invoice.status) || invoice.reconciliationRequired) return 0;
  // Credits already affect the stored invoice total. Never subtract them again.
  return Number.isSafeInteger(invoice.totalCents) && invoice.totalCents > 0 ? invoice.totalCents : 0;
}
export function invoiceDisplayStatus(invoice, now = Date.now()) {
  if (!invoice) return 'unknown';
  const timestamp = instant(now), cutoff = invoiceCollectionCutoff(invoice);
  if (invoice.status === 'approved' && !invoice.held && !invoice.reconciliationRequired && invoiceOutstandingCents(invoice) > 0 && Number.isFinite(timestamp) && typeof cutoff === 'string') {
    const calendarDate = /^\d{4}-\d{2}-\d{2}$/.test(cutoff), cutoffTime = Date.parse(calendarDate ? cutoff + 'T12:00:00Z' : cutoff);
    const pastCutoff = Number.isFinite(cutoffTime) && (calendarDate ? new Date(cutoffTime).toISOString().slice(0, 10) === cutoff && cutoff < easternDay(timestamp) : cutoffTime < timestamp);
    if (pastCutoff) return 'overdue';
  }
  // Pending/processing remain visible in Open; their collectible balance is zero.
  return ['approved', 'charging', 'pending'].includes(invoice.status) ? 'open' : invoice.status;
}
export const invoiceIsOwed = invoice => invoiceOutstandingCents(invoice) > 0;
