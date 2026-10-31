'use client';
import {recordDestination} from '@/lib/admin-record-policy.mjs';
import {useState} from 'react';
import s from './sales-operations.module.css';
import x from './inventory-dashboard.module.css';
import {foodSalesCsv,personalUseLabel} from '../../../lib/dog-food-profit-loss.mjs';
const money=n=>n==null?'Unknown':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
const stamp=v=>v?new Date(/[zZ]|[+-]\d\d:\d\d$/.test(v)?v:v.replace(' ','T')+'Z').toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'short'}):'Unavailable';
const sum=(rows,key)=>rows.reduce((n,r)=>n+(r[key]??0),0);
function Source({id,table='tblpEYQ3qpfcKLmdo'}){return /^rec[a-zA-Z0-9]{14}$/.test(id||'')?<a href={recordDestination('appc40e3mlfOt2HoA',table,id)}>Inspect source record</a>:<code>{id}</code>;}
function Table({head,children}){return <div className={s.tableWrap}><table><thead><tr>{head.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;}
function Card({title,caption,children}){return <section className={s.card}><div className={s.cardHeading}><div><small>{caption}</small><h2>{title}</h2></div></div>{children}</section>;}
export function exportFoodSales(rows){
  const csv=foodSalesCsv(rows);
  const link=document.createElement('a'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.href=url;link.download='opwp-dog-food-sales-profit-loss.csv';link.click();URL.revokeObjectURL(url);
}
export default function SalesProfitLoss({data,initialPeriod='all',initialSku='all',compact=false}) {
  const report=data.intelligence?.inventory?.salesReport;
  const [period,setPeriod]=useState(initialPeriod),[sku,setSku]=useState(initialSku),[query,setQuery]=useState(''),[scope,setScope]=useState('all'),[page,setPage]=useState(0);
  if(!report)return <p>Sales and cost reporting is unavailable.</p>;
  const periodRows=report.rows.filter(r=>(period==='all'||(period==='undated'?!r.date:r.date.slice(0,7)===period))&&(sku==='all'||r.productId===sku)),customer=periodRows.filter(r=>r.included),costed=customer.filter(r=>r.referenceCostCents!=null),unmatched=customer.filter(r=>r.referenceCostCents==null),
    actualSales=sum(customer,'totalCents'),knownCost=sum(costed,'referenceCostCents'),knownMargin=sum(costed,'referenceMarginCents'),cash=sum(customer.filter(r=>!r.cashConflict),'supportedCashCents'),verifiedGross=customer.length&&customer.every(r=>r.exactGrossProfitCents!=null)?sum(customer,'exactGrossProfitCents'):null;
  const matches=periodRows.filter(r=>(scope==='all'||scope==='customer'&&r.included||scope==='review'&&r.review.length>0)&&[r.id,r.name,r.productName,r.notes,r.responsible,r.paymentMethod,r.orderId,r.paymentReference,...(r.receipts||[]).map(p=>p.reference)].join(' ').toLowerCase().includes(query.toLowerCase()));
  const pages=Math.max(1,Math.ceil(matches.length/50)),currentPage=Math.min(page,pages-1),visibleRows=matches.slice(currentPage*50,currentPage*50+50);
  const periodBusinessCosts=report.businessCosts.filter(c=>(sku==='all'||c.product_id===sku)&&(period==='all'||(period==='undated'?!c.actual_date:c.actual_date?.slice(0,7)===period))),knownLosses=sum(periodBusinessCosts,'totalCents');
  const personalUse=(report.personalUse||[]).filter(c=>(sku==='all'||c.product_id===sku)&&(period==='all'||(period==='undated'?!c.actual_date:c.actual_date?.slice(0,7)===period))),confirmedPersonal=personalUse.filter(c=>c.review_status==='confirmed'&&c.linked);
  return <div className={x.root}>
    {!compact&&<div className={x.intro}><div><small>AIRTABLE SALES & COST DETAIL</small><h2>Every sale. Every recorded dollar.</h2><p>Customer sales, payment evidence and a dealer-cost operating margin, with the source records behind each amount. Personal use remains separate.</p></div><div className={x.sync}><strong>Extreme Dog Fuel Airtable</strong><span>{report.rows.length} source sales records</span><small>Snapshot: {stamp(data.intelligence.inventory.sync.capturedAt)}<br/>Production sync: {stamp(data.intelligence.inventory.sync.lastSuccessAt)}</small></div></div>}
    <Card title="Sales and profit/loss basis" caption="ACTUAL RECORDED AMOUNTS · COST BASIS LABELED">
      <div className={x.toolbar}>
        <label>Sales period<select value={period} onChange={e=>{setPeriod(e.target.value);setPage(0);}}><option value="all">All recorded history</option>{[...report.monthly].reverse().map(m=><option key={m.month} value={m.month}>{m.month}{m.month===data.intelligence.inventory.asOf.slice(0,7)?' MTD':''}</option>)}<option value="undated">Undated source records</option></select></label>
        <label>Sales formula<select value={sku} onChange={e=>{setSku(e.target.value);setPage(0);}}><option value="all">All formulas</option>{report.formulas.map(p=><option key={p.productId} value={p.productId}>{p.color} {p.formula} · {p.weight} lb</option>)}</select></label>
      </div>
      <div className={x.kpis}>
        <article><span>Recorded customer sales</span><strong>{money(actualSales)}</strong><small>{customer.length} included records · {sum(customer,'quantity')} known bags · sale date, not cash date</small></article>
        <article><span>Recorded payment evidence</span><strong>{money(cash)}</strong><small>Explicit source amounts / receipts only; legacy Paid labels and conflicting receipts are excluded</small></article>
        <article><span>Dealer-basis bag cost</span><strong>{money(knownCost)}</strong><small>{sum(costed,'quantity')} costed bags × Airtable Dealer Price · historical lot costs may differ</small></article>
        <article><span>Dealer-basis margin</span><strong>{money(knownMargin)}</strong><small>Costed sales minus reference bag costs · estimate before tax separation, fees, overhead and unverified losses</small></article>
      </div>
      <Table head={['Profit/loss line','Amount','Scope and evidence']}>
        <tr><td>Recorded customer sales amount</td><td><strong>{money(actualSales)}</strong></td><td>{customer.length} source records, including unpaid billed sales; {periodRows.length-customer.length} records excluded / held below</td></tr>
        <tr><td>Sales with a usable quantity and dealer cost</td><td>{money(sum(costed,'totalCents'))}</td><td>{costed.length} costed source rows</td></tr>
        <tr><td>Less: bag acquisition reference</td><td>{money(knownCost)}</td><td>Airtable Dealer Price, matching the owner’s original invoice costs; exact historical receipt costs remain incomplete</td></tr>
        <tr><td>Margin on costed sales</td><td><strong>{money(knownMargin)}</strong></td><td>Reference-basis estimate, not final net profit</td></tr>
        <tr><td>Unmatched sales needing quantity / cost</td><td>{money(sum(unmatched,'totalCents'))}</td><td>{unmatched.length} source rows excluded from margin rather than assigned zero cost</td></tr>
        <tr><td>Documented business damage / expiration / other costs</td><td>{money(knownLosses)} recorded</td><td>{periodBusinessCosts.length} structured entries in this period · actual total incomplete; {report.undatedBusinessCostCents?`${money(report.undatedBusinessCostCents)} undated business costs need period review`:'unquantified historical losses remain unresolved'}</td></tr>
        <tr><td>Verified gross profit</td><td>{money(verifiedGross)}</td><td>Requires consumed-lot acquisition cost and tax-exclusive revenue for every included sale. Incomplete historical costs prevent a complete actual gross result.</td></tr>
        <tr><td>Final net profit/loss</td><td>Incomplete</td><td>Tax/fees, overhead and unresolved losses still need reconciliation. Personal/family use is excluded from business losses.</td></tr>
        <tr><td>Source-reported payments / outstanding</td><td>{money(sum(customer,'collectedCents'))} / {money(sum(customer,'balanceCents'))}</td><td>Preserves Airtable payment labels and balance calculation; a Paid label alone is not cash proof</td></tr>
      </Table>
    </Card>
    {!compact&&<Card title="Month-by-month sales and operating margin" caption="SALE MONTH · COMPLETE SOURCE TOTALS, INCOMPLETE COST HISTORY">
      <Table head={['Sale month','Recorded sales','Known bags','Dealer-basis cost','Costed margin','Unmatched sales']}>
        {report.monthly.map(m=>{const rows=report.rows.filter(r=>r.included&&r.date.slice(0,7)===m.month&&(sku==='all'||r.productId===sku)),priced=rows.filter(r=>r.referenceCostCents!=null);return <tr key={m.month}><td><button onClick={()=>{setPeriod(m.month);setPage(0);}}>{m.month}</button></td><td>{money(sum(rows,'totalCents'))}</td><td>{sum(rows,'quantity')}{rows.some(r=>r.quantity==null)?' + unknown':''}</td><td>{money(sum(priced,'referenceCostCents'))}</td><td>{money(sum(priced,'referenceMarginCents'))}<small>Estimate</small></td><td>{money(sum(rows.filter(r=>r.referenceCostCents==null),'totalCents'))}</td></tr>;})}
      </Table>
    </Card>}
    <Card title={personalUseLabel} caption="SEPARATE BAG USE AND ACQUISITION COST · OUTSIDE CUSTOMER PROFIT/LOSS">
      <p className={s.caption}>{sum(confirmedPersonal,'quantity')} confirmed bags · {money(sum(confirmedPersonal,'totalCents'))} known acquisition cost · {confirmedPersonal.filter(c=>c.totalCents==null).length} entries missing cost. Period and formula filters apply; unknown use dates appear under All recorded history or Undated source records. Pending classifications are excluded from these totals.</p>
      <Table head={['Category / formula','Bags / acquisition cost','Actual use date','Status / source']}>
        {personalUse.map(c=><tr key={c.id}><td><strong>{personalUseLabel}</strong><small>{c.productName}</small></td><td>{c.quantity} bags<small>{money(c.totalCents)} acquisition cost · {money(c.unit_cost_cents)} / bag</small></td><td>{c.actual_date||'Unknown historical use date'}<small>Entered: {stamp(c.created_at)}</small></td><td>{!c.linked?'Source needs reconciliation':c.review_status==='confirmed'?'Confirmed':'Classification review pending'}<small>{c.checkpoint_id?'Already included in physical count; no second deduction':'Existing stock deduction; no replay'}</small><Source id={c.checkpoint_id||c.movement_id} table={c.checkpoint_id?'tblcJj3WOBoRHRHFV':(data.movements||[]).find(m=>m.id===c.movement_id)?.sourceTable==='Inventory Adjustments'?'tblcJj3WOBoRHRHFV':'tblpEYQ3qpfcKLmdo'}/><details><summary>Evidence and audit note</summary><p>{c.note}</p><p>{c.source_reference} · {c.actor}</p><code>{c.id}</code></details></td></tr>)}
      </Table>
      {!personalUse.length&&<p className={s.caption}>No personal-use evidence in this selection. This does not confirm zero personal use.</p>}
      <p className={s.caption}>Personal use creates no customer revenue, payment or business spoilage. Record its category and cost in <a href="/admin/dog-food/inventory/">Inventory &amp; monthly demand</a>, under Acquisition costs outside customer sales.</p>
    </Card>
    <Card title="Full sales detail" caption="SOURCE ROWS RETAINED · FILTER, INSPECT AND EXPORT">
      <div className={x.toolbar}><label>Search sales<input value={query} maxLength={200} placeholder="Customer, formula, receipt or notes" onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label><label>Record scope<select value={scope} onChange={e=>{setScope(e.target.value);setPage(0);}}><option value="all">All source records, including exclusions</option><option value="customer">Included customer sales</option><option value="review">Records with review notes</option></select></label><button onClick={()=>exportFoodSales(matches)}>Export {matches.length} sales to CSV</button></div>
      <p className={s.caption}>{matches.length} matching records. Filters below do not change the period/formula P&amp;L totals above. Source payment labels and documented receipts are separate columns.</p>
      <Table head={['Sale / customer / source','Formula / bags','Recorded sale / payment','Cost / margin basis','Fulfillment / classification','Full details']}>
        {visibleRows.map(r=><tr key={r.id}><td><strong>{r.name||'Name missing'}</strong><small>{r.date||'Sale date missing'} · {r.sourceLabel}</small><Source id={r.id}/><small>{r.id}</small></td><td>{r.productName}<small>{r.quantity??'Unknown'} bags</small></td><td><strong>{money(r.totalCents)}</strong><small>Source status: {r.recordedPaymentStatus||r.paymentStatus||'Missing'} · {r.paymentMethod||'Method missing'}</small><small>Recorded cash evidence: {money(r.supportedCashCents)}</small><small>Source reported paid: {money(r.collectedCents)} · balance {money(r.balanceCents)}</small></td><td>Dealer {money(r.unitReferenceCents)} / bag<small>Reference cost {money(r.referenceCostCents)}</small><small>Reference margin {money(r.referenceMarginCents)}</small><small>Verified gross profit {money(r.exactGrossProfitCents)}</small></td><td>{r.fulfillment}{r.fulfillmentAssumed?' (assumed from blank)':''}<small>{r.included?'Included in recorded customer sales':r.exclusion}</small></td><td><details><summary>Notes, receipts and audit references</summary><p>{r.notes||'No source notes'}</p><p>Responsible: {r.responsible||'Unassigned'} · next follow-up: {r.nextFollowUp||'Not set'}</p><p>Order: {r.orderId||'None'} · line: {r.lineId||'None'} · Sweep &amp; Go job: {r.sngJobId||'None'} · payment reference: {r.paymentReference||'None'}</p><p>Explicit source payment amount: {money(r.recordedPaymentsReceivedCents)}</p>{(r.receipts||[]).map(p=><p key={p.id}>{p.date||'Date missing'} · {money(p.amountCents)} · {p.method} · {p.reference} · <code>{p.id}</code></p>)}<p>Customer type: {r.customerType||'Not recorded'} ? distribution center: {r.distributionCenter||'Not recorded'}</p><p>Source: {r.source||'Not recorded'} ? created: {r.createdAt||'Not recorded'}</p><p>Cost basis: {r.costBasis}</p><ul>{r.review.map((w,i)=><li key={i}>{w}</li>)}</ul></details></td></tr>)}
      </Table>
      {!matches.length&&<p>No matching sales.</p>}<div className={x.toolbar}><button disabled={currentPage===0} onClick={()=>setPage(p=>p-1)}>Previous 50</button><span>Page {currentPage+1} of {pages}</span><button disabled={currentPage>=pages-1} onClick={()=>setPage(p=>p+1)}>Next 50</button></div>
    </Card>
    {!compact&&<Card title="How to read these figures" caption="DATA LIMITS STAY VISIBLE"><ul className={x.rules}>{report.limitations.map(t=><li key={t}>{t}</li>)}</ul></Card>}
  </div>;
}
