"use client";
import { useState } from "react";
import styles from "./profitability.module.css";
import { routeDay } from "@/lib/route-profitability-calculations.mjs";
import { ROUTE_REVENUE_CATEGORIES } from "@/lib/route-revenue.mjs";
const money=value=>Number.isFinite(value)?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value):"Not available";

export function ReviewItem({issue,onUpdate}) {
  const [amount,setAmount]=useState(issue.proposal?.amount ?? ((issue.requiresClassification || issue.issue === "Service category needs verification") ? issue.recordedRevenue : ""));
  const [note,setNote]=useState("");
  const [category,setCategory]=useState(issue.proposal?.category || "");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  async function save(action,useProposal=false) {
    const revenue=useProposal ? issue.proposal.amount : amount === "" ? null : Number(amount);
    const reason=useProposal ? `Confirmed ${issue.proposal.source} invoice ${issue.proposal.invoiceId}: dated service/product line items.` : note;
    if(!useProposal && note.trim().length<3){setMessage("Add a note explaining the verified amount or exclusion.");return;}
    setBusy(true);setMessage("");
    try {
      const response=await fetch("/api/admin/route-profitability/review/",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jobId:issue.jobId,action,revenue,reason,category:useProposal?issue.proposal.category||category:category})});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||"Could not save this review.");
      if(onUpdate)onUpdate(result);else window.location.reload();
      if(result.warning)setMessage(result.warning);
    } catch(error){setMessage(error.message);}
    finally{setBusy(false);}
  }
  return <article className={styles.reviewItem}>
    <div className={styles.sectionHead}><div><strong>{issue.customer}</strong><p>{issue.date} · {issue.serviceType} · {issue.issue}</p></div><span className={styles.pendingBadge}>Recorded {money(issue.recordedRevenue)}</span></div>
    {issue.proposal ? <p><strong>Invoice-supported candidate: {money(issue.proposal.amount)}</strong> · {issue.proposal.source} #{issue.proposal.invoiceId}. Verify this belongs to the visit before confirming.</p> : <p>{issue.evidencePending?"Source checks are retrying automatically. No owner action is needed yet.":"Verify the service category and amount against the source evidence below."}</p>}
    <details className={styles.details}><summary>Source evidence ({issue.evidence?.length || 0} invoices)</summary>{(issue.evidence||[]).map((invoice,index)=><div key={`${invoice.source}-${invoice.id}-${index}`}><p><strong>{invoice.source} #{invoice.id}</strong> · {invoice.date} · total {money(invoice.total)}{invoice.balance!==undefined?` · open balance ${money(invoice.balance)}`:""}</p><ul>{invoice.lines.map((line,i)=><li key={i}>{line.description} — {money(line.amount)}</li>)}</ul></div>)}{!issue.evidence?.length?<p>No matching invoice evidence was found in the available sources.</p>:null}</details>
    <div className={styles.reviewActions}>{issue.proposal?<button className={styles.primaryButton} disabled={busy} onClick={()=>save("confirm",true)}>Confirm invoice amount</button>:null}<label>Verified service revenue<input aria-label={`Verified revenue for ${issue.customer}`} type="number" min="0" max="10000" step="0.01" value={amount} onChange={event=>setAmount(event.target.value)} /></label><label>Revenue category<select aria-label={`Revenue category for ${issue.customer}`} value={category} onChange={event=>setCategory(event.target.value)}><option value="">Use source service type</option>{Object.entries(ROUTE_REVENUE_CATEGORIES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Verification note<input aria-label={`Verification note for ${issue.customer}`} maxLength="500" value={note} onChange={event=>setNote(event.target.value)} placeholder="Invoice, included visit, or correction reason" /></label><button disabled={busy||amount===""} onClick={()=>save("confirm")}>Save verified amount</button><button disabled={busy} onClick={()=>save("exclude")}>Exclude non-route record</button></div>
    <p className={styles.note}>A verified $0 visit remains counted. Dog-food deliveries are route revenue. Corrections affect this dashboard and preserve the original source record.</p>
    {busy?<p role="status">Saving review and recalculating route history…</p>:null}{message?<p role="alert">{message}</p>:null}
  </article>;
}

export default function RouteDataReview({review,onUpdate,from,through,weekday="All days"}) {
  const [allHistory,setAllHistory]=useState(false);
  const [page,setPage]=useState(0);
  const backlog=review?.issues||[];
  const issues=allHistory||!from?backlog:backlog.filter(issue=>issue.date>=from&&issue.date<=through&&(weekday==="All days"||routeDay(issue.date)===weekday));
  const pendingBacklog=review?.pendingIssues||[];
  const pending=allHistory||!from?pendingBacklog:pendingBacklog.filter(issue=>issue.date>=from&&issue.date<=through&&(weekday==="All days"||routeDay(issue.date)===weekday));
  const safePage=Math.min(page,Math.max(0,Math.ceil(issues.length/5)-1));
  return <section className={styles.costPanel} aria-label="Route data review"><div className={styles.sectionHead}><div><span className={styles.eyebrow}>Accuracy controls</span><h2>{issues.length?`${issues.length} services need verification`:pending.length?`${pending.length} services awaiting source checks`:review?.checkedAt?"Owner review queue clear":"Source checks pending"}</h2><p>Matching source records resolve automatically. Only questions the completed source checks cannot answer appear here. Saved answers update categories, details, and route totals.</p></div><span className={issues.length||pending.length?styles.pendingBadge:styles.readyBadge}>{review?.checkedAt?`${review.resolvedCount||0} reviewed` : "Refresh to check sources"}</span></div>
    <p className={styles.note}>{review?.checks?.join(" · ") || "The next refresh checks Sweep & Go and QuickBooks evidence."} {review?.checkedAt?`Last checked ${new Date(review.checkedAt).toLocaleString("en-US", { timeZone: "America/New_York" })}.`:""} Recorded visit prices do not by themselves establish payment collection.</p>
    {from?<button onClick={()=>{setAllHistory(!allHistory);setPage(0);}}>{allHistory?"Review selected period":`Review all history (${backlog.length+pendingBacklog.length} unresolved)`}</button>:null}
    <p className={styles.note}>{issues.length} records ready for owner review in {allHistory||!from?"available history":"the selected period"}. {pending.length} additional records in this range are awaiting source checks.</p>
    {pending.length?<details className={styles.details}><summary>Inspect {pending.length} pending service records</summary><p>These visits are counted, but their service values remain incomplete. Source checks will retry; a failed check does not establish a $0 visit.</p><ul>{pending.map(issue=><li key={issue.jobId}><strong>{issue.customer}</strong> | {issue.date} | {ROUTE_REVENUE_CATEGORIES[issue.category]||issue.serviceType} | {issue.issue} | Job {issue.jobId}</li>)}</ul></details>:null}
    {issues.slice(safePage*5,safePage*5+5).map(issue=><ReviewItem key={`${issue.jobId}-${issue.recordedRevenue}`} issue={issue} onUpdate={onUpdate}/>)}
    {issues.length>5?<div className={styles.pagination}><span>{safePage*5+1}–{Math.min(issues.length,(safePage+1)*5)} of {issues.length}</span><button disabled={!safePage} onClick={()=>setPage(safePage-1)}>Previous reviews</button><button disabled={(safePage+1)*5>=issues.length} onClick={()=>setPage(safePage+1)}>Next reviews</button></div>:null}
    {review?.recentDecisions?.length?<details className={styles.details}><summary>Recent verified corrections</summary>{review.recentDecisions.map((decision,index)=><p key={`${decision.reviewedAt}-${index}`}><strong>{decision.customer} · {decision.date}</strong> — {decision.action==="exclude"?"Excluded from route reporting":money(decision.revenue)}. {decision.category ? `${ROUTE_REVENUE_CATEGORIES[decision.category]} · ` : ""}{decision.reason}<br/><small>Reviewed by {decision.reviewer} on {new Date(decision.reviewedAt).toLocaleString("en-US",{timeZone:"America/New_York"})}.</small></p>)}</details>:null}
    <p className={styles.note}>Missing or invalid employee shifts, stale sources, and QuickBooks account reconciliation are also checked in the ledger and Profitability view. Correct shift records in the source system, then refresh.</p>
  </section>;
}
