'use client';

import { useEffect, useRef, useState } from 'react';
import { operatingDate } from '@/lib/field-policy.mjs';
import { SubscriptionBreakdown } from '@/components/crm/SubscriptionHistory';
import s from './subscriptions.module.css';

const API = '/api/admin/crm/subscriptions/';
const money = cents => cents == null ? 'Needs rate review' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents || 0) / 100);
const dollars = cents => (Number(cents || 0) / 100).toFixed(2);
const label = value => String(value || '').replaceAll('_', ' ');
const titleCase = value => label(value).replace(/\b\w/g, character => character.toUpperCase());
const frequencyLabel = value => ({ once_a_week: 'Weekly', twice_a_week: 'Twice Weekly', every_other_week: 'Biweekly', once_a_month: 'Monthly' })[value] || titleCase(value);
const planName = sub => titleCase(sub.name || sub.planLabel || sub.planId);
const dogsLabel = count => `${count} ${Number(count) === 1 ? 'dog' : 'dogs'}`;
const dateLabel = value => value ? new Date(`${String(value).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'short', day: 'numeric' }) : 'Not set';
const periodLastDate = value => { if (!value) return null; const boundary = new Date(`${String(value).slice(0, 10)}T12:00:00Z`); boundary.setUTCDate(boundary.getUTCDate() - 1); return boundary.toISOString().slice(0, 10); };
const terminationReasons = [['moved', 'Moved'], ['price', 'Price'], ['service_issue', 'Service issue'], ['seasonal_pause', 'Seasonal pause'], ['other', 'Other']];
function cents(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match) throw new Error('Enter an amount with at most two decimal places.');
  const amount = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(amount)) throw new Error('The amount is too large.');
  return amount;
}
async function request(body, query) {
  const response = await fetch(query ? `${API}?${query}` : API, {
    cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Subscription information is unavailable.');
  return result;
}

export default function SubscriptionWorkspace({ initialData = null, initialCustomerId = '' } = {}) {
  const [data, setData] = useState(initialData), [customerId, setCustomerId] = useState(initialCustomerId), [view, setView] = useState('active');
  const [date, setDate] = useState(operatingDate()), [tab, setTab] = useState('customer'), [editor, setEditor] = useState(null);
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [refreshEpoch, setRefreshEpoch] = useState(0), [search, setSearch] = useState('');
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const requestedOperation = useRef('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = new URLSearchParams(window.location.search);
    if (['customer', 'rates', 'reports', 'book'].includes(query.get('tab'))) setTab(query.get('tab'));
    if (query.get('customerId')) setCustomerId(query.get('customerId'));
    if (['pause', 'skip', 'amend', 'resume'].includes(query.get('operation'))) requestedOperation.current = query.get('operation');
    if (query.get('create') === 'customer') { setTab('customer'); setNewCustomerOpen(true); }
  }, []);
  const loadSequence = useRef(0), pendingCustomer = useRef(null);
  async function load() {
    const sequence = ++loadSequence.current;
    try {
      const result = await request(null, new URLSearchParams({ customerId, view, date }));
      if (sequence !== loadSequence.current) return;
      setData(result); setError('');

    } catch (problem) { if (sequence === loadSequence.current) setError(problem.message); }
  }
  useEffect(() => { setEditor(null); setPreview(null); void load(); }, [customerId, view, date]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (preview) document.querySelector('[aria-label="Review before applying"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else if (editor) document.querySelector('[aria-label="Subscription change"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [editor, preview]);
  useEffect(() => {
    if (!requestedOperation.current || !customerId || !data) return;
    const subscription = data.subscriptions?.find(sub => sub.customerId === customerId && !['canceled', 'cancelled', 'ended'].includes(sub.status));
    if (subscription) { setTab('customer'); setPreview(null); setEditor({ operation: requestedOperation.current, subscription }); requestedOperation.current = ''; }
  }, [data, customerId]);
  useEffect(() => {
    if (newCustomerOpen && data && typeof document !== 'undefined') document.getElementById('new-customer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [newCustomerOpen, data?.enabled]);
  async function review(command, bulk = false) {
    setBusy(true); setError(''); setNotice(''); setPreview(null);
    try {
      const result = await request({ ...(bulk ? { action: 'preview_bulk_reprice' } : { action: 'preview' }), customerId, ...command });
      setPreview({ ...result.preview, isBulk: bulk, requestId: crypto.randomUUID() });
    } catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  }
  async function apply() {
    setBusy(true); setError('');
    try {
      const result = await request({ action: preview.isBulk ? 'apply_bulk_reprice' : 'apply', previewToken: preview.token, requestId: preview.requestId });
      setNotice(result.message || 'Subscription change saved.'); setPreview(null); setEditor(null); setRefreshEpoch(value => value + 1); await load();
    } catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  }
  async function saveCustomer(event) {
    event.preventDefault(); const form = event.currentTarget, values = new FormData(form); setBusy(true); setError('');
    try {
      const input = { name: values.get('name'), reason: values.get('reason') }, signature = JSON.stringify(input);
      if (pendingCustomer.current?.signature !== signature) pendingCustomer.current = { signature, requestId: crypto.randomUUID() };
      const result = await request({ action: 'save_customer', ...input, requestId: pendingCustomer.current.requestId });
      pendingCustomer.current = null;
      setCustomerId(result.customer?.id || result.customerId || ''); form.reset(); await load(); setNotice('Customer record created.');
    } catch (problem) { setError(problem.message); } finally { setBusy(false); }
  }
  async function linkPortal(event) {
    event.preventDefault(); const values = new FormData(event.currentTarget); setBusy(true); setError('');
    try {
      await request({ action: 'link_portal', customerId, accountId: values.get('accountId'), reason: values.get('reason'), verified: values.get('verified') === 'on', requestId: crypto.randomUUID() });
      setNotice('Verified customer portal access linked.'); await load();
    } catch (problem) { setError(problem.message); } finally { setBusy(false); }
  }
  const customer = data?.customers?.find(item => item.id === customerId);
  const customerName = id => data?.customers?.find(item => item.id === id)?.name || id;
  const visibleSubscriptions = (data?.subscriptions || []).filter(sub => `${customerName(sub.customerId)} ${planName(sub)} ${sub.zip} ${frequencyLabel(sub.frequency)}`.toLowerCase().includes(search.toLowerCase()));
  const activeMrr = data?.report?.activeMrrCents || 0;
  return <main className={s.workspace}>
    <header className={s.heading}><div><span className={s.eyebrow}>Revenue operations</span><h1>{tab === 'book' ? 'Price book' : tab === 'reports' ? 'Subscription reports' : tab === 'rates' ? 'Rate review' : 'Subscriptions'}</h1><p>{tab === 'book' ? 'Versioned service rates, yard surcharges and effective dates.' : tab === 'reports' ? 'Recurring revenue, rate overrides and service agreement performance.' : 'Service agreements, scheduled changes and a clear history of every rate.'}</p></div><label>Review date<input type='date' value={date} onChange={event => setDate(event.target.value)} /></label></header>
    <nav className={s.tabs} aria-label='Subscription workspace'>
      {[['customer', 'Service agreements'], ['rates', 'Rate review'], ['reports', 'Reports'], ['book', 'Price book']].map(([id, name]) => <button key={id} type='button' aria-pressed={tab === id} onClick={() => { setTab(id); setPreview(null); setEditor(null); }}>{name}</button>)}
    </nav>
    {error ? <p className={s.error} role='alert'>{error}</p> : null}
    {notice ? <p className={s.notice} role='status'>{notice}</p> : null}
    {!data ? <section className={s.card}><p>{error ? 'The subscription workspace could not be loaded.' : 'Loading subscription records...'}</p>{error ? <button onClick={() => void load()}>Try again</button> : null}</section> : data.enabled === false ? <section className={s.card}><h2>Subscription workspace awaiting activation</h2><p>{data.message || data.setupMessage || 'This workspace will be available after its setup has been approved.'}</p></section> : <>
      {tab === 'customer' ? <>
        <section className={s.metrics}><div><span>Active monthly recurring revenue</span><strong>{money(activeMrr)}</strong><small>From current service agreements</small></div><div><span>Manual rate overrides</span><strong>{data.report?.manualOverrides?.length || 0}</strong><small>Reason recorded on each agreement</small></div><div><span>Below current price book</span><strong>{data.report?.belowBook?.length || 0}</strong><small>Review before applying any rate change</small></div></section>
        <div className={s.directoryToolbar}><div className={s.filter} role='group' aria-label='Subscription history filter'>{[['active', 'Active'], ['past', 'Past'], ['all', 'All']].map(([id, name]) => <button key={id} type='button' aria-pressed={view === id} onClick={() => setView(id)}>{name}</button>)}</div><label className={s.searchLabel}><span>Search agreements</span><input type='search' value={search} onChange={event => setSearch(event.target.value)} placeholder='Customer, plan or ZIP code' /></label></div>
        {customerId ? <section className={s.customerHeader}><div><button className={s.textButton} onClick={() => { setCustomerId(''); setSearch(''); }}>All subscriptions</button><h2>{customer?.name || 'Customer record'}</h2><p>Review the service agreement and its complete amendment history.</p></div><button disabled={busy || !data.priceBook} onClick={() => setEditor({ operation: 'create' })}>New subscription</button></section> : null}
        {!customerId ? <section className={s.card}><div className={s.sectionHeading}><div><h2>{view === 'active' ? 'Active agreements' : view === 'past' ? 'Past agreements' : 'All agreements'}</h2><p className={s.muted}>{visibleSubscriptions.length} agreement{visibleSubscriptions.length === 1 ? '' : 's'}{customerId ? ' for this customer' : ' across your service area'}</p></div><button className={s.secondary} disabled={busy} onClick={() => void load()}>Refresh</button></div><div className={s.tableWrap}><table><thead><tr><th>Customer</th><th>Plan and service</th><th>Status</th><th>Monthly rate</th><th>Started</th><th>Agreement</th></tr></thead><tbody>{visibleSubscriptions.map(sub => <tr key={sub.id}><td><strong>{customerName(sub.customerId)}</strong><small>ZIP {sub.zip}</small></td><td>{planName(sub)}<small>{frequencyLabel(sub.frequency)} / {dogsLabel(sub.dogCount)}</small>{sub.currentLines?.filter(line => line.kind === 'yard_size' && line.totalCents > 0).map(line => <small key={line.id}>{line.label}: {money(line.totalCents)}</small>)}</td><td><span className={s.status} data-status={sub.status}>{titleCase(sub.status)}</span>{sub.rateSource === 'manual' ? <small>Manual rate override</small> : null}</td><td className={s.amount}><strong>{money(sub.totalCents)}</strong>{sub.belowBook ? <small className={s.attention}>Below price book</small> : null}</td><td>{dateLabel(sub.startDate)}</td><td><button className={s.secondary} onClick={() => { setCustomerId(sub.customerId); setSearch(''); }}>Open agreement</button></td></tr>)}</tbody></table></div>{!visibleSubscriptions.length ? <div className={s.empty}><h3>No {view === 'all' ? '' : view + ' '}subscriptions in this view</h3><p>{search ? 'Try another customer name, plan or ZIP code.' : 'Choose another view to review earlier agreements.'}</p></div> : null}</section> : null}
        {customerId ? visibleSubscriptions.map(subscription => <SubscriptionCard key={subscription.id} subscription={subscription} date={date} busy={busy} onEdit={(operation, details = {}) => { setPreview(null); setEditor({ operation, subscription, ...details }); }} />) : null}
        <details className={`${s.card} ${s.createCustomer}`} id='new-customer' open={newCustomerOpen} onToggle={event => setNewCustomerOpen(event.currentTarget.open)}><summary>Create a customer record</summary><form className={s.form} onSubmit={saveCustomer}><label>Customer name<input name='name' maxLength={160} required /></label><label>Reason<input name='reason' maxLength={1000} required /></label><button disabled={busy}>Create customer record</button></form></details>
        {customerId ? <details className={s.card}><summary>Verified customer portal access</summary><p>Link only a portal account whose ownership you have checked. A matching name or email alone does not establish ownership.</p><form className={s.form} onSubmit={linkPortal}><label>Verified portal account ID<input name='accountId' maxLength={160} required /></label><label>Ownership review and reason<textarea name='reason' maxLength={2000} required /></label><label className={s.check}><input name='verified' type='checkbox' required />I verified this account belongs to {customer?.name || 'this customer'}.</label><button disabled={busy}>Link verified portal account</button></form></details> : null}
      </> : null}
      {tab === 'rates' ? <BulkReview key={refreshEpoch} report={data.report} date={date} busy={busy} onReview={command => review(command, true)} /> : null}
      {tab === 'reports' ? <Report report={data.report} onOpenCustomer={id => { setCustomerId(id); setView('all'); setTab('customer'); }} /> : null}
      {tab === 'book' ? <PriceBookEditor key={data.priceBook?.version || 'empty'} book={data.priceBook} date={date} busy={busy} onReview={command => review(command)} onError={setError} /> : null}
      {editor ? <section className={s.editor} aria-label='Subscription change'><div className={s.sectionHeading}><h2>{editor.operation === 'create' ? 'New subscription' : `${label(editor.operation)} · ${editor.subscription?.name || label(editor.subscription?.planId)}`}</h2><button className={s.secondary} onClick={() => { setEditor(null); setPreview(null); }}>Close</button></div>{['create', 'amend', 'schedule_change'].includes(editor.operation) ? <RateEditor key={`${editor.operation}-${editor.subscription?.id || 'new'}`} {...editor} book={data.priceBook} date={date} busy={busy} onError={setError} onReview={command => review(command)} /> : <OperationEditor key={`${editor.operation}-${editor.subscription?.id}`} {...editor} date={date} busy={busy} onError={setError} onReview={command => review(command)} />}</section> : null}
      {preview ? <Preview preview={preview} busy={busy} onApply={apply} onCancel={() => setPreview(null)} /> : null}
    </>}
  </main>;
}

function SubscriptionCard({ subscription: sub, date, busy, onEdit }) {
  const past = ['canceled', 'cancelled', 'ended'].includes(sub.status);
  const versions = [...(sub.versions || [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  return <article className={s.card}>
    <div className={s.sectionHeading}><div><div className={s.badges}><span>{label(sub.status)}</span>{sub.belowBook ? <span className={s.attention}>Below current book</span> : null}{sub.rateSource === 'manual' ? <span>Manual rate</span> : null}</div><h3>{planName(sub)}</h3><p>{frequencyLabel(sub.frequency)} / {dogsLabel(sub.dogCount)} / ZIP {sub.zip}</p></div><div className={s.price}><strong>{money(sub.totalCents)}</strong><span>fixed monthly total</span></div></div>
    <dl className={s.facts}><div><dt>Started</dt><dd>{dateLabel(sub.startDate)}</dd></div><div><dt>{past ? 'Ended' : 'Billing period ends'}</dt><dd>{dateLabel(past ? sub.endDate : periodLastDate(sub.billingPeriodEnd))}</dd></div>{!past ? <div><dt>Next billing period starts</dt><dd>{dateLabel(sub.billingPeriodEnd)}</dd></div> : null}<div><dt>Current book</dt><dd>{(Object.hasOwn(sub, 'currentBookRateCents') ? sub.currentBookRateCents : sub.bookRateCents) == null ? 'Needs rate review' : money(Object.hasOwn(sub, 'currentBookRateCents') ? sub.currentBookRateCents : sub.bookRateCents)}</dd></div>{sub.rateSource === 'manual' ? <div><dt>Manual rate</dt><dd>{money(sub.manualRateCents)}</dd></div> : null}</dl>
    {past ? <p><strong>Termination reason:</strong> {label(typeof sub.terminationReason === 'string' ? sub.terminationReason : sub.terminationReason?.code)}{sub.terminationNote ? `. ${sub.terminationNote}` : ''}</p> : null}
    <details><summary>{past ? 'Final price breakdown' : 'Price breakdown'}</summary><LineTable lines={sub.currentLines} total={sub.totalCents} /></details>
    <details><summary>Price history · {versions.length} version{versions.length === 1 ? '' : 's'}</summary><ol className={s.timeline}>{versions.map((version, index) => <li key={version.id}><div><strong>{dateLabel(version.effectiveDate)}</strong>{version.effectiveDate > date ? <span className={s.scheduled}>Scheduled</span> : null}<b>{money(version.totalCents)} per month</b></div>{lineChanges(versions[index - 1], version).map((change, i) => <p key={i}>{change}</p>)}<small>{version.reason}</small></li>)}</ol></details>
    {(sub.scheduledChanges || []).length ? <section className={s.reminders}><h4>Scheduled changes & notices</h4>{sub.scheduledChanges.map(change => <p key={change.versionId || change.id}><strong>{dateLabel(change.effectiveDate)}</strong> · {money(change.totalCents)} per month<br />Customer notice reminder: {dateLabel(change.noticeReminderDate)} · {label(change.noticeStatus)}</p>)}</section> : null}
    {versions.filter(version => !version.cancelledAt && version.noticeReminderDate && version.noticeStatus === 'pending').map(version => <div key={version.id} className={s.reminder}><p><strong>Customer notice {version.noticeReminderDate <= date ? 'due' : 'reminder'}: {dateLabel(version.noticeReminderDate)}</strong><br />Change effective {dateLabel(version.effectiveDate)} · {money(version.totalCents)} per month</p><button disabled={busy} className={s.secondary} onClick={() => onEdit('acknowledge_notice', { versionId: version.id })}>Review notice acknowledgment</button></div>)}
    {[...(sub.pauses || []), ...(sub.skips || [])].filter(change => change.resumeDate >= date).map((change, index) => <p key={index} className={s.reminder}>Service {change.kind || 'pause / skip'} from {dateLabel(change.startDate)}. Automatically resumes {dateLabel(change.resumeDate)}.</p>)}
    {(sub.credits || []).length ? <details><summary>Promised credits</summary>{sub.credits.map(credit => <p key={credit.id}>{money(credit.remainingCents ?? credit.amountCents)} · {label(credit.status || 'promised')} · {credit.reason}</p>)}</details> : null}
    <details><summary>Audit trail</summary><div className={s.tableWrap}><table><thead><tr><th>When</th><th>Who</th><th>Change</th><th>Before</th><th>After</th><th>Reason</th></tr></thead><tbody>{(sub.audit || []).map((entry, i) => <tr key={entry.id || i}><td>{entry.at || entry.when || entry.createdAt}</td><td>{entry.actor || entry.who}</td><td>{label(entry.action || entry.operation)}</td><td>{auditValue(entry.oldValue)}</td><td>{auditValue(entry.newValue)}</td><td>{entry.reason}</td></tr>)}</tbody></table></div></details>
    {!past ? <div className={s.agreementActions}><button disabled={busy} onClick={() => onEdit('amend')}>Change agreement</button><button disabled={busy} className={s.secondary} onClick={() => onEdit(sub.status === 'paused' ? 'resume' : 'pause')}>{sub.status === 'paused' ? 'Resume' : 'Pause'}</button><details className={s.actionMenu}><summary>More agreement actions</summary><div className={s.menuPanel}>{[['schedule_change', 'Schedule change'], ['skip', 'Skip'], [sub.status === 'paused' ? 'pause' : 'resume', sub.status === 'paused' ? 'Pause' : 'Resume'], ['promise_credit', 'Promise credit'], ['invoice', 'Next invoice'], ['cancel', 'Cancel subscription']].map(([id, name]) => <button key={id} disabled={busy} className={id === 'cancel' ? s.danger : s.secondary} onClick={() => onEdit(id)}>{name}</button>)}</div></details></div> : null}
  </article>;
}

function lineChanges(prior, version) {
  if (!prior) return [`Started at ${money(version.totalCents)} per month.`];
  const before = new Map((prior.lineItems || []).map(line => [line.id, line]));
  const changes = (version.lineItems || []).filter(line => before.get(line.id)?.totalCents !== line.totalCents).map(line => `${line.label}: ${money(before.get(line.id)?.totalCents)} to ${money(line.totalCents)}.`);
  for (const line of prior.lineItems || []) if (!(version.lineItems || []).some(item => item.id === line.id)) changes.push(`${line.label}: ${money(line.totalCents)} to ${money(0)}.`);
  if (prior.selection?.frequency !== version.selection?.frequency) changes.push(`Frequency: ${label(prior.selection?.frequency)} to ${label(version.selection?.frequency)}.`);
  if (prior.selection?.dogCount !== version.selection?.dogCount) changes.push(`Dog count: ${prior.selection?.dogCount} to ${version.selection?.dogCount}.`);
  return changes.length ? changes : ['Agreement details updated.'];
}

function auditValue(value, key = '') {
  if (value == null) return 'Not set';
  if (typeof value === 'number') return key.endsWith('Cents') ? money(value) : String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return key.toLowerCase().includes('date') ? dateLabel(value) : label(value);
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' && item ? `${item.label || item.id || ''}${item.totalCents != null ? ` ${money(item.totalCents)}` : item.amountCents != null ? ` ${money(item.amountCents)}` : item.quantity != null ? ` x ${item.quantity}` : ''}` : String(item)).join('; ') || 'None';
  return Object.entries(value).filter(([name]) => !['versionId', 'bookId'].includes(name)).map(([name, item]) => `${label(name.replace(/([A-Z])/g, ' $1').toLowerCase())}: ${auditValue(item, name)}`).join('; ') || 'None';
}

function RateEditor({ operation, subscription: sub, book, date, busy, onError, onReview }) {
  const selection = sub?.selection || sub || {};
  const [planId, setPlan] = useState(selection.planId || book?.plans?.[0]?.id || '');
  const [frequency, setFrequency] = useState(selection.frequency || 'once_a_week'), [dogCount, setDogs] = useState(selection.dogCount || 1);
  const [zip, setZip] = useState(selection.zip || ''), [yardTierId, setYard] = useState(selection.yardTierId || book?.yardTiers?.[0]?.id || '');
  const [addons, setAddons] = useState(Object.fromEntries((selection.addons || []).map(item => [item.id, item.quantity])));
  const [rateSource, setRateSource] = useState(sub?.rateSource || 'preset'), [manualRate, setManualRate] = useState(dollars(sub?.manualRateCents ?? sub?.totalCents));
  const [visibility, setVisibility] = useState({ ...(selection.lineVisibility || {}), ...Object.fromEntries((sub?.currentLines || []).map(line => [line.id, line.itemized !== false])) });
  const [discounts, setDiscounts] = useState(() => (selection.discounts || []).map(discount => ({ ...discount, amount: dollars(discount.amountCents) })));
  const selectedPlan = book?.plans?.find(plan => plan.id === planId), frequencies = [...new Set((selectedPlan?.rates || []).map(rate => rate.frequency))];
  function submit(event) {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    try {
      onReview({ operation, subscriptionId: sub?.id, expectedRevision: sub?.revision, effectiveDate: values.get('effectiveDate'), startDate: values.get('effectiveDate'),
        billingPeriodStart: values.get('billingPeriodStart') || values.get('effectiveDate'), billingPeriodEnd: values.get('billingPeriodEnd'), noticeReminderDate: values.get('noticeReminderDate') || null,
        reason: values.get('reason'), rateSource, manualRateCents: rateSource === 'manual' ? cents(manualRate) : null, manualReason: values.get('manualReason') || '',
        selection: { planId, frequency, dogCount: Number(dogCount), zip, yardTierId, addons: Object.entries(addons).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ({ id, quantity: Number(quantity) })), lineVisibility: visibility,
          discounts: discounts.map(discount => ({ id: discount.id, label: discount.label, amountCents: cents(discount.amount), reason: discount.reason, itemized: visibility[`discount:${discount.id}`] !== false })) },
      });
    } catch (problem) { onError(problem.message); }
  }
  return <form className={s.form} onSubmit={submit}>
    <div className={s.formGrid}><label>Plan<select value={planId} onChange={event => setPlan(event.target.value)} required>{(book?.plans || []).map(plan => <option key={plan.id} value={plan.id}>{titleCase(plan.label)}</option>)}</select></label><label>Service frequency<select value={frequency} onChange={event => setFrequency(event.target.value)} required>{frequencies.map(value => <option key={value} value={value}>{frequencyLabel(value)}</option>)}</select></label><label>Dog count<input type='number' min='1' max='20' value={dogCount} onChange={event => setDogs(event.target.value)} required /></label><label>Service ZIP<input inputMode='numeric' pattern='[0-9]{5}' maxLength={5} value={zip} onChange={event => setZip(event.target.value)} required /></label><label>Yard size<select value={yardTierId} onChange={event => setYard(event.target.value)} required>{(book?.yardTiers || []).map(tier => <option key={tier.id} value={tier.id}>{tier.label} · {money(tier.upchargeCents)} per month</option>)}</select></label></div>
    <fieldset><legend>Add-ons</legend><div className={s.formGrid}>{(book?.addons || []).map(addon => <label key={addon.id}>{addon.label} · {money(addon.unitCents)}{addon.unitLabel ? ` / ${addon.unitLabel}` : ''}<input type='number' min='0' max='50' value={addons[addon.id] || 0} onChange={event => setAddons({ ...addons, [addon.id]: Number(event.target.value) })} /></label>)}</div></fieldset>
    <div className={s.formGrid}><label>Rate source<select value={rateSource} onChange={event => setRateSource(event.target.value)}><option value='preset'>Current price book</option><option value='manual'>Manual rate</option></select></label>{rateSource === 'manual' ? <><label>Manual monthly total ($)<input inputMode='decimal' value={manualRate} onChange={event => setManualRate(event.target.value)} required /></label><label>Manual rate reason<input name='manualReason' maxLength={1000} defaultValue={sub?.manualReason || ''} required /></label></> : null}</div>
    <fieldset><legend>Agreement discounts</legend>{discounts.map((discount, index) => <div className={s.formGrid} key={discount.id}><label>Customer label<input value={discount.label} onChange={event => setDiscounts(discounts.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} required /></label><label>Monthly discount ($)<input inputMode='decimal' value={discount.amount} onChange={event => setDiscounts(discounts.map((item, i) => i === index ? { ...item, amount: event.target.value } : item))} required /></label><label>Discount reason<input value={discount.reason} onChange={event => setDiscounts(discounts.map((item, i) => i === index ? { ...item, reason: event.target.value } : item))} maxLength={1000} required /></label><button type='button' className={s.secondary} onClick={() => setDiscounts(discounts.filter((_, i) => i !== index))}>Remove discount</button></div>)}<button type='button' className={s.secondary} onClick={() => setDiscounts([...discounts, { id: crypto.randomUUID(), label: 'Agreement discount', amount: '', reason: '' }])}>Add agreement discount</button></fieldset>
    <fieldset><legend>Customer price breakdown</legend><p className={s.muted}>Checked lines are itemized. Unchecked amounts are included in the customer's base plan total. The base plan heading remains visible.</p><div className={s.checkGrid}>{[['base', 'Base plan'], ['extra_dogs', 'Extra dogs'], ['yard', 'Yard size'], ...(book?.addons || []).map(addon => [`addon:${addon.id}`, addon.label]), ...discounts.map(discount => [`discount:${discount.id}`, discount.label]), ...(sub?.credits || []).filter(credit => (credit.remainingCents ?? credit.amountCents) > 0).map(credit => [`credit:${credit.id}`, `Promised credit · ${money(credit.remainingCents ?? credit.amountCents)}`]), ['manual_adjustment', 'Manual adjustment']].map(([id, name]) => <label key={id} className={s.check}><input type='checkbox' disabled={id === 'base'} checked={id === 'base' || visibility[id] !== false} onChange={event => setVisibility({ ...visibility, [id]: event.target.checked })} />{name}</label>)}</div></fieldset>
    <div className={s.formGrid}><label>Effective date<input name='effectiveDate' type='date' defaultValue={date} required /></label>{operation === 'create' ? <label>Billing period starts<input name='billingPeriodStart' type='date' defaultValue={date} required /></label> : null}<label>Next billing period starts<input name='billingPeriodEnd' type='date' defaultValue={sub?.billingPeriodEnd || ''} readOnly={Boolean(sub)} required /></label><label>Customer notice reminder<input name='noticeReminderDate' type='date' required={operation === 'schedule_change'} /></label></div>
    <label>Reason for this agreement change<textarea name='reason' maxLength={2000} required /></label><p className={s.muted}>Weekly service is billed as a fixed monthly total. Existing subscriptions retain their agreed rate when the book changes.</p><button disabled={busy}>{busy ? 'Preparing preview...' : 'Preview price and proration'}</button>
  </form>;
}

function OperationEditor({ operation, subscription: sub, versionId, date, busy, onError, onReview }) {
  const [termination, setTermination] = useState('');
  function submit(event) {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    try {
      onReview({ operation, subscriptionId: sub.id, expectedRevision: sub.revision, effectiveDate: values.get('effectiveDate') || date,
        startDate: values.get('effectiveDate') || date, resumeDate: values.get('resumeDate') || null,
        terminationReason: values.get('terminationReason') || null, terminationNote: values.get('terminationNote') || '',
        amountCents: operation === 'promise_credit' ? cents(values.get('amount')) : undefined,
        versionId, customerNotified: values.get('customerNotified') === 'on',
        periodStart: values.get('periodStart') || sub.billingPeriodStart, periodEnd: values.get('periodEnd') || sub.billingPeriodEnd,
        reason: values.get('reason'),
      });
    } catch (problem) { onError(problem.message); }
  }
  return <form className={s.form} onSubmit={submit}>
    <p>{operation === 'cancel' ? 'Use cancellation only when this agreement truly ends. Price, frequency and dog-count changes belong in Change agreement.' : operation === 'promise_credit' ? 'The credit stays attached to this subscription and is applied to the next invoice.' : operation === 'invoice' ? 'Review the exact line items and promised credits before creating the invoice.' : operation === 'acknowledge_notice' ? 'Confirm the customer was notified before marking this reminder complete.' : 'The existing agreement and its history stay together.'}</p>
    <div className={s.formGrid}><label>{operation === 'invoice' ? 'Invoice date' : 'Effective date'}<input name='effectiveDate' type='date' defaultValue={date} required /></label>{['pause', 'skip'].includes(operation) ? <label>Automatically resume on<input name='resumeDate' type='date' min={date} required /></label> : null}{operation === 'promise_credit' ? <label>Promised credit ($)<input name='amount' inputMode='decimal' required /></label> : null}{operation === 'invoice' ? <><label>Billing period starts<input name='periodStart' type='date' defaultValue={sub.billingPeriodStart} required /></label><label>Next billing period starts<input name='periodEnd' type='date' defaultValue={sub.billingPeriodEnd} required /></label></> : null}</div>
    {operation === 'cancel' ? <><label>Termination reason<select name='terminationReason' value={termination} onChange={event => setTermination(event.target.value)} required><option value=''>Choose a reason</option>{terminationReasons.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>Termination note<textarea name='terminationNote' maxLength={2000} required={termination === 'other'} /></label></> : null}
    {operation === 'acknowledge_notice' ? <label className={s.check}><input type='checkbox' name='customerNotified' required />I reviewed the notice and confirmed it was delivered to the customer.</label> : null}
    <label>Reason<textarea name='reason' maxLength={2000} required /></label><button disabled={busy}>{busy ? 'Preparing preview...' : 'Preview change'}</button>
  </form>;
}

function LineTable({ lines = [], total }) {
  return <div className={s.tableWrap}><table><thead><tr><th>Line item</th><th>Quantity</th><th>Amount</th><th>Customer view</th></tr></thead><tbody>{lines.map(line => <tr key={line.id}><td>{line.label}</td><td>{line.quantity}</td><td>{money(line.totalCents)}</td><td>{line.itemized === false ? 'Included in base' : 'Itemized'}</td></tr>)}</tbody><tfoot><tr><th colSpan={2}>Fixed monthly total</th><td>{money(total)}</td><td /></tr></tfoot></table></div>;
}

function Preview({ preview, busy, onApply, onCancel }) {
  const proration = preview.proration, artifact = preview.customerDocument || preview.invoice?.customerDocument || preview.subscription?.customerPricing || preview.invoice || preview.subscription;
  const document = artifact?.pricing || artifact;
  return <section className={s.preview} aria-label='Review before applying'><span className={s.eyebrow}>Preview before applying</span><h2>{preview.isBulk ? 'Bulk repricing review' : label(preview.operation || 'Subscription change')}</h2>
    {preview.isBulk ? <div className={s.tableWrap}><table><thead><tr><th>Subscription</th><th>Current</th><th>Proposed</th><th>Effective date</th></tr></thead><tbody>{(preview.bulk?.rows || preview.changes || preview.rows || []).map(row => <tr key={row.subscriptionId || row.id}><td>{row.subscriptionId || row.id}</td><td>{money(row.oldTotalCents ?? row.currentRateCents)}</td><td>{money(row.newTotalCents ?? row.bookRateCents)}</td><td>{dateLabel(row.effectiveDate || preview.bulk?.effectiveDate)}</td></tr>)}</tbody></table></div> : document?.lineItems || document?.currentLines ? <SubscriptionBreakdown document={document} title='Customer price breakdown' totalLabel={preview.invoice ? 'Invoice total' : 'Monthly total'} /> : null}
    {preview.credit ? <section className={s.proration}><h3>Promised credit: {money(preview.credit.amountCents)}</h3><p>This credit will apply to the next invoice. The recurring monthly rate stays unchanged.</p></section> : null}
    {preview.priceBook ? <><h3>Proposed price book · version {preview.priceBook.version}</h3><p>Effective {dateLabel(preview.priceBook.effectiveDate)}. Existing agreements repriced: {preview.subscriptionsRepriced || 0}.</p><div className={s.tableWrap}><table><thead><tr><th>Plan</th><th>Frequency</th><th>Dogs</th><th>Zone</th><th>Base monthly</th><th>Extra dogs</th></tr></thead><tbody>{(preview.priceBook.plans || []).flatMap(plan => plan.rates.map((rate, index) => <tr key={`${plan.id}-${index}`}><td>{titleCase(plan.label)}</td><td>{frequencyLabel(rate.frequency)}</td><td>{rate.dogCount}</td><td>{rate.zoneId}</td><td>{money(rate.baseCents)}</td><td>{money(rate.extraDogsCents)}</td></tr>))}</tbody></table></div><div className={s.formGrid}>{(preview.priceBook.yardTiers || []).map(tier => <p key={tier.id}><strong>{tier.label}</strong><br />{money(tier.upchargeCents)} monthly yard upcharge</p>)}</div></> : null}
    {proration ? <div className={s.proration}><h3>Proration preview</h3><p>Period starts {dateLabel(proration.periodStart)}; next period starts {dateLabel(proration.periodEnd)}. {proration.affectedDays ?? proration.remainingDays} of {proration.totalDays} days are affected by this change.</p><dl className={s.facts}><div><dt>Previous monthly total</dt><dd>{money(proration.oldTotalCents)}</dd></div><div><dt>New monthly total</dt><dd>{money(proration.newTotalCents)}</dd></div><div><dt>Estimated adjustment</dt><dd>{money(proration.adjustmentCents)}</dd></div></dl><p>Daily proration uses actual days in this billing period. Review this adjustment before applying the change.</p></div> : null}
    {preview.confirmationEmail?.text ? <details><summary>Confirmation email preview</summary><p><strong>{preview.confirmationEmail.subject}</strong></p><pre className={s.emailPreview}>{preview.confirmationEmail.text}</pre></details> : null}
    <p className={s.muted}>Applying saves the reviewed change. Customer notices remain reminders for the office to review.</p><div className={s.actions}><button disabled={busy || !preview.token} onClick={onApply}>{busy ? 'Saving...' : 'Apply reviewed change'}</button><button disabled={busy} className={s.secondary} onClick={onCancel}>Keep unchanged</button></div>
  </section>;
}

function BulkReview({ report = {}, date, busy, onReview }) {
  const [selected, setSelected] = useState([]), rows = report.belowBook || [];
  function submit(event) { event.preventDefault(); const values = new FormData(event.currentTarget); onReview({ subscriptionIds: selected, effectiveDate: values.get('effectiveDate'), reason: values.get('reason') }); }
  return <section className={s.card}><h2>Below-current-book review</h2><p>Price-book updates never change existing agreements automatically. Choose agreements and review the proposed rates before applying.</p><form className={s.form} onSubmit={submit}><div className={s.tableWrap}><table><thead><tr><th>Select</th><th>Customer / subscription</th><th>Agreed monthly</th><th>Current book</th><th>Difference</th></tr></thead><tbody>{rows.map(row => <tr key={row.subscriptionId}><td><input type='checkbox' aria-label={`Select subscription ${row.subscriptionId}`} checked={selected.includes(row.subscriptionId)} onChange={event => setSelected(event.target.checked ? [...selected, row.subscriptionId] : selected.filter(id => id !== row.subscriptionId))} /></td><td>{row.customerName || row.customerId}<small>{row.subscriptionId}</small></td><td>{money(row.currentRateCents)}</td><td>{money(row.bookRateCents)}</td><td>{money(row.bookRateCents - row.currentRateCents)}</td></tr>)}</tbody></table></div>{!rows.length ? <p>No below-book subscriptions in this review.</p> : null}<div className={s.formGrid}><label>Effective date<input name='effectiveDate' type='date' defaultValue={date} required /></label><label>Reason<input name='reason' maxLength={2000} required /></label></div><button disabled={busy || !selected.length}>Preview repricing for {selected.length} agreement{selected.length === 1 ? '' : 's'}</button></form></section>;
}

function Report({ report = {}, onOpenCustomer }) {
  return <><section className={s.metrics}><div><span>Active monthly recurring revenue</span><strong>{money(report.activeMrrCents)}</strong></div><div><span>Manual rate overrides</span><strong>{(report.manualOverrides || []).length}</strong></div><div><span>Below current book</span><strong>{(report.belowBook || []).length}</strong></div></section><div className={s.columns}>{[['MRR by plan', report.byPlan], ['MRR by add-on', report.byAddon]].map(([title, rows]) => <section className={s.card} key={title}><h2>{title}</h2><table><thead><tr><th>Service</th><th>Agreements</th><th>Active MRR</th></tr></thead><tbody>{(rows || []).map(row => <tr key={row.id}><td>{titleCase(row.label)}</td><td>{row.count}</td><td>{money(row.mrrCents)}</td></tr>)}</tbody></table></section>)}</div><section className={s.card}><h2>Manual override drift</h2><div className={s.tableWrap}><table><thead><tr><th>Customer / subscription</th><th>Current book</th><th>Manual rate</th><th>Override difference</th></tr></thead><tbody>{(report.manualOverrides || []).map(row => <tr key={row.subscriptionId}><td>{row.customerName || row.customerId}<small>{row.subscriptionId}</small></td><td>{money(row.bookRateCents)}</td><td>{money(row.manualRateCents)}</td><td>{money(row.driftCents)}</td></tr>)}</tbody></table></div></section><section className={s.card}><h2>Cancellations by reason</h2><table><thead><tr><th>Termination reason</th><th>Count</th></tr></thead><tbody>{(report.cancellationsByReason || []).map(row => <tr key={row.reason}><td>{label(row.reason)}</td><td>{row.count}</td></tr>)}</tbody></table></section><section className={s.card}><h2>Customer notice reminders</h2><p>Pending notices remain visible until the office confirms customer notification.</p><div className={s.tableWrap}><table><thead><tr><th>Customer / subscription</th><th>Reminder due</th><th>Change effective</th><th /></tr></thead><tbody>{(report.noticeReminders || []).map(row => <tr key={`${row.subscriptionId}-${row.versionId}`}><td>{row.customerName || row.customerId}<small>{row.subscriptionId}</small></td><td>{dateLabel(row.dueDate || row.noticeReminderDate)}</td><td>{dateLabel(row.effectiveDate)}</td><td><button className={s.secondary} onClick={() => onOpenCustomer?.(row.customerId)}>Open customer record</button></td></tr>)}</tbody></table></div></section></>;
}

function PriceBookEditor({ book, date, busy, onReview, onError }) {
  const [draft, setDraft] = useState(() => structuredClone(book || {}));
  const [rateFrequency, setRateFrequency] = useState(() => book?.plans?.some(plan => plan.rates?.some(rate => rate.frequency === 'once_a_week')) ? 'once_a_week' : 'all');
  const [rateZone, setRateZone] = useState('all');
  if (!book) return <section className={s.card}><h2>No approved price book</h2><p>A price book must be configured before preset rates can be quoted.</p></section>;
  const catalogRates = (book.plans || []).flatMap(plan => (plan.rates || []).map((rate, index) => ({ ...rate, planId: plan.id, planLabel: titleCase(plan.label || plan.id), key: `${plan.id}-${index}` })));
  const catalogFrequencies = [...new Set(catalogRates.map(rate => rate.frequency))];
  const visibleRates = catalogRates.filter(rate => (rateFrequency === 'all' || rate.frequency === rateFrequency) && (rateZone === 'all' || rate.zoneId === rateZone));
  function tierChange(index, key, value) { setDraft({ ...draft, yardTiers: draft.yardTiers.map((tier, i) => i === index ? { ...tier, [key]: value } : tier) }); }
  function collectionChange(name, index, key, value) { setDraft({ ...draft, [name]: draft[name].map((item, i) => i === index ? { ...item, [key]: value } : item) }); }
  function rateChange(planIndex, rateIndex, key, value) { setDraft({ ...draft, plans: draft.plans.map((plan, p) => p === planIndex ? { ...plan, rates: plan.rates.map((rate, r) => r === rateIndex ? { ...rate, [key]: value } : rate) } : plan) }); }
  const amount = value => typeof value === 'number' ? dollars(value) : value;
  const toCents = value => typeof value === 'number' ? value : cents(value);
  function submit(event) {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    try {
      onReview({ operation: 'price_book', priceBook: { ...draft, version: Number(book.version) + 1, effectiveDate: values.get('effectiveDate'),
        yardTiers: (draft.yardTiers || []).map(tier => ({ ...tier, upchargeCents: toCents(tier.upchargeCents) })),
        plans: (draft.plans || []).map(plan => ({ ...plan, rates: plan.rates.map(rate => ({ ...rate, dogCount: Number(rate.dogCount), baseCents: toCents(rate.baseCents), extraDogsCents: toCents(rate.extraDogsCents) })) })),
        addons: (draft.addons || []).map(addon => ({ ...addon, unitCents: toCents(addon.unitCents) })),
        zones: (draft.zones || []).map(zone => { const { zipText, ...saved } = zone; return { ...saved, zips: typeof zipText === 'string' ? zipText.split(/[\s,]+/).filter(Boolean) : zone.zips }; }),
      }, expectedVersion: book.version, effectiveDate: values.get('effectiveDate'), reason: values.get('reason') });
    } catch (problem) { onError(problem.message); }
  }
  return <section className={s.card}><h2>Price book · version {book.version}</h2><p>Book changes affect new quotes and rate comparisons. Existing subscriptions keep their agreed rates until an amendment is reviewed.</p><dl className={s.facts}><div><dt>Published version</dt><dd>{book.version}</dd></div><div><dt>Effective date</dt><dd>{dateLabel(book.effectiveDate)}</dd></div><div><dt>Service plans</dt><dd>{book.plans?.length || 0}</dd></div><div><dt>Pricing zones</dt><dd>{book.zones?.length || 0}</dd></div></dl>
    <div className={s.catalogColumns}><section className={s.catalogPanel}><div className={s.sectionHeading}><h3>Yard-size surcharges</h3><span className={s.catalogCount}>{book.yardTiers?.length || 0} tiers</span></div><p className={s.muted}>Added to the selected monthly service rate.</p><div className={s.tableWrap}><table aria-label='Published yard-size surcharges'><thead><tr><th>Yard tier</th><th className={s.amount}>Monthly surcharge</th></tr></thead><tbody>{(book.yardTiers || []).map(tier => <tr key={tier.id}><td>{tier.label}</td><td className={s.amount}><strong>{money(tier.upchargeCents)}</strong></td></tr>)}</tbody></table></div></section><section className={s.catalogPanel}><div className={s.sectionHeading}><h3>Add-on services</h3><span className={s.catalogCount}>{book.addons?.length || 0} services</span></div><p className={s.muted}>Published unit rates and billing cadence.</p><div className={s.tableWrap}><table aria-label='Published add-on rates'><thead><tr><th>Service</th><th>Cadence</th><th className={s.amount}>Unit rate</th></tr></thead><tbody>{(book.addons || []).map(addon => <tr key={addon.id}><td>{titleCase(addon.label)}<small>{addon.unitLabel}</small></td><td>{titleCase(addon.billingCadence || 'monthly')}</td><td className={s.amount}><strong>{money(addon.unitCents)}</strong></td></tr>)}</tbody></table></div>{!book.addons?.length ? <p className={s.muted}>No add-on services in this version.</p> : null}</section></div>
    <section className={s.catalogPanel}><div className={s.sectionHeading}><div><h3>Monthly service rates</h3><p className={s.muted}>Fixed monthly pricing before yard-size surcharges and add-on services.</p></div><span className={s.catalogCount}>{visibleRates.length} rates</span></div><div className={s.catalogFilters}><label>Service schedule<select value={rateFrequency} onChange={event => setRateFrequency(event.target.value)}><option value='all'>All schedules</option>{catalogFrequencies.map(value => <option value={value} key={value}>{frequencyLabel(value)}</option>)}</select></label><label>Pricing zone<select value={rateZone} onChange={event => setRateZone(event.target.value)}><option value='all'>All zones</option>{(book.zones || []).map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}</select></label></div><div className={s.tableWrap}><table aria-label='Published monthly service rates'><thead><tr><th>Plan</th><th>Schedule</th><th>Dogs</th><th className={s.amount}>Base rate</th><th className={s.amount}>Extra dogs</th><th className={s.amount}>Monthly total</th></tr></thead><tbody>{visibleRates.map(rate => <tr key={rate.key}><td><strong>{rate.planLabel}</strong><small>{book.zones?.find(zone => zone.id === rate.zoneId)?.label || rate.zoneId}</small></td><td>{frequencyLabel(rate.frequency)}</td><td>{dogsLabel(rate.dogCount)}</td><td className={s.amount}>{money(rate.baseCents)}</td><td className={s.amount}>{money(rate.extraDogsCents || 0)}</td><td className={s.amount}><strong>{money(rate.baseCents + (rate.extraDogsCents || 0))}</strong></td></tr>)}</tbody></table></div>{!visibleRates.length ? <p className={s.empty}>No published rates match this schedule and zone.</p> : null}</section>
    <details className={s.bookEditor}><summary>Edit price book</summary><p>Prepare a new version, set its effective date and review the proposed changes before applying. Existing agreements keep their agreed rates.</p><form className={s.form} onSubmit={submit}>
    <fieldset><legend>Yard size tiers</legend>{(draft.yardTiers || []).map((tier, index) => <div key={index} className={s.formGrid}><label>Tier code<input value={tier.id} onChange={event => tierChange(index, 'id', event.target.value)} required /></label><label>Customer label<input value={tier.label} onChange={event => tierChange(index, 'label', event.target.value)} required /></label><label>Monthly upcharge ($)<input inputMode='decimal' value={amount(tier.upchargeCents)} onChange={event => tierChange(index, 'upchargeCents', event.target.value)} required /></label><button type='button' className={s.secondary} onClick={() => setDraft({ ...draft, yardTiers: draft.yardTiers.filter((_, i) => i !== index) })}>Remove tier</button></div>)}<button type='button' className={s.secondary} onClick={() => setDraft({ ...draft, yardTiers: [...(draft.yardTiers || []), { id: '', label: '', upchargeCents: '' }] })}>Add yard tier</button></fieldset>
    <fieldset><legend>ZIP pricing zones</legend>{(draft.zones || []).map((zone, index) => <div className={s.formGrid} key={index}><label>Zone code<input value={zone.id} onChange={event => collectionChange('zones', index, 'id', event.target.value)} required /></label><label>Zone name<input value={zone.label} onChange={event => collectionChange('zones', index, 'label', event.target.value)} required /></label><label>ZIP codes<input value={zone.zipText ?? (zone.zips || []).join(', ')} onChange={event => collectionChange('zones', index, 'zipText', event.target.value)} placeholder='43615, 43551' /></label></div>)}<button type='button' className={s.secondary} onClick={() => setDraft({ ...draft, zones: [...(draft.zones || []), { id: '', label: '', zips: [] }] })}>Add pricing zone</button></fieldset>
    <fieldset><legend>Plan rates · fixed monthly totals</legend>{(draft.plans || []).map((plan, planIndex) => <details key={planIndex} open><summary>{titleCase(plan.label) || 'New plan'}</summary><div className={s.formGrid}><label>Plan code<input value={plan.id} onChange={event => collectionChange('plans', planIndex, 'id', event.target.value)} required /></label><label>Plan name<input value={plan.label} onChange={event => collectionChange('plans', planIndex, 'label', event.target.value)} required /></label></div><div className={s.tableWrap}><table><thead><tr><th>Frequency</th><th>Dogs</th><th>Zone</th><th>Base monthly ($)</th><th>Extra dogs ($)</th><th /></tr></thead><tbody>{(plan.rates || []).map((rate, rateIndex) => <tr key={rateIndex}><td><select aria-label={`${plan.label} rate ${rateIndex + 1} frequency`} value={rate.frequency} onChange={event => rateChange(planIndex, rateIndex, 'frequency', event.target.value)}>{[...new Set(['twice_a_week', 'once_a_week', 'every_other_week', 'once_a_month', rate.frequency])].filter(Boolean).map(value => <option key={value} value={value}>{frequencyLabel(value)}</option>)}</select></td><td><input aria-label={`${plan.label} rate ${rateIndex + 1} dog count`} type='number' min='1' max='20' value={rate.dogCount} onChange={event => rateChange(planIndex, rateIndex, 'dogCount', event.target.value)} required /></td><td><select aria-label={`${plan.label} rate ${rateIndex + 1} zone`} value={rate.zoneId} onChange={event => rateChange(planIndex, rateIndex, 'zoneId', event.target.value)} required>{(draft.zones || []).map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}</select></td><td><input aria-label={`${plan.label} rate ${rateIndex + 1} base monthly dollars`} inputMode='decimal' value={amount(rate.baseCents)} onChange={event => rateChange(planIndex, rateIndex, 'baseCents', event.target.value)} required /></td><td><input aria-label={`${plan.label} rate ${rateIndex + 1} extra dog dollars`} inputMode='decimal' value={amount(rate.extraDogsCents ?? 0)} onChange={event => rateChange(planIndex, rateIndex, 'extraDogsCents', event.target.value)} required /></td><td><button type='button' className={s.secondary} onClick={() => collectionChange('plans', planIndex, 'rates', plan.rates.filter((_, i) => i !== rateIndex))}>Remove</button></td></tr>)}</tbody></table></div><button type='button' className={s.secondary} onClick={() => collectionChange('plans', planIndex, 'rates', [...plan.rates, { frequency: 'once_a_week', dogCount: 1, zoneId: draft.zones?.[0]?.id || '', baseCents: '', extraDogsCents: 0 }])}>Add plan rate</button></details>)}<button type='button' className={s.secondary} onClick={() => setDraft({ ...draft, plans: [...(draft.plans || []), { id: '', label: '', rates: [] }] })}>Add plan</button></fieldset>
    <fieldset><legend>Add-on rates</legend>{(draft.addons || []).map((addon, index) => <div className={s.formGrid} key={index}><label>Add-on code<input value={addon.id} onChange={event => collectionChange('addons', index, 'id', event.target.value)} required /></label><label>Customer label<input value={addon.label} onChange={event => collectionChange('addons', index, 'label', event.target.value)} required /></label><label>Monthly unit price ($)<input inputMode='decimal' value={amount(addon.unitCents)} onChange={event => collectionChange('addons', index, 'unitCents', event.target.value)} required /></label><label>Quantity unit<input value={addon.unitLabel || ''} onChange={event => collectionChange('addons', index, 'unitLabel', event.target.value)} placeholder='box, treatment, delivery' required /></label></div>)}<button type='button' className={s.secondary} onClick={() => setDraft({ ...draft, addons: [...(draft.addons || []), { id: '', label: '', unitCents: '', unitLabel: '' }] })}>Add add-on rate</button></fieldset>
    <div className={s.formGrid}><label>Effective date<input name='effectiveDate' type='date' defaultValue={date} required /></label><label>Reason for book change<input name='reason' maxLength={2000} required /></label></div><button disabled={busy}>Preview price-book update</button>
  </form></details></section>;
}
