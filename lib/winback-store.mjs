import { assignWinbackVariants, validateWinbackCopy, winbackHash, winbackPhone } from './winback-policy.mjs';
export const WINBACK_ORG = 'org-opwp';
export const winbackChanges = result => Number(result?.meta?.changes || 0);
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };

export async function importWinbackCampaign(db, { id, name, sourceSha256, copy, recipients, reviewEnabled = false, random }) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id || '') || typeof name !== 'string' || !name.trim() || name.length > 120 || !/^[a-f0-9]{64}$/.test(sourceSha256 || '')) throw new Error('A pinned private campaign import is required.');
  await validateWinbackCopy(copy);
  const prior = await db.prepare('SELECT source_sha256,copy_json FROM winback_campaigns WHERE id=? AND organization_id=?').bind(id, WINBACK_ORG).first();
  if (prior) {
    if (prior.source_sha256 !== sourceSha256 || prior.copy_json !== JSON.stringify(copy)) throw new Error('Campaign input changed. Use a new reviewed campaign ID.');
    return { imported: 0, existing: true };
  }
  const assigned = assignWinbackVariants(recipients, random);
  const batchCounts = new Map();
  for (const row of assigned) batchCounts.set(row.batch, (batchCounts.get(row.batch) || 0) + 1);
  if ([...batchCounts.values()].some(count => count > 100)) throw new Error('A campaign batch exceeds 100 recipients.');
  const statements = [db.prepare(`INSERT INTO winback_campaigns(id,organization_id,name,copy_json,source_sha256,review_enabled) VALUES(?,?,?,?,?,?)`).bind(id, WINBACK_ORG, name.trim(), JSON.stringify(copy), sourceSha256, reviewEnabled ? 1 : 0)];
  for (const recipient of assigned) {
    const phone = winbackPhone(recipient.phone), hash = await winbackHash(phone);
    if (!phone || !['V1', 'V2'].includes(recipient.version) || !Number.isInteger(recipient.batch) || recipient.batch < 1) throw new Error('Invalid reviewed recipient.');
    const recipientId = `wb-${(await winbackHash(`${id}:${phone}`)).slice(0, 40)}`;
    statements.push(db.prepare(`INSERT INTO winback_recipients(id,campaign_id,phone_hash,phone,first_name,greeting,version,batch,card_variant,card_eligible,card_filename)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(recipientId, id, hash, phone, recipient.first_name || '', recipient.greeting || '', recipient.version, recipient.batch, recipient.card_variant, recipient.card_eligible ? 1 : 0, recipient.card_eligible ? `${phone.slice(1)}-${recipient.card_variant}.jpg` : null));
  }
  // D1 executes the whole import transactionally. A partial import never exists.
  await db.batch(statements);
  return { imported: assigned.length, existing: false };
}

export async function winbackCampaign(db, campaignId) {
  const row = await db.prepare('SELECT * FROM winback_campaigns WHERE id=? AND organization_id=?').bind(campaignId, WINBACK_ORG).first();
  return row ? { ...row, copy: parse(row.copy_json) } : null;
}
export async function winbackRecipients(db, campaignId, batch = null) {
  return (await db.prepare(`SELECT r.* FROM winback_recipients r JOIN winback_campaigns c ON c.id=r.campaign_id WHERE r.campaign_id=? AND c.organization_id=? AND (? IS NULL OR r.batch=?) ORDER BY r.batch,r.id`).bind(campaignId, WINBACK_ORG, batch, batch).all()).results || [];
}
export async function winbackSwitches(db, env, campaignId) {
  if (env.WINBACK_ENABLED !== 'true' || env.WINBACK_SEND_ENABLED !== 'true' || env.WINBACK_KILL_SWITCH !== 'false') return { allowed: false, reason: 'environment_disabled' };
  const row = await db.prepare(`SELECT s.enabled global_enabled,s.kill_switch global_kill,c.enabled,c.kill_switch,c.approved_by,c.approval_evidence FROM winback_settings s
    JOIN winback_campaigns c ON c.organization_id=s.organization_id WHERE s.organization_id=? AND c.id=?`).bind(WINBACK_ORG, campaignId).first();
  if (!row || row.global_enabled !== 1 || row.global_kill !== 0 || row.enabled !== 1 || row.kill_switch !== 0 || !row.approved_by?.trim() || !row.approval_evidence?.trim()) return { allowed: false, reason: 'database_disabled' };
  return { allowed: true };
}

export async function localWinbackReasons(db, row, now, providerEvidence = null, { claimed = false } = {}) {
  const reasons = [], hash = await winbackHash(row.phone);
  if (row.status !== 'queued' || row.attempted_at && !claimed) reasons.push('already_attempted');
  if (await db.prepare('SELECT 1 blocked FROM lead_suppressions WHERE organization_id=? AND phone_hash=?').bind(WINBACK_ORG, hash).first()) reasons.push('phone_suppressed');
  if (await db.prepare(`SELECT 1 blocked FROM winback_recipients r JOIN winback_campaigns c ON c.id=r.campaign_id
    WHERE r.phone_hash=? AND r.campaign_id!=? AND r.status IN ('queued','sent','replied') AND c.enabled=1 AND c.kill_switch=0 AND c.organization_id=? LIMIT 1`).bind(hash, row.campaign_id, WINBACK_ORG).first()) reasons.push('another_active_campaign');
  if (await db.prepare(`SELECT 1 blocked FROM meta_lead_intakes i JOIN lead_conversations c ON c.submission_id=i.submission_id AND c.organization_id=i.organization_id
    JOIN submissions s ON s.id=i.submission_id WHERE i.phone_hash=? AND i.organization_id=? AND c.status IN ('open','waiting') AND s.status NOT IN ('deleted','trashed','converted') LIMIT 1`).bind(hash, WINBACK_ORG).first()) reasons.push('open_meta_conversation');
  if (await db.prepare(`SELECT 1 blocked FROM lead_messages m JOIN lead_conversations c ON c.id=m.conversation_id JOIN submissions s ON s.id=c.submission_id
    WHERE m.organization_id=? AND m.direction='outbound' AND m.created_at>=? AND substr(replace(replace(replace(replace(replace(s.phone,'+',''),'(',''),')',''),'-',''),' ',''),-10)=? LIMIT 1`).bind(WINBACK_ORG, new Date(now.getTime() - 30 * 86400000).toISOString().replace('T', ' ').slice(0, 19), row.phone.slice(-10)).first()) reasons.push('recent_opwp_text');
  if (await db.prepare(`SELECT 1 blocked FROM airtable_cockpit_snapshots WHERE snapshot_key LIKE 'winter_pause:org-opwp:%'
    AND json_valid(payload) AND json_extract(payload,'$.phone')=? AND json_extract(payload,'$.status')='staff_review' LIMIT 1`).bind(row.phone).first()) reasons.push('seasonal_pauser');
  const refs = (providerEvidence?.airtable?.matches || []).flatMap(record => [record.fields['SNG Client ID'], record.fields['Sweep&Go Client ID']]).filter(value => value != null && String(value));
  for (const ref of new Set(refs.map(String))) {
    if (await db.prepare(`SELECT 1 blocked FROM subscription_pauses WHERE client_ref=? AND status='paused' LIMIT 1`).bind(ref).first()) { reasons.push('seasonal_pauser'); break; }
  }
  return [...new Set(reasons)];
}

export async function queueWinbackAirtable(db, { id, phone, outcome, doNotText = false, note, now = new Date() }) {
  const timestamp = now.toISOString();
  await db.prepare(`INSERT OR IGNORE INTO winback_airtable_outbox(id,phone,outcome,do_not_text,note,created_at) VALUES(?,?,?,?,?,?)`).bind(id, phone, outcome, doNotText ? 1 : 0, note, timestamp).run();
}

function sourceTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const utc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(text) ? text.replace(' ', 'T') + 'Z' : text;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(utc)) return null;
  const milliseconds = Date.parse(utc);
  return Number.isFinite(milliseconds) ? { milliseconds, iso: new Date(milliseconds).toISOString() } : null;
}

// Attribution follows existing source-owned conversion records. Reply intent,
// account text and mutable updated_at/last_activity_at never prove signup.
export async function reconcileWinbackConversions(db) {
  const rows = (await db.prepare(`SELECT r.*,s.phone source_phone,s.email source_email,s.lifecycle_stage,g.stage growth_stage,g.converted_at
    FROM winback_recipients r JOIN winback_campaigns c ON c.id=r.campaign_id JOIN submissions s ON s.id=r.submission_id
    LEFT JOIN growth_leads g ON g.submission_id=s.id AND g.organization_id=?
    WHERE c.organization_id=? AND r.signup_at IS NULL AND r.sent_at IS NOT NULL AND s.status NOT IN ('deleted','trashed')
      AND (g.stage='won' AND length(trim(COALESCE(g.converted_at,'')))>0 OR s.lifecycle_stage='converted')
      AND EXISTS(SELECT 1 FROM winback_deliveries d WHERE d.recipient_id=r.id AND d.purpose='initial' AND d.status IN ('sent','unknown')
        AND length(trim(COALESCE(d.provider_message_id,'')))>0 AND d.provider_message_id=r.provider_message_id)
      AND json_valid(s.payload) AND COALESCE(json_extract(CASE WHEN json_valid(s.payload) THEN s.payload ELSE '{}' END,'$.organization_id'),json_extract(CASE WHEN json_valid(s.payload) THEN s.payload ELSE '{}' END,'$.organizationId'),?)=?
      AND NOT EXISTS(SELECT 1 FROM growth_leads foreign_owner WHERE foreign_owner.submission_id=s.id AND foreign_owner.organization_id!=?)
      AND NOT EXISTS(SELECT 1 FROM lead_conversations foreign_owner WHERE foreign_owner.submission_id=s.id AND foreign_owner.organization_id!=?)
      AND NOT EXISTS(SELECT 1 FROM meta_lead_intakes foreign_owner WHERE foreign_owner.submission_id=s.id AND foreign_owner.organization_id!=?)
    ORDER BY r.sent_at,r.id LIMIT 1000`).bind(WINBACK_ORG, WINBACK_ORG, WINBACK_ORG, WINBACK_ORG, WINBACK_ORG, WINBACK_ORG, WINBACK_ORG).all()).results || [];
  const result = { checked: rows.length, signups: 0, held: 0 };
  for (const row of rows) {
    const phone = winbackPhone(row.phone), sent = sourceTimestamp(row.sent_at);
    if (!phone || winbackPhone(row.source_phone) !== phone || await winbackHash(phone) !== row.phone_hash || !sent) { result.held++; continue; }
    let converted = row.growth_stage === 'won' ? sourceTimestamp(row.converted_at) : null;
    let evidenceId = null, evidenceCreatedAt = null;
    if (!converted && row.lifecycle_stage === 'converted') {
      // lead-handoff.js writes this exact immutable event in the same batch as
      // successful onboarding conversion. It supplies time when the submission
      // itself has no dedicated converted_at column.
      const events = (await db.prepare(`SELECT e.id,e.created_at,o.phone,o.email FROM growth_lead_events e
        JOIN submissions o ON o.id=json_extract(CASE WHEN json_valid(e.details) THEN e.details ELSE '{}' END,'$.onboardingId')
        WHERE e.submission_id=? AND e.organization_id=? AND e.event_type='system' AND e.actor_email='verified_signup'
          AND e.summary='Customer signup verified; sales outreach stopped' AND e.id=('inbox-signup:'||o.id||':'||e.submission_id)
          AND o.kind='onboarding' AND o.sng_sync_state='succeeded' AND o.sng_synced=1 AND o.status NOT IN ('deleted','trashed')
          AND json_valid(o.payload) AND COALESCE(json_extract(CASE WHEN json_valid(o.payload) THEN o.payload ELSE '{}' END,'$.organization_id'),json_extract(CASE WHEN json_valid(o.payload) THEN o.payload ELSE '{}' END,'$.organizationId'),?)=?
          AND NOT EXISTS(SELECT 1 FROM growth_leads foreign_owner WHERE foreign_owner.submission_id=o.id AND foreign_owner.organization_id!=?)
          AND NOT EXISTS(SELECT 1 FROM lead_conversations foreign_owner WHERE foreign_owner.submission_id=o.id AND foreign_owner.organization_id!=?)
        ORDER BY e.created_at,e.id LIMIT 10`).bind(row.submission_id, WINBACK_ORG, WINBACK_ORG, WINBACK_ORG, WINBACK_ORG, WINBACK_ORG).all()).results || [];
      const matches = events.filter(event => winbackPhone(event.phone) === phone && typeof row.source_email === 'string' && row.source_email.trim()
        && String(event.email || '').trim().toLowerCase() === row.source_email.trim().toLowerCase()
        && sourceTimestamp(event.created_at)?.milliseconds >= sent.milliseconds);
      if (matches.length === 1) { converted = sourceTimestamp(matches[0].created_at); evidenceId = matches[0].id; evidenceCreatedAt = matches[0].created_at; }
    }
    if (!converted || converted.milliseconds < sent.milliseconds) { result.held++; continue; }
    const evidence = evidenceId
      ? `EXISTS(SELECT 1 FROM submissions s JOIN growth_lead_events e ON e.submission_id=s.id WHERE s.id=? AND s.lifecycle_stage='converted' AND e.organization_id=? AND e.id=? AND e.created_at=?)`
      : `EXISTS(SELECT 1 FROM growth_leads g WHERE g.submission_id=? AND g.organization_id=? AND g.stage='won' AND g.converted_at=?)`;
    const evidenceArgs = evidenceId ? [row.submission_id, WINBACK_ORG, evidenceId, evidenceCreatedAt] : [row.submission_id, WINBACK_ORG, row.converted_at];
    const note = `Win-back ${row.campaign_id}, ${row.version}, batch ${row.batch}, variant ${row.card_variant}: Signed up confirmed by the linked source record.`;
    const changes = await db.batch([
      db.prepare(`UPDATE winback_recipients SET signup_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND signup_at IS NULL AND submission_id=?
        AND campaign_id IN(SELECT id FROM winback_campaigns WHERE organization_id=?) AND ${evidence}`).bind(converted.iso, row.id, row.submission_id, WINBACK_ORG, ...evidenceArgs),
      db.prepare(`INSERT OR IGNORE INTO winback_airtable_outbox(id,phone,outcome,do_not_text,note,created_at)
        SELECT ?,r.phone,'Signed up',0,?,? FROM winback_recipients r JOIN winback_campaigns c ON c.id=r.campaign_id
        WHERE r.id=? AND c.organization_id=? AND r.signup_at=?`).bind(`signup:${row.id}`, note, converted.iso, row.id, WINBACK_ORG, converted.iso),
    ]);
    result.signups += winbackChanges(changes[0]);
  }
  return result;
}

// A failed local mirror enqueue cannot erase an accepted SMS receipt. This
// reconstructs only missing mirrors from durable sent evidence, without sending.
export async function reconcileMissingWinbackSentOutbox(db, { limit = 100 } = {}) {
  const rows = (await db.prepare(`SELECT d.id delivery_id,r.phone,r.phone_hash,r.sent_at,r.campaign_id,r.version,r.batch,r.card_variant
    FROM winback_deliveries d JOIN winback_recipients r ON r.id=d.recipient_id JOIN winback_campaigns c ON c.id=r.campaign_id
    WHERE c.organization_id=? AND d.purpose='initial' AND d.status='sent' AND length(trim(COALESCE(d.provider_message_id,'')))>0
      AND d.provider_message_id=r.provider_message_id AND r.sent_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM winback_airtable_outbox o WHERE o.id=('sent:'||d.id)) ORDER BY d.created_at,d.id LIMIT ?`)
    .bind(WINBACK_ORG, Math.max(1, Math.min(100, Number(limit) || 100))).all()).results || [];
  const result = { checked: rows.length, queued: 0 };
  for (const row of rows) {
    const timestamp = sourceTimestamp(row.sent_at), phone = winbackPhone(row.phone);
    if (!timestamp || !phone || await winbackHash(phone) !== row.phone_hash) continue;
    const note = `Win-back ${row.campaign_id}, ${row.version}, batch ${row.batch}, variant ${row.card_variant}: sent.`;
    const queued = await db.prepare(`INSERT OR IGNORE INTO winback_airtable_outbox(id,phone,outcome,do_not_text,note,created_at)
      SELECT ?,r.phone,'Sent',0,?,? FROM winback_deliveries d JOIN winback_recipients r ON r.id=d.recipient_id JOIN winback_campaigns c ON c.id=r.campaign_id
      WHERE d.id=? AND c.organization_id=? AND d.purpose='initial' AND d.status='sent' AND length(trim(COALESCE(d.provider_message_id,'')))>0
        AND d.provider_message_id=r.provider_message_id AND r.sent_at IS NOT NULL`).bind(`sent:${row.delivery_id}`, note, timestamp.iso, row.delivery_id, WINBACK_ORG).run();
    result.queued += winbackChanges(queued);
  }
  return result;
}

export async function flushWinbackAirtable(db, providers, { limit = 20 } = {}) {
  const rows = (await db.prepare(`SELECT * FROM winback_airtable_outbox WHERE status IN ('queued','failed') ORDER BY created_at,id LIMIT ?`).bind(Math.max(1, Math.min(100, limit))).all()).results || [];
  let synced = 0, failed = 0;
  for (const row of rows) {
    try { await providers.writeAirtable(row); await db.prepare(`UPDATE winback_airtable_outbox SET status='synced',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.id).run(); synced++; }
    catch { await db.prepare(`UPDATE winback_airtable_outbox SET status='failed',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.id).run(); failed++; }
  }
  return { synced, failed };
}
