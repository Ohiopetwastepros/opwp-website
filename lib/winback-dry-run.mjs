import { assignWinbackVariants, planWinbackImport, renderWinbackMessage, validateWinbackCopy, winbackMask, usableWinbackName } from './winback-policy.mjs';

export async function buildWinbackDryRun(rows, copy, { batch = 1, rules = {}, verifyRecipient, random, assignedRecipients = null } = {}) {
  await validateWinbackCopy(copy);
  const plan = planWinbackImport(rows, rules);
  let assigned;
  if (assignedRecipients !== null) {
    if (!Array.isArray(assignedRecipients) || assignedRecipients.length !== plan.recipients.length) throw new Error('Stored campaign assignments do not match the reviewed input.');
    const stored = new Map(assignedRecipients.map(row => [row.phone, row]));
    assigned = plan.recipients.map(row => {
      const existing = stored.get(row.phone);
      if (!existing || existing.version !== row.version || Number(existing.batch) !== row.batch || !['A','B'].includes(existing.card_variant)) throw new Error('Stored campaign assignments do not match the reviewed input.');
      return { ...row, card_variant: existing.card_variant };
    });
  } else assigned = assignWinbackVariants(plan.recipients, random);
  const recipients = assigned.filter(row => row.batch === batch);
  const results = [];
  for (const row of recipients) {
    const evidence = verifyRecipient ? await verifyRecipient(row) : { allowed: false, reasons: ['send_time_checks_not_verified'] };
    const reasons = evidence?.allowed === true ? [] : Array.isArray(evidence?.reasons) && evidence.reasons.length ? evidence.reasons : ['send_time_checks_not_verified'];
    results.push({ name: usableWinbackName(row.first_name) || 'there', phone: winbackMask(row.phone), version: row.version, batch: row.batch, cardVariant: row.card_variant, card: row.card_eligible ? 'text-only; card held' : 'no card', body: renderWinbackMessage(row, copy, { firstMessage: evidence?.firstMessage !== false }), allowed: reasons.length === 0, reasons });
  }
  const skipped = plan.skipped.map(row => ({ name: usableWinbackName(row.first_name) || 'there', phone: winbackMask(row.phone), batch: row.batch, reason: row.reason }));
  const skipCounts = {};
  for (const row of [...results.flatMap(row => row.reasons.map(reason => ({ reason }))), ...skipped]) skipCounts[row.reason] = (skipCounts[row.reason] || 0) + 1;
  const totals = { csvRows: rows.length, candidatesAllBatches: plan.recipients.length, batchCandidates: results.length, willSend: results.filter(row => row.allowed).length, heldBatch: results.filter(row => !row.allowed).length, importSkipped: skipped.length, skipCounts };
  return { results, skipped, totals, reviewEnabled: plan.reviewEnabled };
}

export function winbackDryRunMarkdown(result, { date = '2026-11-23', batch = 1 } = {}) {
  const clean = text => String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replaceAll('```', "'''" );
  const lines = [`# Win-back batch ${batch} dry run, ${date}`, '', 'No sends. Masked operational report; keep this file in ignored private storage.', '', 'A dry run is not campaign approval. Every live recipient still requires fresh provider checks immediately before delivery.', '', `Totals: ${JSON.stringify(result.totals)}`, ''];
  for (const row of result.results) lines.push(`## ${clean(row.name)}, ${row.phone}`, '', `Version ${row.version}; variant ${row.cardVariant}; ${row.card}.`, '', row.allowed ? 'Eligible at dry-run verification only.' : `Held: ${row.reasons.join(', ')}`, '', '```text', clean(row.body), '```', '');
  lines.push('## Import skips', '');
  for (const row of result.skipped) lines.push(`- ${clean(row.name)}, ${row.phone}: ${row.reason}`);
  return lines.join('\n') + '\n';
}
