'use client';
import {useEffect,useState} from 'react';
import {collectionReference} from '@/lib/dog-food-collection-format.mjs';
import s from './collections-workflow.module.css';
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
const stamp=v=>v?new Date(/[zZ]|[+-]\d\d:\d\d$/.test(v)?v:v.replace(' ','T')+'Z').toLocaleString('en-US',{timeZone:'America/New_York'}):'Not yet';
export function CollectionSettings({state}) {
  return <>
    <p>Tony receives one short text on Sundays at 9 PM Eastern: customer names and amounts to collect. SNG-related sales are excluded. Multiple due sales for a customer are combined. Balances needing review stay in the dashboard. No collection review email is sent.</p>
    <label className={s.check}><input name="enabled" type="checkbox" defaultChecked={Boolean(state.alerts_enabled)}/>Enable Sunday 9 PM reminders</label>
    <div className={s.fields}>
      <label>Collection staff name<input name="name" maxLength={100} defaultValue={state.collector_name||state.collector_default_name||''} required/></label>
      <label>Tony’s cellphone (E.164)<input name="phone" type="tel" pattern="\+[1-9][0-9]{7,14}" defaultValue={state.collector_phone||''} placeholder="+14195551234"/></label>
    </div>
    <label className={s.check}><input name="smsEnabled" type="checkbox" defaultChecked={Boolean(state.collector_enabled)}/>Enable Tony’s Quo reminder</label>
    <label className={s.check}><input name="staffConfirmed" type="checkbox"/>I verified this is Tony’s staff cellphone, not a customer number.</label>
    <p className={s.muted}>One scheduled attempt per week. Manual sends share a one-attempt-per-day limit. Delivery failures need review before another attempt. API SMS uses Quo credits. Replies stay manual in Quo; use these settings to pause reminders.</p>
  </>;
}
export default function CollectionsWorkflow({data,busy,onAction,onSettings}) {
  const [review,setReview]=useState(null),[sendConfirm,setSendConfirm]=useState(false);
  const state=data.sync,automatic=state.collector_reply_mode==='automatic';
  const replies=automatic?(data.collectionReplies||[]):[],items=data.collectionItems||[];
  useEffect(()=>{if(review&&!replies.some(r=>r.message_id===review.message_id&&r.status==='review'))setReview(null);},[replies,review]);
  const pending=replies.filter(r=>['review','queued','processing'].includes(r.status));
  const alerts=(data.alerts||[]).slice(0,8),paid=items.filter(i=>i.status==='paid');
  const due=data.unpaid.filter(s=>!s.nextFollowUp||s.nextFollowUp<=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date()));
  function submitReview(event) {
    event.preventDefault();const f=new FormData(event.currentTarget);
    onAction({action:'collection_approve',messageId:review.message_id,saleId:f.get('saleId'),amount:f.get('amount'),date:f.get('date'),method:f.get('method'),reference:f.get('reference'),confirmed:f.get('confirmed')==='on'});
  }
  return <section className={s.workspace} aria-label="Staff collections workflow">
    <div className={s.heading}><div><small>STAFF COLLECTIONS / QUO REMINDERS</small><h3>Tony’s weekly collection list.</h3><p>Customer names and amounts, texted Sundays at 9 PM Eastern. Balances with review flags are held here until corrected.</p></div><div className={s.buttons}><button onClick={onSettings} disabled={busy}>Routing & schedule</button><button onClick={()=>setSendConfirm(true)} disabled={busy||!state.collector_verified_at||!state.collector_enabled}>Send Tony’s list now</button></div></div>
    <div className={s.stats}>
      <article><span>Recorded outstanding</span><strong>{money(data.metrics.receivablesCents)}</strong><small>{data.unpaid.length} sales · {due.length} due for follow-up</small></article>
      <article><span>Payment confirmation</span><strong>{automatic?pending.length:'Manual'}</strong><small>{automatic?'Reports to review; ambiguous claims do not change payments':'Record actual money received in Airtable'}</small></article>
      <article><span>Tracked sales fully paid</span><strong>{paid.length}</strong><small>Verified from the Airtable ledger</small></article>
      <article><span>Reminder routing</span><strong>{state.collector_enabled&&state.collector_verified_at?'Quo ready':'Setup needed'}</strong><small>{state.alerts_enabled?'Sundays · 9 PM Eastern':'Scheduled reminder disabled'}</small></article>
    </div>
    <div className={s.guide}><b>Payment evidence, not “done.”</b><p>{automatic?'Structured staff reports are checked against fresh balances; free-text claims and flagged sales require office review.':'Tony can reply in Quo for you to review manually. Incoming texts are not connected to this dashboard and never automatically mark a sale paid.'} Record the actual amount, payment date, method and receipt/check/transaction reference in Airtable Payment Receipts, or use the sale’s Record payment action here. Payments Received is an opening amount, not a running total: never repeat the same money in both. Fresh Airtable balances close fully paid items; partial payments leave the remainder due.</p></div>
    {sendConfirm?<div className={s.review}><h4>Send Tony’s collection list now?</h4><p>This sends one Quo text to {state.collector_name} at {state.collector_phone}, with customer names and amounts. No email is sent. This manual send is in addition to the weekly schedule; only one attempt is allowed today.</p><div className={s.buttons}><button disabled={busy} onClick={async()=>{await onAction({action:'collection_notify'});setSendConfirm(false);}}>Yes, text Tony</button><button disabled={busy} onClick={()=>setSendConfirm(false)}>Cancel</button></div></div>:null}
    <div className={s.columns}><div><h4>{automatic?'Tony’s reply inbox':'Manual collection workflow'}</h4>{!automatic?<><p className={s.muted}>Quo reply processing is off. Check Tony’s OPWP conversation, then update the correct Airtable sale with the actual payment evidence. Customer messaging remains approval-only.</p><h4>Reference the exact sale</h4>{data.unpaid.slice(0,12).map(v=><article className={s.reply} key={v.id}><div><b>{v.name}</b><span>{money(v.balanceCents)}</span></div><small>{v.date} · {collectionReference(v.id)}</small>{v.warnings?.length?<p>{v.warnings.join(' · ')}</p>:null}</article>)}</>:null}{automatic&&!replies.length?<p className={s.muted}>Replies from the verified staff phone will appear here. They are not added to customer lead intake.</p>:null}{replies.slice(0,12).map(r=><article className={s.reply} key={r.message_id}><div><b>{r.reference||'Needs sale match'}</b><span data-status={r.status}>{r.status.replaceAll('_',' ')}</span></div><small>{stamp(r.occurred_at)} · Quo {r.message_id}</small><p>{r.content}</p><small>{r.reason}</small>{r.status==='review'?<div className={s.buttons}><button disabled={busy} onClick={()=>setReview(r)}>Review evidence</button></div>:null}</article>)}</div>
      <div><h4>Reminder delivery</h4>{!alerts.length?<p className={s.muted}>No staff reminders sent yet.</p>:null}{alerts.map(a=><article className={s.delivery} key={a.id}><b>{a.channel==='quo'?'Tony · Quo SMS':'Owner · email'}</b><span>{a.delivery_status||a.status}</span><small>{a.alert_date} · {a.recipient}{a.segments?` · ${a.segments} SMS segments`:''}</small>{a.error?<p>{a.error}</p>:null}</article>)}{paid.length?<><h4>Verified paid in Airtable</h4>{paid.slice(0,10).map(i=><p className={s.paid} key={i.sale_id}><b>{i.customer_name}</b><span>{i.reference} · {stamp(i.resolved_at)}</span></p>)}</>:null}</div></div>
    {review?<div className={s.review} role="region" aria-label="Review Tony payment evidence"><div className={s.heading}><h4>Review collection evidence</h4><button type="button" disabled={busy} onClick={()=>setReview(null)}>Close review</button></div><blockquote>{review.content}</blockquote><p>{review.reason}</p><form onSubmit={submitReview}><div className={s.fields}>
      <label>Exact sale<select name="saleId" defaultValue={review.sale_id||''} required><option value="">Choose the correct sale</option>{data.sales.filter(v=>!v.cancelled&&(v.balanceCents||v.id===review.sale_id)).map(v=><option key={v.id} value={v.id}>{v.name} · {v.date} · {money(v.balanceCents)} due · {collectionReference(v.id)}</option>)}</select></label>
      <label>Money actually collected ($)<input name="amount" type="number" min="0.01" step="0.01" defaultValue={review.amount_cents?review.amount_cents/100:''} required/></label>
      <label>Payment date<input name="date" type="date" defaultValue={review.payment_date||''} required/></label>
      <label>Method<select name="method" defaultValue={review.payment_method||'Cash'}><option>Cash</option><option>Check</option><option>Venmo / Zelle / PayPal</option></select></label>
      <label>Receipt/check/transaction reference<input name="reference" defaultValue={review.payment_reference||''} maxLength={100} required/></label>
    </div><label className={s.check}><input name="confirmed" type="checkbox" required/>I reviewed the message and confirm this money was actually collected for this sale.</label><button disabled={busy}>Approve & save verified receipt</button></form><form className={s.dismiss} onSubmit={e=>{e.preventDefault();onAction({action:'collection_dismiss',messageId:review.message_id,reason:new FormData(e.currentTarget).get('reason')});}}><label>Or resolve without posting a payment<input name="reason" required maxLength={500} placeholder="Not a payment report; duplicate; updated in Airtable…"/></label><button disabled={busy}>Dismiss with review note</button></form><p className={s.muted}>Posting records a staff-reported receipt. It does not charge a card or prove that a check has cleared.</p></div>:null}
  </section>;
}
