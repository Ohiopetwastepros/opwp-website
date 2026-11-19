import {playbookEnabled, playbookHash} from './lead-playbook-links.mjs';
import {readBoundedProviderJson} from './bounded-body.mjs';

export function queuePlaybookMirrorStatement(db, kind, id) {
  if (!['draft', 'library'].includes(kind)) throw new Error('Invalid playbook mirror kind.');
  return db.prepare(`INSERT INTO playbook_airtable_sync(kind,record_id,status,next_attempt_at) VALUES (?,?,'queued',CURRENT_TIMESTAMP)
    ON CONFLICT(kind,record_id) DO UPDATE SET revision=playbook_airtable_sync.revision+1,status='queued',attempt_count=0,error_message=NULL,mismatch_json=NULL,next_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`).bind(kind, id);
}
function fieldsFor(kind, row) {
  if (kind === 'draft') return {'Playbook ID': row.id, 'Conversation ID': row.conversation_id, 'Intent': row.intent, 'Status': row.status, 'Body': row.final_body || row.body, 'Template': row.template_key || row.answer_key || '', 'Pricing Version': row.pricing_version || '', 'Policy Version': row.policy_version || '', 'Approver': row.approver || '', 'Approvals': 0, 'Edits': row.edit_distance ? 1 : 0, 'Rejections': row.status === 'rejected' ? 1 : 0};
  return {'Playbook ID': row.answer_key, 'Intent': row.intent || '', 'Stage': row.stage || '', 'Status': row.approval_status, 'Body': row.answer_template, 'Template': row.answer_key, 'Pricing Version': '', 'Policy Version': String(row.version), 'Approver': row.updated_by || '', 'Approvals': row.approvals || 0, 'Edits': row.edits || 0, 'Rejections': row.rejections || 0};
}
export async function processPlaybookMirror(db, env, limit = 20, {fetcher = fetch} = {}) {
  // An unset playbook must not touch new tables in an unmigrated environment.
  if (!playbookEnabled(env)) return {enabled: false, attempted: 0, synced: 0, mismatches: 0};
  if (!env.AIRTABLE_API_KEY || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_PLAYBOOK_DRAFTS_TABLE_ID || !env.AIRTABLE_PLAYBOOK_LIBRARY_TABLE_ID) return {enabled: true, configured: false, attempted: 0};
  await db.prepare("UPDATE playbook_airtable_sync SET status='queued',updated_at=CURRENT_TIMESTAMP WHERE status='syncing' AND updated_at<datetime('now','-5 minutes')").run();
  const work = await db.prepare(`SELECT * FROM playbook_airtable_sync WHERE status IN ('queued','failed') AND next_attempt_at<=CURRENT_TIMESTAMP AND attempt_count<10 ORDER BY next_attempt_at LIMIT ?`).bind(Math.max(1, Math.min(50, Number(limit) || 20))).all();
  let synced = 0, mismatches = 0, failed = 0;
  for (const task of work.results || []) {
    const claim = await db.prepare(`UPDATE playbook_airtable_sync SET status='syncing',attempt_count=attempt_count+1,updated_at=CURRENT_TIMESTAMP WHERE kind=? AND record_id=? AND revision=? AND status IN ('queued','failed')`).bind(task.kind, task.record_id, task.revision).run();
    if (claim.meta?.changes !== 1) continue;
    try {
      const row = task.kind === 'draft'
        ? await db.prepare("SELECT * FROM lead_reply_drafts WHERE id=? AND organization_id='org-opwp'").bind(task.record_id).first()
        : await db.prepare("SELECT * FROM lead_answer_library WHERE answer_key=? AND organization_id='org-opwp'").bind(task.record_id).first();
      if (!row) throw new Error('missing_local_record');
      const expected = fieldsFor(task.kind, row), base = env.AIRTABLE_BASE_ID, table = task.kind === 'draft' ? env.AIRTABLE_PLAYBOOK_DRAFTS_TABLE_ID : env.AIRTABLE_PLAYBOOK_LIBRARY_TABLE_ID;
      if (!/^app[A-Za-z0-9]+$/.test(base) || !/^tbl[A-Za-z0-9]+$/.test(table)) throw new Error('invalid_mirror_configuration');
      async function request(path, options) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
        try {
          const response = await fetcher(`https://api.airtable.com/v0/${base}/${table}${path}`, {...options, headers: {Authorization: `Bearer ${env.AIRTABLE_API_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json'}, signal: controller.signal, redirect: 'manual'});
          if (!response.ok) { await response.body?.cancel(); throw new Error('mirror_provider_rejected'); }
          return await readBoundedProviderJson(response, 128 * 1024);
        } finally { clearTimeout(timer); }
      }
      const write = await request('', {method: 'PATCH', body: JSON.stringify({performUpsert: {fieldsToMergeOn: ['Playbook ID']}, records: [{fields: expected}], typecast: false})});
      const recordId = write.records?.[0]?.id;
      if (!/^rec[A-Za-z0-9]+$/.test(recordId || '')) throw new Error('invalid_mirror_response');
      // A successful write alone is not a successful sync.
      const readBack = await request('/' + recordId, {method: 'GET'});
      const differences = Object.keys(expected).filter(key => JSON.stringify(readBack.fields?.[key] ?? (typeof expected[key] === 'number' ? 0 : '')) !== JSON.stringify(expected[key]));
      const mismatch = differences.length > 0;
      const update = await db.prepare(`UPDATE playbook_airtable_sync SET status=?,airtable_record_id=?,payload_hash=?,mismatch_json=?,error_message=NULL,synced_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE kind=? AND record_id=? AND revision=? AND status='syncing'`).bind(mismatch ? 'mismatch' : 'synced', recordId, await playbookHash(JSON.stringify(expected)), mismatch ? JSON.stringify({fields: differences}) : null, task.kind, task.record_id, task.revision).run();
      if (update.meta?.changes === 1) { if (mismatch) mismatches++; else synced++; }
    } catch {
      // Provider errors may contain customer fields. Store only a fixed diagnostic.
      await db.prepare(`UPDATE playbook_airtable_sync SET status='failed',error_message='mirror_sync_failed',next_attempt_at=datetime('now','+15 minutes'),updated_at=CURRENT_TIMESTAMP WHERE kind=? AND record_id=? AND revision=? AND status='syncing'`).bind(task.kind, task.record_id, task.revision).run();
      failed++;
    }
  }
  return {enabled: true, configured: true, attempted: (work.results || []).length, synced, mismatches, failed};
}
