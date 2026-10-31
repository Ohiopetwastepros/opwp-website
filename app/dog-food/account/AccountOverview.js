'use client';
import { foodOverview } from '@/lib/dog-food-overview.mjs';
import styles from './account.module.css';

export function AccountIcon({ name, ...props }) {
  const paths = {
    home: <><rect x='3' y='3' width='7' height='7' rx='1.5'/><rect x='14' y='3' width='7' height='7' rx='1.5'/><rect x='3' y='14' width='7' height='7' rx='1.5'/><rect x='14' y='14' width='7' height='7' rx='1.5'/></>,
    order: <><path d='M5 7h14l-1 14H6L5 7Z'/><path d='M9 8V6a3 3 0 0 1 6 0v2'/></>,
    orders: <><rect x='5' y='3' width='14' height='18' rx='2'/><path d='M9 8h6M9 12h6M9 16h4'/></>,
    plans: <><path d='M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5'/></>,
    profile: <><path d='M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z'/><circle cx='12' cy='10' r='2.5'/></>,
    arrow: <><path d='M5 12h14m-5-5 5 5-5 5'/></>,
    check: <path d='m5 12 4 4L19 6'/>,
    card: <><rect x='2' y='5' width='20' height='14' rx='3'/><path d='M2 10h20M6 15h4'/></>,
    help: <><path d='M4 14v-3a8 8 0 0 1 16 0v3M18 19c0 2-3 2-6 2'/><rect x='2' y='11' width='4' height='7' rx='2'/><rect x='18' y='11' width='4' height='7' rx='2'/></>,
    lock: <><rect x='5' y='10' width='14' height='11' rx='2'/><path d='M8 10V7a4 4 0 0 1 8 0v3M12 14v3'/></>,
    logout: <><path d='M9 3H4v18h5M9 12h12m-4-4 4 4-4 4'/></>,
  };
  return <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' {...props}>{paths[name] || paths.order}</svg>;
}

export function AccountBrand() {
  return <a href='/dog-food/' className={styles.brand}><img src='/assets/opwp-logo.webp' width='64' height='48' alt='Ohio Pet Waste Pros'/><span>My Dog Food<small>Ohio Pet Waste Pros</small></span></a>;
}

export function AccountNavigation({ tab, setTab, busy, logout, customer }) {
  return <header className={styles.accountHeader}>
    <div className={styles.headerInner}><AccountBrand/><div className={styles.headerUtilities}><a href='tel:+14192622371'><AccountIcon name='help'/><span>Need a hand?</span></a><button disabled={busy} onClick={logout} aria-label='Sign out'><AccountIcon name='logout'/><span>Sign out</span></button></div></div>
    <div className={styles.navSurface}><nav className={styles.accountNav} aria-label='Dog food account'>{[['home','Home'],['order','Shop Food'],['orders','Orders & Deliveries'],['plans','Monthly Plan'],['profile','Account']].map(([id,text]) => <button key={id} className={tab === id ? styles.selected : ''} aria-current={tab === id ? 'page' : undefined} aria-label={text} onClick={() => setTab(id)}><AccountIcon name={id}/><span className={styles.desktopNavLabel}>{text}</span><span className={styles.mobileNavLabel} aria-hidden='true'>{({home:'Home',order:'Shop',orders:'Orders',plans:'Plan',profile:'Account'})[id]}</span></button>)}</nav></div>
  </header>;
}
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n||0)/100);
const date=v=>v?new Date(v.slice(0,10)+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'Awaiting confirmation';
const label=v=>String(v||'').replaceAll('_',' ');
export default function AccountOverview({ data, setTab, viewOrder, reorder, busy, api }) {
  const v=foodOverview(data), {repeatOrder,nextOrder,plan,profileReady,attentionOrder}=v;
  const favorite=repeatOrder?.items||[];
  const pickup=nextOrder?.fulfillment_method==='pickup';
  const pickupLabels={preparing:'Preparing your food',ready:'Ready to arrange pickup',arranged:'Pickup arranged',collected:'Picked up'};
  return <div className={styles.overview}>
    {!profileReady&&<section className={styles.setup}><AccountIcon name='profile'/><div><strong>Let’s get your account ready.</strong><p>Save your contact details before your first order.</p></div><button onClick={()=>setTab('profile')}>Complete account <AccountIcon name='arrow'/></button></section>}
    {attentionOrder&&<div className={styles.paymentAlert} role='status'><AccountIcon name='card'/><span><strong>{attentionOrder.order_number} is awaiting payment.</strong> No payment has been confirmed.</span><button disabled={busy||!data.paymentConfigured} onClick={()=>api('/api/dog-food/account/',{action:'checkout',orderId:attentionOrder.id})}>Continue to payment</button></div>}
    <div className={styles.homeGrid}>
      <section className={styles.favoriteCard}>
        <div className={styles.favoriteCopy}><span className={styles.eyebrow}>{repeatOrder?'Their everyday favorite':'Good food. One less errand.'}</span><h2>{repeatOrder?<>Same happy dog.<br/>Same favorite food.</>:<>A full bowl.<br/>A simpler routine.</>}</h2><p>{repeatOrder?favorite.map(i=>i.quantity+' × '+(i.name||i.color+' '+i.formula_code)+' · '+i.bag_weight_lb+' lb').join(' / '):'Four Extreme Dog Fuel formulas, with free local pickup or delivery by your local team.'}</p><button className={styles.primary} onClick={()=>repeatOrder?reorder(repeatOrder):setTab('order')}>{repeatOrder?'Reorder their food':'Shop dog food'} <AccountIcon name='arrow'/></button><small>{repeatOrder?'Review current prices and quantities before payment.':'One-time orders. Monthly options. Your choice.'}</small></div>
        <div className={styles.favoriteArt}>{(favorite.length?favorite:data.products).slice(0,favorite.length?2:4).map(i=><img key={i.product_id||i.id} src={'/assets/edf/'+i.formula_code+'.webp'} width='160' height='240' alt={(i.name||i.color+' '+i.formula_code)+' dog food'}/>)}</div>
      </section>
      <section className={styles.statusCard}><span className={styles.eyebrow}>{nextOrder?'Your current order':'Your local team'}</span>{nextOrder?<><div className={styles.sectionHead}><h2>{pickup?'Pickup update':'Delivery update'}</h2><span className={styles.badge} data-tone={nextOrder.paid_provider?'success':'pending'}>{nextOrder.paid_provider?'Paid':'Payment pending'}</span></div><strong>{pickup?(pickupLabels[nextOrder.pickup_status]||'Order received'):nextOrder.delivery_date?'Delivery confirmed':'Awaiting delivery confirmation'}</strong><p>{pickup?(nextOrder.pickup_status==='arranged'?'Your agreed pickup details are available below.':nextOrder.pickup_status==='ready'?'Your food is ready. Contact Tony or the office to agree on a pickup time.':'Once paid, the team prepares your food and contacts you to coordinate pickup. Please wait for confirmation before arriving.'):'Your local team confirms the date and delivery arrangement. A requested date is not a confirmed appointment.'}</p>{(pickup?nextOrder.pickup_status==='arranged'&&nextOrder.pickup_date:nextOrder.delivery_date)&&<p className={styles.confirmedDate}>{date(pickup?nextOrder.pickup_date:nextOrder.delivery_date)}</p>}<button onClick={()=>viewOrder(nextOrder.id)}>View {nextOrder.order_number} <AccountIcon name='arrow'/></button></>:<><h2>A real person, right here.</h2><p>Help choosing a formula, coordinating pickup or checking a delivery? Your Ohio Pet Waste Pros team is a call away.</p><a href='tel:+14192622371'>419-262-2371 <AccountIcon name='arrow'/></a><button className={styles.secondaryBrowse} onClick={()=>setTab('order')}>Browse all formulas</button></>}</section>
    </div>
    {plan&&<section className={styles.verifiedPlan}><AccountIcon name='plans'/><div><span className={styles.eyebrow}>Your verified monthly plan</span><h3>{label(plan.status)} · {plan.payment_provider==='stripe'?'Website billing':'Office / Sweep & Go billing'}</h3><p>{plan.items.map(i=>i.quantity+' × '+i.color+' '+i.formula_code).join(' · ')}{plan.next_delivery_date?' · Next confirmed: '+date(plan.next_delivery_date):' · Next date awaiting confirmation'}</p></div><button onClick={()=>setTab('plans')}>View plan & request changes <AccountIcon name='arrow'/></button></section>}
    <section className={styles.recentCard}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>Your recent orders</span><h2>{data.orders.length?'Good food, on repeat.':'Your first bag starts here.'}</h2></div><button className={styles.textButton} onClick={()=>setTab('orders')}>View all orders <AccountIcon name='arrow'/></button></div>{data.orders.length?data.orders.slice(0,3).map(o=><div className={styles.recentOrder} key={o.id}><div className={styles.recentImages}>{o.items.slice(0,2).map(i=><img key={i.product_id} src={'/assets/edf/'+i.formula_code+'.webp'} alt='' width='42' height='64'/>)}</div><div><strong>{o.order_number}</strong><p>{o.items.map(i=>i.quantity+' × '+i.color+' '+i.formula_code).join(' · ')}</p></div><div className={styles.recentMeta}><span>{date(o.placed_at)}</span><strong>{money(o.total_cents)}</strong></div><span className={styles.badge} data-tone={o.paid_provider?'success':'pending'}>{o.pickup_status==='collected'?'Picked up':o.delivery_status==='delivered'?'Delivered':o.fulfillment_method==='pickup'?(pickupLabels[o.pickup_status]||label(o.status)):label(o.status)}</span><button onClick={()=>viewOrder(o.id)}>Details</button>{v.buyAgain.some(i=>i.order.id===o.id)&&<button onClick={()=>reorder(o)}>Reorder</button>}</div>):<div className={styles.emptyHistory}><span>Your orders and fulfillment updates will appear here after your first purchase.</span><button onClick={()=>setTab('order')}>Shop food <AccountIcon name='arrow'/></button></div>}</section>
    <section className={styles.finderBanner}><div><span className={styles.eyebrow}>A little help choosing</span><h2>Find their kind of fuel.</h2><p>Find a formula that fits their everyday.</p><a href='/dog-food/#order-tool'>Try the food finder <AccountIcon name='arrow'/></a></div><div className={styles.formulaLineup}>{data.products.map(p=><img key={p.id} src={'/assets/edf/'+p.formula_code+'.webp'} alt={p.name} width='72' height='108'/>)}</div></section>
  </div>;
}
