'use client';
import {useEffect,useRef,useState} from 'react';
import FoodCustomerDialog,{invitationLabel} from '@/components/FoodCustomerDialog';
import FoodCustomerSearch from '@/components/FoodCustomerSearch';
import {foodStaffCustomerComplete} from '@/lib/food-customer-intake.mjs';
import s from './customer-hub.module.css';
const endpoint='/api/admin/dog-food/customers/';
const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(v)||0)/100);
const label=v=>String(v||'Not recorded').replaceAll('_',' ');
const initials=c=>(c.first_name?.[0]||'')+(c.last_name?.[0]||'');
const name=c=>[c.first_name,c.last_name].filter(Boolean).join(' ');
const paymentMethod=provider=>({stripe:'Stripe',cardpointe:'CardPointe',sng_verified:'Sweep & Go',staff_cash:'Cash',staff_check:'Check',staff_card:'Card',staff_venmo:'Venmo',staff_zelle:'Zelle',staff_paypal:'PayPal'})[provider]||label(provider);
const tabs=[['overview','Overview'],['sales','Sales & payments'],['plans','Plans'],['portal','Portal access'],['activity','Notes & activity']];
export default function CustomerHub(){
  const [search,setSearch]=useState(''),[status,setStatus]=useState('all'),[offset,setOffset]=useState(0),[records,setRecords]=useState([]),[hasMore,setHasMore]=useState(false),[selected,setSelected]=useState(''),[detail,setDetail]=useState(null),[dialog,setDialog]=useState(null),[version,setVersion]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[resultKey,setResultKey]=useState(''),[tab,setTab]=useState('overview'),[statusDialog,setStatusDialog]=useState(null);
  const profile=useRef(null),statusPending=useRef(false),linkPending=useRef(false);
  const [accountLink,setAccountLink]=useState(null);
  useEffect(()=>{const controller=new AbortController(),timer=setTimeout(async()=>{setLoading(true);try{const r=await fetch(endpoint+'?q='+encodeURIComponent(search)+'&offset='+offset+'&status='+status,{cache:'no-store',signal:controller.signal}),d=await r.json();if(!r.ok)throw Error(d.error||'Customer hub could not be loaded.');setRecords(d.customers);setHasMore(d.hasMore);setResultKey(search+'|'+status+'|'+offset);}catch(e){if(e.name!=='AbortError')setError(e.message);}finally{if(!controller.signal.aborted)setLoading(false);}},180);return()=>{clearTimeout(timer);controller.abort();};},[search,status,offset,version]);
  useEffect(()=>{if(!selected){setDetail(null);return;}const controller=new AbortController();setDetail(null);fetch(endpoint+'?id='+encodeURIComponent(selected),{cache:'no-store',signal:controller.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||'Customer record could not be loaded.');if(!controller.signal.aborted)setDetail(d.customers[0]||null);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[selected,version]);
  useEffect(()=>{if(detail)profile.current?.focus({preventScroll:true});},[detail]);
  function choose(c){if(accountLink?.payload||statusDialog?.payload){setError('Resolve the pending customer change before opening another profile.');return;}setError('');setNotice('');setSelected(c.id);setTab('overview');setStatusDialog(null);}
  async function post(body){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw Object.assign(Error(d.error||'The change could not be confirmed.'),{definitive:d.definitive===true});return d;}
  async function linkAccount(e){e.preventDefault();if(linkPending.current)return;linkPending.current=true;setBusy(true);setError('');const f=new FormData(e.currentTarget),selected=JSON.parse(f.get('account')),body=accountLink?.payload||{action:'link_portal_account',commandId:crypto.randomUUID(),customerId:detail.id,accountId:selected.id,expectedCustomerId:selected.customer_id,targetVersion:detail.version,reason:f.get('reason'),confirm:f.has('confirm')};setAccountLink({payload:body});try{const d=await post(body);setNotice(d.result.message);setAccountLink(null);setVersion(v=>v+1);}catch(e){if(e.definitive)setAccountLink(null);setError(e.message);}finally{linkPending.current=false;setBusy(false);}}
  async function invite(){setBusy(true);setError('');try{await post({action:'invite_customer',commandId:crypto.randomUUID(),customerId:detail.id,channels:['email'],confirm:true});setNotice('Portal email instructions processed. Review the email and text status below.');setVersion(v=>v+1);}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function changeStatus(e){e.preventDefault();if(statusPending.current)return;statusPending.current=true;setBusy(true);setError('');const body=statusDialog.payload||{action:'set_customer_status',commandId:crypto.randomUUID(),customerId:detail.id,expectedStatus:detail.status,statusVersion:detail.statusVersion,status:detail.status==='active'?'inactive':'active',reason:statusDialog.reason,confirm:true};setStatusDialog(d=>({...d,payload:body}));try{const d=await post(body);setNotice(detail.status==='active'?'Customer deactivated.':'Customer reactivated.');setStatusDialog(null);setVersion(v=>v+1);}catch(e){setError(e.message);}finally{statusPending.current=false;setBusy(false);}}
  const fresh=resultKey===search+'|'+status+'|'+offset,rows=fresh?records:[],waiting=loading||!fresh;
  const orders=detail?.orders||[],legacy=detail?.legacySales||[],total=(detail?.orderSummary?.total_cents||0)+legacy.reduce((n,o)=>n+(o.totalCents||0),0),balance=(detail?.orderSummary?.balance_cents||0)+legacy.reduce((n,o)=>n+(o.balanceCents||0),0);
  const primaryAddress=detail?.addresses?.find(address=>address.is_primary)||detail?.addresses?.[0];
  const profileComplete=Boolean(detail&&foodStaffCustomerComplete(detail,primaryAddress,detail.preferred_fulfillment));
  return <section className={s.hub}>
    {dialog&&<FoodCustomerDialog endpoint={endpoint} customer={dialog.customer} onClose={()=>setDialog(null)} onRefresh={()=>{setDialog(null);setDetail(null);setVersion(v=>v+1);setNotice('Reloading the customer record.');}} onSaved={async customer=>{setDialog(null);choose(customer);setVersion(value=>value+1);setNotice('Customer saved.');}}/>}
    {!selected&&<header className={s.heading}>
      <div><small>EXTREME DOG FUEL</small><h1>Customers</h1><p>Contact details, sales history and portal access.</p></div>
      <button className={s.primary} onClick={()=>setDialog({customer:null})}>+ Add customer</button>
    </header>}
    {error&&<p role="alert" className={s.error}>{error}</p>}
    {notice&&<div role="status" className={s.notice}><span>{notice}</span><button aria-label="Dismiss notification" onClick={()=>setNotice('')}>&times;</button></div>}
    {!selected&&<div className={s.toolbar}>
      <FoodCustomerSearch value={search} onChange={q=>{setSearch(q);setOffset(0);}} customers={rows} loading={waiting} onSelect={choose}/>
      <label className={s.filter}>Status<select value={status} onChange={e=>{setStatus(e.target.value);setOffset(0);}}><option value="all">All customers</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
    </div>}
    {selected?<div className={s.workspace}>
      <div className={s.back}><button disabled={Boolean(accountLink?.payload||statusDialog?.payload)} onClick={()=>{setSelected('');setStatusDialog(null);setNotice('');setError('');}}>&larr; All customers</button><a href="/admin/dog-food/record-sale/">Record a food sale</a></div>
      {!detail?<p role='status' className={s.empty}>Loading customer profile…</p>:<article ref={profile} tabIndex={-1} className={s.profile} aria-label={name(detail)+' customer profile'}>
        <header className={s.identity}><span className={s.avatar}>{initials(detail)}</span><div className={s.identityName}><small>CUSTOMER</small><h1>{name(detail)}</h1><div className={s.badges}><span className={detail.status==='active'?s.badge:s.inactive}>{detail.status==='active'?'Active customer':'Inactive customer'}</span><span className={s.badge}>{label(detail.customer_type)}</span>{!profileComplete&&<span className={s.inactive}>Details needed</span>}</div></div><div className={s.actions}><button disabled={detail.status!=='active'} onClick={()=>setDialog({customer:detail})}>{profileComplete?'Edit profile':'Complete profile'}</button><button disabled={busy} onClick={()=>setStatusDialog({reason:'',payload:null})}>{detail.status==='active'?'Deactivate client':'Reactivate client'}</button></div></header>
        {detail.status!=='active'&&<p className={s.statusNote}>This customer is inactive. New sales and portal sign-in are blocked. Existing orders, balances and delivery work remain available to the office.</p>}
        {statusDialog&&<form className={s.statusForm} onSubmit={changeStatus}><h4>{detail.status==='active'?'Deactivate this customer?':'Reactivate this customer?'}</h4><p>{detail.status==='active'?'This ends portal sessions, blocks new sales, cancels queued portal invitations and pauses native Stripe plans. Existing orders, deliveries, inventory reservations and balances stay in place. Review outstanding work separately.':'This restores new sales and portal sign-in using the existing password. Previous sessions stay signed out. Paused plans stay paused and no invitation is sent automatically.'}</p><p>Sweep & Go billing and plans must be managed in Sweep & Go.</p><label>Reason<textarea required maxLength={500} value={statusDialog.reason} disabled={Boolean(statusDialog.payload)} onChange={e=>setStatusDialog({...statusDialog,reason:e.target.value})}/></label><div className={s.actions}><button className={s.primary} disabled={busy}>{statusDialog.payload?'Retry same status change':detail.status==='active'?'Confirm deactivation':'Confirm reactivation'}</button><button type='button' disabled={busy} onClick={()=>{setStatusDialog(null);setVersion(v=>v+1);}}>Close and refresh</button></div></form>}
        <div className={s.stats}>
          <div><small>Recorded sales - {(detail.orderSummary?.count||0)+legacy.length}</small><strong>{money(total)}</strong></div>
          <div><small>Outstanding balance</small><strong>{money(balance)}</strong></div>
          <div><small>Portal access</small><strong className={s.textStat}>{detail.status!=='active'?'Inactive':detail.account_id?'Activated':'Awaiting activation'}</strong></div>
        </div>
        {(orders.length===100||legacy.some(o=>o.warnings?.length))&&<p className={s.statusNote}>History includes up to 100 native sales. Source records flagged for review may affect the displayed totals.</p>}
        <nav className={s.tabs} aria-label='Customer profile sections'>{tabs.map(([id,title])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}>{title}</button>)}</nav>
        {tab==='overview'&&<div className={s.cards}>
          <section className={s.card}>
            <h2>Contact</h2>
            <dl>
              <div><dt>Phone</dt><dd>{detail.phone?<a href={'tel:'+detail.phone}>{detail.phone}</a>:'Not recorded'}</dd></div>
              <div><dt>Email</dt><dd>{detail.email?<a href={'mailto:'+detail.email}>{detail.email}</a>:'Not recorded'}</dd></div>
              <div><dt>Customer type</dt><dd>{label(detail.customer_type)}</dd></div>
            </dl>
          </section>
          <section className={s.card}>
            <h2>Address & handoff</h2>
            {primaryAddress?<p className={s.address}>{primaryAddress.line1}<br/>{primaryAddress.city}, {primaryAddress.state} {primaryAddress.postal_code}</p>:<p>Address needed.</p>}
            <dl>
              <div><dt>Preference</dt><dd>{label(detail.preferred_fulfillment)}</dd></div>
              {detail.preferred_fulfillment!=='pickup'&&<div><dt>Drop-off</dt><dd>{primaryAddress?.placement_preference==='Other'?primaryAddress.placement_other:primaryAddress?.placement_preference||'Not recorded'}</dd></div>}
            </dl>
          </section>
          <section className={s.card}>
            <h2>Preferences & notes</h2>
            <dl><div><dt>Dogs</dt><dd>{detail.dog_count||'Not recorded'}</dd></div><div><dt>Frequency</dt><dd>{label(detail.service_frequency)}</dd></div></dl>
            <p className={s.notes}>{detail.notes||'No office notes.'}</p>
          </section>
          <section className={s.card}>
            <h2>Recent sales</h2>
            {!orders.length&&!legacy.length?<p>No sales recorded.</p>:<>
              {[
                ...orders.map(order=>({id:order.id,title:order.order_number,date:order.sale_date||order.created_at.slice(0,10),total:order.total_cents,balance:order.balance_cents})),
                ...legacy.map(sale=>({id:sale.id,title:sale.productName,date:sale.date,total:sale.totalCents,balance:sale.balanceCents}))
              ].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3).map(sale=><div key={sale.id} className={s.recentSale}><div><strong>{sale.title}</strong><small>{sale.date}</small></div><div><strong>{money(sale.total)}</strong><small>{sale.balance?money(sale.balance)+' due':'Paid'}</small></div></div>)}
              <button className={s.textButton} onClick={()=>setTab('sales')}>View sales & payments</button>
            </>}
          </section>
        </div>}
        {tab==='sales'&&<section className={s.card}><h4>Sales & payments</h4><p>Sales and payments recorded for this customer.</p>{!orders.length&&!legacy.length&&<p>No sales recorded yet.</p>}{orders.map(o=><article key={o.id} className={s.order}><div><strong>{o.order_number}</strong><small>{o.sale_date||o.created_at.slice(0,10)} · {label(o.fulfillment_method)} · {label(o.status)}</small>{o.items?.map(item=><p key={item.id}>{item.quantity} x {item.color} {item.formula||item.name}{item.weight?' ('+item.weight+' lb)':''}</p>)}<small>{label(o.source)} - Handoff: {label(o.handoffStatus||'unknown')}</small><small>{o.receiptMethods?.length?o.receiptMethods.map(paymentMethod).join(' / '):'No payment recorded'}</small>{o.sale_notes&&<p className={s.notes}>{o.sale_notes}</p>}</div><dl><div><dt>Total</dt><dd>{money(o.total_cents)}</dd></div><div><dt>Received</dt><dd>{money(o.received_cents)}</dd></div><div><dt>Balance</dt><dd>{money(o.balance_cents)}</dd></div></dl></article>)}{legacy.map(o=><article key={o.id} className={s.order}><div><strong>Imported sale · {o.date}</strong><small>{o.productName} · {o.quantity} bags · {o.fulfillment}</small>{o.warnings?.length>0&&<small>Source record needs review.</small>}</div><dl><div><dt>Total</dt><dd>{money(o.totalCents)}</dd></div><div><dt>Recorded receipts</dt><dd>{money(o.collectedCents)}</dd></div><div><dt>Balance</dt><dd>{money(o.balanceCents)}</dd></div></dl></article>)}</section>}
        {tab==='plans'&&<section className={s.card}><h4>Plans & subscriptions</h4><p>Reactivating a customer does not resume paused billing. Manage Sweep & Go billing in Sweep & Go.</p>{!detail.plans?.length&&!detail.legacyPlans?.length&&<p>No plans linked.</p>}{detail.plans?.map(p=><article key={p.id} className={s.order}><strong>{label(p.payment_provider)} plan</strong><span className={s.badge}>{label(p.status)}</span><p>Next delivery: {p.next_delivery_date||'Not set'}</p></article>)}{detail.legacyPlans?.map(p=><article key={p.id} className={s.order}><strong>Imported plan {p.number}</strong><span className={s.badge}>{p.status}</span><p>{p.frequency} · Next delivery: {p.next||'Not set'}</p></article>)}</section>}
        {tab==='portal'&&<section className={s.card}><h4>Customer portal access</h4><p>{detail.status!=='active'?'Portal access is blocked while this customer is inactive.':detail.account_id?'This customer has a verified login. Their password is private and stays linked to this profile.':'The customer verifies their email and chooses a password to access this same customer record.'}</p><button disabled={busy||!detail.email||!detail.revision||detail.status!=='active'} onClick={invite}>Send email invitation / access instructions</button>{!detail.email&&<p>No email is recorded. Staff sales remain available; add the customer?s own email before sending an invitation.</p>}{!detail.revision&&<p>Save the customer profile before sending access instructions.</p>}{!detail.account_id&&detail.portalLinkCandidates?.length>0&&<form onSubmit={linkAccount}><h4>Link an existing verified signup</h4><p>Only incomplete signups without customer history qualify. Verify the person using office evidence; selecting a name or matching email alone does not authorize linking.</p><label>Verified portal signup<select name="account" required disabled={Boolean(accountLink?.payload)}>{detail.portalLinkCandidates.map(a=><option key={a.id} value={JSON.stringify({id:a.id,customer_id:a.customer_id})}>{a.email} ? created {a.created_at}</option>)}</select></label><label>Identity verification evidence<textarea name="reason" required minLength={10} maxLength={2000} disabled={Boolean(accountLink?.payload)}/></label><label className={s.check}><input name="confirm" type="checkbox" required disabled={Boolean(accountLink?.payload)}/>I verified this exact account belongs to this established customer and reviewed both records.</label><button disabled={busy}>{accountLink?.payload?'Retry original account link':'Link verified account to this customer'}</button></form>}<h4 className={s.subhead}>Email & text history</h4>{detail.messages?.length?detail.messages.map(m=><div className={s.message} key={m.id}><strong>{m.channel==='sms'?'Text message':'Email'}</strong><span className={s.badge}>{invitationLabel(m.status)}</span><small>{m.created_at} · {m.detail||'Waiting for a configured provider.'}</small></div>):<p>No invitation has been sent. Existing contacts are never invited in bulk automatically.</p>}</section>}
        {tab==='activity'&&<div className={s.cards}><section className={s.card}><h4>Office notes</h4><p className={s.notes}>{detail.notes||'No office notes yet.'}</p><button disabled={detail.status!=='active'} onClick={()=>setDialog({customer:detail})}>Edit notes</button></section><section className={s.card}><h4>Customer activity</h4>{detail.activity?.length?detail.activity.map(a=><article className={s.activity} key={a.id}><strong>{a.action==='set_customer_status'?(a.to==='active'?'Customer reactivated':'Customer deactivated'):a.action==='create_customer'?'Customer created':a.action==='update_customer'?'Profile updated':'Portal instructions queued'}</strong><small>{a.created_at} · {a.actor}</small>{a.reason&&<p>{a.reason}</p>}</article>):<p>No profile changes recorded yet. Sales and plans are shown in their own sections.</p>}</section></div>}
      </article>}
    </div>:<div className={s.directory}>
      <div className={s.directoryHeading}><span role="status">{waiting?'Loading customers...':rows.length+' customers'+(hasMore?' on this page':'')}</span></div>
      <div className={s.tableWrap}><table className={s.customerTable}>
        <thead><tr><th>Customer</th><th>Phone & email</th><th>Status</th><th>Portal</th><th><span className={s.srOnly}>Open profile</span></th></tr></thead>
        <tbody>{rows.map(customer=><tr key={customer.id}>
          <td><button className={s.customerName} onClick={()=>choose(customer)}><span className={s.miniAvatar}>{initials(customer)}</span><strong>{name(customer)}</strong></button></td>
          <td className={s.contact}>{customer.phone?<a href={'tel:'+customer.phone}>{customer.phone}</a>:<span>Phone not recorded</span>}{customer.email?<a href={'mailto:'+customer.email}>{customer.email}</a>:<small>Email not recorded</small>}</td>
          <td><span className={customer.status==='active'?s.badge:s.inactive}>{customer.status==='active'?'Active':'Inactive'}</span></td>
          <td><span className={s.portalState}>{customer.account_id?'Activated':'Awaiting activation'}</span></td>
          <td><button aria-label={'Open '+name(customer)+' profile'} onClick={()=>choose(customer)}>Open profile &rarr;</button></td>
        </tr>)}</tbody>
      </table></div>
      {!waiting&&!rows.length&&<p className={s.empty}>No matching customers. Try another name or status filter.</p>}
      <footer className={s.paging}><button disabled={waiting||!offset} onClick={()=>setOffset(value=>Math.max(0,value-100))}>Previous</button><span>{rows.length?offset+1:0}&ndash;{offset+rows.length}</span><button disabled={waiting||!hasMore} onClick={()=>setOffset(value=>value+100)}>Next</button></footer>
    </div>}

  </section>;
}
