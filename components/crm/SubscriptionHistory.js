import styles from './subscription-history.module.css';

const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents || 0) / 100);
const label = value => String(value || '').replaceAll('_', ' ');
const titleCase = value => label(value).replace(/\b\w/g, character => character.toUpperCase());
const date = value => value ? new Date(`${String(value).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set';
const periodLastDate = value => { if (!value) return null; const boundary = new Date(`${String(value).slice(0, 10)}T12:00:00Z`); boundary.setUTCDate(boundary.getUTCDate() - 1); return boundary.toISOString().slice(0, 10); };

export function SubscriptionBreakdown({ document, title = 'Monthly price', totalLabel = 'Monthly total' }) {
  const lines = document?.lineItems || document?.currentLines || [];
  return <section className={styles.breakdown} aria-label={title}>
    <h4>{title}</h4>
    <dl>{lines.map((line, index) => <div key={line.id || `${line.label}-${index}`}><dt>{line.label}{line.quantity > 1 ? <small>{line.quantity} × {money(line.unitCents)}</small> : null}</dt><dd>{money(line.totalCents)}</dd></div>)}</dl>
    <div className={styles.total}><strong>{totalLabel}</strong><strong>{money(document?.totalCents)}</strong></div>
  </section>;
}

export default function SubscriptionHistory({ subscriptions = [], title = 'Your subscription history' }) {
  return <section className={styles.history} aria-label={title}>
    <div className={styles.heading}><h2>{title}</h2><p>Your active and past subscriptions stay together here.</p></div>
    {!subscriptions.length ? <p className={styles.empty}>No subscriptions to show yet.</p> : subscriptions.map(subscription => <article className={styles.card} key={subscription.id}>
      <div className={styles.row}><div><span className={styles.eyebrow}>{label(subscription.status)}</span><h3>{titleCase(subscription.name || subscription.planLabel || subscription.planId) || 'Service Subscription'}</h3><p>{label(subscription.frequency)}{subscription.dogCount ? ` · ${subscription.dogCount} ${Number(subscription.dogCount) === 1 ? 'dog' : 'dogs'}` : ''}</p></div><strong>{money(subscription.totalCents)}<small>per month</small></strong></div>
      <dl className={styles.dates}><div><dt>Started</dt><dd>{date(subscription.startDate)}</dd></div><div><dt>{subscription.endDate ? 'Ended' : 'Billing period ends'}</dt><dd>{date(subscription.endDate || periodLastDate(subscription.billingPeriodEnd))}</dd></div>{!subscription.endDate ? <div><dt>Next billing period starts</dt><dd>{date(subscription.billingPeriodEnd)}</dd></div> : null}</dl>
      {subscription.endDate && subscription.terminationReason ? <p>Reason: {label(typeof subscription.terminationReason === 'string' ? subscription.terminationReason : subscription.terminationReason.code)}{subscription.terminationNote ? `. ${subscription.terminationNote}` : ''}</p> : null}
      <SubscriptionBreakdown document={subscription.customerPricing || subscription} title={subscription.endDate ? 'Final monthly price' : 'Monthly price'} />
      {subscription.versions?.length ? <details className={styles.timeline}><summary>Price and service history</summary><ol>{subscription.versions.map(version => <li key={version.id || version.effectiveDate}><strong>{date(version.effectiveDate)}</strong><span>{money(version.totalCents)} per month</span>{version.customerPricing || version.lineItems ? <SubscriptionBreakdown document={version.customerPricing || version} title='Price breakdown' /> : null}</li>)}</ol></details> : null}
    </article>)}
  </section>;
}
