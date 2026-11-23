'use client';
import { useEffect, useState } from 'react';
import SubscriptionHistory from '@/components/crm/SubscriptionHistory';

export default function SubscriptionPortal() {
  const [history, setHistory] = useState([]), [cursor, setCursor] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(true), [linked, setLinked] = useState(true);
  async function load(next = '') {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/crm/subscriptions/portal/?${new URLSearchParams(next ? { cursor: next } : {})}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Your history could not be loaded.');
      setHistory(prior => next ? [...prior, ...result.subscriptions] : result.subscriptions);
      setCursor(result.nextCursor); setLinked(result.linked);
    } catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  return <main style={{ maxWidth: '60rem', margin: '2rem auto', padding: '1rem' }}>
    <a href="/dog-food/account/">Back to your account</a>
    <h1>Ohio Pet Waste Pros subscriptions</h1>
    <p>See your active and past service history, price changes, and itemized monthly totals.</p>
    {error ? <p role="alert">{error} <button onClick={() => void load()}>Try again</button></p> : null}
    {!linked ? <p>Contact the office to connect your service history to your account.</p> : null}
    {history.length || !busy && !error ? <SubscriptionHistory subscriptions={history} /> : null}
    {busy ? <p role="status">Loading your history…</p> : null}
    {cursor ? <button disabled={busy} onClick={() => void load(cursor)}>Load more history</button> : null}
  </main>;
}
