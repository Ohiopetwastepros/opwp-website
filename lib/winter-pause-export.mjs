const PREFIX = 'winter_pause:org-opwp:';

function payloadOf(row) {
  try { return typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload; }
  catch { return null; }
}

// These are requests for staff review, never evidence that a provider pause was applied.
export function winterPauseRows(snapshots) {
  if (!Array.isArray(snapshots)) throw new TypeError('Expected an array of winter-pause snapshots.');
  const requests = new Map();
  for (const row of snapshots) {
    if (!row || !String(row.snapshot_key || '').startsWith(PREFIX)) continue;
    const payload = payloadOf(row);
    if (!payload || payload.status !== 'staff_review' || typeof payload.conversationId !== 'string'
      || row.snapshot_key !== PREFIX + payload.conversationId
      || typeof payload.name !== 'string' || !/^\+[1-9]\d{7,14}$/.test(payload.phone || '')) continue;
    const parsed = Date.parse(row.updated_at || payload.updatedAt || payload.requestedAt || '');
    const updated = Number.isFinite(parsed) ? parsed : 0;
    const previous = requests.get(payload.conversationId);
    if (!previous || updated >= previous.updated) requests.set(payload.conversationId, {updated, payload});
  }
  return [...requests].sort(([left], [right]) => left.localeCompare(right)).map(([, {payload}]) => ({
    name: payload.name, phone: payload.phone, pause_start: payload.pauseStart || '', planned_restart: payload.plannedRestart || '',
  }));
}

function csvCell(value) {
  let text = String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 500);
  // Spreadsheet applications otherwise execute formulas, including E.164 numbers starting with '+'.
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function winterPauseCsv(snapshots) {
  const columns = ['name', 'phone', 'pause_start', 'planned_restart'];
  return [columns.join(','), ...winterPauseRows(snapshots).map(row => columns.map(column => csvCell(row[column])).join(','))].join('\n') + '\n';
}
