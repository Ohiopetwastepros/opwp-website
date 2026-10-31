import { readRouteInvoiceEvidence, readDatedRouteInvoices } from "./route-invoice-archive.mjs";
import { allocateDatedRouteInvoices } from "./route-invoice-allocation.mjs";
import { getQuickBooksCleanupDataset } from "./quickbooks-cleanup";
import { shiftRouteDate, uniqueRouteRecords } from "./route-profitability-calculations.mjs";
import { REVIEW_KEY, DECISIONS_KEY, routePriceIssues, invoiceProposal, applyRouteDecisions, reviewResolved, validRevenueCategory } from "./route-data-quality.mjs";

export async function readRouteReview(db) {
  const rows = await db.prepare("SELECT snapshot_key,payload FROM airtable_cockpit_snapshots WHERE snapshot_key IN (?,?)").bind(REVIEW_KEY, DECISIONS_KEY).all();
  const map = Object.fromEntries((rows.results || []).map(row=>[row.snapshot_key, JSON.parse(row.payload)]));
  const review = map[REVIEW_KEY] || { issues: [], checkedAt: null };
  const decisions = map[DECISIONS_KEY] || { version: 0, byJob: {} };
  const unresolved = review.issues.filter(issue=>!reviewResolved(issue,decisions.byJob[issue.jobId]));
  // Source checks run first. The owner is only shown records whose SNG archive and
  // QuickBooks search both completed without a single defensible value.
  const issues = unresolved.filter(issue=>(issue.sourcesComplete === true || issue.ownerActionRequired === true) && !issue.evidencePending);
  return { ...review, decisions, issues, pendingIssues: unresolved.filter(issue=>!issues.includes(issue)), allIssues: review.issues, unresolvedCount: unresolved.length, deferredCount: unresolved.length - issues.length, resolvedCount: review.issues.filter(issue=>reviewResolved(issue,decisions.byJob[issue.jobId])).length };
}

async function saveSnapshot(db, name, data) {
  const payload=JSON.stringify(data);
  if(new TextEncoder().encode(payload).length>1500000)throw new Error("Route review exceeds its storage budget.");
  await db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at,updated_at) VALUES (?,?,'success',?,CURRENT_TIMESTAMP)
  ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,status='success',captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`).bind(name,payload,new Date().toISOString()).run();
}

export async function reconcileRouteRecords(db, records, from, through) {
  // Imported aliases are not additional visits and must not block an otherwise
  // unique invoice match. Keep distinct original SNG jobs for ambiguity checks.
  records = { ...records, jobs: uniqueRouteRecords(records.jobs || [], "Job ID") };
  const prior=await readRouteReview(db);
  // Display filtering must not remove pending provider checks from the recovery backlog.
  prior.issues = prior.allIssues || prior.issues;
  const issues=[...prior.issues.filter(issue=>issue.date<from||issue.date>through),...routePriceIssues(records)].sort((a,b)=>b.date.localeCompare(a.date)||a.jobId.localeCompare(b.jobId));
  // Keep the complete issue backlog, but bound provider evidence work per refresh.
  const checkTime=new Map(prior.issues.map(issue=>[issue.jobId,issue.evidenceAttemptedAt || issue.evidenceCheckedAt || ""]));
  const pending=issues.filter(issue=>!reviewResolved(issue,prior.decisions.byJob[issue.jobId])).sort((a,b)=>(checkTime.get(a.jobId)||"").localeCompare(checkTime.get(b.jobId)||""));
  // Reserve room for the current dashboard while advancing older evidence too.
  // A long historical backlog must not delay a new delivery's known invoice.
  const recent=pending.filter(issue=>issue.date>=shiftRouteDate(through,-35)).slice(0,20);
  const recentIds=new Set(recent.map(issue=>issue.jobId));
  const evidenceBatch=[...recent,...pending.filter(issue=>!recentIds.has(issue.jobId)).slice(0,40-recent.length)];
  const invoices=[];
  let quickBooksChecked=false;
  let archiveComplete=true;
  const names=[...new Set(evidenceBatch.map(issue=>issue.customer))];
  const checks=[];
  if(names.length){
    const archive=await readRouteInvoiceEvidence(db,names);
    archiveComplete=archive.complete;
    invoices.push(...archive.invoices);
    checks.push(archiveComplete ? "Sweep & Go historical and live invoices checked" : "SNG invoice evidence is incomplete; automatic checks will retry");
    try {
      // The existing connector bounds this to five pages / 5,000 invoices.
      const evidenceDates=evidenceBatch.map(issue=>issue.date).sort();
      const evidenceFrom=shiftRouteDate(evidenceDates[0],-31);
      const evidenceThrough=[through,shiftRouteDate(evidenceDates.at(-1),31)].sort()[0];
      const dataset=await getQuickBooksCleanupDataset({dataset:"entity",entity:"Invoice",start:evidenceFrom,end:evidenceThrough,accountingMethod:"Accrual"});
      const wanted=new Set(names.map(name=>name.toLowerCase().replace(/[^a-z0-9]/g,"")));
      for(const row of dataset.records || dataset.rows || []){
        const customer=String(row.CustomerRef?.name||"");
        if(!wanted.has(customer.toLowerCase().replace(/[^a-z0-9]/g,"")))continue;
        invoices.push({id:String(row.Id),source:"QuickBooks",customer,date:row.TxnDate,total:row.TotalAmt,balance:row.Balance,lines:(row.Line||[]).filter(line=>line.DetailType==="SalesItemLineDetail").slice(0,100).map(line=>({description:String(line.Description||line.SalesItemLineDetail?.ItemRef?.name||"").slice(0,400),amount:line.Amount == null || line.Amount === "" ? null : Number(line.Amount)}))});
      }
      checks.push("QuickBooks invoices checked");
      quickBooksChecked=true;
    } catch(error) { checks.push("QuickBooks temporarily unavailable; automatic retry queued"); console.error(JSON.stringify({event:"route_invoice_check_failed",message:String(error?.message||"Invoice check failed").slice(0,300)})); }
  }
  const ids=new Set(evidenceBatch.map(issue=>issue.jobId));
  const allocations=allocateDatedRouteInvoices(records,await readDatedRouteInvoices(db,from,through),{from,through});
  const automatic=[];
  const reviewed=issues.map(issue=>{
    const priorIssue=prior.issues.find(row=>row.jobId===issue.jobId&&row.date===issue.date&&row.customer===issue.customer&&row.clientId===issue.clientId&&row.serviceType===issue.serviceType&&row.category===issue.category&&row.recordedRevenue===issue.recordedRevenue);
    if(!ids.has(issue.jobId)) {
      const quickBooksChecked=Boolean(priorIssue?.quickBooksChecked);
      const proposal=priorIssue?.proposal||null;
      return {...issue,evidence:priorIssue?.evidence||[],proposal,evidencePending:!priorIssue?.sourcesComplete,quickBooksChecked,sourcesComplete:Boolean(priorIssue?.sourcesComplete),evidenceCheckedAt:priorIssue?.evidenceCheckedAt||null,evidenceAttemptedAt:priorIssue?.evidenceAttemptedAt||null,evidenceRefreshPending:Boolean(priorIssue?.evidenceRefreshPending),ownerActionRequired:Boolean(priorIssue?.sourcesComplete)};
    }
    const proposed=invoiceProposal(issue,invoices);
    const proposal=proposed.proposal;
    // A dated line or delivery cannot be applied to two completed jobs. Check all
    // source jobs, including already-priced ones, not just the review backlog.
    const peers=(records.jobs||[]).filter(record=>{
      const f=record.fields||{};
      if(String(f["Customer Name"]||"").toLowerCase()!==issue.customer.toLowerCase() || !["completed","job:completed"].includes(String(f.Status||"").toLowerCase()))return false;
      const date=String(f.Date||"").slice(0,10);
      if(proposal?.match==="service_date")return date===issue.date && !["recurring","skip","skipped"].includes(String(f["Service Type"]).toLowerCase());
      const invoice=proposed.evidence.find(row=>row.id===proposal?.invoiceId&&row.source===proposal?.source);
      const days=(Date.parse(date)-Date.parse(invoice?.date))/86400000;
      return days>=0&&days<=3&&["one_time","custom","dog_food"].includes(String(f["Service Type"]).toLowerCase());
    });
    const uniqueIds=new Set(peers.map(row=>String(row.fields?.["Job ID"]||row.id).replace(/\.0+$/,"")));
    const names=(records.customers||[]).filter(row=>String(row.fields?.["Client Name"]||"").toLowerCase()===issue.customer.toLowerCase());
    const family=category=>String(category||"").startsWith("addon")?"addon":String(category||"").startsWith("dog_food")?"food":"cleanup";
    const compatible=(!/^(addon|dog_food)/.test(issue.category||"")||family(issue.category)===family(proposal?.category))
      && !(issue.category!=="other"&&family(issue.category)==="cleanup"&&family(proposal?.category)==="addon");
    const auto=archiveComplete&&proposal&&proposal.category!=="other"&&compatible&&uniqueIds.size===1&&names.length===1;
    if(auto)automatic.push({...issue,action:"confirm",revenue:proposal.amount,category:proposal.category,components:proposal.components,reason:`Automatically matched ${proposal.source} invoice ${proposal.invoiceId}: unique ${proposal.match==="service_date"?"dated service":"food delivery"} evidence.`,reviewer:"Automatic reconciliation",reviewedAt:new Date().toISOString(),evidence:proposed.evidence,automatic:true});
    const checkedNow=archiveComplete&&quickBooksChecked;
    // Provider outages must not erase completed checks or hide an existing
    // owner question. Automatic corrections above still require fresh evidence.
    const sourcesComplete=checkedNow || Boolean(priorIssue?.sourcesComplete);
    const retained=(priorIssue?.evidence||[]).filter(row=>
      row.source==="QuickBooks" ? !quickBooksChecked : !archiveComplete);
    const evidence=[...proposed.evidence,...retained].filter((row,index,all)=>
      all.findIndex(other=>other.source===row.source&&other.id===row.id)===index).slice(0,24);
    return {...issue,...proposed,evidence,evidencePending:!sourcesComplete&&!auto,
      quickBooksChecked:quickBooksChecked||Boolean(priorIssue?.quickBooksChecked),sourcesComplete,
      evidenceCheckedAt:checkedNow?new Date().toISOString():priorIssue?.evidenceCheckedAt||null,
      evidenceAttemptedAt:new Date().toISOString(),evidenceRefreshPending:!checkedNow,
      ownerActionRequired:sourcesComplete&&!auto};
  });
  // Dated line allocations supersede whole-invoice suggestions, including
  // previously priced initial jobs. Owner decisions remain protected by CAS.
  const corrections=[...automatic,...allocations];
  const loadedIds=new Set(records.jobs.map(r=>String(r.fields?.["Job ID"]||r.id).replace(/\.0+$/,"")));
  const allocatedIds=new Set(allocations.map(d=>d.jobId));
  const obsolete=Object.values(prior.decisions.byJob).filter(d=>{
    if (!d.automatic || d.reviewer!=="Automatic invoice allocation" || !loadedIds.has(d.jobId) || allocatedIds.has(d.jobId)) return false;
    // A bounded refresh may contain this visit only as surrounding context.
    // Incomplete coverage cannot disprove an earlier unique-initial match.
    if ((d.reason?.startsWith("Unique initial-cleanup") || d.reason?.startsWith("Exact recorded package total")) && (!d.evidence?.length || d.evidence.some(i=>!i.date || from>shiftRouteDate(i.date,-31)))) return false;
    return true;
  });
  const decisions=corrections.length||obsolete.length ? await saveAutomaticRouteDecisions(db,corrections,obsolete) : prior.decisions.byJob;
  await saveSnapshot(db,REVIEW_KEY,{issues:reviewed.sort((a,b)=>b.date.localeCompare(a.date)),checks,checkedAt:new Date().toISOString(),evidenceBatchLimit:40});
  return applyRouteDecisions(records,decisions);
}

async function saveAutomaticRouteDecisions(db, decisions, obsolete = []) {
  for(let attempt=0;attempt<3;attempt++) {
    const current=await readRouteReview(db), prior=JSON.stringify(current.decisions);
    const byJob={...current.decisions.byJob};
    for(const decision of obsolete) {
      // Remove only the exact automatic allocation audited above. A concurrent
      // owner correction or newer automatic result must survive this refresh.
      if(JSON.stringify(byJob[decision.jobId])===JSON.stringify(decision))delete byJob[decision.jobId];
    }
    for(const decision of decisions) {
      const existing=byJob[decision.jobId];
      // Never overwrite a still-applicable owner decision.
      if(existing&&!existing.automatic&&reviewResolved(decision,existing))continue;
      byJob[decision.jobId]=decision;
    }
    const payload=JSON.stringify({version:current.decisions.version+1,byJob});
    if(new TextEncoder().encode(payload).length>1500000)throw new Error("Route decisions exceed their storage budget.");
    await db.prepare("INSERT OR IGNORE INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,'success',?)").bind(DECISIONS_KEY,prior,new Date().toISOString()).run();
    const result=await db.prepare("UPDATE airtable_cockpit_snapshots SET payload=?,captured_at=?,updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=? AND payload=?").bind(payload,new Date().toISOString(),DECISIONS_KEY,prior).run();
    if(Number(result.meta?.changes)===1)return byJob;
  }
  throw new Error("Concurrent route reconciliation; retrying on the next refresh.");
}

export async function saveRouteDecision(db, input, reviewer) {
  const current=await readRouteReview(db);
  const issue=current.issues.find(issue=>issue.jobId===input.jobId);
  if(!issue)return {status:409,error:"This record has changed or is already reviewed. Refresh the dashboard."};
  if(input.action!=="exclude" && (input.action!=="confirm"||!Number.isFinite(input.revenue)||input.revenue<0||input.revenue>10000))return {status:400,error:"Choose a valid service amount or exclude the visit."};
  if(input.category && !validRevenueCategory(input.category))return {status:400,error:"Choose a valid revenue category."};
  if(input.action === "confirm" && (issue.requiresClassification || issue.issue === "Service category needs verification") && (!validRevenueCategory(input.category) || input.category === "other"))return {status:400,error:"Choose the verified service category to resolve this record."};
  const reason=String(input.reason||"").trim();
  if(reason.length<3||reason.length>500)return {status:400,error:"Add a verification note between 3 and 500 characters."};
  const prior=JSON.stringify(current.decisions);
  const next={version:current.decisions.version+1,byJob:{...current.decisions.byJob,[issue.jobId]:{jobId:issue.jobId,date:issue.date,customer:issue.customer,serviceType:issue.serviceType,recordedRevenue:issue.recordedRevenue,action:input.action,revenue:input.action==="confirm"?input.revenue:null,category:input.action==="confirm"&&input.category?input.category:null,components:input.action==="confirm"&&issue.proposal&&Math.abs(input.revenue-issue.proposal.amount)<0.005&&input.category===issue.proposal.category?issue.proposal.components:undefined,reason,reviewer,reviewedAt:new Date().toISOString(),evidence:issue.evidence}}};
  const payload=JSON.stringify(next);
  if(new TextEncoder().encode(payload).length>1500000)return {status:409,error:"Review history has reached its storage limit."};
  await db.prepare("INSERT OR IGNORE INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,'success',?)").bind(DECISIONS_KEY,prior,new Date().toISOString()).run();
  const result=await db.prepare("UPDATE airtable_cockpit_snapshots SET payload=?,captured_at=?,updated_at=CURRENT_TIMESTAMP WHERE snapshot_key=? AND payload=?").bind(payload,new Date().toISOString(),DECISIONS_KEY,prior).run();
  return Number(result.meta?.changes)===1 ? {status:200,ok:true,date:issue.date} : {status:409,error:"Another review was saved first. Refresh and try again."};
}
