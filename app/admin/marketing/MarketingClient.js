"use client";
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { totals, groupMetrics, historyForSnapshot, importMetaDaily, importOutcomes, acquisitionMetrics } from '@/lib/marketing-metrics.mjs';
import styles from './marketing.module.css';

const money = value => value == null ? '—' : value.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
const integer = value => Number(value || 0).toLocaleString('en-US',{maximumFractionDigits:0});
const percent = value => value == null ? '—' : `${(value*100).toFixed(2)}%`;
function downloadText(name,text,type='text/csv') {
  const url = URL.createObjectURL(new Blob([text],{type}));
  const anchor = document.createElement('a'); anchor.href=url; anchor.download=name; anchor.click(); URL.revokeObjectURL(url);
}
const csvCell = value => `"${String(value ?? '').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')}"`;
const outcomeTemplate = 'lead_id,ad_id,captured_at,qualified_at,signed_up_at,first_paid_at,customer_id,payment_verified,first_payment_amount,mrr\n';

export default function MarketingClient({ seed, briefs, initialSnapshot, storageAvailable, teamPhoto = '/assets/photos/team-founders-sign-640.webp' }) {
  const [snapshot,setSnapshot] = useState(initialSnapshot);
  const [tab,setTab] = useState('performance');
  const [start,setStart] = useState(seed.reportingStart);
  const [end,setEnd] = useState(initialSnapshot.reportingEnd || seed.reportingEnd);
  const [campaign,setCampaign] = useState('all');
  const [group,setGroup] = useState('adId');
  const [complete,setComplete] = useState(false);
  const [extra,setExtra] = useState('0');
  const [target,setTarget] = useState('100');
  const [margin,setMargin] = useState('50');
  const [plannedDaily,setPlannedDaily] = useState('30');
  const [pending,setPending] = useState(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  const history = useMemo(()=>historyForSnapshot(seed.daily,snapshot),[seed,snapshot]);
  const campaigns = [...new Map([...seed.ads,...history].map(row=>[row.campaignId,row.campaign])).entries()];
  const rows = useMemo(()=>history.filter(row=>row.date>=start && row.date<=end && (campaign==='all' || row.campaignId===campaign)),[history,start,end,campaign]);
  const summary = totals(rows);
  const hasLedger = Boolean(snapshot.outcomes?.length);
  const calendarDays = Number.isFinite(Date.parse(end)-Date.parse(start)) && start<=end ? Math.max(1,Math.round((Date.parse(end)-Date.parse(start))/86400000)+1) : 0;
  const trailingWindow = days => { if(Number.isFinite(Date.parse(end))) useDates(new Date(Date.parse(`${end}T00:00:00Z`) - (days-1)*86400000).toISOString().slice(0,10),end); };
  const acquisition = acquisitionMetrics(rows,snapshot.outcomes || [],{start,end,complete,additionalCost:Math.max(0,Number(extra)||0)});
  const monthly = groupMetrics(rows,row=>row.date.slice(0,7)).sort((a,b)=>a.key.localeCompare(b.key));
  const table = groupMetrics(rows,group).sort((a,b)=>b.spend-a.spend);
  const lastActive = [...rows].filter(row=>row.spend>0).sort((a,b)=>b.date.localeCompare(a.date))[0]?.date;
  const fullHistory = start<=seed.reportingStart && end>=seed.reportingEnd;
  const adsMetadata = new Map(seed.ads.map(row=>[row.adId,row]));
  const changeFilter = setter => event => {setter(event.target.value);setComplete(false);};
  const useDates = (from,to) => {setStart(from);setEnd(to);setComplete(false);};

  async function chooseFile(event,action) {
    const file=event.target.files?.[0]; event.target.value=''; if(!file) return;
    setError('');setMessage('');setPending(null);
    try {
      if(file.size>8*1024*1024) throw new Error('Choose a CSV 8 MB or smaller.');
      const csv=await file.text();
      const parsed=action==='meta' ? importMetaDaily(csv,String(seed.accountId)) : importOutcomes(csv);
      setPending({action,csv,name:file.name,description:action==='meta' ? `${parsed.rows.length.toLocaleString()} daily rows • ${parsed.start} to ${parsed.end} • ${money(totals(parsed.rows).spend)} spend` : `${parsed.length.toLocaleString()} unique lead records. Replaces the previously imported outcome ledger.`});
    } catch(err) {setError(err.message);}
  }
  async function saveImport() {
    if(!pending || busy) return;setBusy(true);setError('');
    try {
      const response=await fetch('/api/admin/marketing/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:pending.action,csv:pending.csv,revision:snapshot.revision || ''})});
      const result=await response.json(); if(!response.ok) throw new Error(result.error || 'Import failed.');
      setSnapshot(result.snapshot);setPending(null);setComplete(false);setMessage('Import saved in the private OPWP acquisition view.');
      if(result.snapshot.reportingEnd>end) setEnd(result.snapshot.reportingEnd);
    } catch(err) {setError(err.message);} finally {setBusy(false);}
  }
  function exportTable() {
    const header=['Name','Campaign','Spend USD','Meta form leads','CPL USD','Verified new paying customers','Reconciled media CAC USD','CRM lead to paid rate','Impressions','Link clicks','Link CTR','CPC USD','CPM USD','Leads / link clicks proxy'];
    const records=table.map(row=>{
      const acquired=acquisitionMetrics(row.records,snapshot.outcomes || [],{start,end,complete});
      return [group==='adId'?row.records[0].name:row.records[0].campaign,row.records[0].campaign,row.spend,row.leads,row.cpl,hasLedger?acquired.paid:null,acquired.mediaCac,acquired.closeRate,row.impressions,row.clicks,row.ctr,row.cpc,row.cpm,row.clickLeadProxy];
    });
    downloadText(`opwp-acquisition-${start}-${end}.csv`,[header,...records].map(row=>row.map(csvCell).join(',')).join('\r\n'));
  }

  return <div className={styles.wrap}>
    <div className={styles.status}><span>PRIVATE • USD • META ACCOUNT {seed.accountId}</span><span>Meta data through {snapshot.reportingEnd || seed.reportingEnd} • {snapshot.metaImportedAt ? `Imported ${snapshot.metaImportedAt.slice(0,10)}` : `Audit snapshot ${seed.exportedAt}`}</span></div>
    <nav className={styles.tabs} aria-label="Acquisition views">{[['performance','Performance'],['creatives','Fall creatives'],['audit','Audit findings'],['feeds','Data feeds']].map(([id,label])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    {tab==='performance' && <>
      <section className={styles.filters} aria-label="Report filters">
        <label>From<input aria-label="From date" type="date" value={start} onChange={changeFilter(setStart)}/></label>
        <label>Through<input aria-label="Through date" type="date" value={end} onChange={changeFilter(setEnd)}/></label>
        <label>Campaign<select value={campaign} onChange={changeFilter(setCampaign)}><option value="all">All campaigns</option>{campaigns.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <div className={styles.shortcuts}><button onClick={()=>useDates(seed.reportingStart,snapshot.reportingEnd || seed.reportingEnd)}>All history</button><button onClick={()=>useDates('2025-09-01','2025-10-31')}>Fall 2025</button><button onClick={()=>useDates('2026-01-01','2026-02-28')}>Jan–Feb</button><button onClick={()=>useDates('2026-04-01','2026-04-30')}>April</button>{[7,14,28].map(days=><button key={days} onClick={()=>trailingWindow(days)}>Last {days} days</button>)}</div>
      </section>
      {start>end && <p role="alert" className={styles.warning}>The start date must be before the end date.</p>}
      <div className={styles.metrics}>
        <Metric title="Ad spend" value={money(summary.spend)} note="Meta-reported media cost"/>
        <Metric title="Form leads" value={integer(summary.leads)} note="Attributed results, not unique customers"/>
        <Metric title="Cost per lead" value={money(summary.cpl)} note="Spend ÷ attributed form leads"/>
        <Metric title="Paid customer CAC" value={money(acquisition.mediaCac)} note={complete?'Media spend ÷ verified new customers':'Outcome reconciliation needed'}/>
      </div>
      <div className={styles.notice}><strong>{lastActive ? `Last spending in this selection: ${lastActive}.` : 'No spending in this selection.'}</strong> {snapshot.outcomes?.length ? 'Paid metrics use the imported evidence ledger, assigned to the lead capture cohort.' : 'The historical paid-customer link is missing. Meta form leads and Leads Center “Converted” labels do not establish payment.'} This view updates when a CSV is imported; an automatic Meta API feed is not connected.</div>
      <div className={styles.grid}>
        <section className={styles.panel}><h2>Lead cost over time</h2><p>Monthly CPL, with volume and spend. April 2026 is a partial month. Blank months had no reported spend.</p><div className={styles.chart}>{monthly.map(row=><div className={styles.chartRow} key={row.key}><span>{row.key}</span><div className={styles.barTrack}><div className={styles.bar} style={{width:`${Math.max(1,(row.cpl || 0)/Math.max(1,...monthly.map(r=>r.cpl || 0))*100)}%`}}/></div><strong>{money(row.cpl)}</strong><small>{integer(row.leads)} leads</small></div>)}</div>{!monthly.length && <p>No data in this window.</p>}</section>
        <section className={styles.panel}><h2>Customer conversion</h2><p>Lead capture cohort {start}–{end}; outcomes accumulate through the ledger’s last import. Count each new customer once.</p><dl className={styles.funnel}><div><dt>Matched CRM leads</dt><dd>{integer(acquisition.trackedLeads)}</dd></div><div><dt>Qualified / signed up</dt><dd>{hasLedger ? `${integer(acquisition.qualified)} / ${integer(acquisition.signups)}` : '—'}</dd></div><div><dt>Verified new paying customers</dt><dd>{hasLedger ? integer(acquisition.paid) : '—'}</dd></div><div><dt>Lead → paid conversion</dt><dd>{percent(acquisition.closeRate)}</dd></div><div><dt>Fully loaded CAC</dt><dd>{money(acquisition.loadedCac)}</dd></div><div><dt>New customer MRR</dt><dd>{money(acquisition.mrr)}</dd></div><div><dt>First payments in this cohort</dt><dd>{money(acquisition.firstPayments)}</dd></div></dl>
          <label className={styles.check}><input type="checkbox" checked={complete} disabled={!acquisition.trackedLeads} onChange={e=>setComplete(e.target.checked)}/>I reconciled the entire selected acquisition cohort, including lost leads, duplicate/existing customers and first-payment evidence.</label>
          <label className={styles.inline}>Additional acquisition costs in this selection ($)<input type="number" min="0" max="1000000" value={extra} onChange={e=>setExtra(e.target.value)}/></label>
          <p className={styles.small}>Include discounts, creative production, agency fees and acquisition labor. {acquisition.paid>0 && !complete ? `Observed spend per linked customer is ${money(acquisition.observedCost)}; this is provisional, not a reconciled CAC. ` : ''}{acquisition.unmatched>0 ? `${acquisition.unmatched} ledger leads do not match ad IDs in this selection. ` : ''}MRR is recurring revenue, not profit or cash collected. Imported payment evidence does not change the CRM.</p>
        </section>
      </div>
      <section className={styles.panel}><div className={styles.sectionHeading}><div><h2>What the ads delivered</h2><p>Ratios use summed numerators and denominators. Lead/link click ratio is a directional proxy, not form completion rate.</p></div><div className={styles.actions}><label>Group by<select value={group} onChange={e=>setGroup(e.target.value)}><option value="adId">Creative</option><option value="campaignId">Campaign</option></select></label><button onClick={exportTable}>Download this table</button></div></div>
        <div className={styles.tableWrap}><table><thead><tr><th>{group==='adId'?'Creative':'Campaign'}</th><th>Spend</th><th>Leads</th><th>CPL</th><th>Paid customers</th><th>Media CAC</th><th>CRM lead → paid</th><th>Link CTR</th><th>CPC</th><th>CPM</th><th>Lead / link</th><th>Lifetime frequency</th></tr></thead><tbody>{table.map(row=>{const acquired=acquisitionMetrics(row.records,snapshot.outcomes || [],{start,end,complete});return <tr key={row.key}><td><strong>{group==='adId'?row.records[0].name:row.records[0].campaign}</strong>{group==='adId' && <small>{row.records[0].campaign}<br/>{row.key}</small>}</td><td>{money(row.spend)}</td><td>{integer(row.leads)}</td><td>{money(row.cpl)}</td><td>{hasLedger?integer(acquired.paid):'—'}</td><td>{money(acquired.mediaCac)}</td><td>{percent(acquired.closeRate)}</td><td>{percent(row.ctr)}</td><td>{money(row.cpc)}</td><td>{money(row.cpm)}</td><td>{percent(row.clickLeadProxy)}</td><td>{group==='adId' && fullHistory && !snapshot.metaImportedAt ? adsMetadata.get(row.key)?.frequency?.toFixed(2) || '—' : '—'}</td></tr>;})}</tbody></table></div>
        <p className={styles.small}>{seed.ads.filter(row=>!row.spend && !row.leads).length} exported ads had no spend/results. Deleted delivered ads are included in the seed. Unique reach and frequency cannot be added across ads or days; lifetime frequency only appears for the original full export.</p>
      </section>
      <div className={styles.metrics}><Metric title="Link CTR" value={percent(summary.ctr)} note={`${integer(summary.clicks)} link clicks / ${integer(summary.impressions)} impressions`}/><Metric title="CPC / CPM" value={`${money(summary.cpc)} / ${money(summary.cpm)}`} note="Click cost / cost per 1,000 impressions"/><Metric title="3-second plays" value={integer(summary.video3s)} note={`${integer(summary.thruplays)} ThruPlays; mixed creative formats`}/><Metric title="Landing page views" value={integer(summary.landingViews)} note="Instant-form ads do not require a website visit"/></div>
      <section className={styles.panel}><h2>Spend pacing</h2><label className={styles.inline}>Planned daily spend for this selection ($)<input type="number" min="0" max="100000" value={plannedDaily} onChange={e=>setPlannedDaily(e.target.value)}/></label><p>{calendarDays} calendar days • {money(calendarDays?summary.spend/calendarDays:null)} average daily spend • {money(Math.max(0,Number(plannedDaily)||0)*calendarDays)} planned spend • {percent(Number(plannedDaily)>0 && calendarDays ? summary.spend/(Number(plannedDaily)*calendarDays) : null)} of plan. This is a planning input; it does not change an ad budget.</p></section>
      <section className={styles.panel}><h2>Planning calculator</h2><p>Scenario only. Choose a target CAC from contribution profit and cash payback, then work backwards to the needed close rate.</p><div className={styles.actions}><label>Target CAC ($)<input type="number" value={target} min="1" onChange={e=>setTarget(e.target.value)}/></label><label>Monthly contribution margin (%)<input type="number" min="1" max="100" value={margin} onChange={e=>setMargin(e.target.value)}/></label></div><p>At the selected {money(summary.cpl)} CPL, a {money(Number(target))} media CAC requires about <strong>{percent(summary.cpl && Number(target)>0 ? summary.cpl/Number(target) : null)}</strong> lead-to-paid conversion. Estimated contribution payback from a reconciled cohort: <strong>{acquisition.loadedCac && acquisition.paid && acquisition.mrr && Number(margin)>0 ? `${(acquisition.loadedCac/(acquisition.mrr/acquisition.paid*Math.min(100,Number(margin))/100)).toFixed(1)} months` : 'needs verified customers, MRR and margin'}</strong>. Initial cleanup revenue, churn and route travel change the economics.</p></section>
      {(seed.breakdowns.placement || seed.breakdowns.demographics) && <section className={styles.panel}><h2>Historical delivery diagnostics</h2><p>Lifetime export only, through {seed.exportedAt}. These tables do not follow the date filters. Campaign selection applies. Delivery was allocated by Meta, so differences are not randomized causal results.</p><div className={styles.grid}>{[['placement',row=>`${row.Platform} · ${row.Placement}`,'Placements'],['demographics',row=>`${row.Age} · ${row.Gender}`,'Age and gender']].map(([key,fn,title])=><div key={key}><h3>{title}</h3><div className={styles.tableWrap}><table><thead><tr><th>Segment</th><th>Spend</th><th>Leads</th><th>CPL</th></tr></thead><tbody>{groupMetrics((seed.breakdowns[key] || []).filter(row=>campaign==='all'||row.campaignId===campaign),fn).sort((a,b)=>b.spend-a.spend).map(row=><tr key={row.key}><td>{row.key}</td><td>{money(row.spend)}</td><td>{integer(row.leads)}</td><td>{money(row.cpl)}</td></tr>)}</tbody></table></div></div>)}</div></section>}
    </>}
    {tab==='creatives' && <><section className={styles.hero}><div><span>FALL 2026 • PRODUCTION BRIEFS</span><h2>Keep the proof. Refresh the message.</h2><p>Start with the real team and a clear service demo. Add one distinct fall convenience concept. Build the remaining ideas as reserves so production stays ahead of fatigue.</p></div><img src={teamPhoto} alt="Ohio Pet Waste Pros founders with the company yard sign"/></section><div className={styles.creativeGrid}>{briefs.map(brief=><article className={styles.panel} key={brief.id}><div className={styles.badge}>{brief.id} · {brief.priority}</div><h2>{brief.title}</h2><p>{brief.format}</p><h3>“{brief.hook}”</h3><p><strong>Why test it:</strong> {brief.hypothesis}</p><p className={styles.small}>{brief.evidence}</p><details open><summary>Copy & production</summary><p><strong>Primary text:</strong> {brief.primary}</p><p><strong>Headline:</strong> {brief.headline}</p>{brief.voiceover && <p><strong>Voice-over:</strong> {brief.voiceover}</p>}<p>{brief.production}</p><ul>{brief.shots.map(shot=><li key={shot}>{shot}</li>)}</ul></details></article>)}</div><section className={styles.notice}><strong>Deliver each video in 9:16 with natural audio, readable captions and key elements within Meta’s safe zone.</strong> Make deliberate 4:5 Feed crops and inspect every placement. Use real staff, genuine service footage and permissioned customer scenes. Preview Advantage+ variations so generated text, offers, crops or backgrounds do not change your claims.</section></>}
    {tab==='audit' && <div className={styles.audit}>
      <section className={styles.panel}><h2>The winning campaign is the starting point</h2><p>{seed.findings.summary}</p><p>{seed.findings.timeTrend}</p></section>
      <section className={styles.panel}><h2>Algorithm implications</h2><p>Meta’s Andromeda retrieves relevant ads; ranking and GEM use broader learned signals. Content matters, but geography, objective, feedback and customer behavior still matter. Neither a magic creative count nor unlimited broad targeting follows from these engineering changes.</p><p>Use a small set of distinct concepts in serviceable geographic controls. {seed.findings.audience}</p><p><a href="https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/" target="_blank" rel="noreferrer">Meta: Andromeda</a> · <a href="https://engineering.fb.com/2025/11/10/ml-applications/metas-generative-ads-model-gem-the-central-brain-accelerating-ads-recommendation-ai-innovation/" target="_blank" rel="noreferrer">Meta: GEM</a> · <a href="https://about.fb.com/news/2026/01/2026-ai-drives-performance/" target="_blank" rel="noreferrer">Meta: 2026 performance update</a></p></section>
      <section className={styles.panel}><h2>Form and follow-up</h2><p>{seed.findings.form}</p><p>Keep autofilled contact fields and the qualifiers that change your quote. Test Higher intent against the current form after its setting is verified. A higher CPL can still win if paid conversion improves. Do not add every possible question at once. Explicit SMS consent remains a separate release requirement; a contact preference is not the same field.</p><p>{seed.findings.leadExport}</p><p><a href="https://about.fb.com/ltam/wp-content/uploads/sites/14/2023/11/LeadGenerationGuide.pdf" target="_blank" rel="noreferrer">Meta: lead generation guide</a> · <a href="https://www.facebook.com/business/ads/facebook-instagram-reels-ads" target="_blank" rel="noreferrer">Meta: Reels guidance</a> · <Link href="/admin/quote-funnel/">YardOps pipeline</Link></p></section>
      <section className={styles.panel}><h2>Launch and review rules</h2><ol><li>Confirm route areas/capacity, launch budget, response coverage and offer terms.</li><li>Start with the team photo, service demo and one fall concept; avoid splitting a small local budget into many tiny ad sets.</li><li>Verify form delivery, consent handling, ad/lead IDs and signup/first-payment matching before scaling.</li><li>Review spend, delivery errors and contact backlog daily. Compare 7/14/28-day paid cohorts weekly, allowing the actual sales lag.</li><li>Use paired metrics: CPM + CTR + lead/link proxy + qualified/paid conversion. Refresh when cost and quality worsen together; do not stop an ad based only on lifetime frequency.</li><li>Choose paid CAC and contribution payback thresholds before scaling. Ads Manager’s opportunity score of 100 is not proof of profitable acquisition.</li></ol></section>
      <section className={styles.notice}><strong>Audit scope:</strong> Account {seed.accountId}. {seed.findings.scope}</section>
    </div>}
    {tab==='feeds' && <div className={styles.audit}>
      <section className={styles.panel}><h2>Update this one view</h2><p>Import daily Meta exports as ads run. Matching ad/day rows replace previous values, so overlapping attribution windows do not double-count. Refresh the last 28 days for backfilled results. Historical breakdowns remain the original audit snapshot.</p><ol><li>Ads Manager → Ads → selected date range → Day breakdown only.</li><li>Include Account ID, Campaign ID, Ad ID, names, USD spend, Results and result indicator, impressions, link clicks, attribution setting; optional video/engagement metrics.</li><li>Use 7-day click / 1-day view consistently. Include deleted ads with delivery. Exclude summary totals and other breakdowns.</li><li>Export CSV, choose it below, review the preview and save. Data stays in the private OPWP system.</li></ol><div className={styles.actions}><label className={styles.fileButton}>Choose daily Meta CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e=>chooseFile(e,'meta')}/></label><a href={`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${encodeURIComponent(seed.accountId)}`} target="_blank" rel="noreferrer">Open Ads Manager</a></div></section>
      <section className={styles.panel}><h2>Reconcile leads to first paying customers</h2><p>Download the ledger template. Include every real lead, including lost/unqualified leads, with its Meta lead ID, ad ID and capture date. Preserve raw lead volume separately from deduplicated CRM people. Only mark payment_verified=true when a new customer’s first service payment is confirmed in your billing records.</p><p>Use blank outcome dates for stages not reached. A “Converted” label, signup or manually won pipeline stage does not establish payment. customer_id must remain stable; each customer is counted once and assigned to the earliest verified linked lead in the ledger. Include first_payment_amount and mrr if verified; blank revenue fields stay unreported. The ledger replaces the previous outcome import, so import the full reconciled history.</p><div className={styles.actions}><button onClick={()=>downloadText('opwp-meta-outcomes-template.csv',outcomeTemplate)}>Download outcome template</button><label className={styles.fileButton}>Choose outcome ledger CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e=>chooseFile(e,'outcomes')}/></label></div><p className={styles.small}>Identifiers and dates only; omit names, phone numbers and email addresses. This reporting import does not send messages, mark invoices paid, change CRM stages or upload conversions to Meta.</p></section>
      {pending && <section className={styles.panel}><h2>Review import</h2><strong>{pending.name}</strong><p>{pending.description}</p><div className={styles.actions}><button disabled={busy || !storageAvailable} onClick={saveImport}>{busy?'Saving…':'Save private import'}</button><button disabled={busy} onClick={()=>setPending(null)}>Cancel</button></div></section>}
      {error && <p className={styles.warning} role="alert">{error}</p>}{message && <p className={styles.notice} role="status">{message}</p>}
      {!storageAvailable && <p className={styles.warning}>Private storage is unavailable in this environment. The historical view works; imports cannot be saved until the authenticated database is available.</p>}
      <section className={styles.panel}><h2>Connection status and next step</h2><dl className={styles.funnel}><div><dt>Historical Meta data</dt><dd>Loaded</dd></div><div><dt>Daily Meta feed</dt><dd>Manual CSV</dd></div><div><dt>Paid-customer ledger</dt><dd>{snapshot.outcomes?.length ? `${integer(snapshot.outcomes.length)} records` : 'Not reconciled'}</dd></div><div><dt>Automatic Marketing API feed</dt><dd>Not connected</dd></div><div><dt>CRM → Meta Conversions API</dt><dd>Not verified</dd></div></dl><p>Keep Quo and Airtable for the workflow you already pay for. This view adds no reporting subscription. An automatic read-only Marketing API feed needs appropriately authorized account access; conversion feedback is a separate integration with event validation, deduplication and privacy controls. Do not activate a qualified-lead optimization goal until the feedback events are working.</p></section>
    </div>}
  </div>;
}
function Metric({title,value,note}) {return <section className={styles.metric}><span>{title}</span><strong>{value}</strong><small>{note}</small></section>;}
