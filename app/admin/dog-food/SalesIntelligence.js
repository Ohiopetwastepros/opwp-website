'use client';
import {recordDestination} from '@/lib/admin-record-policy.mjs';
import {useState} from 'react';
import s from './sales-operations.module.css';
import x from './sales-intelligence.module.css';
import InventoryDashboard from './InventoryDashboard';
const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((v||0)/100);
const labels={awaiting_payment:'Awaiting payment',paid_unscheduled:'Paid · needs date',scheduled:'Scheduled',pickup_ready:'Pickup ready',on_way:'On the way',completed:'Completed',exception:'Needs attention',closed:'Cancelled / refunded'};
const text=v=>String(v||'').replaceAll('_',' ');
function Table({head,children}){return <div className={s.tableWrap}><table><thead><tr>{head.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;}
function Card({title,caption,children,action}){return <section className={s.card}><div className={s.cardHeading}><div>{caption&&<small>{caption}</small>}<h2>{title}</h2></div>{action}</div>{children}</section>;}
function KPIs({values}){return <div className={s.metrics}>{values.map(([title,value,caption])=><article key={title}><span>{title}</span><strong>{value??'Unconfigured'}</strong><small>{caption}</small></article>)}</div>;}
export function SalesFunnel({data,onNavigate,busy,onAction}) {
  const [stage,setStage]=useState('all'),[query,setQuery]=useState('');const v=data.intelligence;
  if(!v)return <p>Sales funnel is unavailable.</p>;
  const m=v.summary,rows=v.pipeline.filter(o=>(stage==='all'||o.stage===stage)&&[o.order_number,o.first_name,o.last_name,o.items].join(' ').toLowerCase().includes(query.toLowerCase()));
  return <>
    <div className={x.intro}><h2>Onboarding → payment → fulfillment → next order</h2><p>Every website account and order has a visible next step. Order stages count orders; onboarding counts customers. Historical manual sales remain in the sales ledger.</p></div>
    <KPIs values={[["Verified accounts",m.verifiedAccounts,'Email verified; credentials stay private'],['Saved profiles',m.completeProfiles,`${m.profileWithoutOrder} saved profiles without an order`],['Active monthly plans',m.activePlans,`${m.pastDuePlans} past due · ${m.pausedPlans} paused`],['Airtable needs sync',m.pendingProjections,`${m.failedProjections} posting failures`],['Notice exceptions',m.failedNotices,'Failed or uncertain acceptance requires review']]}/>
    <div className={x.stages}><button className={stage==='all'?x.active:''} onClick={()=>setStage('all')}><strong>{v.pipeline.length}</strong><span>All orders</span></button>{v.funnel.map(f=><button key={f.stage} className={stage===f.stage?x.active:''} onClick={()=>setStage(f.stage)}><strong>{f.count}</strong><span>{labels[f.stage]}</span></button>)}</div>
    <Card title="Order progress and next actions" caption="PAYMENT AND PHYSICAL FULFILLMENT ARE SEPARATE" action={<button onClick={()=>onNavigate('website')}>Open fulfillment controls</button>}>
      <div className={s.filters}><input aria-label="Search sales funnel" placeholder="Search customer, order or formula" value={query} onChange={e=>setQuery(e.target.value)} maxLength={200}/></div>
      <Table head={['Customer / order','Bags / payment','Fulfillment','Evidence / sync','Next step']}>
        {rows.slice(0,250).map(o=><tr key={o.id}><td><strong>{o.first_name} {o.last_name}</strong><small>{o.order_number} · {text(o.order_type)}</small></td><td>{o.items||'No lines'}<small>{money(o.total_cents)} · {text(o.status)}</small></td><td><span className={s.badge}>{labels[o.stage]}</span><small>{o.fulfillment_method==='pickup'?'Pickup by arrangement':o.technician_name||'Delivery technician pending'} · {o.scheduled_date||'Date unconfirmed'}</small></td><td><small>{o.fulfillment_method==='pickup'?text(o.pickup_status)||'Handoff pending':o.proof_recorded?'Private delivery proof recorded':'Proof pending'}</small><small>{o.syncState.last_error?'Posting needs review':o.syncState.revision===undefined?'Not queued':o.syncState.revision===o.syncState.synced_revision?'Airtable verified':'Airtable pending'}</small>{o.noticeStates.map((n,i)=><small key={i}>{text(n.template)}: {text(n.status)}{n.outcome?` · ${text(n.outcome)}`:''}</small>)}</td><td className={s.notes}>{o.automation_review||o.nextAction}</td></tr>)}
      </Table>{!rows.length&&<p className={s.empty}>No orders in this stage.</p>}{rows.length>250&&<p className={s.caption}>Showing the first 250 matching orders. Narrow the search to review more.</p>}
    </Card>
    <Card title="Website onboarding and shared customer review" caption="ALL SHARED OPWP CHANGES REQUIRE OFFICE REVIEW" action={<button onClick={()=>onNavigate('customers')}>Customer records</button>}>
      <Table head={['Customer / saved profile','Onboarding','Airtable','OPWP relationship / preference']}>
        {v.profiles.slice(0,250).map(p=><tr key={p.id}><td><strong>{p.name||'Profile incomplete'}</strong><details><summary>Saved contact and delivery profile</summary><p>{p.email}<br/>{p.phone}<br/>{p.address||'Address missing'}<br/>Bag placement: {p.placement||'Missing'}</p></details></td><td>{text(p.stage)}<small>{p.orderCount} order(s)</small></td><td>{text(p.syncState)}<small>{p.profileCompletedAt||'Profile not completed'}</small></td><td>{p.crmState==='linked_active'?`Linked active OPWP customer · ${p.currentRouteDays.join(', ')}`:text(p.crmState)}<small>Saved preference: {p.preferredFulfillment}</small>{p.customerReview?.status==='pending'&&<details><summary>Office review required</summary><form className={x.review} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);onAction({action:'customer_review',customerId:p.id,revision:p.customerReview.revision,relationship:f.get('relationship'),opwpRecordId:f.get('opwpRecordId'),confirm:true});}}><label>Relationship<select name="relationship" required defaultValue=""><option value="">Choose after reviewing</option><option value="food_only">Food-only customer</option><option value="linked">Existing OPWP customer</option></select></label><label>Actual active OPWP record<select name="opwpRecordId" defaultValue={p.customerReview.opwp_record_id||''}><option value="">Choose if linked</option>{v.crmOptions.map(c=><option key={c.id} value={c.id}>{c.name} · {c.address}</option>)}</select></label><p>Review contact/address changes in the customer record editor and route impact in Route planning. This records your review and checks the linked identity/address; it does not change CRM or billing.</p><a href={recordDestination('appcAWPBQB8GmOrcT','tblhi8MGUOsWNmd37','',p.name)}>Review OPWP customers</a><label className={x.confirm}><input type="checkbox" required/>I reviewed the shared profile and resolved changes in OPWP where required.</label><button disabled={busy}>Record office review</button></form></details>}</td></tr>)}
      </Table>{!v.profiles.length&&<p className={s.empty}>No verified website accounts yet.</p>}
      <p className={s.caption}>An address match suggests a review; it never merges customer identities or changes an OPWP route. Website profile changes keep existing order and plan addresses intact.</p>
    </Card>
    <Card title="Automation handoffs" caption="VISIBLE RELEASE GATES">
      <div className={x.handoffs}>{[['Website → Airtable',v.connections.posting?'Posting enabled':'Posting disabled'],['Paid order → confirmed date',v.connections.scheduling?'Scheduling enabled':'Scheduling disabled'],['Order events → customer notices',v.connections.email?'Dispatch enabled; review outcomes':'Email dispatch disabled'],['OPWP routes → delivery choices',v.connections.routeReady?`${v.connections.activeRouteCustomers} active customers · source ${v.connections.routeCapturedAt}`:'Current route source unavailable']].map(([a,b])=><div key={a}><strong>{a}</strong><span>{b}</span></div>)}</div>
      <p className={s.caption}>Enabled settings are not launch acceptance. Live payment/webhooks, actual inventory, email receipt and physical completion must be verified in the fulfillment controls.</p>
    </Card>
  </>;
}
export function SalesMetrics({data,busy,onAction,onNavigate}) {
  const v=data.intelligence;if(!v)return <p>Sales metrics are unavailable.</p>;
  return <>
    <InventoryDashboard data={data} busy={busy} onAction={onAction} onNavigate={onNavigate}/>
    <Card title="Food deliveries added to the actual day’s route" caption="BOTH SHARED STOPS AND FOOD-ONLY STOPS · TWO-MINUTE SERVICE ALLOWANCE" action={<a href="/admin/route-partner/">Route workspace</a>}>
      <Table head={['Date / technician','Orders / bags','Shared stops / new stops','Existing route minutes','Added food service','Combined route / review']}>
        {v.routeLoads.map(r=><tr key={r.date+':'+r.technicianId}><td><strong>{r.date}</strong><small>{r.technician}</small></td><td>{r.orders} / {r.bags}</td><td>{r.existingStops} / {r.foodOnlyStops}<small>{r.unmatchedStops} need actual route matching</small></td><td>{r.baseServiceMinutes==null?'Route required':`${r.baseServiceMinutes} service`}<small>{r.baseDriveMinutes==null?'Drive time missing':`${Math.round(r.baseDriveMinutes)} drive`}</small></td><td>{r.foodServiceMinutes==null?'Route/settings required':`${r.foodServiceMinutes} min`}</td><td>{r.fullRouteMinutes==null?'Full duration not verified':`${r.fullRouteMinutes} min`}<small>{r.reviewReason}</small></td></tr>)}
      </Table>{!v.routeLoads.length&&<p className={s.empty}>No confirmed upcoming food deliveries. Paid orders without dates remain visible in the sales funnel.</p>}
      <p className={s.caption}>Two minutes is the approved service allowance, separate from travel. New food-only stops require road insertion time. This view does not move scooping stops or grant spare capacity. Tony remains full-time; Craig’s days use confirmed availability.</p>
    </Card>
  </>;
}
