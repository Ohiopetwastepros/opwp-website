import { sngRequest, sngRows } from './sweepandgo';
import { sendQuoText } from './quote-follow-up-delivery';
import { sendTransactionalEmail, transactionalEmailConfig } from './submission-notifications';
import { normalizeReviewIdentity } from './google-review-matching.mjs';
import { REVIEW_REQUEST_TEMPLATE_VERSION, REVIEW_SITE_ORIGIN, reviewTechSlug, buildReviewRequestSms, buildReviewRequestEmail } from './review-request-content.mjs';
import { reviewRequestsEnabled, reviewPhone, reviewEmail, reviewHash, reviewJobType, reviewJobQualifies, reviewEasternDate, reviewCompletedAt, reviewSendWindow, reviewSkipReason } from './review-request-policy.mjs';
import { prepareReviewPreview } from './review-previews.mjs';

const json = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
const str = value => String(value ?? '').trim();

export function reviewJob(body, prior = {}) {
  const data = body?.data ?? body ?? {};
  const context = prior?.data ?? prior ?? {};
  const row = { ...context, ...Object.fromEntries(Object.entries(data).filter(([,v]) => v !== undefined && v !== null && v !== '')) };
  const customer = row.client && typeof row.client === 'object' ? row.client : {};
  const name = str(row.client_name || row.full_name || customer.full_name || `${row.first_name || customer.first_name || ''} ${row.last_name || customer.last_name || ''}`);
  const completedAt = reviewCompletedAt(row.end_time || row.completed_at);
  return {
    jobId: str(row.job_id ?? row.id), customerId: str(row.client_id ?? row.customer_id ?? customer.id ?? (typeof row.client === 'string' || typeof row.client === 'number' ? row.client : '')),
    customerName: name, firstName: str(row.first_name || customer.first_name || name.split(/\s+/)[0]),
    jobType: reviewJobType(row.job_type || row.type), tech: str(row.employee_name || row.assigned_to_name),
    phone: reviewPhone(row.cell_phone || row.cell_phone_number || row.phone || row.phone_number || row.mobile_phone || row.home_phone || customer.cell_phone_number),
    email: reviewEmail(row.email || row.client_email || customer.email), marketingAllowed: row.marketing_allowed ?? customer.marketing_allowed,
    completedAt, jobDate: completedAt ? reviewEasternDate(completedAt) : str(row.date || row.job_date).slice(0,10),
  };
}

export async function resolveReviewJob(body, prior = {}, request = sngRequest) {
  let job = reviewJob(body, prior);
  const data = body?.data ?? body ?? {};
  const date = job.jobDate || str(data.end_time || data.start_time).slice(0,10);
  if (!job.jobId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return job;
  // Dispatch is the authoritative contact/type/assignment enrichment, including
  // phone which is absent from the completion webhook. Refresh on every send.
  const result = await request('/api/v1/dispatch_board/jobs_for_date', { searchParams: { date } });
  if (!result.ok) throw new Error('dispatch_lookup_unavailable');
  const found = sngRows(result).find(row => str(row.job_id ?? row.id) === job.jobId);
  if (!found) throw new Error('dispatch_job_not_found');
  const dispatch = reviewJob({data:found});
  const fields = {
    customerId:['client_id','customer_id','client'], customerName:['client_name','full_name','first_name','last_name'], firstName:['client_name','full_name','first_name'],
    jobType:['job_type','type'], tech:['employee_name','assigned_to_name'],
    phone:['cell_phone','cell_phone_number','phone','phone_number','mobile_phone','home_phone'], email:['email','client_email'],
    marketingAllowed:['marketing_allowed'], completedAt:['end_time','completed_at'], jobDate:['end_time','completed_at','date','job_date'],
  };
  for(const [field,keys] of Object.entries(fields)) if(keys.some(key=>Object.hasOwn(found,key)))job[field]=dispatch[field];
  return job;
}

export async function reviewEnabledAt(env, now = new Date()) {
  if (!reviewRequestsEnabled(env) || !env?.DB) return null;
  await env.DB.prepare("INSERT OR IGNORE INTO review_request_settings(id,enabled_at) VALUES('automation',?)").bind(new Date(now).toISOString()).run();
  return (await env.DB.prepare("SELECT enabled_at FROM review_request_settings WHERE id='automation'").first())?.enabled_at || null;
}

async function identity(db, job, { create = false } = {}) {
  const aliases = [job.customerId ? `sng:${job.customerId}` : '', job.phone ? `phone:${await reviewHash(job.phone)}` : ''].filter(Boolean);
  if (!aliases.length) return '';
  const owners = [];
  for (const key of aliases) {
    const row = await db.prepare('SELECT customer_key FROM review_request_identities WHERE alias_key=? UNION SELECT customer_key FROM review_request_customers WHERE customer_key=? LIMIT 1').bind(key,key).first();
    if (row) owners.push(row.customer_key);
  }
  if (new Set(owners).size > 1) throw new Error('customer_identity_conflict');
  let key = owners[0] || aliases[0];
  if (!create) return key;
  await db.prepare('INSERT OR IGNORE INTO review_request_customers(customer_key,customer_name) VALUES(?,?)').bind(key,job.customerName).run();
  // Phone first serializes concurrent fallback and ID-bearing completions.
  for (const alias of [...aliases].reverse()) {
    await db.prepare('INSERT OR IGNORE INTO review_request_identities(alias_key,customer_key) VALUES(?,?)').bind(alias,key).run();
    const owner = await db.prepare('SELECT customer_key FROM review_request_identities WHERE alias_key=?').bind(alias).first();
    if (owner.customer_key !== key) {
      if (owners.length) throw new Error('customer_identity_conflict');
      key = owner.customer_key;
    }
  }
  return key;
}

export function reviewSnapshotReviewed(tracker, job) {
  return tracker.some(record => {
    const fields = record.fields || {};
    if (fields['Google Review'] !== 'Reviewed') return false;
    if (String(fields['Client Type']||'').toLowerCase()==='unmatched review') return false;
    const id = str(fields['SNG Client ID']);
    // Tracker uses public rcl_ IDs while Dispatch uses numeric IDs. Preserve the
    // existing exact normalized-name match across those two source ID domains.
    if (id && job.customerId && /^rcl_/.test(id) === /^rcl_/.test(job.customerId)) return id === job.customerId;
    return Boolean(job.customerName && normalizeReviewIdentity(fields['Client Name']) === normalizeReviewIdentity(job.customerName));
  });
}

export async function reviewEligibility(env, job, enabledAt, { customerKey = null } = {}) {
  const db = env.DB;
  const key = customerKey ?? await identity(db,job);
  const snapshot = await db.prepare("SELECT payload FROM airtable_cockpit_snapshots WHERE snapshot_key='business_cockpit'").first();
  const tracker = json(snapshot?.payload)?.opwp?.reviewTracker;
  if (!Array.isArray(tracker)) throw new Error('review_snapshot_unavailable');
  const customer = key ? await db.prepare('SELECT do_not_contact,claimed_request_id FROM review_request_customers WHERE customer_key=?').bind(key).first() : null;
  // A manual alias flag must remain effective even after an older phone-only
  // reservation becomes the canonical owner of a later SNG ID.
  const manual = await db.prepare('SELECT MAX(do_not_contact) blocked FROM review_request_customers WHERE customer_key IN(?,?,?)')
    .bind(key,job.customerId?`sng:${job.customerId}`:'',job.phone?`phone:${await reviewHash(job.phone)}`:'').first();
  let suppressed = false;
  if (job.phone) {
    const field = await db.prepare('SELECT suppressed FROM field_message_suppression WHERE phone=?').bind(job.phone).first();
    const lead = await db.prepare("SELECT 1 blocked FROM lead_suppressions WHERE organization_id='org-opwp' AND phone_hash=?").bind(await reviewHash(job.phone)).first();
    suppressed = Boolean(field?.suppressed || lead);
  }
  const emailHash = job.email ? await reviewHash(job.email) : null;
  const unsubscribed = emailHash ? await db.prepare('SELECT 1 blocked FROM review_request_unsubscribes WHERE email_hash=?').bind(emailHash).first() : null;
  const reason = reviewSkipReason({ ...job, enabledAt, customerKey:key, reviewed:reviewSnapshotReviewed(tracker,job), suppressed, emailUnsubscribed:Boolean(unsubscribed), marketingAllowed:job.marketingAllowed, doNotContact:Boolean(customer?.do_not_contact || manual?.blocked) });
  return { reason, customerKey:key, claimedRequestId:customer?.claimed_request_id || null, emailHash };
}

async function recordReviewRequest(env,job,{reason=null,key='',emailHash=null}={}) {
  const db=env.DB, id=crypto.randomUUID();
  if (key) await db.prepare('INSERT OR IGNORE INTO review_request_customers(customer_key,customer_name) VALUES(?,?)').bind(key,job.customerName).run();
  const insert=db.prepare(`INSERT OR IGNORE INTO review_requests(id,customer_key,customer_id,customer_name,job_id,job_date,completed_at,job_type,tech,page_slug,template_version,payload)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,key||null,job.customerId,job.customerName,job.jobId,job.jobDate||'',job.completedAt,job.jobType,job.tech,reviewTechSlug(job.tech),REVIEW_REQUEST_TEMPLATE_VERSION,JSON.stringify(job));
  const statements=[insert];
  if (!reason && key) statements.push(db.prepare("UPDATE review_request_customers SET claimed_request_id=?,updated_at=CURRENT_TIMESTAMP WHERE customer_key=? AND claimed_request_id IS NULL AND do_not_contact=0 AND EXISTS(SELECT 1 FROM review_requests WHERE id=?)").bind(id,key,id));
  const channels=reason?['none']:[...(job.phone?['sms']:[]),...(job.email?['email']:[])];
  for(const channel of channels) {
    statements.push(db.prepare(`INSERT INTO review_request_deliveries(id,request_id,channel,status,reason,recipient,email_hash,skipped_at)
      SELECT ?,?, ?,CASE WHEN ? IS NOT NULL OR NOT EXISTS(SELECT 1 FROM review_request_customers WHERE customer_key=? AND claimed_request_id=?) THEN 'skipped' ELSE 'queued' END,
      CASE WHEN ? IS NOT NULL THEN ? WHEN NOT EXISTS(SELECT 1 FROM review_request_customers WHERE customer_key=? AND claimed_request_id=?) THEN 'already_requested' END,?,?,
      CASE WHEN ? IS NOT NULL OR NOT EXISTS(SELECT 1 FROM review_request_customers WHERE customer_key=? AND claimed_request_id=?) THEN CURRENT_TIMESTAMP END
      WHERE EXISTS(SELECT 1 FROM review_requests WHERE id=?)`).bind(crypto.randomUUID(),id,channel,reason,key,id,reason,reason,key,id,channel==='sms'?job.phone:channel==='email'?job.email:'',channel==='email'?emailHash:null,reason,key,id,id));
  }
  await db.batch(statements);
  return {status:reason?'skipped':'recorded',reason};
}

export async function queueReviewRequest(env,{body,context={},now=new Date(),request=sngRequest}={}) {
  // Disabled means no lookup, enable timestamp, reservation, queue or send.
  if(!reviewRequestsEnabled(env))return {status:'disabled'};
  if(!env?.DB)return {status:'unavailable'};
  const enabledAt=await reviewEnabledAt(env,now);
  let job=reviewJob(body,context);
  if(job.jobType && !reviewJobQualifies(job.jobType))return {status:'ignored',reason:'ineligible_job_type'};
  if(job.completedAt && Date.parse(job.completedAt)<=Date.parse(enabledAt))return {status:'ignored',reason:'before_go_live'};
  job=await resolveReviewJob(body,context,request);
  if(!job.jobId)return {status:'ignored',reason:'missing_job_id'};
  if(await env.DB.prepare('SELECT id FROM review_requests WHERE job_id=?').bind(job.jobId).first())return {status:'duplicate'};
  if(!reviewJobQualifies(job.jobType))return {status:'ignored',reason:'ineligible_job_type'};
  if(!job.completedAt || Date.parse(job.completedAt)<=Date.parse(enabledAt))return {status:'ignored',reason:job.completedAt?'before_go_live':'missing_completion_time'};
  const key=await identity(env.DB,job,{create:true});
  const eligibility=await reviewEligibility(env,job,enabledAt,{customerKey:key});
  return recordReviewRequest(env,job,{key,emailHash:eligibility.emailHash,reason:eligibility.reason || (eligibility.claimedRequestId?'already_requested':null)});
}

async function finish(db,id,status,reason,providerId=null) {
  await db.prepare(`UPDATE review_request_deliveries SET status=?,reason=?,provider_message_id=COALESCE(?,provider_message_id),updated_at=CURRENT_TIMESTAMP,
    sent_at=CASE WHEN ?='sent' THEN CURRENT_TIMESTAMP ELSE sent_at END,skipped_at=CASE WHEN ?='skipped' THEN CURRENT_TIMESTAMP ELSE skipped_at END,
    failed_at=CASE WHEN ?='failed' THEN CURRENT_TIMESTAMP ELSE failed_at END WHERE id=? AND status IN('queued','sending')`).bind(status,reason,providerId,status,status,status,id).run();
}

export async function runScheduledReviewRequests(env,{now=null,limit=10,request=sngRequest}={}) {
  if(!reviewRequestsEnabled(env))return {enabled:false,attempted:0,sent:0};
  if(!env?.DB)return {enabled:true,attempted:0,sent:0};
  const clock=()=>typeof now==='function'?now():now || new Date();
  const db=env.DB,enabledAt=await reviewEnabledAt(env,clock());
  await db.prepare("UPDATE review_request_deliveries SET status='failed',reason='interrupted_send_verify_provider_before_retry',failed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE status='sending' AND datetime(COALESCE(sending_at,updated_at))<datetime('now','-15 minutes')").run();
  if(!reviewSendWindow(clock()))return {enabled:true,deferred:true,attempted:0,sent:0};
  const due=await db.prepare(`SELECT d.*,r.customer_key,r.payload,r.completed_at FROM review_request_deliveries d JOIN review_requests r ON r.id=d.request_id
    WHERE d.status='queued' ORDER BY d.created_at,d.id LIMIT ?`).bind(Math.min(Math.max(Number(limit)||10,1),30)).all();
  let attempted=0,sent=0;
  for(const row of due.results||[]) {
    try {
      // Refresh Dispatch and consent for each channel immediately before send.
      const old=json(row.payload);
      const job=await resolveReviewJob({data:{...old,job_id:old.jobId,client_id:old.customerId,client_name:old.customerName,end_time:old.completedAt,job_type:old.jobType,employee_name:old.tech}}, {},request);
      // Never let enrichment move a historical completion across the cutoff.
      job.completedAt=row.completed_at;
      const currentKey=await identity(db,job);
      const eligibility=await reviewEligibility(env,job,enabledAt,{customerKey:row.customer_key});
      const reason=eligibility.reason || (currentKey!==row.customer_key?'customer_identity_changed':null) || (eligibility.claimedRequestId!==row.request_id?'already_requested':null) || (row.recipient!==(row.channel==='sms'?job.phone:job.email)?'contact_changed':null);
      if(reason){await finish(db,row.id,'skipped',reason);continue;}
      if(row.channel==='sms' && (!env.QUO_API_KEY || !env.QUO_FROM_NUMBER || env.SMS_PROVIDER!=='quo'))continue;
      if(row.channel==='email' && (!transactionalEmailConfig(env).configured || transactionalEmailConfig(env).provider!=='resend'))continue;
      await db.prepare('UPDATE review_requests SET tech=?,page_slug=?,job_type=? WHERE id=?').bind(job.tech,reviewTechSlug(job.tech),job.jobType,row.request_id).run();
      if(!reviewRequestsEnabled(env)||!reviewSendWindow(clock()))continue;
      const preview=await prepareReviewPreview(env,{token:row.request_id,firstName:job.firstName,tech:job.tech});
      const claim=await db.prepare("UPDATE review_request_deliveries SET status='sending',sending_at=CURRENT_TIMESTAMP,reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'").bind(row.id).run();
      if(!claim.meta?.changes)continue;
      attempted++;
      // Recheck after asynchronous DB claims/token writes too: a batch may
      // cross 8 PM between preflight and the actual outbound request.
      const readyToSend=async()=>{
        if(!reviewRequestsEnabled(env)){await finish(db,row.id,'skipped','feature_disabled');return false;}
        if(!reviewSendWindow(clock())){
          await db.prepare("UPDATE review_request_deliveries SET status='queued',reason='quiet_hours',sending_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'").bind(row.id).run();
          return false;
        }
        return true;
      };
      let providerId;
      if(row.channel==='sms'){
        if(!await readyToSend())continue;
        providerId=await sendQuoText(env,{phone:row.recipient},{content:buildReviewRequestSms({firstName:job.firstName,tech:job.tech,previewToken:preview?.token}),operation:'send_review_request'});
      }
      else {
        const token=crypto.randomUUID()+crypto.randomUUID();
        await db.prepare('UPDATE review_request_deliveries SET unsubscribe_token_hash=? WHERE id=?').bind(await reviewHash(token),row.id).run();
        const unsubscribeUrl=`${REVIEW_SITE_ORIGIN}/review/unsubscribe/?token=${token}`;
        const oneClick=`${REVIEW_SITE_ORIGIN}/api/review-requests/unsubscribe/?token=${token}`;
        if(!await readyToSend())continue;
        providerId=await sendTransactionalEmail(env,{to:row.recipient,...buildReviewRequestEmail({firstName:job.firstName,tech:job.tech,previewToken:preview?.token,unsubscribeUrl}),idempotencyKey:`review-request/${row.id}`,headers:{'List-Unsubscribe':`<${oneClick}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}});
      }
      await finish(db,row.id,'sent','provider_accepted_delivery_not_confirmed',providerId);sent++;
    }catch {
      // Preflight read failures defer; an uncertain outbound attempt is terminal.
      const current=await db.prepare('SELECT status FROM review_request_deliveries WHERE id=?').bind(row.id).first();
      if(current?.status==='sending')await finish(db,row.id,'failed','provider_acceptance_uncertain_verify_before_retry');
      else await db.prepare("UPDATE review_request_deliveries SET reason='eligibility_lookup_unavailable',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'").bind(row.id).run();
    }
  }
  return {enabled:true,attempted,sent};
}

export async function unsubscribeReviewEmail(env,token) {
  if(!/^[a-f0-9-]{72}$/.test(str(token)) || !env?.DB)return false;
  const row=await env.DB.prepare("SELECT email_hash FROM review_request_deliveries WHERE unsubscribe_token_hash=? AND channel='email'").bind(await reviewHash(token)).first();
  if(!row?.email_hash)return false;
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO review_request_unsubscribes(email_hash) VALUES(?)').bind(row.email_hash),
    env.DB.prepare("UPDATE review_request_deliveries SET status='skipped',reason='email_unsubscribed',skipped_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE email_hash=? AND status='queued'").bind(row.email_hash),
  ]);return true;
}

export async function getReviewRequestAdminData(env) {
  const enabledAt=await env.DB.prepare("SELECT enabled_at FROM review_request_settings WHERE id='automation'").first();
  const rows=await env.DB.prepare(`SELECT d.id,r.customer_key,r.customer_name,r.job_date,r.tech,d.channel,d.status,d.reason,d.created_at,d.sent_at,
    CASE WHEN d.channel='sms' THEN substr(d.recipient,-4) ELSE '' END phone_last4,c.do_not_contact
    FROM review_request_deliveries d JOIN review_requests r ON r.id=d.request_id LEFT JOIN review_request_customers c ON c.customer_key=r.customer_key ORDER BY d.created_at DESC,d.id LIMIT 300`).all();
  const contacts=await env.DB.prepare('SELECT customer_key,customer_name,do_not_contact FROM review_request_customers ORDER BY updated_at DESC LIMIT 300').all();
  return {enabled:reviewRequestsEnabled(env),enabledAt:enabledAt?.enabled_at||null,rows:rows.results||[],contacts:contacts.results||[]};
}
export async function setReviewDoNotContact(env,{customerKey,blocked,actor}) {
  if(!/^[A-Za-z0-9:_-]{1,180}$/.test(customerKey)||typeof blocked!=='boolean')throw new Error('Invalid contact control');
  const owner=await env.DB.prepare('SELECT customer_key FROM review_request_identities WHERE alias_key=?').bind(customerKey).first();
  customerKey=owner?.customer_key || customerKey;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO review_request_customers(customer_key,do_not_contact,updated_by) VALUES(?,?,?) ON CONFLICT(customer_key) DO UPDATE SET do_not_contact=excluded.do_not_contact,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP').bind(customerKey,Number(blocked),actor),
    env.DB.prepare('INSERT INTO review_request_contact_audit(id,customer_key,do_not_contact,actor) VALUES(?,?,?,?)').bind(crypto.randomUUID(),customerKey,Number(blocked),actor),
  ]);
}
