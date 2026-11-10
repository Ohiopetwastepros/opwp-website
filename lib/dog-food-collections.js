import { FoodError, foodDate, operationModel, text, date, cents } from './dog-food-operations.mjs';
import { collectionReference, collectorSales, collectableSales, collectionSms, isCollectionReminderTime, parseCollectionReply, staffPhone, smsSegments } from './dog-food-collections.mjs';
import { readFoodSnapshot, readFoodOperations, syncFoodOperations, runFoodCommand, foodOperation } from './dog-food-ops-store';
import {foodWebsiteState,queueFoodStatement} from './dog-food-website-store.mjs';
import { outboundFetch } from './outbound-request';
import { readBoundedProviderJson } from './bounded-body.mjs';

const stateFor=db=>db.prepare("SELECT * FROM dog_food_ops_state WHERE id='org-opwp'").first();
async function currentModel(env) {
  const result=await syncFoodOperations(env,{force:true});
  if(!result.configured||result.skipped)throw new FoodError('Current Airtable balances could not be confirmed. No notification or payment was sent.',409);
  const {snapshot,sync}=await readFoodSnapshot(env.DB);
  if(sync.dirty||sync.last_error)throw new FoodError('Airtable changed during verification. Refresh before proceeding.',409);
  const model=(await foodWebsiteState(env.DB)).backend==='website'?await readFoodOperations(env.DB):operationModel(snapshot),orderIds=[...new Set(model.unpaid.map(s=>s.orderId).filter(Boolean))],sngOrders=new Set();
  // Website projections can omit the SNG label. Check their trusted native
  // billing/customer relationships before issuing a staff collection request.
  for(let n=0;n<orderIds.length;n+=100) {
    const ids=orderIds.slice(n,n+100);
    const result=await env.DB.prepare(`SELECT o.id FROM dog_food_orders o JOIN dog_food_customers c ON c.id=o.customer_id
      WHERE o.id IN (${ids.map(()=>'?').join(',')}) AND (
        NULLIF(trim(c.sng_client_id),'') IS NOT NULL OR lower(o.source) LIKE 'sng%' OR lower(o.source) LIKE 'sweep%'
        OR EXISTS (SELECT 1 FROM dog_food_payments p WHERE p.order_id=o.id AND (lower(p.provider) LIKE 'sng%' OR lower(p.provider) LIKE 'sweep%'))
        OR EXISTS (SELECT 1 FROM dog_food_subscriptions s WHERE s.customer_id=c.id AND (lower(s.payment_provider) LIKE 'sng%' OR lower(s.payment_provider) LIKE 'sweep%'))
      )`).bind(...ids).all();
    for(const row of result.results||[])sngOrders.add(row.id);
  }
  const sngDirectSales=new Set();
  const website=(await foodWebsiteState(env.DB)).backend==='website';
  for(let n=0;n<model.unpaid.length;n+=100) {
    const ids=model.unpaid.slice(n,n+100).map(s=>s.id);
    const result=await env.DB.prepare(`SELECT l.sale_id FROM ${website?"(SELECT sale_id,customer_id FROM dog_food_direct_sale_links UNION SELECT source_record_id sale_id,customer_id FROM dog_food_sales_customer_sources WHERE source_table='Sales')":'dog_food_direct_sale_links'} l JOIN dog_food_customers c ON c.id=l.customer_id
      WHERE l.sale_id IN (${ids.map(()=>'?').join(',')}) AND (
        NULLIF(trim(c.sng_client_id),'') IS NOT NULL
        OR EXISTS (SELECT 1 FROM dog_food_subscriptions s WHERE s.customer_id=c.id AND (lower(s.payment_provider) LIKE 'sng%' OR lower(s.payment_provider) LIKE 'sweep%'))
      )`).bind(...ids).all();
    for(const row of result.results||[])sngDirectSales.add(row.sale_id);
  }
  for(const sale of model.unpaid)if(sngOrders.has(sale.orderId)||sngDirectSales.has(sale.id))sale.sngRelated=true;
  return model;
}
async function audit(db,actor,action,id,details) {
  await db.prepare('INSERT INTO dog_food_ops_audit(id,actor,action,entity_id,details) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(),actor,action,id||null,JSON.stringify(details)).run();
}
export async function reconcileFoodCollections(db,model) {
  const existing=(await db.prepare('SELECT * FROM dog_food_collection_items LIMIT 5000').all()).results||[];
  const statements=[];
  for(const item of existing) {
    const sale=model.sales.find(s=>s.id===item.sale_id),archived=model.archived.some(s=>s.table==='Sales'&&s.id===item.sale_id);
    const status=!sale?archived?'closed':'missing':sale.cancelled?'closed':sale.balanceCents?'open':'paid';
    // Missing/archived/cancelled is never mislabeled as paid.
    if(item.status!==status||sale&&item.balance_cents!==sale.balanceCents)statements.push(db.prepare(`UPDATE dog_food_collection_items
      SET status=?,balance_cents=?,updated_at=CURRENT_TIMESTAMP,resolved_at=CASE WHEN ?='paid' THEN COALESCE(resolved_at,CURRENT_TIMESTAMP) ELSE NULL END WHERE sale_id=?`)
      .bind(status,sale?.balanceCents??item.balance_cents,status,item.sale_id));
  }
  for(let n=0;n<statements.length;n+=100)await db.batch(statements.slice(n,n+100));
  // A manual Airtable update may settle an ambiguous text without posting it
  // again. Resolution is linked to the source balance, not inferred from prose.
  await db.prepare(`UPDATE dog_food_collection_replies SET status='resolved',reason='Airtable confirms this linked sale is fully paid; this reply did not create another receipt.',updated_at=CURRENT_TIMESTAMP
    WHERE status='review' AND sale_id IN (SELECT sale_id FROM dog_food_collection_items WHERE status='paid')`).run();
}
async function issueItems(db,rows,state) {
  if(rows.length>50)throw new FoodError('More than 50 due sales need review. Use the dashboard; the SMS was not sent.',409);
  const references=rows.map(s=>collectionReference(s.id));
  if(new Set(references).size!==references.length)throw new FoodError('Collection-code collision requires office review.',409);
  for(const s of rows)await db.prepare(`INSERT INTO dog_food_collection_items(sale_id,reference,customer_name,sale_date,balance_cents,status,recipient)
    VALUES (?,?,?,?,?,'open',?) ON CONFLICT(sale_id) DO UPDATE SET customer_name=excluded.customer_name,sale_date=excluded.sale_date,
    balance_cents=excluded.balance_cents,status='open',recipient=excluded.recipient,resolved_at=NULL,updated_at=CURRENT_TIMESTAMP`)
    .bind(s.id,collectionReference(s.id),s.name,s.date,s.balanceCents,state.collector_phone).run();
}
async function sendStaffSms(env,row) {
  const from=staffPhone(env.QUO_FROM_NUMBER),to=staffPhone(row.recipient);
  // Fixed provider allowlist prevents a configurable base URL from leaking keys.
  const base=new URL(env.QUO_API_BASE_URL||'https://api.openphone.com');
  if(!from||!to||from===to||base.protocol!=='https:'||!['api.openphone.com','api.quo.com'].includes(base.hostname)||base.port||base.username||base.password)
    throw new FoodError('Staff SMS provider configuration is invalid.',503);
  const response=await outboundFetch(new URL('/v1/messages',base),{method:'POST',headers:{Authorization:env.QUO_API_KEY,Accept:'application/json','Content-Type':'application/json'},
    body:JSON.stringify({content:row.content,from,to:[to]})},{provider:'quo',operation:'dog_food_staff_reminder',timeoutMs:12000,retries:0});
  const result=await readBoundedProviderJson(response,65536),id=result?.data?.id||result?.id;
  if(!response.ok||typeof id!=='string'||id.length>120)throw new FoodError('Quo acceptance was not confirmed. Inspect the conversation before resending.',503);
  return id;
}
async function deliverAlert(env,{recipient,channel,content,today}) {
  const db=env.DB,segments=channel==='quo'?smsSegments(content):0;
  if(segments>16)throw new FoodError('The collection list exceeds the 16-segment SMS limit. Use the dashboard or reduce the due list.',409);
  const id=crypto.randomUUID();
  await db.prepare(`INSERT OR IGNORE INTO dog_food_ops_alerts(id,recipient,alert_date,content,status,channel,segments) VALUES (?,?,?,?,'queued',?,?)`)
    .bind(id,recipient,today,content,channel,segments).run();
  const row=await db.prepare(`UPDATE dog_food_ops_alerts SET status='sending' WHERE recipient=? AND alert_date=? AND status='queued' AND channel=? RETURNING *`)
    .bind(recipient,today,channel).first();
  if(!row)return {channel,status:'already_attempted'};
  try {
    if(channel==='quo') {
      const budget=await db.prepare(`INSERT INTO dog_food_collection_sms_usage(usage_day,segments) VALUES (?,?)
        ON CONFLICT(usage_day) DO UPDATE SET segments=segments+excluded.segments WHERE segments+excluded.segments<=20 RETURNING segments`).bind(today,segments).first();
      if(!budget)throw new FoodError('The staff collections daily SMS cap has been reached.');
    }
    const provider=await sendStaffSms(env,row);
    await db.prepare("UPDATE dog_food_ops_alerts SET status='sent',provider_id=?,sent_at=CURRENT_TIMESTAMP WHERE id=? AND status='sending'").bind(provider,row.id).run();
    return {channel,status:'sent',id:row.id};
  }catch(error) {
    await db.prepare("UPDATE dog_food_ops_alerts SET status='failed',error=? WHERE id=? AND status='sending'")
      .bind(`${text(error.message,300)} No automatic resend; inspect provider acceptance first.`,row.id).run();
    return {channel,status:'failed',id:row.id};
  }
}
export async function runFoodCollectionNotifications(env,{at=Date.now(),manual=false,actor='scheduler'}={}) {
  const db=env.DB,state=await stateFor(db),now=new Date(at),today=foodDate(now);
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'}).format(now));
  if(!manual&&(!state?.alerts_enabled||!isCollectionReminderTime(now)))return {skipped:true};
  if(hour<8||hour>21)throw new FoodError('Staff reminders are restricted to 8 a.m.–10 p.m. Eastern.',409);
  const replyConfigured=state.collector_reply_mode==='manual'||state.collector_webhook_id&&env.DOG_FOOD_QUO_WEBHOOK_SIGNING_KEY;
  const quo=Boolean(state.collector_enabled&&state.collector_verified_at&&replyConfigured&&staffPhone(state.collector_phone)&&env.QUO_API_KEY&&String(env.SMS_PROVIDER).toLowerCase()==='quo');
  if(!quo) {
    if(manual)throw new FoodError('Verify Tony’s staff number and enable Quo reminders before sending this reminder.',409);
    return {skipped:true,reason:'Verified staff SMS configuration is required.'};
  }
  const prior=await db.prepare("SELECT id FROM dog_food_ops_alerts WHERE recipient=? AND alert_date=? AND channel='quo'").bind(state.collector_phone,today).first();
  if(prior)return {skipped:true,reason:'Already attempted today. Inspect delivery history before resending.'};
  const model=await currentModel(env);await reconcileFoodCollections(db,model);
  const due=collectorSales(model,state,now),rows=collectableSales(due),heldSales=due.length-rows.length;
  if(!rows.length)return {skipped:true,reason:'No verified balances due for Tony to collect.',heldSales};
  await issueItems(db,rows,state);
  const results=[await deliverAlert(env,{recipient:state.collector_phone,channel:'quo',content:collectionSms(rows),today})];
  await audit(db,actor,'collections_reminder',null,{results,totalCents:model.metrics.receivablesCents,sales:rows.length,heldSales});
  return {results,totalCents:model.metrics.receivablesCents};
}
export async function recordFoodCollectionReply(env,event) {
  const db=env.DB,state=await stateFor(db);
  if(!state?.collector_verified_at||staffPhone(event.from)!==state.collector_phone||staffPhone(event.to)!==staffPhone(env.QUO_FROM_NUMBER))return {handled:false};
  if(event.isGroup)return {handled:true,ignored:true};
  if(state.collector_reply_mode!=='automatic')return {handled:true,ignored:true,reason:'Staff replies are manual; confirm collections in Airtable.'};
  if(/^STOP$/i.test(event.text.trim())) {
    await db.prepare("UPDATE dog_food_ops_state SET collector_enabled=0 WHERE id='org-opwp'").run();
    await audit(db,'quo:'+state.collector_name,'collections_sms_paused',event.providerMessageId,{reason:'Staff replied STOP'});
    return {handled:true,paused:true};
  }
  // All messages from the verified staff phone bypass customer lead intake.
  if(!/\bDF-[A-Z0-9]{8}\b|\bdog.?food\b|\bcollect(?:ed|ion|ing)?\b|\bpaid\b|\bcash\b|\bcheck\b|\bvenmo\b/i.test(event.text))return {handled:true,ignored:true};
  if(!/^[A-Za-z0-9_-]{1,120}$/.test(event.providerMessageId)||!Number.isFinite(Date.parse(event.createdAt)))return {handled:true,ignored:true};
  const parsed=parseCollectionReply(event.text,new Date(event.createdAt)),reference=parsed.reference||/\bDF-[A-Z0-9]{8}\b/i.exec(event.text)?.[0].toUpperCase()||null;
  const item=reference?await db.prepare('SELECT * FROM dog_food_collection_items WHERE reference=? AND recipient=?').bind(reference,state.collector_phone).first():null;
  const ready=parsed.valid&&item&&Date.parse(item.issued_at.replace(' ','T')+'Z')<=Date.parse(event.createdAt);
  const status=ready?'queued':'review',reason=ready?null:parsed.reason||'The sale code was not issued to this staff phone before this report. Office review required.';
  const result=await db.prepare(`INSERT OR IGNORE INTO dog_food_collection_replies(message_id,event_id,from_phone,to_phone,content,occurred_at,sale_id,reference,amount_cents,payment_date,payment_method,payment_reference,status,reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(event.providerMessageId,event.eventId,event.from,event.to,text(event.text,4000),event.createdAt,item?.sale_id||null,reference,
      parsed.amountCents??null,parsed.date||null,parsed.method||null,parsed.receipt||null,status,reason).run();
  return {handled:true,duplicate:!Number(result.meta?.changes||0),queued:status==='queued'};
}
async function paymentFromReply(env,row,report,actor,officeApproved=false) {
  const state=await stateFor(env.DB);
  if(!state.collector_verified_at||row.from_phone!==state.collector_phone||row.to_phone!==staffPhone(env.QUO_FROM_NUMBER))throw new FoodError('Staff identity changed; review this message manually.',409);
  const model=await currentModel(env),sale=model.sales.find(s=>s.id===report.saleId);
  if(!sale||sale.cancelled)throw new FoodError('This sale is missing, archived or cancelled. No payment was posted.',409);
  const {snapshot}=await readFoodSnapshot(env.DB),reference=`Quo:${row.message_id}`;
  const existing=snapshot.tables['Payment Receipts']?.find(r=>r.fields['Receipt Reference']===reference);
  if(existing) {
    const f=existing.fields;
    if(f['Record Status']==='Archived'||f.Sale?.length!==1||f.Sale[0]!==sale.id||Math.round(Number(f.Amount)*100)!==report.amountCents||f['Payment Date']!==report.date||f.Method!==report.method)
      throw new FoodError('An earlier receipt for this message differs; inspect it before making any correction.',409);
    return {id:existing.id,reconciled:true};
  }
  const item=await env.DB.prepare('SELECT * FROM dog_food_collection_items WHERE sale_id=? AND recipient=?').bind(sale.id,row.from_phone).first();
  if(!officeApproved&&(!item||item.reference!==row.reference||sale.warnings.length))throw new FoodError('This sale has a review flag or does not match an issued collection request. Office approval required.',409);
  if(report.amountCents>sale.balanceCents)throw new FoodError('The reported payment exceeds the freshly verified outstanding balance.',409);
  if(report.date<sale.date||report.date>foodDate())throw new FoodError('Payment date is outside the valid sale-to-today range.',409);
  const duplicate=await env.DB.prepare(`SELECT message_id FROM dog_food_collection_replies WHERE message_id<>? AND payment_reference=? AND payment_method=?
    AND status IN ('processing','recorded','resolved') LIMIT 1`).bind(row.message_id,report.receipt,report.method).first();
  if(duplicate)throw new FoodError('That staff receipt/check/transaction reference has already been reported. Review for duplicate payment.',409);
  // Distinguish staff-reported receipt from processor-confirmed card settlement.
  const result=await foodOperation(env,{action:'record_payment',saleId:sale.id,amount:(report.amountCents/100).toFixed(2),date:report.date,method:report.method,reference,
    notes:`Staff collection reported by ${state.collector_name}; ${officeApproved?'office reviewed by '+actor:'validated structured Quo reply'}. Receipt/check/transaction: ${report.receipt}. Quo message ${row.message_id} (${row.occurred_at}). Text: ${row.content}`},actor);
  return result;
}
async function completeReply(env,row,report,actor,officeApproved=false) {
  const receipt=await paymentFromReply(env,row,report,actor,officeApproved);
  await queueFoodStatement(env.DB,env.DB.prepare(`UPDATE dog_food_collection_replies SET status='recorded',reason='Staff-reported payment saved and read back in Airtable.',receipt_id=?,sale_id=?,amount_cents=?,payment_date=?,payment_method=?,payment_reference=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE message_id=?`)
    .bind(receipt.id,report.saleId,report.amountCents,report.date,report.method,report.receipt,actor,row.message_id));
  return receipt;
}
export async function processFoodCollectionReplies(env,{limit=3}={}) {
  const db=env.DB;
  const state=await stateFor(db);
  if(state.collector_reply_mode!=='automatic')return {skipped:true,reason:'Manual Airtable collection confirmation is enabled.'};
  await db.prepare("UPDATE dog_food_collection_replies SET status='review',reason='Processing was interrupted; inspect Airtable before retrying.',updated_at=CURRENT_TIMESTAMP WHERE status='processing' AND updated_at<datetime('now','-5 minutes')").run();
  const rows=(await db.prepare("SELECT * FROM dog_food_collection_replies WHERE status='queued' ORDER BY created_at LIMIT ?").bind(Math.min(3,Math.max(1,limit))).all()).results||[];
  for(const row of rows) {
    const claimed=await db.prepare("UPDATE dog_food_collection_replies SET status='processing',updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND status='queued' RETURNING message_id").bind(row.message_id).first();
    if(!claimed)continue;
    const report={saleId:row.sale_id,amountCents:row.amount_cents,date:row.payment_date,method:row.payment_method,receipt:row.payment_reference};
    try {
      const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`food-collection:${row.message_id}`)));
      const h=Array.from(hash).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,32),commandId=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
      const actor=`quo:${row.from_phone}`;
      await runFoodCommand(env,{action:'collection_reply',commandId,messageId:row.message_id},actor,e=>completeReply(e,row,report,actor));
      await syncFoodOperations(env,{force:true});
    }catch(error) {
      await db.prepare("UPDATE dog_food_collection_replies SET status='review',reason=?,updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND status='processing'")
        .bind(text(error.message,500),row.message_id).run();
    }
  }
  const {snapshot,sync}=await readFoodSnapshot(db);
  if(sync.configured&&!sync.dirty&&!sync.last_error)await reconcileFoodCollections(db,operationModel(snapshot));
  return {processed:rows.length};
}
export async function foodCollectionCommand(env,body,actor) {
  const db=env.DB;
  if(body.action==='collection_settings') {
    const phone=staffPhone(body.phone),name=text(body.name,100);
    if(!name)throw new FoodError('Staff name is required.');
    const old=await stateFor(db),changed=old.collector_phone!==phone;
    if(phone&&phone===staffPhone(env.QUO_FROM_NUMBER))throw new FoodError('The recipient cannot be the OPWP sender number.');
    if(body.smsEnabled===true&&(!phone||changed&&body.staffConfirmed!==true||!changed&&!old.collector_verified_at&&body.staffConfirmed!==true))throw new FoodError('Confirm that this is Tony’s staff cellphone before enabling reminders.');
    await db.prepare(`UPDATE dog_food_ops_state SET alerts_enabled=?,alert_hour=21,weekdays_only=0,collector_name=?,collector_phone=?,
      collector_enabled=?,collector_verified_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP WHEN ?=1 THEN NULL ELSE collector_verified_at END WHERE id='org-opwp'`)
      .bind(body.enabled===true?1:0,name,phone||null,body.smsEnabled===true?1:0,body.staffConfirmed===true?1:0,changed?1:0).run();
    return {saved:true};
  }
  if(body.action==='collection_notify')return runFoodCollectionNotifications(env,{manual:true,actor});
  if(!['collection_approve','collection_dismiss'].includes(body.action))throw new FoodError('Unsupported collection action.');
  const row=await db.prepare('SELECT * FROM dog_food_collection_replies WHERE message_id=?').bind(text(body.messageId,120)).first();
  if(!row||row.status!=='review')throw new FoodError('This reply is no longer awaiting review.',409);
  if(body.action==='collection_dismiss') {
    const reason=text(body.reason,500);if(!reason)throw new FoodError('A review note is required.');
    await db.prepare("UPDATE dog_food_collection_replies SET status='dismissed',reason=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND status='review'")
      .bind(reason,actor,row.message_id).run();return {dismissed:true};
  }
  if((await stateFor(db)).collector_reply_mode!=='automatic')throw new FoodError('Quo replies remain manual. Record the actual payment in Airtable or use Record payment for the sale.',409);
  if(body.confirmed!==true)throw new FoodError('Confirm that this text is evidence of money actually collected.');
  const report={saleId:text(body.saleId,100),amountCents:cents(body.amount),date:date(body.date),method:text(body.method,50),receipt:text(body.reference,100)};
  if(!report.amountCents||!report.receipt||!['Cash','Check','Venmo / Zelle / PayPal'].includes(report.method))throw new FoodError('Enter a positive amount, payment method and receipt reference.');
  return completeReply(env,row,report,actor,true);
}
export async function recordFoodCollectionDelivery(db,body) {
  const message=body?.data?.object;
  if(!['message.delivered','message.failed'].includes(body?.type)||message?.direction!=='outgoing')return;
  await db.prepare(`UPDATE dog_food_ops_alerts SET delivery_status=?,error=CASE WHEN ?='failed' THEN 'Quo reported delivery failure. Inspect the conversation before resending.' ELSE error END
    WHERE channel='quo' AND provider_id=? AND recipient=?`).bind(body.type==='message.delivered'?'delivered':'failed',body.type==='message.failed'?'failed':'delivered',text(message.id,120),staffPhone(message.to?.[0])).run();
}
