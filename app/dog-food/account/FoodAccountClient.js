'use client';
import { useEffect, useRef, useState } from 'react';
import TurnstileWidget from '@/components/TurnstileWidget';
import AccountOverview, { AccountBrand, AccountIcon, AccountNavigation } from './AccountOverview';
import RepeatOrderReview from './RepeatOrderReview';
import OrderCheckout from './OrderCheckout';
import ProductShop from './ProductShop';
import MonthlyPlans from './MonthlyPlans';
import { foodFinderDraft, foodOverview, foodReorder } from '@/lib/dog-food-overview.mjs';
import DeliveryProfile from './DeliveryProfile';
import PasswordFields from './PasswordFields';
import { foodPasswordValid } from '@/lib/dog-food-password.mjs';
import styles from './account.module.css';

const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0) / 100);
const date = s => s ? new Date(`${s.slice(0,10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Awaiting confirmation';
const label = s => String(s || '').replaceAll('_', ' ');
const blankProfile = { firstName:'',lastName:'',phone:'',address:'',city:'',state:'OH',zip:'',placement:'',placementOther:'',fulfillmentMethod:'delivery',dogCount:'',frequency:'' };
export default function FoodAccountClient() {
  const [data,setData] = useState(null), [requestedTab,setTab] = useState('home'), [authMode,setAuthMode] = useState('login');
  const tab=data?.authenticated&&data.profileRequired?'profile':requestedTab;
  const [email,setEmail] = useState(''), [linkToken,setLinkToken] = useState('');
  const [verification,setVerification] = useState(''), [reset,setReset] = useState(0), [busy,setBusy] = useState(false), [notice,setNotice] = useState(''), [error,setError] = useState('');
  const [profile,setProfile] = useState(blankProfile), [quantities,setQuantities] = useState({}), [plan,setPlan] = useState('on_demand');
  const [deliverySpeed,setDeliverySpeed] = useState('route_day');
  const [fulfillmentMethod,setFulfillmentMethod]=useState('delivery'),[deliveryChoices,setDeliveryChoices]=useState(null),[routeWeekday,setRouteWeekday]=useState(null),[tonyDate,setTonyDate]=useState(''),[routesLoading,setRoutesLoading]=useState(false);
  const [cadence,setCadence] = useState('service_week'), [week,setWeek] = useState(4), [monthDay,setMonthDay] = useState(15), [consent,setConsent] = useState(false), [commandId,setCommandId] = useState('');
  const [confirmation,setConfirmation] = useState(null);
  const [recommendationDraft,setRecommendationDraft] = useState(false);
  const [checkoutMode,setCheckoutMode]=useState(false),[cartLoaded,setCartLoaded]=useState(false);
  const [repeatReview,setRepeatReview] = useState(false), [reorderInfo,setReorderInfo] = useState({missing:[],priceChanged:false});
  const [returnToOrder,setReturnToOrder] = useState(false);
  const [focusedOrderId,setFocusedOrderId] = useState('');
  function navigate(id) { setFocusedOrderId('');if(id==='order'){setCheckoutMode(false);setRepeatReview(false);} if(data?.profileRequired){setNotice('Complete and save your profile to continue.');if(id==='order')setReturnToOrder(true);} setTab(id); }
  function viewOrder(id) { setFocusedOrderId(id); setTab('orders'); }
  const dialogRef = useRef(null);
  const headingRef = useRef(null);
  useEffect(()=>{
    if(tab!=='order'||!data?.authenticated||data.profileRequired)return;
    let cancelled=false;setRoutesLoading(true);
    fetch('/api/dog-food/account/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delivery_choices'})}).then(async r=>{const v=await r.json();if(!r.ok)throw new Error(v.error);return v.deliveryChoices;}).then(choices=>{
      if(cancelled)return;setDeliveryChoices(choices);setRouteWeekday(choices.days?.[0]?.weekday??null);setTonyDate('');
    }).catch(()=>{if(!cancelled)setDeliveryChoices({status:'unavailable',days:[],tonyDates:[],deliveryAvailable:false,message:'Current delivery choices could not be checked. Choose pickup or try again.'});}).finally(()=>{if(!cancelled)setRoutesLoading(false);});
    return()=>{cancelled=true;};
  },[tab,plan,data?.addresses?.[0]?.id,data?.authenticated,data?.profileRequired]);
  useEffect(() => {
    if (!data?.authenticated) return;
    window.scrollTo({top:0,behavior:'instant'});
    headingRef.current?.focus({preventScroll:true});
  }, [tab,repeatReview,checkoutMode,focusedOrderId,data?.authenticated]);
  useEffect(() => {
    if (!confirmation) return;
    const prior = document.activeElement, dialog = dialogRef.current;
    dialog?.querySelector('button')?.focus();
    function keyboard(event) {
      if (event.key === 'Escape' && !busy) { setConfirmation(null); return; }
      if (event.key !== 'Tab') return;
      const buttons = [...dialog.querySelectorAll('button:not(:disabled)')];
      if (!buttons.length) { event.preventDefault(); return; }
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); prior?.focus(); };
  }, [confirmation, busy]);
  async function reload() {
    const response = await fetch('/api/dog-food/session/', { cache:'no-store' }), result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to load your account.');
    setData(result);
    if (result.authenticated) {
      const c = result.customer, a = result.addresses[0];
      setProfile({ firstName:c.first_name||'',lastName:c.last_name||'',phone:c.phone||'',address:a?.line1 || '',city:a?.city || '',state:a?.state || 'OH',zip:a?.postal_code || '',placement:a?.placement_preference || '',placementOther:a?.placement_other || '',fulfillmentMethod:result.preferredFulfillment||'delivery',dogCount:result.foodPreferences?.dog_count||'',frequency:result.foodPreferences?.service_frequency||'' });
      setFulfillmentMethod(result.preferredFulfillment||'delivery');if(result.preferredFulfillment==='pickup'){setCadence('fixed_day');setDeliverySpeed('route_day');}setDeliveryChoices(result.deliveryChoices);
      if(result.profileRequired)setTab('profile');
    }
    return result;
  }
  useEffect(() => {
    setCommandId(crypto.randomUUID());
    if (new URLSearchParams(window.location.search).get('start') === 'signup') setAuthMode('signup');
    let hasDraft = false;
    try {
      const draft = JSON.parse(localStorage.getItem('opwp-food-recommendation') || 'null');
      const draftQuantities = foodFinderDraft(draft,window.location.search);
      const savedCart=JSON.parse(localStorage.getItem('opwp-food-cart')||'null');
      const restored=draftQuantities||foodFinderDraft(savedCart,'?from=finder');
      if (restored) {
        setQuantities(restored);
        hasDraft = true; setRecommendationDraft(true); setNotice(draftQuantities?'Your recommended formulas are saved. Sign in to review quantities and fulfillment.':'Your cart is saved. Sign in to review your order.');
        const url = new URL(window.location.href); url.searchParams.delete('from');
        window.history.replaceState(null,'',`${url.pathname}${url.search}${url.hash}`);
      }
    } catch { /* Cart-only local storage is optional and never establishes identity or price. */ }
    setCartLoaded(true);
    const fragment = new URLSearchParams(window.location.hash.slice(1)), token = fragment.get('verify') || fragment.get('reset');
    if (token) { setLinkToken(token); setAuthMode('redeem'); window.history.replaceState(null,'','/dog-food/account/'); }
    reload().then(result => {
      if (hasDraft && result.authenticated) {
        const c = result.customer;
        setTab(result.profileRequired ? 'profile' : 'order');
        setNotice('Your recommended formulas are ready. Review quantities and choose one-time or monthly delivery.');
      }
    }).catch(e => setError(e.message));
  }, []);
  useEffect(()=>{if(!cartLoaded)return;try{localStorage.setItem('opwp-food-cart',JSON.stringify({items:Object.entries(quantities).filter(([,q])=>Number.isInteger(q)&&q>0&&q<=10).map(([productId,quantity])=>({productId,quantity})),expiresAt:Date.now()+86400000}));}catch{}},[quantities,cartLoaded]);
  async function api(path, body) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(path, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) }), result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Please try again.');
      if (result.checkoutUrl) {
        const u = new URL(result.checkoutUrl);
        if (u.protocol !== 'https:' || u.hostname !== 'checkout.stripe.com') throw new Error('Secure checkout returned an unexpected address.');
        if (body.action === 'order') {
          try { localStorage.removeItem('opwp-food-recommendation');localStorage.removeItem('opwp-food-cart'); } catch { /* Optional cart storage. */ }
        }
        window.location.assign(u.href); return result;
      }
      setNotice(result.message || 'Saved.'); const portal = await reload(); return { ...result, portal };
    } catch(e) { setError(e.message); return null; } finally { setBusy(false); }
  }
  async function authenticate(event) {
    event.preventDefault();
    const form=event.currentTarget, values=new FormData(form);
    const password=String(values.get('password')||''), passwordConfirm=String(values.get('passwordConfirm')||'');
    if(authMode==='redeem'&&!foodPasswordValid(password)){setError('Use at least 8 characters, including one capital letter and one special character.');return;}
    if(authMode==='redeem'&&password!==passwordConfirm){setError('Both passwords must match.');return;}
    const result = await api('/api/dog-food/session/', { action:authMode,email:String(values.get('email')||''),password,passwordConfirm,token:linkToken,turnstileToken:verification });
    if(result){for(const name of ['password','passwordConfirm']){const field=form.elements.namedItem(name);if(field)field.value='';}}
    setReset(n => n + 1); setVerification('');
    if (result?.passwordChangeRequired) { setLinkToken(result.setupToken); setAuthMode('redeem'); }
    else if (result && ['login','redeem'].includes(authMode)) {
      setLinkToken(''); setAuthMode('login');
      setTab(result.portal?.profileRequired?'profile':recommendationDraft?'order':'home');
    }
    else if (result && authMode === 'signup') { setAuthMode('login'); setNotice('Check your email for a one-use temporary password. It expires in 30 minutes. Sign in here to choose your own password.'); }
  }
  function reorder(order) {
    const review = foodReorder(order,data.products);
    setQuantities(review.quantities); setReorderInfo(review); setRepeatReview(true);setCheckoutMode(true);
    setCadence(review.cadence); setWeek(review.serviceWeek); setMonthDay(review.monthDay);
    setPlan('on_demand'); setDeliverySpeed('route_day'); setConsent(false); setCommandId(crypto.randomUUID()); setTab('order'); setNotice(''); setError('');
    setFulfillmentMethod(order.fulfillment_method||data.preferredFulfillment||'delivery');
  }
  const items = (data?.products || []).filter(p => Number(quantities[p.id]) > 0);
  const accountView = foodOverview(data || {});
  const invalidQuantity = items.some(p=>!Number.isInteger(quantities[p.id]) || quantities[p.id] > 10) || items.reduce((n,p)=>n+quantities[p.id],0)>10;
  const hasMonthlyPlan = Boolean(data?.customer?.sng_client_id || data?.subscriptions?.some(s=>['active','paused','past_due'].includes(s.status)));
  function changeQuantity(id,quantity) { setQuantities(q=>({...q,[id]:quantity})); setCommandId(crypto.randomUUID()); }
  function summary(s) { return s.delivery_cadence === 'service_week' ? `Week ${s.service_week || s.requested_service_week || 'to confirm'} · same day as service` : `Day ${s.billing_anchor_day || s.requested_month_day || 'to confirm'} each month (last day in shorter months)`; }
  return <div className={`opwp-food-account-shell ${styles.page} ${data?.authenticated ? styles.authenticated : ''}`}>
    {data?.authenticated ? <AccountNavigation tab={tab} setTab={navigate} busy={busy} customer={data.customer} logout={() => api('/api/dog-food/session/',{action:'logout'})}/> : <header className={styles.header}><AccountBrand/><a href='/dog-food/'>Explore the food <AccountIcon name='arrow'/></a></header>}
    <div className={styles.workspace}>
      {data?.authenticated && <div className={styles.topbar}><span>My dog food <span>/</span> {({home:'Overview',order:'Order food',orders:'Order history',plans:'Monthly delivery',profile:'Delivery profile'})[tab]}</span><a href='/dog-food/#order-tool'>Food finder <AccountIcon name='arrow'/></a></div>}
    <div className={styles.container}>
      {notice && <div className={styles.notice} role='status'><span>{notice}</span><button type='button' aria-label='Dismiss notification' onClick={() => setNotice('')}>×</button></div>}{error && !(data?.authenticated&&tab==='profile') && <div className={styles.error} role='alert'>{error}</div>}
      {!data ? <div className={styles.card}><h1>My dog food</h1><p>{error ? 'Your account could not be loaded.' : 'Loading your account…'}</p>{error && <button onClick={() => reload().catch(e => setError(e.message))}>Try again</button>}</div> : !data.authenticated ? <section className={styles.loginLayout}>
        <div className={styles.welcome}><span className={styles.eyebrow}>Good food. one less errand.</span><h1>Their favorite fuel.<br/><em>Your kind of easy.</em></h1><p>Full bowls and fewer bag runs. Your dog food, delivery and monthly plan, together in one simple place.</p><div className={styles.bagStage}><div className={styles.bags}>{data.products.map(p => <img key={p.id} src={`/assets/edf/${p.formula_code}.webp`} width='130' height='200' alt={`${p.name}, ${p.bag_weight_lb} lb bag`}/>)}</div><span className={styles.stageCaption}>Extreme dog fuel <span>Delivered by your local team</span></span></div><div className={styles.welcomeBenefits}><span><AccountIcon name='check'/>Free route-day delivery</span><span><AccountIcon name='check'/>One-time or monthly</span></div></div>
        <form key={authMode} className={`${styles.card} ${styles.authCard}`} onSubmit={authenticate}><span className={styles.loginIcon}><AccountIcon name='lock'/></span><span className={styles.eyebrow}>Your dog food account</span><h2>{authMode === 'signup' ? 'Create your account' : authMode === 'forgot' ? 'Reset your password' : authMode === 'redeem' ? 'Choose your password' : 'Welcome back'}</h2><p className={styles.muted}>{authMode === 'signup' ? 'We’ll email a one-use temporary password. Use the email on your existing dog-food orders to link your profile. You’ll choose your own password after signing in.' : authMode === 'forgot' ? 'Enter your account email for a secure reset link.' : authMode === 'redeem' ? 'Use at least 8 characters, one capital letter and one special character. Type it twice to confirm.' : 'Sign in to order, track deliveries and manage your monthly plan.'}</p>
          {authMode !== 'redeem' && <label>Email<input name='email' type='email' autoComplete='email' required maxLength={254} defaultValue={email} onChange={e => setEmail(e.target.value)} /></label>}
          {['login','redeem'].includes(authMode) && <PasswordFields creating={authMode==='redeem'}/> }
          <TurnstileWidget action='dog_food_account' onToken={setVerification} resetKey={reset} /><button className={styles.primary} disabled={busy || !verification}>{busy ? 'Please wait…' : authMode === 'signup' ? 'Send verification email' : authMode === 'forgot' ? 'Send reset link' : authMode === 'redeem' ? 'Save password & sign in' : 'Sign in'}</button>
          <div className={styles.authLinks}><button type='button' onClick={() => {setAuthMode(authMode === 'login' ? 'signup' : 'login');setError('');setNotice('');}}>{authMode === 'login' ? 'Create an account' : 'Back to sign in'}</button>{authMode === 'login' && <button type='button' onClick={() => setAuthMode('forgot')}>Forgot password?</button>}</div><p className={styles.authFine}>Having trouble? <a href='tel:+14192622371'>419-262-2371</a>. Sweep & Go credentials do not sign you into this portal.</p>
        </form>
      </section> : <>
        <div className={styles.heading}><div><span className={styles.eyebrow}>{tab === 'home' ? 'THE GOOD-FOOD ROUTINE' : 'YOUR DOG FOOD ACCOUNT'}</span><h1 ref={headingRef} tabIndex={-1}>{tab === 'home' ? `Hi, ${data.customer.first_name || 'there'}.` : ({order:repeatReview ? 'Reorder their food.' : checkoutMode?'Review your order.':'Shop dog food.',orders:'Orders & deliveries.',plans:'Your monthly plan.',profile:'Your account.'})[tab]}</h1><p>{({home:'A full bowl starts here. Keep their routine simple.',order:repeatReview ? 'Review your bags, delivery preference and current total.' : 'Pick their favorites. We handle the bag run.',orders:'Follow deliveries and reorder their favorites.',plans:'Your food routine, with changes reviewed by the office.',profile:'Your contact details and preferences, saved for next time.'})[tab]}</p></div><button className={styles.primary} onClick={() => {if(tab==='home' && accountView.repeatOrder && !accountView.nextOrder)reorder(accountView.repeatOrder);else{setRepeatReview(false);navigate('order');}}}>{tab==='order' ? 'Browse food' : tab==='home' && accountView.repeatOrder && !accountView.nextOrder ? 'Buy again' : 'Order food'} <AccountIcon name='arrow'/></button></div>
        {tab === 'home' && <AccountOverview data={data} setTab={navigate} viewOrder={viewOrder} reorder={reorder} setPlan={setPlan} busy={busy} api={api} setConfirmation={setConfirmation}/>}
        {tab === 'order' && <OrderCheckout shopping={!repeatReview&&!checkoutMode} onReview={()=>setCheckoutMode(true)} orderingAvailable={data.deliveryPolicy?.orderingAvailable} onQuantity={changeQuantity} fulfillmentMethod={fulfillmentMethod} onFulfillment={value=>{setFulfillmentMethod(value);setDeliverySpeed('route_day');setTonyDate('');if(value==='pickup')setCadence('fixed_day');else setCadence('service_week');setConsent(false);setCommandId(crypto.randomUUID());}} deliveryChoices={deliveryChoices} routesLoading={routesLoading} routeWeekday={routeWeekday} onRouteWeekday={value=>{setRouteWeekday(value);setTonyDate('');setCommandId(crypto.randomUUID());}} tonyDate={tonyDate} onTonyDate={value=>{setTonyDate(value);setRouteWeekday(null);setCommandId(crypto.randomUUID());}} items={items} quantities={quantities} plan={plan} onPlan={value=>{setPlan(value);setCadence(fulfillmentMethod==='pickup'?'fixed_day':'service_week');setDeliverySpeed('route_day');setConsent(false);setCommandId(crypto.randomUUID());}} deliverySpeed={deliverySpeed} onDelivery={value=>{setDeliverySpeed(value);if(value!=='route_day'){setTonyDate('');if(routeWeekday==null)setRouteWeekday(deliveryChoices?.days?.[0]?.weekday??null);}setCommandId(crypto.randomUUID());}} cadence={cadence} onCadence={value=>{setCadence(value);setCommandId(crypto.randomUUID());}} week={week} onWeek={value=>{setWeek(value);setCommandId(crypto.randomUUID());}} monthDay={monthDay} onMonthDay={value=>{setMonthDay(value);setCommandId(crypto.randomUUID());}} consent={consent} onConsent={setConsent} profile={profile} profileReady={accountView.profileReady} onEditProfile={()=>{setReturnToOrder(true);setTab('profile');}} hasMonthlyPlan={hasMonthlyPlan} invalidQuantity={invalidQuantity} missingFormula={repeatReview&&reorderInfo.missing.length>0} busy={busy} paymentConfigured={data.paymentConfigured} onCheckout={()=>api('/api/dog-food/account/',{action:'order',commandId,items:items.map(p=>({productId:p.id,quantity:quantities[p.id]})),plan,fulfillmentMethod,routeWeekday:fulfillmentMethod==='pickup'||tonyDate?null:routeWeekday,tonyDate:fulfillmentMethod==='pickup'?null:tonyDate,deliverySpeed:plan==='subscription'?'route_day':deliverySpeed,...(plan==='subscription'?{cadence,serviceWeek:week,monthDay,billingConsent:consent}:{})})}>
          {repeatReview||checkoutMode ? <RepeatOrderReview items={items} quantities={quantities} onQuantity={changeQuantity} profile={profile} info={repeatReview?reorderInfo:{missing:[],priceChanged:false}} onBrowse={() => {setRepeatReview(false);setCheckoutMode(false);}} onEditProfile={() => {setReturnToOrder(true);setTab('profile');}} hasMonthlyPlan={hasMonthlyPlan}/> : <ProductShop products={data.products} quantities={quantities} onQuantity={changeQuantity}/>}
        </OrderCheckout>}
        {tab === 'orders' && <section className={styles.card}><div className={styles.sectionHead}><h2>{focusedOrderId ? 'Delivery & order details' : 'Your orders'}</h2>{focusedOrderId && <button className={styles.textButton} onClick={() => setFocusedOrderId('')}>View all orders <AccountIcon name='arrow'/></button>}</div><p className={styles.muted}>See confirmed delivery dates, payment status and the bags in each order.</p>{!data.orders.length && <div className={styles.emptyState}><AccountIcon name='orders'/><h3>Your next favorite starts here.</h3><p>Orders, payment status and confirmed handoffs will appear here. Historical SNG orders may still be reconciling.</p></div>}{(focusedOrderId ? data.orders.filter(o=>o.id===focusedOrderId) : data.orders).map(o => <article className={styles.order} key={o.id}><div className={styles.row}><div><strong>{o.order_number}</strong><p>Ordered {date(o.placed_at)} · {label(o.order_type)}</p></div><strong>{money(o.total_cents)}</strong></div><div className={styles.orderItems}>{o.items.map(i => <span key={i.product_id}><img src={`/assets/edf/${i.formula_code}.webp`} width='35' height='55' alt=''/>{i.quantity} × {i.color} {i.formula_code} · {i.bag_weight_lb} lb</span>)}</div><div className={styles.row}><span className={styles.badge} data-tone={o.paid_provider?'success':'pending'}>{o.paid_provider ? `Paid via ${o.paid_provider}` : o.refunded_cents>0?'Refund recorded':o.amount_received_cents>0?'Partially paid':o.source==='staff_sales'?'Unpaid':label(o.status)}</span><span>{o.fulfillment_progress?.confirmed?`${o.fulfillment_progress.confirmed} of ${o.fulfillment_progress.total} bags handed over`:o.fulfillment_method==='unknown'?'Handoff pending office verification':o.fulfillment_method==='pickup' ? o.pickup_status==='collected'?'Picked up':o.pickup_status==='arranged'?`Pickup arranged: ${date(o.pickup_date)}`:o.pickup_status==='ready'?'Ready to arrange pickup':o.pickup_status==='preparing'?'Preparing your food':'Awaiting preparation' : o.delivery_status === 'delivered' ? 'Delivered' : o.delivery_date ? `Delivery: ${date(o.delivery_date)}` : o.requested_delivery_speed==='same_day' ? 'Same-day request awaiting confirmation' : o.requested_delivery_speed==='next_day' ? 'Next-day request awaiting confirmation' : 'Next route day awaiting confirmation'}</span></div>{o.pickup_instructions&&<p><strong>Agreed pickup details:</strong> {o.pickup_instructions}</p>}{o.pickupEvents?.length>0&&<ol className={styles.orderTimeline}>{o.pickupEvents.map((event,i)=><li key={i}><strong>{({preparing:'Preparing',ready:'Ready to arrange pickup',arranged:'Pickup arranged',collected:'Picked up',cancelled:'Cancelled'})[event.stage]||event.stage}</strong><span>{date(event.occurred_at)}</span>{event.instructions&&<p>{event.instructions}</p>}</li>)}</ol>}{['direct','staff_sales'].includes(o.source)&&<p className={styles.fine}>Direct sale · {money(o.amount_received_cents)} received{o.refunded_cents>0?' ? '+money(o.refunded_cents)+' refunded':''}{ o.balance_cents>0?' · '+money(o.balance_cents)+' outstanding':''}. Contact the office for payment or handoff details.</p>}{o.source_document_id&&<p className={styles.fine}>Sweep &amp; Go invoice {o.source_document_id} ? food line {o.source_line_id}. Invoice paid status verified; the exact payment date is not inferred.</p>}{o.delivery_fee_cents>0 && <p className={styles.fine}>Includes {money(o.delivery_fee_cents)} delivery fee and {money(o.tax_cents)} sales tax.</p>}<div className={styles.actions}>{o.items.length>0&&<button onClick={() => reorder(o)}>Order these again</button>}{o.proof_available ? <a href={`/api/dog-food/proof/${o.id}/`} target="_blank" rel="noreferrer">View delivery photo</a> : null}{!['direct','staff_sales'].includes(o.source)&&!o.paid_provider && ['pending_payment','payment_failed','draft'].includes(o.status) && <button disabled={busy || !data.paymentConfigured} onClick={() => api('/api/dog-food/account/',{action:'checkout',orderId:o.id})}>Pay securely →</button>}</div></article>)}</section>}
        {tab === 'plans' && <MonthlyPlans data={data} api={api} busy={busy}/>}
        {tab === 'profile' && <DeliveryProfile profile={profile} required={data.profileRequired} email={data.customer.email} busy={busy} error={error} onSave={async savedProfile=>{const saved=await api('/api/dog-food/account/',{action:'profile',profile:savedProfile});if(saved){setTab(recommendationDraft||returnToOrder?'order':'home');setReturnToOrder(false);}}}/>}
      </>}
      <footer className={styles.footer}><span>Ohio Pet Waste Pros · Local food, dependable delivery</span><a href='tel:+14192622371'>Need a hand? 419-262-2371</a><a href='/privacy-policy/'>Privacy</a></footer>
    </div>
    </div>
    {confirmation && <div className={styles.overlay}><section ref={dialogRef} className={styles.modal} role='dialog' aria-modal='true' aria-labelledby='plan-confirm'><h2 id='plan-confirm'>{confirmation.subscriptionAction[0].toUpperCase() + confirmation.subscriptionAction.slice(1)} this monthly plan?</h2><p>This changes future automatic deliveries and charges. Existing paid orders will not be refunded or removed. A cycle already charging may require office assistance.</p>{error && <p className={styles.error} role="alert">{error}</p>}<div className={styles.actions}><button disabled={busy} onClick={() => setConfirmation(null)}>Keep plan unchanged</button><button className={styles.primary} disabled={busy} onClick={async () => {const result = await api('/api/dog-food/account/',{action:'subscription',...confirmation,confirm:true});if(result)setConfirmation(null);}}>Yes, {confirmation.subscriptionAction}</button></div></section></div>}
  </div>;
}
