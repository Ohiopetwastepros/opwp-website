'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseHostedTokenizerMessage, safeHostedTokenizerConfig } from '../../lib/hosted-payment-tokenizer.mjs';

export default function HostedPaymentMethod({ customerId, config, onSaved }) {
  const [methodType, setMethodType] = useState('card'), [ready, setReady] = useState(false), [consent, setConsent] = useState(false);
  const [billingZip, setBillingZip] = useState(''), [isDefault, setIsDefault] = useState(true), [saving, setSaving] = useState(false), [notice, setNotice] = useState(''), [generation, setGeneration] = useState(0);
  const frame = useRef(null), ephemeral = useRef(null), savingLock = useRef(false);
  const configurations = config?.tokenizerConfigs || config;
  const selected = useMemo(() => safeHostedTokenizerConfig(configurations?.[methodType] || (configurations?.methodType === methodType ? configurations : null)), [configurations, methodType]);
  const localFake = selected?.provider === 'fake';
  useEffect(() => {
    ephemeral.current = null; setReady(false); setConsent(false);
    if (!selected) return undefined;
    const onMessage = event => {
      const parsed = parseHostedTokenizerMessage(event, { origin: selected.origin, source: frame.current?.contentWindow });
      if (!parsed || savingLock.current) return;
      ephemeral.current = parsed.status === 'ready' ? { token: parsed.token, receivedAt: Date.now() } : null;
      setReady(parsed.status === 'ready');
      if (parsed.status === 'invalid') setNotice('Complete the payment details in the secure form.');
      else setNotice('Secure payment details are ready to save.');
    };
    window.addEventListener('message', onMessage);
    return () => { window.removeEventListener('message', onMessage); ephemeral.current = null; };
  }, [selected, customerId, generation]);
  async function save(event) {
    event.preventDefault();
    if (savingLock.current || !consent || !/^\d{5}(?:-\d{4})?$/.test(billingZip) || !customerId || !selected) return;
    const current = ephemeral.current;
    if (!current || Date.now() - current.receivedAt > 90_000) { ephemeral.current = null; setReady(false); setNotice('Refresh the secure form and enter the payment details again.'); return; }
    savingLock.current = true; ephemeral.current = null; setReady(false); setSaving(true); setNotice('');
    try {
      const response = await fetch('/api/admin/crm/billing/methods', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, token: current.token, methodType, billingZip, consent: true, isDefault }),
      });
      if (!response.ok) throw new Error('profile_save_failed');
      // The server returns only the safe method projection, never the processor token.
      const saved = await response.json();
      setNotice('Payment method saved.'); setConsent(false); setGeneration(value => value + 1);
      onSaved?.(saved);
    } catch { setNotice('The payment method could not be saved. Refresh the secure form before trying again.'); }
    finally { savingLock.current = false; setSaving(false); }
  }
  return <form onSubmit={save} aria-label='Secure UAT payment method'>
    <h3>Add a payment method</h3>
    <p>{localFake ? 'Local fake payments only. Choose the sample method below; do not enter real payment details.' : <>Use the processor&apos;s secure form to save a card or bank account.</>}</p>
    <label>Payment type <select value={methodType} disabled={saving} onChange={event => { setNotice(''); setMethodType(event.target.value); }}><option value='card'>Card</option><option value='ach'>ACH bank account</option></select></label>
    {selected ? <>
      {methodType === 'ach' ? <p>{localFake ? 'The fake bank method creates a Pending ACH result. No bank details or external processor are used.' : 'Enter routing number / account number inside the secure form. ACH payments remain pending until settlement; bank returns may arrive later.'}</p> : null}
      <iframe ref={frame} key={`${methodType}-${customerId}-${generation}`} src={selected.url} title={methodType === 'ach' ? 'Processor hosted ACH form' : 'Processor hosted card form'} referrerPolicy='no-referrer' style={{ width: '100%', minHeight: methodType === 'card' ? 260 : 130, border: '1px solid #cad5df', borderRadius: 8 }} />
      <label>Billing ZIP <input name='billingZip' autoComplete='postal-code' inputMode='numeric' value={billingZip} maxLength={10} pattern='[0-9]{5}(-[0-9]{4})?' required disabled={saving} onChange={event => setBillingZip(event.target.value)} /></label>
      <label><input type='checkbox' checked={isDefault} disabled={saving} onChange={event => setIsDefault(event.target.checked)} /> Use as the default payment method</label>
      <label><input type='checkbox' checked={consent} required disabled={saving} onChange={event => setConsent(event.target.checked)} /> The customer authorized saving this method for approved recurring payments.</label>
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}><button type='submit' disabled={!ready || !consent || saving}>{saving ? 'Saving…' : 'Save payment method'}</button><button type='button' disabled={saving} onClick={() => { setNotice(''); setGeneration(value => value + 1); }}>Refresh secure form</button></div>
    </> : <p>Processor UAT setup is required before this payment type is available.</p>}
    <p role='status' aria-live='polite'>{notice}</p>
  </form>;
}
