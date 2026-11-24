import { normalizePhone } from './lead-assistant.mjs';

export const WINBACK_POLICY_VERSION = 'winback-v1';
export const WINBACK_FIRST_FOOTER = '\n\nReply STOP to opt out';
export const WINBACK_MIN_INTERVAL_MS = 15000;
export const WINBACK_MAX_BATCH = 100;
const phonePattern = /^\+1[2-9]\d{2}[2-9]\d{6}$/;
export function winbackPhone(value) { const phone = normalizePhone(value); return phonePattern.test(phone) ? phone : ''; }
export function winbackMask(value) { return winbackPhone(value) ? `***${winbackPhone(value).slice(-4)}` : 'invalid'; }
export const winbackHash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)))), b => b.toString(16).padStart(2, '0')).join('');

export function winbackCopyViolations(body) {
  const reasons = [];
  if (/[\u2013\u2014]/u.test(body)) reasons.push('forbidden_dash');
  if (/\b(?:morning|afternoon|evening|tonight|noon|midnight)\b|\b(?:by|before|at|around)\s+\d{1,2}(?::\d{2})?\b(?![\d/])|\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i.test(body)) reasons.push('time_of_day_promise');
  if (/\$15\s*off/i.test(body)) reasons.push('unapproved_discount');
  return reasons;
}

// Copy is deliberately supplied from a private approved file, never guessed from
// a campaign label. Hashes pin the exact source bytes and rendered copy.
export async function validateWinbackCopy(config) {
  if (!config || config.approved !== true || typeof config.approvedBy !== 'string' || !config.approvedBy.trim() || typeof config.evidence !== 'string' || !config.evidence.trim()) throw new Error('Approved private win-back copy is required.');
  for (const version of ['V1', 'V2']) {
    const template = config.templates?.[version];
    if (!template || typeof template.body !== 'string' || template.body.length < 20 || template.body.length > 1500 || template.body.includes('\r') || !template.body.endsWith(WINBACK_FIRST_FOOTER)) throw new Error(`Invalid approved ${version} template.`);
    if ((template.body.match(/Reply STOP to opt out/g) || []).length !== 1 || winbackCopyViolations(template.body).length) throw new Error(`Unsafe approved ${version} copy.`);
    const sourceGreeting = template.body.startsWith('Hi [First],') && (template.body.match(/\[First\]/g) || []).length === 1;
    if (/\{\{(?!greeting\}\}|firstName\}\})/.test(template.body) || !sourceGreeting && !template.body.includes('{{greeting}}') || sourceGreeting && /\{\{/.test(template.body)) throw new Error('Only the original First greeting or explicit greeting and firstName template slots are supported.');
    if (!/^[a-f0-9]{64}$/.test(template.sha256 || '') || await winbackHash(template.body) !== template.sha256) throw new Error(`Approved ${version} copy hash mismatch.`);
  }
  return true;
}

export function usableWinbackName(value) {
  const name = String(value || '').trim();
  return /^[\p{L}][\p{L}' -]{0,39}$/u.test(name) && !/^(?:unknown|none|null|n\/a|test|customer|there)$/i.test(name) ? name : '';
}
export function renderWinbackMessage(recipient, copy, { firstMessage = true } = {}) {
  const template = copy?.templates?.[recipient.version]?.body;
  if (!template) throw new Error('Approved campaign copy is unavailable.');
  const name = usableWinbackName(recipient.first_name);
  const greeting = recipient.greeting || (name ? `Hi ${name},` : 'Hi there,');
  if (!/^Hi [\p{L}][\p{L}' ,&-]{0,85},$/u.test(greeting) || /[\r\n]/.test(greeting)) throw new Error('Invalid private greeting override.');
  let body = template.startsWith('Hi [First],') ? greeting + template.slice('Hi [First],'.length) : template.replaceAll('{{greeting}}', greeting).replaceAll('{{firstName}}', name || 'there');
  if (!firstMessage && body.endsWith(WINBACK_FIRST_FOOTER)) body = body.slice(0, -WINBACK_FIRST_FOOTER.length);
  if (body.length > 1600 || /\{\{/.test(body) || winbackCopyViolations(body).length) throw new Error('Rendered win-back copy needs review.');
  return body;
}

export function winbackWindow(now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid campaign clock.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const thanksgiving = parts.month === '11' && parts.weekday === 'Thu' && Number(parts.day) >= 22 && Number(parts.day) <= 28;
  return { date, allowed: !['Sat', 'Sun'].includes(parts.weekday) && !thanksgiving && minute >= 660 && minute < 1080, reason: thanksgiving ? 'thanksgiving' : ['Sat', 'Sun'].includes(parts.weekday) ? 'weekend' : minute < 660 || minute >= 1080 ? 'outside_send_window' : '' };
}

export function parseWinbackCsv(text) {
  if (typeof text !== 'string' || text.length > 5 * 1024 * 1024) throw new Error('CSV is missing or too large.');
  const rows = [], row = []; let value = '', quoted = false, closed = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) { if (ch === '"' && input[i + 1] === '"') { value += '"'; i++; } else if (ch === '"') { quoted = false; closed = true; } else value += ch; continue; }
    if (ch === '"') { if (value || closed) throw new Error('Malformed CSV quoting.'); quoted = true; continue; }
    if (ch === ',' || ch === '\n' || ch === '\r') {
      row.push(value); value = ''; closed = false;
      if (ch !== ',') { if (ch === '\r' && input[i + 1] === '\n') i++; if (row.some(cell => cell !== '')) rows.push([...row]); row.length = 0; }
    } else { if (closed) throw new Error('Malformed CSV quote suffix.'); value += ch; }
  }
  if (quoted) throw new Error('Unclosed CSV quote.');
  if (value || row.length || closed) { row.push(value); rows.push([...row]); }
  if (rows.length < 2 || rows.length > 10001) throw new Error('CSV requires a header and bounded recipients.');
  const headers = rows.shift().map(header => header.trim());
  if (headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error('CSV headers must be unique.');
  return rows.map((cells, index) => { if (cells.length !== headers.length) throw new Error(`CSV column count mismatch on row ${index + 2}.`); return Object.fromEntries(headers.map((h, i) => [h, cells[i]])); });
}

// Review rules contain operational identities and stay in ignored private input.
// Enablement needs its own approval, independent of campaign/copy approval.
export function planWinbackImport(rows, { columns = {}, review = {} } = {}) {
  const keys = { phone: 'phone', firstName: 'first_name', version: 'version', batch: 'batch', flag: 'flag', ...columns };
  const seen = new Set(), recipients = [], skipped = [];
  const excluded = new Set((review.excludedPhones || []).map(winbackPhone).filter(Boolean));
  const included = new Set((review.includedPhones || []).map(winbackPhone).filter(Boolean));
  const reviewEnabled = review.enabled === true && review.approved === true && typeof review.approvedBy === 'string' && Boolean(review.approvedBy.trim()) && typeof review.evidence === 'string' && Boolean(review.evidence.trim());
  rows.forEach((row, index) => {
    const phone = winbackPhone(row[keys.phone]), first_name = usableWinbackName(row[keys.firstName]), version = String(row[keys.version] || '').trim(), batch = Number(row[keys.batch]), flag = String(row[keys.flag] || '').trim().toLowerCase();
    let reason = !phone ? 'invalid_phone' : excluded.has(phone) ? 'private_exclusion' : flag !== 'ok' && !(flag === 'review' && reviewEnabled && included.has(phone)) ? flag === 'review' ? 'review_held' : 'unapproved_flag' : !['V1', 'V2'].includes(version) ? 'invalid_version' : !Number.isInteger(batch) || batch < 1 || batch > 1000 ? 'invalid_batch' : seen.has(phone) ? 'duplicate_phone' : '';
    const greeting = reviewEnabled ? review.greetings?.[phone] || '' : '';
    const recipient = { row: index + 2, phone, first_name, version, batch, greeting, card_eligible: Boolean(first_name), status: 'queued' };
    if (reason) { skipped.push({ ...recipient, reason }); return; }
    seen.add(phone); recipients.push(recipient);
  });
  const counts = new Map();
  for (const row of recipients) counts.set(row.batch, (counts.get(row.batch) || 0) + 1);
  if ([...counts.values()].some(count => count > WINBACK_MAX_BATCH)) throw new Error('A campaign batch exceeds 100 recipients.');
  return { recipients, skipped, reviewEnabled };
}

// Fisher-Yates with cryptographic randomness by default. Assignment is persisted
// once at import; resumes and reports never randomize it again.
export function assignWinbackVariants(rows, random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) {
  const groups = new Map(), assigned = new Map(), oddExtras = new Map();
  const draw = () => { const value = random(); if (!(value >= 0 && value < 1)) throw new Error('Invalid random source.'); return value; };
  rows.forEach((row, i) => { const key = `${row.batch}:${row.version}`; groups.set(key, [...(groups.get(key) || []), i]); });
  for (const indices of groups.values()) {
    for (let i = indices.length - 1; i > 0; i--) { const j = Math.floor(draw() * (i + 1)); [indices[i], indices[j]] = [indices[j], indices[i]]; }
    let extraA = false;
    if (indices.length % 2) {
      const batch = rows[indices[0]].batch;
      if (!oddExtras.has(batch)) oddExtras.set(batch, draw() < 0.5);
      extraA = oddExtras.get(batch); oddExtras.set(batch, !extraA);
    }
    indices.forEach((index, i) => assigned.set(index, i < Math.floor(indices.length / 2) + (extraA ? 1 : 0) ? 'A' : 'B'));
  }
  return rows.map((row, i) => ({ ...row, card_variant: assigned.get(i), card_eligible: Boolean(row.card_eligible && usableWinbackName(row.first_name)) }));
}

export function winbackReport(recipients) {
  const variants = Object.fromEntries(['A', 'B'].map(variant => [variant, { sent: 0, replies: 0, positive_replies: 0, quote_requests: 0, signups: 0, opt_outs: 0 }]));
  for (const row of recipients) {
    const out = variants[row.card_variant]; if (!out) continue;
    if (row.sent_at) out.sent++;
    if (row.replied_at) out.replies++;
    if (row.positive_at) out.positive_replies++;
    if (row.quote_requested_at) out.quote_requests++;
    if (row.signup_at) out.signups++;
    if (row.opted_out_at) out.opt_outs++;
  }
  // Stored assignments alone are not delivered card treatments. The current
  // transport sends text only, so response-rate differences cannot pick a card.
  return { variants, recommendation: 'Picture cards were not delivered. No card winner can be inferred. Keep the approved split.',
    switchingApproved: false, cardMode: 'text_only', cardComparisonEligible: false, recommendedVariant: null };
}
