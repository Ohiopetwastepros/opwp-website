"use client";
import { useMemo,useState } from 'react';
import { buildDensityAnalysis } from '@/lib/live-density-calculations.mjs';
import MarketingClient from '../marketing/MarketingClient';
import DensityPanel from './DensityPanel';
import BusinessPanel from './BusinessPanel';
import styles from './acquisition.module.css';
const TABS=[['overview','Overview'],['advertising','Advertising'],['density','Route density'],['businesses','Business opportunities']];
export default function AcquisitionClient({seed,density,densityReviews,briefs,marketing,businesses,stages,marketingAvailable,businessAvailable,initialTab,teamPhoto}) {
  const [tab,setTab]=useState(TABS.some(([id])=>id===initialTab)?initialTab:'overview');
  const [businessSnapshot,setBusinessSnapshot]=useState(businesses);
  const [densitySource,setDensitySource]=useState(density);
  const densityModel=useMemo(()=>densitySource?buildDensityAnalysis(densitySource):null,[densitySource]);
  function select(id) {setTab(id);const url=new URL(window.location.href);url.searchParams.set('tab',id);window.history.replaceState(null,'',url);}
  return <div className={styles.workspace}>
    <nav className={styles.tabs} aria-label="Acquisition workspace">{TABS.map(([id,label])=><button type="button" key={id} aria-pressed={tab===id} onClick={()=>select(id)}>{label}</button>)}</nav>
    <div hidden={tab!=='overview'}>
      <section className={styles.hero}><span>CUSTOMERS & GROWTH</span><h2>Build a denser, more valuable customer book.</h2><p>Evaluate the cost of winning customers alongside the work needed to serve them. Keep future business purchases in the same workspace.</p></section>
      <div className={styles.cards}>
        <section className={styles.card}><span>Advertising</span><h2>Spend → leads → paying customers</h2><p>Historical Meta results, conversion reporting, fall creative briefs and private data imports.</p><button onClick={()=>select('advertising')}>Open advertising</button></section>
        <section className={styles.card}><span>Route density</span><h2>Acquire nearby customers</h2><p>{densityModel?`${densityModel.scope.trustedGeocodes} reliable mapped locations from ${densityModel.scope.activeRecords} active clients. Explore current pockets, service-day patterns and infill suggestions.`:'Open the live map to load the current Airtable client book.'}</p><button onClick={()=>select('density')}>Explore route density</button></section>
        <section className={styles.card}><span>Business acquisitions</span><h2>Build an opportunity pipeline</h2><p>{businessSnapshot.opportunities.length ? `${businessSnapshot.opportunities.length} saved ${businessSnapshot.opportunities.length===1?'opportunity':'opportunities'}.` : 'No opportunities saved yet.'} Track local businesses, recurring customers, asking prices, diligence and next steps.</p><button onClick={()=>select('businesses')}>Review business opportunities</button></section>
      </div>
      <section className={styles.panel}><h2>Current priorities</h2><ol><li>Use the live density map to select neighborhoods for proven team and service-demo ads, plus a fall convenience challenger.</li><li>Confirm Craig’s additional field hours and check address-level road fit before growing the route.</li><li>Match leads to verified first payments so paid CAC and conversion rates can be reported.</li></ol><p className={styles.note}>Airtable customer locations refresh automatically every 10 minutes. Advertising still refreshes through private CSV imports. Suggestions and saved reviews do not execute customer, staff or ad changes.</p></section>
    </div>
    <div hidden={tab!=='advertising'}><MarketingClient seed={seed} briefs={briefs} initialSnapshot={marketing} storageAvailable={marketingAvailable} teamPhoto={teamPhoto}/></div>
    <div hidden={tab!=='density'}><DensityPanel data={densitySource} onSource={setDensitySource} initialReviews={densityReviews} active={tab==='density'}/></div>
    <div hidden={tab!=='businesses'}><BusinessPanel snapshot={businessSnapshot} onSnapshot={setBusinessSnapshot} stages={stages} storageAvailable={businessAvailable}/></div>
  </div>;
}
