'use client';
import {useEffect,useRef,useState} from 'react';
import styles from './food-sales.module.css';
const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((cents||0)/100);
const blank=()=>({customerId:'',newCustomer:null,items:[],fulfillmentMethod:'pickup',fulfillmentStatus:'pending',billingProvider:'manual',amount:'0.00',paymentMethod:'cash',paymentReference:'',paymentReceivedConfirmed:false,handoffConfirmed:false,receivedBy:'',handoffNote:'',addressId:'',deliveryAddress:{line1:'',city:'',state:'OH',postalCode:''}});
async function request(url,body,method='POST') {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try {
    const r=await fetch(url,{method:body?method:'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error||'Request failed.'),{status:r.status,uncertain:data.uncertain,definitive:data.definitive});return data;
  }finally{clearTimeout(timer);}
}
export default function FoodSalesClient() {
  const [data,setData]=useState(null),[draft,setDraft]=useState(blank),[query,setQuery]=useState(''),[customer,setCustomer]=useState(null),[quote,setQuote]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(null),[tab,setTab]=useState('sale'),[login,setLogin]=useState({email:'',password:''}),[loaded,setLoaded]=useState(false),[recentAction,setRecentAction]=useState(null);
  const [setupToken,setSetupToken]=useState(''),[passwordSetup,setPasswordSetup]=useState({password:'',passwordConfirm:''});
  useEffect(()=>{const match=/^#setup=([a-f0-9]{64})$/.exec(window.location.hash);if(match){setSetupToken(match[1]);window.history.replaceState(null,'',window.location.pathname+window.location.search);}},[]);
  const member=useRef(null),searchVersion=useRef(0),notice=useRef(null);
  useEffect(()=>{if(message||error)notice.current?.scrollIntoView({block:'nearest'});},[message,error]);
  const set=(key,value)=>{setDraft(d=>({...d,[key]:value}));setQuote(null);};
  async function refresh(q='') {
    const d=await request('/api/food-sales/?q='+encodeURIComponent(q));setData(d);member.current=d.member.id;return d;
  }
  useEffect(()=>{refresh().catch(e=>{if(e.status!==401)setError(e.message);}).finally(()=>setLoaded(true));},[]);
  useEffect(()=>{
    if(!data?.member.id)return;
    const key='opwp-food-sales:'+data.member.id;
    try {
      const saved=JSON.parse(sessionStorage.getItem(key+':draft')||'null');if(saved){setDraft(saved.draft);setCustomer(saved.customer);}
      const ref=JSON.parse(localStorage.getItem(key+':pending')||'null');
      const payload=JSON.parse(sessionStorage.getItem(key+':payload')||'null');
      if(ref)setPending({...ref,payload});
    }catch{setError('This browser could not restore its draft. Check recent entries before starting another sale.');}
  },[data?.member.id]);
  useEffect(()=>{if(data?.member.id)try{sessionStorage.setItem('opwp-food-sales:'+data.member.id+':draft',JSON.stringify({draft,customer}));}catch{/* Saving is still server confirmed; no offline queue. */}},[draft,customer,data?.member.id]);
  useEffect(()=>{
    if(!data)return;const version=++searchVersion.current;
    const timer=setTimeout(()=>request('/api/food-sales/?q='+encodeURIComponent(query)).then(d=>{if(version===searchVersion.current)setData(d);}).catch(e=>setError(e.message)),300);
    return ()=>clearTimeout(timer);
  },[query]);
  function persist(payload) {
    const key='opwp-food-sales:'+member.current,ref={commandId:payload.commandId};
    // Store the exact retry payload before sending. If storage is unavailable,
    // do not send a mutation with an unrecoverable submission identity.
    sessionStorage.setItem(key+':payload',JSON.stringify(payload));localStorage.setItem(key+':pending',JSON.stringify(ref));setPending({...ref,payload});return ref;
  }
  function clearPending() {
    const key='opwp-food-sales:'+member.current;sessionStorage.removeItem(key+':payload');localStorage.removeItem(key+':pending');setPending(null);
  }
  async function confirmed(result) {
    clearPending();setMessage(result.orderNumber?`${result.orderNumber} saved. ${result.balanceCents!=null?money(result.balanceCents)+' remaining.':''}`:result.message||'Saved and confirmed.');
    setDraft(blank());setQuote(null);setCustomer(null);setRecentAction(null);await refresh();
  }
  async function submit(payload) {
    if(busy)return;setBusy(true);setError('');setMessage('');
    try {persist(payload);const d=await request('/api/food-sales/',payload);await confirmed(d.result);}
    catch(e){if(e.definitive){const ref={commandId:payload.commandId,rejected:true};localStorage.setItem('opwp-food-sales:'+member.current+':pending',JSON.stringify(ref));setPending({...ref,payload});}setError((e.definitive?'This attempt was rejected. ':'The save outcome is uncertain. ')+e.message+' Check this submission before starting another.');}
    finally{setBusy(false);}
  }
  async function checkPending() {
    setBusy(true);setError('');
    try{const d=await request('/api/food-sales/?submission='+pending.commandId);if(d.saved)await confirmed(d.result);else setMessage('No committed save is visible for this ID. Retry the exact submission, or send its ID to the office if this tab no longer has the payload.');}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function releaseRejected() {
    // A new ID is safe only after a definitive client-error response AND a
    // server status lookup shows no committed result. Uncertain requests stay locked.
    setBusy(true);try{const d=await request('/api/food-sales/?submission='+pending.commandId);if(d.saved)await confirmed(d.result);else if(pending.rejected){clearPending();setMessage('Rejected submission closed. Edit the draft and review the price again.');}else setError('Keep this ID until the office reconciles its outcome.');}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function saveSale(event) {
    event.preventDefault();if(!quote||pending)return;
    const amount=Number(draft.amount);if(!Number.isFinite(amount)||amount<0||!/^\d+(\.\d{1,2})?$/.test(draft.amount)){setError('Enter the actual amount received with up to two decimal places.');return;}
    const {amount:unused,...fields}=draft;
    await submit({...fields,action:'save',commandId:crypto.randomUUID(),quoteHash:quote.quoteHash,amountReceivedCents:Math.round(amount*100)});
  }
  async function signIn(event) {
    event.preventDefault();setBusy(true);setError('');
    try{await request('/api/food-sales/session/',login);setLogin({email:'',password:''});await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function setStaffPassword(event){event.preventDefault();setBusy(true);setError('');try{const d=await request('/api/food-sales/session/',{action:'set_password',token:setupToken,...passwordSetup});setPasswordSetup({password:'',passwordConfirm:''});setSetupToken('');setMessage(d.message);}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function signOut() {
    setBusy(true);try{await request('/api/food-sales/session/',{},'DELETE');sessionStorage.removeItem('opwp-food-sales:'+member.current+':draft');setData(null);setDraft(blank());setCustomer(null);setQuote(null);setPending(null);setMessage('Signed out.');}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const amountCents=Math.round(Number(draft.amount||0)*100),balance=quote?Math.max(0,quote.total-amountCents):null;
  return <div className={`opwp-field-shell ${styles.shell}`}>
    <header className={styles.header}><a href='/food-sales/' className={styles.brand}><span className={styles.mark}>OP</span><span>OHIO PET WASTE PROS<small>Extreme Dog Fuel · Staff sales</small></span></a>{data&&<button className={styles.quiet} onClick={signOut} disabled={busy}>Sign out</button>}</header>
    <div className={styles.content}>
      {!data?<section className={styles.login}><span className={styles.eyebrow}>YOUR INDIVIDUAL STAFF ACCESS</span><h1>Good food.<br/>One simple sale.</h1><p>Record food, money received and the handoff in one place.</p>{loaded&&(setupToken?<form onSubmit={setStaffPassword}><h2>Choose your password</h2><p>Use at least 12 characters, including one capital letter and one symbol. This link can be used once.</p><label>New password<input type='password' autoComplete='new-password' minLength={12} maxLength={256} required value={passwordSetup.password} onChange={e=>setPasswordSetup({...passwordSetup,password:e.target.value})}/></label><label>Confirm password<input type='password' autoComplete='new-password' minLength={12} maxLength={256} required value={passwordSetup.passwordConfirm} onChange={e=>setPasswordSetup({...passwordSetup,passwordConfirm:e.target.value})}/></label><button className={styles.primary} disabled={busy}>Set my password</button></form>:<form onSubmit={signIn}><label>Email<input type='email' autoComplete='username' required value={login.email} onChange={e=>setLogin({...login,email:e.target.value})}/></label><label>Password<input type='password' maxLength={256} autoComplete='current-password' required value={login.password} onChange={e=>setLogin({...login,password:e.target.value})}/></label><button className={styles.primary} disabled={busy}>Sign in securely</button></form>)}<small>Access is provided by the office. Your session expires after 30 minutes of inactivity.</small></section>:<>
      <div className={styles.intro}><div><span className={styles.eyebrow}>EXTREME DOG FUEL</span><h1>{tab==='sale'?'Record a sale':'Your recent entries'}</h1><p>Signed in as <strong>{data.member.name}</strong></p></div><span className={styles.live}><i/>Shared customer & stock records</span></div>
      <nav className={styles.tabs} aria-label='Food sales'><button aria-current={tab==='sale'?'page':undefined} onClick={()=>setTab('sale')}>New sale</button><button aria-current={tab==='recent'?'page':undefined} onClick={()=>setTab('recent')}>Recent entries <span>{data.recent.length}</span></button></nav>
      <div ref={notice}>{message&&<div className={styles.notice} role='status'>{message}</div>}{error&&<div className={styles.error} role='alert'>{error}</div>}</div>
      {(data.inventoryConfigured===false||data.recordingEnabled===false)&&<div className={styles.pending} role='status'><strong>New sales are waiting for inventory verification.</strong><p>The office needs to confirm usable bags, lot numbers and expiration dates before a new sale can be saved. You can still review prices and existing entries.</p></div>}
      {pending&&<section className={styles.pending} aria-label='Unconfirmed submission'><strong>Check this submission before another sale</strong><p>Its outcome is not yet confirmed on this device.</p><code>{pending.commandId}</code><div className={styles.actions}><button disabled={busy} onClick={checkPending}>Check save status</button>{pending.payload&&<button disabled={busy} onClick={()=>submit(pending.payload)}>Retry same submission</button>}{pending.rejected&&<button disabled={busy} onClick={releaseRejected}>Edit rejected draft</button>}</div></section>}
      {tab==='sale'?<form onSubmit={saveSale} className={styles.saleForm}>
        <fieldset disabled={busy||Boolean(pending)} className={styles.card}><legend><span>01</span>Customer</legend>
          {customer?<div className={styles.selected}><div><strong>{customer.first_name} {customer.last_name}</strong><small>{customer.email} · {customer.phone}</small></div><button type='button' onClick={()=>{setCustomer(null);set('customerId','');}}>Change</button></div>:<><label>Find a customer<input type='search' placeholder='Name, phone or email' value={query} onChange={e=>setQuery(e.target.value)}/></label>{data.customers.map(c=><button className={styles.customer} type='button' key={c.id} onClick={()=>{setCustomer(c);setDraft(d=>({...d,customerId:c.id,newCustomer:null,addressId:''}));setQuote(null);}}><strong>{c.first_name} {c.last_name}</strong><span>{c.email} · {c.phone}</span></button>)}{query.length>=2&&!data.customers.length&&<p>No matching customer found.</p>}<button type='button' className={styles.textButton} onClick={()=>setDraft(d=>({...d,customerId:'',newCustomer:{firstName:'',lastName:'',email:'',phone:''}}))}>+ Add a new customer</button></>}
          {draft.newCustomer&&<div className={styles.grid}>{[['firstName','First name','text'],['lastName','Last name','text'],['email','Email','email'],['phone','Phone','tel']].map(([key,label,type])=><label key={key}>{label}<input type={type} required value={draft.newCustomer[key]} onChange={e=>set('newCustomer',{...draft.newCustomer,[key]:e.target.value})}/></label>)}<small>The shared customer account requires an email and phone.</small></div>}
        </fieldset>
        <fieldset disabled={busy||Boolean(pending)} className={styles.card}><legend><span>02</span>Food & quantities</legend><div className={styles.products}>{data.products.map(p=>{const selected=draft.items.find(i=>i.productId===p.id);return <label key={p.id} className={styles.product}><img src={'/assets/edf/'+p.formula_code+'.webp'} alt='' width='36' height='55'/><span><strong>{p.color} · {p.formula_code}</strong><small>{p.name} · {p.bag_weight_lb} lb</small><b>{money(p.retail_price_cents)} / bag, before tax</b></span><input aria-label={p.color+' '+p.formula_code+' quantity'} inputMode='numeric' type='number' min='0' max='100' value={selected?.quantity||0} onChange={e=>{const quantity=Number(e.target.value);set('items',[...draft.items.filter(i=>i.productId!==p.id),...(quantity>0?[{productId:p.id,quantity}]:[])]);}}/></label>;})}</div><p className={styles.hint}>Catalog prices. Lucas County tax is calculated in the confirmed total.</p></fieldset>
        <fieldset disabled={busy||Boolean(pending)} className={styles.card}><legend><span>03</span>Pickup or delivery</legend><div className={styles.grid}><label>Handoff method<select value={draft.fulfillmentMethod} onChange={e=>set('fulfillmentMethod',e.target.value)}><option value='pickup'>Pickup</option><option value='delivery'>Delivery</option></select></label><label>Handoff status<select value={draft.fulfillmentStatus} onChange={e=>set('fulfillmentStatus',e.target.value)}><option value='pending'>Pending</option><option value='completed'>Completed now</option></select></label></div>
          {draft.fulfillmentMethod==='delivery'&&<><label>Customer address<select value={draft.addressId} onChange={e=>set('addressId',e.target.value)}><option value=''>Use primary address, or enter one below</option>{data.addresses.filter(a=>a.customer_id===draft.customerId).map(a=><option key={a.id} value={a.id}>{a.line1}, {a.city} {a.postal_code}</option>)}</select></label>{!draft.addressId&&<div className={styles.grid}>{[['line1','Street address'],['city','City'],['postalCode','Ohio ZIP']].map(([key,label])=><label key={key}>{label}<input value={draft.deliveryAddress[key]} onChange={e=>set('deliveryAddress',{...draft.deliveryAddress,[key]:e.target.value})}/></label>)}</div>}</>}
          {draft.fulfillmentStatus==='completed'&&<><label>Received by<input required value={draft.receivedBy} onChange={e=>set('receivedBy',e.target.value)}/></label><label className={styles.check}><input type='checkbox' required checked={draft.handoffConfirmed} onChange={e=>set('handoffConfirmed',e.target.checked)}/>I confirm the bags were physically handed over.</label></>}
        </fieldset>
        <fieldset disabled={busy||Boolean(pending)} className={styles.card}><legend><span>04</span>Money actually received</legend><div className={styles.grid}><label>Amount received today ($)<input type='text' inputMode='decimal' required value={draft.amount} onChange={e=>setDraft(d=>({...d,amount:e.target.value}))}/></label><label>Payment method<select value={draft.paymentMethod} onChange={e=>set('paymentMethod',e.target.value)}><option value='cash'>Cash</option><option value='check'>Check</option><option value='venmo'>Venmo</option></select></label></div><p className={styles.hint}>Enter $0 for an unpaid sale. Choosing a method does not charge or collect money.</p>{draft.paymentMethod!=='cash'&&<label>Check number / Venmo reference<input required={amountCents>0} value={draft.paymentReference} onChange={e=>set('paymentReference',e.target.value)}/></label>}{amountCents>0&&<label className={styles.check}><input type='checkbox' required checked={draft.paymentReceivedConfirmed} onChange={e=>set('paymentReceivedConfirmed',e.target.checked)}/>I confirm this amount was actually received.</label>}<label>Who will collect any remaining balance?<select value={draft.billingProvider} onChange={e=>set('billingProvider',e.target.value)}><option value='manual'>Office / manual collection</option><option value='sweep_and_go'>Existing Sweep & Go billing</option></select></label></fieldset>
        <section className={styles.summary}><div><span className={styles.eyebrow}>REVIEW BEFORE SAVING</span><h2>{quote?money(quote.total):'Confirm your total'}</h2><p>{quote?`${money(quote.subtotal)} food + ${money(quote.tax)} tax`:'Review the current price after choosing your bags.'}</p></div>{quote&&<dl><div><dt>Received</dt><dd>{money(amountCents)}</dd></div><div><dt>Remaining balance</dt><dd>{money(balance)}</dd></div></dl>}<button type='button' disabled={busy||Boolean(pending)||!draft.items.length} onClick={async()=>{setBusy(true);setError('');try{setQuote((await request('/api/food-sales/',{action:'quote',items:draft.items})).result);}catch(e){setError(e.message);}finally{setBusy(false);}}}>Review current price</button><button className={styles.primary} disabled={busy||Boolean(pending)||!quote||data.inventoryConfigured===false||data.recordingEnabled===false||amountCents>quote.total||!draft.customerId&&!draft.newCustomer}>Save sale · {quote?money(quote.total):'review first'}</button><small>{pending?'Submission awaiting confirmation.':'Unsaved draft · Stock is reserved only when the save is confirmed.'}</small></section>
      </form>:<section className={styles.recent}>{data.recent.length?data.recent.map(o=><article key={o.id} className={styles.card}><div className={styles.recentHead}><div><strong>{o.customerName}</strong><small>{o.orderNumber}</small></div><strong>{money(o.totalCents)}</strong></div><div className={styles.badges}><span>{o.paymentStatus==='paid'?'Paid':o.paymentStatus==='partial'?'Partially paid':o.paymentStatus==='refunded'?'Refund recorded':'Unpaid'}</span><span>{o.fulfillmentMethod} · {o.fulfillmentStatus}</span></div><p>{money(o.receivedCents)} received · <strong>{money(o.balanceCents)} remaining</strong></p><div className={styles.actions}>{o.balanceCents>0&&<button onClick={()=>setRecentAction({kind:'receipt',order:o,amount:'',method:'cash',reference:'',confirmed:false})}>Add receipt</button>}{o.fulfillmentStatus==='pending'&&<button onClick={()=>setRecentAction({kind:'handoff',order:o,receivedBy:'',confirmed:false})}>Record handoff</button>}<button onClick={()=>setRecentAction({kind:'correction',order:o,reason:''})}>Request correction</button></div></article>):<div className={styles.card}><h2>No entries yet</h2><p>Your confirmed sales will appear here.</p></div>}
        {recentAction&&<form className={styles.card} onSubmit={e=>{e.preventDefault();const a=recentAction;submit({action:a.kind,orderId:a.order.id,commandId:crypto.randomUUID(),...(a.kind==='receipt'?{amountReceivedCents:Math.round(Number(a.amount)*100),paymentMethod:a.method,paymentReference:a.reference,paymentReceivedConfirmed:a.confirmed}:a.kind==='handoff'?{receivedBy:a.receivedBy,handoffConfirmed:a.confirmed}:{reason:a.reason})});}}><h2>{recentAction.kind==='receipt'?'Add actual receipt':recentAction.kind==='handoff'?'Confirm physical handoff':'Office correction request'}</h2><p>{recentAction.order.orderNumber}</p>{recentAction.kind==='receipt'?<><label>Amount received ($)<input inputMode='decimal' required value={recentAction.amount} onChange={e=>setRecentAction({...recentAction,amount:e.target.value})}/></label><label>Method<select value={recentAction.method} onChange={e=>setRecentAction({...recentAction,method:e.target.value})}>{['cash','check','venmo'].map(v=><option key={v} value={v}>{v}</option>)}</select></label>{recentAction.method!=='cash'&&<label>Reference<input required value={recentAction.reference} onChange={e=>setRecentAction({...recentAction,reference:e.target.value})}/></label>}</>:recentAction.kind==='handoff'?<label>Received by<input required value={recentAction.receivedBy} onChange={e=>setRecentAction({...recentAction,receivedBy:e.target.value})}/></label>:<label>What needs correcting?<textarea required maxLength={1000} value={recentAction.reason} onChange={e=>setRecentAction({...recentAction,reason:e.target.value})}/></label>}{recentAction.kind!=='correction'&&<label className={styles.check}><input type='checkbox' required checked={recentAction.confirmed} onChange={e=>setRecentAction({...recentAction,confirmed:e.target.checked})}/>I confirm this {recentAction.kind==='receipt'?'money was actually received':'physical handoff happened'}.</label>}<div className={styles.actions}><button className={styles.primary} disabled={busy||Boolean(pending)}>Save confirmation</button><button type='button' onClick={()=>setRecentAction(null)}>Cancel</button></div></form>}
      </section>}
      </>}
      {!data&&<div ref={notice}>{message&&<div className={styles.notice} role='status'>{message}</div>}{error&&<div className={styles.error} role='alert'>{error}</div>}</div>}
      <footer className={styles.footer}>Ohio Pet Waste Pros · Food sales workspace<br/>Questions or corrections? Contact the office.</footer>
    </div>
  </div>;
}
