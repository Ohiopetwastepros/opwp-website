// Pure reporting calculations. No customer decisions, database writes or Meta uploads.
export const METRIC_FIELDS = ['spend', 'leads', 'impressions', 'clicks', 'video3s', 'thruplays', 'videoPlays', 'landingViews', 'comments', 'shares'];
export const divide = (numerator, denominator) => denominator > 0 ? numerator / denominator : null;
export function totals(rows) {
  const total = Object.fromEntries(METRIC_FIELDS.map(key => [key, 0]));
  for (const row of rows) for (const key of METRIC_FIELDS) total[key] += Number(row[key]) || 0;
  total.spend = Math.round(total.spend * 100) / 100;
  return { ...total, cpl: divide(total.spend, total.leads), ctr: divide(total.clicks, total.impressions),
    cpc: divide(total.spend, total.clicks), cpm: divide(total.spend * 1000, total.impressions),
    clickLeadProxy: divide(total.leads, total.clicks), hook: divide(total.video3s, total.impressions),
    hold: divide(total.thruplays, total.video3s) };
}
export function groupMetrics(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const group = typeof key === 'function' ? key(row) : row[key];
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  }
  return [...groups].map(([key, records]) => ({ key, ...totals(records), records }));
}

export function parseCsv(text, maxRows = 20000) {
  if (typeof text !== 'string' || text.length > 8 * 1024 * 1024) throw new Error('CSV must be 8 MB or smaller.');
  const rows = []; let row = [], value = '', quoted = false;
  const pushCell = () => { if (value.length > 4000) throw new Error('A CSV cell exceeds 4,000 characters.'); row.push(value); value = ''; if (row.length > 100) throw new Error('CSV has too many columns.'); };
  const pushRow = () => { pushCell(); if (row.some(cell => cell.trim())) rows.push(row); row = []; if (rows.length > maxRows + 1) throw new Error(`CSV exceeds ${maxRows.toLocaleString()} rows.`); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else if (quoted) quoted = false;
      else if (!value) quoted = true;
      else throw new Error('Invalid CSV quoting.');
    } else if (char === ',' && !quoted) pushCell();
    else if ((char === '\r' || char === '\n') && !quoted) { pushRow(); if (char === '\r' && text[i + 1] === '\n') i++; }
    else value += char;
  }
  if (quoted) throw new Error('CSV has an unfinished quoted field.');
  if (value || row.length) pushRow();
  const header = (rows.shift() || []).map(cell => cell.replace(/^\uFEFF/, '').trim());
  if (!header.length || new Set(header).size !== header.length) throw new Error('CSV needs unique column headers.');
  return rows.map(cells => { if (cells.length !== header.length) throw new Error('CSV row has a different column count.'); return Object.fromEntries(header.map((key, i) => [key, cells[i]])); });
}

const date = value => {
  const result = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(`${result}T00:00:00Z`).toISOString().slice(0,10) !== result) throw new Error('Use valid YYYY-MM-DD dates.');
  return result;
};
const identifier = (value, label) => {
  const result = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(result)) throw new Error(`${label} is missing or invalid.`);
  return result;
};
const count = (value, label, integer = false) => {
  if (value === '' || value == null || value === '—') return 0;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > 1e10 || (integer && !Number.isSafeInteger(result))) throw new Error(`${label} must be a nonnegative ${integer ? 'integer' : 'number'}.`);
  return result;
};

export function importMetaDaily(text, expectedAccount) {
  if(typeof expectedAccount!=='string'||!expectedAccount)throw Error('A reporting account must be configured before import.');
  const rows = parseCsv(text);
  const required = ['Reporting starts','Reporting ends','Ad ID','Account ID','Campaign ID','Campaign name','Ad name','Amount spent (USD)','Results','Result indicator','Impressions','Link clicks'];
  if (!rows.length || required.some(key => !(key in rows[0]))) throw new Error('Export Ads with Day breakdown, Account ID, Campaign ID, Ad ID, Results, spend, impressions and link clicks.');
  const seen = new Set();
  const normalized = rows.map(row => {
    if (row['Account ID'] !== expectedAccount) throw new Error('This file contains a different ad account.');
    if (date(row['Reporting starts']) !== date(row['Reporting ends'])) throw new Error('Only daily rows are supported; remove summary totals and other breakdowns.');
    if (['Placement','Platform','Age','Gender','Country'].some(key => row[key])) throw new Error('Use only the Day breakdown for this feed.');
    const hasDelivery = ['Amount spent (USD)','Results','Impressions','Link clicks'].some(key => Number(row[key] || 0) > 0);
    if (hasDelivery && row['Attribution setting'] && row['Attribution setting'] !== '7-day click or 1-day view') throw new Error('Keep the historical 7-day click / 1-day view attribution for comparable reporting.');
    const leads = count(row.Results, 'Results', true);
    if (leads && row['Result indicator'] !== 'actions:leadgen.other') throw new Error('This feed accepts instant-form lead results only.');
    const adId = identifier(row['Ad ID'], 'Ad ID'), day = date(row['Reporting starts']), key = `${adId}:${day}`;
    if (seen.has(key)) throw new Error('Duplicate ad/day row; use a single Day breakdown.');
    seen.add(key);
    return { date: day, adId, campaignId: identifier(row['Campaign ID'], 'Campaign ID'),
      name: String(row['Ad name']).slice(0,200), campaign: String(row['Campaign name']).slice(0,200), adSet: String(row['Ad set name'] || '').slice(0,200),
      spend: count(row['Amount spent (USD)'],'Spend'), leads, impressions: count(row.Impressions,'Impressions',true), clicks: count(row['Link clicks'],'Link clicks',true),
      video3s: count(row['3-second video plays'],'Video plays',true), thruplays: count(row.ThruPlays,'ThruPlays',true), videoPlays: count(row['Video plays'],'Video plays',true),
      landingViews: count(row['Landing page views'],'Landing page views',true), comments: count(row['Post comments'],'Comments',true), shares: count(row['Post shares'],'Shares',true) };
  });
  return { rows: normalized, start: normalized.reduce((a,r)=>a < r.date ? a : r.date, normalized[0].date), end: normalized.reduce((a,r)=>a > r.date ? a : r.date, normalized[0].date) };
}
export function mergeDaily(existing, imported) {
  const map = new Map(existing.map(row => [`${row.adId}:${row.date}`, row]));
  for (const row of imported) map.set(`${row.adId}:${row.date}`, row);
  return [...map.values()].sort((a,b) => a.date.localeCompare(b.date) || a.adId.localeCompare(b.adId));
}
export function historyForSnapshot(seed, snapshot) {
  const zeroKeys = new Set(snapshot.zeroKeys || []);
  return mergeDaily(seed, snapshot.daily || []).filter(row => !zeroKeys.has(`${row.adId}:${row.date}`));
}

export function importOutcomes(text) {
  const rows = parseCsv(text, 10000), seen = new Set();
  const required = ['lead_id','ad_id','captured_at','qualified_at','signed_up_at','first_paid_at','customer_id','payment_verified'];
  if (!rows.length || required.some(key => !(key in rows[0]))) throw new Error(`Outcome CSV needs: ${required.join(', ')}.`);
  return rows.map(row => {
    const leadId = identifier(row.lead_id,'Lead ID');
    if (seen.has(leadId)) throw new Error('Duplicate lead ID. Deduplicate your CRM export first.');
    seen.add(leadId);
    const capturedAt = date(row.captured_at), qualifiedAt = row.qualified_at ? date(row.qualified_at) : null,
      signedUpAt = row.signed_up_at ? date(row.signed_up_at) : null, firstPaidAt = row.first_paid_at ? date(row.first_paid_at) : null;
    if ([qualifiedAt,signedUpAt,firstPaidAt].some(value => value && value < capturedAt)) throw new Error('Outcome dates cannot precede capture dates.');
    if (row.payment_verified && !['true','false'].includes(row.payment_verified.toLowerCase())) throw new Error('payment_verified must be true or false.');
    const paymentVerified = row.payment_verified.toLowerCase() === 'true';
    if (paymentVerified && (!firstPaidAt || !row.customer_id)) throw new Error('Verified payments require a date and customer ID.');
    return { leadId, adId: row.ad_id ? identifier(row.ad_id,'Ad ID') : '', capturedAt, qualifiedAt, signedUpAt, firstPaidAt,
      paymentVerified, customerId: row.customer_id ? identifier(row.customer_id,'Customer ID') : '',
      mrr: row.mrr ? count(row.mrr,'MRR') : null, firstPayment: row.first_payment_amount ? count(row.first_payment_amount,'First payment') : null };
  });
}

export function acquisitionMetrics(rows, outcomes, { start, end, complete = false, additionalCost = 0 } = {}) {
  const adIds = new Set(rows.map(row => row.adId));
  const cohort = outcomes.filter(row => row.capturedAt >= start && row.capturedAt <= end && adIds.has(row.adId));
  const firstCustomers = new Map();
  for (const row of outcomes.filter(row => row.paymentVerified && row.firstPaidAt && row.customerId)) {
    const previous = firstCustomers.get(row.customerId);
    if (!previous || row.capturedAt < previous.capturedAt || (row.capturedAt === previous.capturedAt && row.leadId < previous.leadId)) firstCustomers.set(row.customerId, row);
  }
  const customers = new Map([...firstCustomers].filter(([,row]) => row.capturedAt >= start && row.capturedAt <= end && adIds.has(row.adId)));
  const spend = totals(rows).spend, paid = customers.size;
  return { trackedLeads: cohort.length, qualified: cohort.filter(row=>row.qualifiedAt).length, signups: cohort.filter(row=>row.signedUpAt).length,
    paid, mrr: paid && [...customers.values()].every(row=>row.mrr!=null) ? [...customers.values()].reduce((sum,row)=>sum+row.mrr,0) : null,
    firstPayments: paid && [...customers.values()].every(row=>row.firstPayment!=null) ? [...customers.values()].reduce((sum,row)=>sum+row.firstPayment,0) : null,
    observedCost: divide(spend, paid), mediaCac: complete ? divide(spend,paid) : null,
    loadedCac: complete ? divide(spend + additionalCost,paid) : null, closeRate: complete ? divide(paid,cohort.length) : null,
    unmatched: outcomes.filter(row=>row.capturedAt>=start && row.capturedAt<=end && !adIds.has(row.adId)).length };
}
