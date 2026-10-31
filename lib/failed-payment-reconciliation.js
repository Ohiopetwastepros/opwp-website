import { controlledSngFetch } from './sng-request-control.mjs';
import { outboundFetch } from './outbound-request.js';
import { readBoundedProviderJson } from './bounded-body.mjs';

// Payment-accepted events have no invoice identity: they hold outreach, never settle an invoice.
export const PAYMENT_MATCH_SQL = `EXISTS (
 SELECT 1 FROM sng_events p JOIN sng_events d ON d.id=f.source_event_id
 WHERE p.event_type='client:client_payment_accepted' AND p.status='processed'
 AND CAST(json_extract(p.payload,'$.data.client') AS TEXT)=f.client_ref
 AND CAST(json_extract(d.payload,'$.data.total') AS REAL)>0
 AND ROUND(CAST(json_extract(p.payload,'$.data.amount') AS REAL)*100)
   =ROUND(CAST(json_extract(d.payload,'$.data.total') AS REAL)*100)
 AND julianday(p.received_at)>julianday(COALESCE((SELECT MAX(d2.received_at) FROM sng_events d2
 WHERE d2.event_type='client:client_payment_declined'
 AND CAST(json_extract(d2.payload,'$.data.invoice_id') AS TEXT)=f.invoice_id),d.received_at)))`;

export const RECOVERY_ROWS_SQL = `SELECT f.*,r.payment_state,r.evidence,r.evidence_at,r.sng_checked_at,
 r.remaining,r.airtable_record_id,r.airtable_fingerprint,r.airtable_confirmed_at,r.sync_error,
 COALESCE(NULLIF(i.invoice_number,''),h.invoice_number) invoice_number,
 h.status history_status,h.imported_at history_at,
 COALESCE((SELECT MAX(d.received_at) FROM sng_events d WHERE d.event_type='client:client_payment_declined'
   AND CAST(json_extract(d.payload,'$.data.invoice_id') AS TEXT)=f.invoice_id),e.received_at) decline_at,
 json_extract(e.payload,'$.data.total') amount,
 (${PAYMENT_MATCH_SQL}) payment_match
 FROM failed_payment_sms f LEFT JOIN failed_payment_reconciliation r ON r.sms_id=f.id
 LEFT JOIN sng_invoices i ON i.invoice_id=f.invoice_id
 LEFT JOIN route_invoice_history h ON h.invoice_id=f.invoice_id
 LEFT JOIN sng_events e ON e.id=f.source_event_id`;

export function archivedResolution(row) {
  const historyAt=Date.parse(row.history_at), declineAt=Date.parse(row.decline_at);
  if (Number.isFinite(historyAt) && historyAt>=declineAt && historyAt>= (Date.parse(row.sng_checked_at)||0)) {
    if (/^paid$/i.test(row.history_status)) return {state:'paid',evidence:'Sweep & Go invoice export: Paid',at:row.history_at};
    if (/^void(ed)?$/i.test(row.history_status)) return {state:'voided',evidence:'Sweep & Go invoice export: Voided',at:row.history_at};
  }
  if (row.payment_match && !['paid','voided','settled'].includes(row.payment_state)) return {state:'payment_recorded',evidence:'Verified payment received; invoice allocation requires confirmation',at:row.decline_at};
  return null;
}

export async function reconcileRecordedPayments(db) {
  if (!db) return;
  await db.prepare(`INSERT INTO failed_payment_reconciliation(sms_id)
    SELECT id FROM failed_payment_sms WHERE 1 ON CONFLICT(sms_id) DO NOTHING`).bind().run();
  const {results=[]}=await db.prepare(`${RECOVERY_ROWS_SQL}
    ORDER BY COALESCE(r.checked_at,'') ASC LIMIT 250`).bind().all();
  for(const row of results) {
    const found=archivedResolution(row);
    if(found) await db.prepare(`UPDATE failed_payment_reconciliation SET payment_state=?,evidence=?,evidence_at=?,checked_at=CURRENT_TIMESTAMP WHERE sms_id=?`)
      .bind(found.state,found.evidence,found.at,row.id).run();
    else await db.prepare(`UPDATE failed_payment_reconciliation SET checked_at=CURRENT_TIMESTAMP WHERE sms_id=?`).bind(row.id).run();
  }
}

export function parseInvoiceBalance(data) {
  const value=data?.invoice_remaining;
  if ((typeof value!=='number' && typeof value!=='string') || String(value).trim()==='' || !/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error('Unconfirmed invoice balance');
  const remaining=Number(value);
  if(!Number.isFinite(remaining)||remaining>1000000) throw new Error('Invalid invoice balance');
  return remaining;
}

export async function confirmInvoice(env,row) {
  if(!env.SNG_API_KEY || !row.invoice_number) throw new Error('Sweep & Go invoice confirmation unavailable');
  const url=new URL('https://openapi.sweepandgo.com/api/v2/one_time_payment/check_invoice');
  url.searchParams.set('invoice_number',row.invoice_number);
  const response=await controlledSngFetch(env,url,{headers:{Authorization:`Bearer ${env.SNG_API_KEY}`,Accept:'application/json'},cache:'no-store'});
  if(!response.ok) throw new Error('Sweep & Go invoice confirmation unavailable');
  const remaining=parseInvoiceBalance(await readBoundedProviderJson(response));
  // A balance endpoint proves nothing is due, not that cash was received (could be a credit).
  const state=remaining===0?'settled':'open';
  await env.DB.prepare(`UPDATE failed_payment_reconciliation SET payment_state=?,remaining=?,
    evidence='Sweep & Go live invoice balance',evidence_at=CURRENT_TIMESTAMP,sng_checked_at=CURRENT_TIMESTAMP,
    next_check_at=datetime('now','+6 hours'),sync_error=NULL WHERE sms_id=?`)
    .bind(state,remaining,row.id).run();
  return {...row,payment_state:state,remaining,evidence:'Sweep & Go live invoice balance'};
}

export function mirrorFields(row) {
  return {'Invoice ID':row.invoice_id,'Customer':row.client_name||'Unknown customer',
    'Payment State':row.payment_state||'needs_review','Evidence':row.evidence||'',
    'SMS State':row.status,'Evidence Time':row.evidence_at||'',
    'Confirmed Sync':'D1-managed; payment evidence from Sweep & Go'};
}

export async function syncRecoveryRow(env,row) {
  if(!env.AIRTABLE_API_KEY || !env.AIRTABLE_FAILED_PAYMENTS_TABLE_ID) throw new Error('Airtable recovery mirror is not configured');
  const fields=mirrorFields(row), fingerprint=JSON.stringify(fields);
  if(row.airtable_fingerprint===fingerprint && row.airtable_confirmed_at) return true;
  const url=`https://api.airtable.com/v0/${encodeURIComponent(env.AIRTABLE_BASE_ID)}/${encodeURIComponent(env.AIRTABLE_FAILED_PAYMENTS_TABLE_ID)}`;
  const headers={Authorization:`Bearer ${env.AIRTABLE_API_KEY}`,'Content-Type':'application/json'};
  const write=await outboundFetch(url,{method:'PATCH',headers,body:JSON.stringify({performUpsert:{fieldsToMergeOn:['Invoice ID']},records:[{fields}]})},
    {provider:'airtable',operation:'failed_payment_recovery_upsert',timeoutMs:10000,retries:0});
  if(!write.ok) throw new Error('Airtable recovery write failed');
  const saved=await readBoundedProviderJson(write), id=saved.records?.[0]?.id;
  if(!/^rec[a-zA-Z0-9]+$/.test(id||'')) throw new Error('Airtable recovery write unconfirmed');
  const read=await outboundFetch(`${url}/${id}`,{headers,cache:'no-store'},
    {provider:'airtable',operation:'failed_payment_recovery_readback',timeoutMs:10000,retries:1});
  if(!read.ok) throw new Error('Airtable recovery readback failed');
  const confirmed=await readBoundedProviderJson(read);
  if(!Object.entries(fields).every(([key,value])=>(confirmed.fields?.[key]||'')===value)) throw new Error('Airtable recovery readback mismatch');
  await env.DB.prepare(`UPDATE failed_payment_reconciliation SET airtable_record_id=?,airtable_fingerprint=?,
    airtable_confirmed_at=CURRENT_TIMESTAMP,sync_error=NULL WHERE sms_id=?`).bind(id,fingerprint,row.id).run();
  return true;
}

export async function runFailedPaymentRecovery(env) {
  if(!env.DB) return {configured:false};
  await reconcileRecordedPayments(env.DB);
  const {results=[]}=await env.DB.prepare(`${RECOVERY_ROWS_SQL}
    WHERE r.next_check_at<=CURRENT_TIMESTAMP ORDER BY r.next_check_at LIMIT 10`).bind().all();
  let confirmed=0,held=0;
  for(const row of results) {
    try {
      // Preserve definitive paid/voided exports; no reason to call the balance API for those.
      if(!['paid','voided','settled'].includes(row.payment_state)) await confirmInvoice(env,row);
      const fresh=await env.DB.prepare(`${RECOVERY_ROWS_SQL} WHERE f.id=?`).bind(row.id).first();
      await syncRecoveryRow(env,fresh);
      await env.DB.prepare(`UPDATE failed_payment_reconciliation SET next_check_at=datetime('now','+6 hours') WHERE sms_id=?`).bind(row.id).run();
      confirmed++;
    } catch {
      // Mirror known evidence even if the live provider is temporarily unavailable.
      try { await syncRecoveryRow(env,row); } catch { /* retried on the next bounded pass */ }
      await env.DB.prepare(`UPDATE failed_payment_reconciliation SET sync_error='Confirmation or mirror sync failed; outreach held',
        next_check_at=datetime('now','+30 minutes') WHERE sms_id=?`).bind(row.id).run();
      held++;
    }
  }
  return {configured:true,confirmed,held};
}

// Called immediately before each send. An outage, missing match, partial payment, or unconfirmed mirror blocks outreach.
export async function verifyFailedPaymentForSend(env,id) {
  const row=await env.DB.prepare(`${RECOVERY_ROWS_SQL} WHERE f.id=?`).bind(id).first();
  if(!row || row.status!=='awaiting_approval' || row.payment_match || ['paid','voided','settled','payment_recorded'].includes(row.payment_state) || archivedResolution(row)) return false;
  const confirmed=await confirmInvoice(env,row);
  const fresh=await env.DB.prepare(`${RECOVERY_ROWS_SQL} WHERE f.id=?`).bind(id).first();
  await syncRecoveryRow(env,fresh);
  return confirmed.remaining>0 && Math.round(confirmed.remaining*100)===Math.round(Number(row.amount)*100);
}
