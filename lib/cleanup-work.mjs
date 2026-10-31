import { singleInvoiceServiceDate } from './route-data-quality.mjs';
import { classifyRevenueLine } from './revenue-classification.mjs';
import { validRouteDate } from './route-profitability-calculations.mjs';

export const CLEANUP_BILLING_KEY = 'cleanup_billing:org-opwp:v1';
export const cleanupWorkKey = id => `cleanup_work:org-opwp:${id}`;
const nameKey = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const boundedText = (value, limit) => typeof value === 'string' && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
export const validCleanupJobId = id => typeof id === 'string' && /^\d{1,20}$/.test(id);

export function durationEvidence(value) {
  if (value == null || value === '') return null;
  let minutes;
  if (typeof value === 'number') minutes = value;
  else if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) minutes = Number(value);
  else if (typeof value === 'string' && /^\d{1,2}:[0-5]\d(?::[0-5]\d)?$/.test(value.trim())) {
    const [hours, mins, secs = 0] = value.trim().split(':').map(Number);
    minutes = hours * 60 + mins + secs / 60;
  }
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 1440 ? Math.round(minutes * 100) / 100 : null;
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?$/.test(value)) return null;
  const result = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isFinite(result) ? result : null;
}

export function cleanupWorkEvidence(fields, saved = null) {
  const source = fields['Source Work'] || {};
  const start = timestamp(source.startedAt), end = timestamp(source.endedAt);
  const elapsedMinutes = start !== null && end !== null && end >= start && end - start <= 86400000 ? Math.round((end - start) / 600) / 100 : null;
  const matches = saved && saved.jobId === String(fields['Job ID']).replace(/\.0+$/, '') && saved.date === fields.Date && nameKey(saved.customer) === nameKey(fields['Customer Name']);
  const review = matches ? saved : null;
  const primary = String(fields['Tech Name'] || 'Unassigned').slice(0, 100);
  const crew = review?.crew || (primary === 'Unassigned' ? [] : [{ name: primary, reportedMinutes: null }]);
  const completeLabor = review?.crewConfirmed === true && crew.length > 0 && crew.every(member => member.reportedMinutes !== null);
  const reportedMinutes = review?.reportedMinutes ?? null;
  return {
    primaryTechnician: primary, crew, crewConfirmed: review?.crewConfirmed === true,
    startedAt: start === null ? null : new Date(start).toISOString(), endedAt: end === null ? null : new Date(end).toISOString(),
    elapsedMinutes, sourceDurationMinutes: durationEvidence(source.duration),
    legacyMinutes: Number(fields['Actual Minutes']) > 0 ? durationEvidence(fields['Actual Minutes']) : null,
    estimatedMinutes: Number(fields['Est. Minutes']) > 0 ? durationEvidence(fields['Est. Minutes']) : null,
    reportedMinutes, varianceMinutes: elapsedMinutes !== null && reportedMinutes !== null ? Math.round((reportedMinutes - elapsedMinutes) * 100) / 100 : null,
    reportedLaborMinutes: completeLabor ? Math.round(crew.reduce((sum, member) => sum + member.reportedMinutes, 0) * 100) / 100 : null,
    note: review?.note || '', revision: review?.revision || 0, updatedAt: review?.updatedAt || null, updatedBy: review?.updatedBy || null,
  };
}

export function validateCleanupWorkInput(input) {
  if (!input || !validCleanupJobId(input.jobId) || !validRouteDate(input.date) || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new Error('Invalid cleanup record or revision.');
  if (!Array.isArray(input.crew) || input.crew.length < 1 || input.crew.length > 8 || typeof input.crewConfirmed !== 'boolean') throw new Error('Record one to eight crew members and confirm crew coverage.');
  const optionalMinutes = value => value === null ? null : typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1440 && Math.abs(Math.round(value * 100) - value * 100) < .000001 ? value : NaN;
  const crew = input.crew.map(member => {
    if (!member || !boundedText(member.name, 100) || !member.name.trim() || /[<>]/.test(member.name)) throw new Error('Enter a valid technician name.');
    const reportedMinutes = optionalMinutes(member.reportedMinutes);
    if (Number.isNaN(reportedMinutes)) throw new Error('Reported minutes must be blank or between 0 and 1,440.');
    return { name: member.name.trim(), reportedMinutes };
  });
  if (new Set(crew.map(member => nameKey(member.name))).size !== crew.length) throw new Error('List each crew member once.');
  const reportedMinutes = optionalMinutes(input.reportedMinutes);
  if (Number.isNaN(reportedMinutes) || !boundedText(input.note, 1000) || input.note.trim().length < 3) throw new Error('Add a source note and a valid reported job duration.');
  return { jobId: input.jobId, date: input.date, revision: input.revision, crew, crewConfirmed: input.crewConfirmed, reportedMinutes, note: input.note.trim() };
}

export async function invoiceServiceSignature(lines) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 100) return null;
  const values = [];
  for (const line of lines) {
    const description = String(line.description ?? '');
    if (/^tips?\b/i.test(description.trim())) continue;
    if (description.length > 400 || line.amount === null || line.amount === '' || !Number.isFinite(Number(line.amount))) return null;
    values.push([description.trim().replace(/\s+/g, ' ').toLowerCase(), Math.round(Number(line.amount) * 100)]);
  }
  if (!values.length) return null;
  values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(values)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function normalizeCleanupBillingInvoices(rows) {
  if (!Array.isArray(rows) || rows.length >= 5000) throw new Error('QuickBooks invoice evidence exceeded its safe limit.');
  const invoices = [];
  for (const row of rows) {
    const reference = String(row.DocNumber ?? row.referenceNumber ?? '');
    const match = /^S&G-(\d{1,20})$/.exec(reference);
    if (!match) continue;
    const lines = row.lines || (row.Line || []).filter(line => line.DetailType === 'SalesItemLineDetail').map(line => ({ description: line.Description || '', amount: line.Amount }));
    const signature = await invoiceServiceSignature(lines);
    const date = row.TxnDate || row.date;
    if (!signature || !validRouteDate(date)) continue;
    invoices.push({ sngId: match[1], id: String(row.Id ?? row.id).slice(0,100), reference, date, signature,
      balance: row.Balance == null && row.balance == null ? null : Number(row.Balance ?? row.balance),
    });
  }
  return invoices;
}

export async function cleanupBillingEvidence(fields, value, decision, invoices, snapshot) {
  if (!['initial', 'one_time'].includes(value.category)) return null;
  const clientId = String(fields['Source Client ID'] || '');
  const priorIds = new Set((decision?.evidence || []).filter(invoice => invoice.source === 'Sweep & Go' || /SNG|Sweep & Go/.test(invoice.source || '')).map(invoice => String(invoice.id)));
  const matches = invoices.filter(invoice => !/^(void|voided|draft|deleted)$/i.test(invoice.status || '') &&
    (clientId ? invoice.clientId === clientId : priorIds.has(String(invoice.id))) &&
    nameKey(invoice.customer) === nameKey(fields['Customer Name']) && invoice.lines.some(line =>
      singleInvoiceServiceDate(line.description, invoice.date, fields.Date) === fields.Date && classifyRevenueLine(line, invoice).category === value.category));
  const checkedAt = snapshot?.checkedAt || null;
  if (matches.length !== 1) return { status: matches.length ? 'ambiguous' : 'unlinked', checkedAt, reference: null };
  const invoice = matches[0];
  const amount = invoice.lines.filter(line => singleInvoiceServiceDate(line.description, invoice.date, fields.Date) === fields.Date && classifyRevenueLine(line, invoice).category === value.category).reduce((sum, line) => sum + Number(line.amount), 0);
  const reference = `S&G-${invoice.id}`;
  if (value.missing || !Number.isFinite(amount) || Math.abs(amount - value.revenue) > .011) return { status: 'service_difference', checkedAt, reference };
  if (!snapshot || snapshot.from > invoice.date || snapshot.through < invoice.date) return { status: 'not_checked', reference, checkedAt };
  const qbo = snapshot.invoices.filter(row => row.sngId === String(invoice.id));
  if (qbo.length !== 1) return { status: qbo.length ? 'ambiguous' : 'not_found', reference, checkedAt };
  const signature = await invoiceServiceSignature(invoice.lines);
  const linesMatch = signature !== null && qbo[0].signature === signature;
  const matched = linesMatch && qbo[0].date === invoice.date;
  return { status: matched ? 'matched' : linesMatch ? 'invoice_date_difference' : 'invoice_difference', reference, checkedAt, serviceAmount: Math.round(amount * 100) / 100,
    sngInvoiceDate: invoice.date, qboInvoiceDate: qbo[0].date,
    balance: matched && Number.isFinite(qbo[0].balance) ? qbo[0].balance : null };
}
