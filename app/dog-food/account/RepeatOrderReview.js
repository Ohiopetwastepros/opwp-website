'use client';
import { AccountIcon } from './AccountOverview';
import styles from './account.module.css';
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n||0)/100);

export default function RepeatOrderReview({items,quantities,onQuantity,info,onBrowse,hasMonthlyPlan}) {
  return <section className={styles.repeatReview}>
    <div className={styles.repeatIntro}><span className={styles.eyebrow}>Pick up where you left off</span><h2>Your bags</h2></div>
    {info.missing.length > 0 && <div className={styles.error} role='alert'>These formulas are no longer in the current catalog: {info.missing.join(', ')}. Choose your formulas before continuing. We will not substitute them.</div>}
    {info.priceChanged && <div className={styles.priceNote}>Prices have changed since your previous order. Today’s prices are shown below.</div>}
    <div className={styles.repeatItems}>{items.map(p=><article key={p.id}><img src={`/assets/edf/${p.formula_code}.webp`} width='70' height='110' alt={`${p.name}, ${p.formula_code}`}/><div><span className={styles.eyebrow}>{p.formula_code} / {p.color}</span><h3>{p.name}</h3><p>{p.bag_weight_lb} lb · {money(p.retail_price_cents)} per bag + tax</p><label>Number of {p.color} bags<input type='number' min='0' max='10' step='1' value={quantities[p.id] || 0} onChange={e=>onQuantity(p.id,Number(e.target.value))}/></label></div><strong>{money(p.retail_price_cents*quantities[p.id])}</strong></article>)}</div>
    {!items.length && <p>Your cart is empty. Browse the formulas to choose a bag.</p>}
    <button type='button' onClick={onBrowse}>Edit your bags <AccountIcon name='arrow'/></button>
    {hasMonthlyPlan && <div className={styles.extraBagNote}><AccountIcon name='plans'/><div><strong>This is an extra, one-time order.</strong><p>Any existing monthly plan keeps its current schedule.</p></div></div>}
  </section>;
}
