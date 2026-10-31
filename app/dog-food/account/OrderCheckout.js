'use client';
import {useEffect,useState} from 'react';
import {FOOD_DELIVERY_OPTIONS,FOOD_TAX_LABEL,foodCheckoutTotals,foodSameDayOpen} from '@/lib/dog-food-checkout.mjs';
import {AccountIcon} from './AccountOverview';
import styles from './account.module.css';
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n||0)/100);

export default function OrderCheckout({children,shopping,onReview,onQuantity,orderingAvailable,items,quantities,plan,onPlan,deliverySpeed,onDelivery,cadence,onCadence,week,onWeek,monthDay,onMonthDay,consent,onConsent,profile,profileReady,onEditProfile,hasMonthlyPlan,invalidQuantity,missingFormula,busy,paymentConfigured,onCheckout,fulfillmentMethod,onFulfillment,deliveryChoices,routesLoading,routeWeekday,onRouteWeekday,tonyDate,onTonyDate}) {
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(timer);},[]);
  const monthly=plan==='subscription', sameDayOpen=foodSameDayOpen(now);
  const pickup=fulfillmentMethod==='pickup';
  const speed=monthly||pickup?'route_day':deliverySpeed;
  const totals=foodCheckoutTotals(items.map(p=>({unit_price_cents:p.retail_price_cents,quantity:quantities[p.id]})),speed);
  const delivery=FOOD_DELIVERY_OPTIONS.find(o=>o.id===speed);
  const expiredSameDay=!monthly && speed==='same_day' && !sameDayOpen;
  const bags=items.reduce((n,p)=>n+quantities[p.id],0);
  const routeReady=pickup||!routesLoading&&deliveryChoices?.deliveryAvailable&&(tonyDate&&!monthly||deliveryChoices?.days?.some(d=>d.weekday===routeWeekday));
  const ready=orderingAvailable!==false&&!busy && items.length>0 && !invalidQuantity && !missingFormula && profileReady && paymentConfigured && !expiredSameDay && routeReady && (!monthly||consent);
  if(shopping)return <section>{orderingAvailable===false&&<p className={styles.readinessWarning} role='status'><strong>Online ordering is not ready yet.</strong>Online orders are awaiting verified stock and fulfillment setup. Call 419-262-2371 to order directly from the team.</p>}{children}<div className={styles.cartBar} aria-label='Your cart'><div><strong>{bags} {bags===1?'bag':'bags'} in your order</strong><span>Food: {money(totals.subtotal)} · tax and delivery at checkout</span></div><button type='button' className={styles.primary} disabled={!items.length||invalidQuantity} onClick={onReview}>Review order <AccountIcon name='arrow'/></button></div>{invalidQuantity&&<p className={styles.error} role='alert'>Choose up to 10 whole bags per order.</p>}</section>;
  return <form className={`${styles.checkoutLayout} ${styles.checkoutFocused}`} onSubmit={e=>{e.preventDefault();if(ready)onCheckout();}}>
    <div className={styles.checkoutMain}>{orderingAvailable===false&&<p className={styles.readinessWarning} role='status'><strong>Online ordering is not ready yet.</strong>Online orders are awaiting verified stock and fulfillment setup. Call 419-262-2371 to order directly from the team.</p>}
      {children}
      <section className={styles.deliveryChoices} aria-label='Order and delivery options'>
        <fieldset className={styles.purchaseType}><legend>How often?</legend><div>
          <label data-checked={!monthly}><input type='radio' name='purchase-type' value='on_demand' checked={!monthly} onChange={()=>onPlan('on_demand')}/><span><strong>Just this order</strong></span></label>
          <label data-checked={monthly} data-disabled={hasMonthlyPlan}><input type='radio' name='purchase-type' value='subscription' checked={monthly} disabled={hasMonthlyPlan} onChange={()=>onPlan('subscription')}/><span><strong>Recurring monthly</strong>{hasMonthlyPlan&&<small>Manage your existing monthly plan.</small>}</span></label>
        </div></fieldset>
        <fieldset className={styles.purchaseType}><legend>How will you get your bags?</legend><div>
          <label data-checked={!pickup}><input type='radio' name='handoff' checked={!pickup} onChange={()=>onFulfillment('delivery')}/><span><strong>Deliver to me</strong></span></label>
          <label data-checked={pickup}><input type='radio' name='handoff' checked={pickup} onChange={()=>onFulfillment('pickup')}/><span><strong>Free pickup by arrangement</strong></span></label>
        </div></fieldset>
        {!pickup&&<fieldset className={styles.monthlyChoices}><legend>Your recommended drop-off day</legend>
          {routesLoading&&<p role='status'>Checking delivery options…</p>}
          {!!deliveryChoices?.days?.length&&<label>Route day<select disabled={routesLoading} value={tonyDate?'':routeWeekday??''} onChange={e=>onRouteWeekday(Number(e.target.value))}><option value='' disabled>Choose a route day</option>{deliveryChoices.days.map((d,i)=><option key={d.weekday} value={d.weekday}>{d.day}{i===0?' — recommended':''}</option>)}</select></label>}
          {!monthly&&!!deliveryChoices?.tonyDates?.length&&<label>Tony one-time drop-off<select value={tonyDate} onChange={e=>{if(e.target.value)onTonyDate(e.target.value);else onRouteWeekday(deliveryChoices.days?.[0]?.weekday??null);onDelivery('route_day');}}><option value=''>Use recommended route day</option>{deliveryChoices.tonyDates.map(d=><option key={d} value={d}>{d} — confirmed extra delivery capacity</option>)}</select></label>}
          {!routesLoading&&!deliveryChoices?.deliveryAvailable&&<p className={styles.error}>Delivery is not confirmed for this address. Choose pickup or call 419-262-2371 to arrange a Tony drop-off.</p>}
        </fieldset>}
        {!monthly&&!pickup ? <fieldset className={styles.speedChoices}><legend>When should we deliver?</legend>
          {FOOD_DELIVERY_OPTIONS.map(option=>{const unavailable=option.id==='same_day'&&!sameDayOpen;return <label key={option.id} data-checked={speed===option.id} data-disabled={unavailable}><input type='radio' name='delivery-speed' value={option.id} checked={speed===option.id} disabled={unavailable} onChange={()=>onDelivery(option.id)}/><span><strong>{option.name}</strong>{unavailable&&<small>Closed for today. Same-day requests close at noon Eastern.</small>}</span><b>{option.feeCents?`+${money(option.feeCents)}`:'Free'}</b></label>;})}
          {expiredSameDay&&<p className={styles.error} role='alert'>Same-day requests have closed. Choose next day or your free next route day.</p>}
        </fieldset> : monthly?<fieldset className={styles.monthlyChoices}><legend>Your monthly schedule</legend>
          {!pickup&&<label>Schedule by<select value={cadence} onChange={e=>onCadence(e.target.value)}><option value='service_week'>Week of the month, on the selected route day</option><option value='fixed_day'>Day of the month (office confirms route alignment)</option></select></label>}
          {!pickup&&cadence==='service_week'?<label>Week of the month<select value={week} onChange={e=>onWeek(Number(e.target.value))}>{[1,2,3,4].map(w=><option key={w} value={w}>Week {w}</option>)}</select></label>:<label>Preferred day of month<input type='number' min='1' max='31' required value={monthDay} onChange={e=>onMonthDay(Number(e.target.value))}/></label>}
        </fieldset>:null}
      </section>
    </div>
    <aside className={styles.checkoutSummary} aria-label='Checkout summary'>
      <span className={styles.eyebrow}>Review & checkout</span><h2>{monthly?'Your monthly food':'Your order'}</h2>
      {items.length?<><p className={styles.bagCount}>{bags} {bags===1?'bag':'bags'} · {monthly?pickup?'monthly pickup':'monthly delivery':'one-time order'}</p><div className={styles.checkoutItems}>{items.map(p=><div key={p.id}><img src={`/assets/edf/${p.formula_code}.webp`} width='32' height='52' alt=''/><span><strong>{quantities[p.id]} × {p.color} {p.formula_code}</strong></span><b>{money(p.retail_price_cents*quantities[p.id])}</b><label className={styles.cartQuantity}><span className={styles.srOnly}>{p.color} {p.formula_code} bags in your order</span><select aria-label={`${p.color} ${p.formula_code} bags in your order`} value={quantities[p.id]} onChange={e=>onQuantity(p.id,Number(e.target.value))}>{Array.from({length:11},(_,i)=><option key={i} value={i}>{i===0?'Remove':i}</option>)}</select></label></div>)}</div></>:<p className={styles.emptyCart}>Choose your bags to build your order.</p>}
      <div className={styles.checkoutAddress}><div><AccountIcon name='profile'/><strong>{pickup?'Your contact details':'Deliver to'}</strong><button type='button' className={styles.textButton} onClick={onEditProfile}>{profileReady?'Edit':'Add details'}</button></div>{profileReady?<p>{pickup&&<>{profile.firstName} {profile.lastName}<br/>{profile.phone}<br/></>}{pickup&&<span className={styles.contactAddressNote}>Your saved contact address — not the pickup location</span>}{profile.address}<br/>{profile.city}, {profile.state} {profile.zip}<small>{pickup?'Pickup location confirmed by the office':profile.placement==='Other'?profile.placementOther:profile.placement}</small></p>:<p>Add your name, phone and delivery address before checkout.</p>}</div>
      {invalidQuantity&&<p className={styles.error} role='alert'>Choose up to 10 whole bags. Contact the team for a larger order.</p>}
      {items.length>0 && <dl className={styles.checkoutTotals}><div><dt>Food</dt><dd>{money(totals.subtotal)}</dd></div><div><dt>{pickup?'Pickup by arrangement':tonyDate?`Tony drop-off ${tonyDate}`:monthly?'Monthly route delivery':delivery.name}</dt><dd>{totals.deliveryFee?money(totals.deliveryFee):'Free'}</dd></div><div><dt>{FOOD_TAX_LABEL}</dt><dd>{money(totals.tax)}</dd></div><div className={styles.checkoutTotal} aria-live='polite' aria-atomic='true'><dt>{monthly?'Due today / monthly':'Total'}</dt><dd>{money(totals.total)}</dd></div></dl>}
      {monthly&&items.length>0&&<label className={`${styles.checkbox} ${styles.monthlyConsent}`}><input type='checkbox' checked={consent} onChange={e=>onConsent(e.target.checked)}/><span>I authorize {money(totals.total)} today and each month after my schedule is confirmed. Charges normally occur two days before the confirmed {pickup?'pickup':'delivery'} date. I can request a pause, skip or cancellation in my account; the office must approve and confirm the change.</span></label>}
      <button className={styles.primary} disabled={!ready}>{busy?'Opening checkout…':'Continue to secure payment'}<AccountIcon name='arrow'/></button>
      {!paymentConfigured&&<p className={styles.error} role='alert'>Checkout is unavailable. No payment will be taken.</p>}

    </aside>
  </form>;
}
