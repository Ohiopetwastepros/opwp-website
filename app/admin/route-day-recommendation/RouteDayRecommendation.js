'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './route-day.module.css';

export default function RouteDayRecommendation() {
  const [address, setAddress] = useState('');
  const [frequency, setFrequency] = useState('once_a_week');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const activeRequest = useRef(null);
  const debounce = useRef(null);

  async function recommend() {
    clearTimeout(debounce.current);
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const id = ++generation.current;
    setLoading(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/admin/route-assignment/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal: controller.signal,
        body: JSON.stringify({ address: address.trim(), frequency, monthly_revenue: 0 }) });
      const data = await response.json().catch(() => null);
      if (controller.signal.aborted || id !== generation.current) return;
      if (!response.ok || !data?.ok) throw new Error(response.status === 401 ? 'Your session expired. Sign in again to check this address.' : data?.error || 'The route check could not finish. Try again.');
      setResult(data.recommendation);
    } catch (failure) { if (id === generation.current && failure.name !== 'AbortError') setError(failure.message); }
    finally { if (id === generation.current) setLoading(false); }
  }

  useEffect(() => {
    generation.current++; activeRequest.current?.abort();
    setResult(null); setError(''); setLoading(false);
    if (!/^.+,\s*[^,]+,\s*(OH|MI)\s*,?\s*\d{5}$/i.test(address.trim())) return;
    debounce.current = setTimeout(recommend, 1000);
    return () => { clearTimeout(debounce.current); activeRequest.current?.abort(); };
  }, [address, frequency]);

  const day = result?.recommendedPair || result?.recommendedDay;
  const geographic = result?.recommendationBasis === 'current_route_geography';
  const choices = result?.rankedDays?.filter(row => row.allowed && row.available) || [];
  const warnings = [...new Set([...(result?.routeWarnings || []), result?.airtableFreshness?.warning].filter(Boolean))];
  return <div className={styles.tool}>
    <form className={styles.search} onSubmit={event => { event.preventDefault(); recommend(); }}>
      <label htmlFor="route-address">Service address</label>
      <input id="route-address" value={address} onChange={event => setAddress(event.target.value)} placeholder="5061 Sandra Drive, Toledo, OH 43613" autoComplete="street-address" maxLength={400} required aria-describedby="route-address-help" />
      <p id="route-address-help">Include street, city, state, and ZIP. A complete address checks automatically.</p>
      <div className={styles.controls}><label>Service frequency<select value={frequency} onChange={event => setFrequency(event.target.value)}><option value="once_a_week">Weekly</option><option value="every_other_week">Every other week</option><option value="once_a_month">Monthly</option><option value="twice_a_week">Twice weekly</option></select></label><button type="submit" disabled={loading || !address.trim()}>{loading ? 'Checking current routes…' : 'Find route day'}</button></div>
    </form>
    {error ? <div role="alert" className={styles.error}>{error}</div> : null}
    {loading ? <div role="status" className={styles.empty}>Locating the address and comparing nearby route stops…</div> : null}
    {result ? <section className={styles.result} aria-live="polite">
      <div className={styles.resultHead}><span>{!day ? 'No close route match' : geographic ? 'Provisional geographic match' : 'Closest street-connected route'}</span>{day ? <b>{geographic ? 'Road check pending' : 'Road access checked'}</b> : null}</div>
      <h2>{day || 'Owner review needed'}</h2>
      <p className={styles.address}>{result.formattedAddress || result.address}</p>
      <p>{result.guidance || 'No close route was found in the permitted service territory. Review this address before offering a service day.'}</p>
      {day ? <p className={styles.assignment}>{result.region} · {result.recommendedTechnician || 'Confirm technician'}</p> : null}
      {geographic ? <div className={styles.notice}>The street-level road check is currently unavailable. This suggestion uses nearby active customers and their existing days. It is not a verified driving-time match.</div> : <div className={styles.notice}>Road distance accounts for street connections and access in both directions. Compares up to five nearby stops per eligible day; it does not reorder existing routes or measure live traffic.</div>}
      {choices.length ? <div className={styles.tableWrap}><table><caption>Current route matches</caption><thead><tr><th>Day</th><th>Closest current stop</th><th>{geographic ? 'Straight-line distance' : 'Road match'}</th><th>Area stops</th></tr></thead><tbody>{choices.map(row => <tr key={row.day} className={day?.includes(row.day) ? styles.chosen : ''}><th scope="row">{row.day}</th><td>{row.nearestAddress}</td><td>{geographic ? `${row.nearestMiles} mi` : `${row.nearestRoadMinutes} min · ${row.nearestRoadMiles} mi`}</td><td>{row.regionDensity}</td></tr>)}</tbody></table></div> : null}
      <details className={styles.details}><summary>Source and limitations</summary><p>Current route snapshot: {result.sourceSnapshotAt || 'Unavailable'}. Existing customer days are preserved. Confirm staffing and the service day before scheduling.</p>{warnings.map(warning => <p key={warning}>{warning}</p>)}</details>
    </section> : !loading ? <div className={styles.empty}><strong>One address. The best current day.</strong><p>Matches your active customer routes and service territory. Background route planning is paused; this check stays within the existing free routing allowance.</p></div> : null}
  </div>;
}
