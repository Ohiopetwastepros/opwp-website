import { routeRecordId, uniqueRouteRecords } from "./route-profitability-calculations.mjs";
import { validRevenueCategory, routeRevenueCategory } from "./route-revenue.mjs";
import { classifyRevenueLine } from "./revenue-classification.mjs";
export { validRevenueCategory } from "./route-revenue.mjs";
const key = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const REVIEW_KEY = "route_profitability_reviews_v1";
export const DECISIONS_KEY = "route_profitability_decisions_v1";

export function routePriceIssues(records) {
  const seen = new Set();
  return uniqueRouteRecords(records.jobs || [], "Job ID").flatMap((record) => {
    const f = record.fields || {}, id = routeRecordId(f["Job ID"] || record.id);
    if (!id || seen.has(id) || !["completed", "jobcompleted"].includes(key(f.Status)) || ["skip", "skipped"].includes(key(f["Service Type"]))) return [];
    seen.add(id);
    const value = Number(f["Revenue ($)"]);
    const issue = !Number.isFinite(value) || value <= 0 ? "Missing or zero service price" : !f["Source Price Confirmed"] && (value > 500 || (key(f["Service Type"]) === "recurring" && value > 100)) ? "Unusually high visit price" : routeRevenueCategory(f) === "other" ? "Service category needs verification" : null;
    return issue ? [{ jobId: id, date: String(f.Date || "").slice(0, 10), customer: String(f["Customer Name"] || "Unknown customer").slice(0, 200), clientId: f["Source Client ID"] || "", serviceType: String(f["Service Type"] || "Unknown").slice(0, 40), category: routeRevenueCategory(f), recordedRevenue: Number.isFinite(value) ? value : null, requiresClassification: routeRevenueCategory(f) === "other", issue }] : [];
  });
}

export function invoiceServiceDates(description,invoiceDate,referenceDate) {
  const tokens=String(description).match(/(?<!\d)(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/(?:\d{4}|\d{2}))?)(?!\d)/g)||[];
  const dates=[];
  for(const token of tokens){
    const parts=token.split("/");let date;
    if(parts.length===2){
      const distance=Math.abs(Date.parse(referenceDate)-Date.parse(invoiceDate))/86400000;
      if(!Number.isFinite(distance)||distance>31)return null;
      date=`${referenceDate.slice(0,4)}-${parts[0].padStart(2,"0")}-${parts[1].padStart(2,"0")}`;
    }else date=parts.length===3?`${parts[2].length===2?"20":""}${parts[2]}-${parts[0].padStart(2,"0")}-${parts[1].padStart(2,"0")}`:token;
    const parsed=Date.parse(date);
    if(!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==date)return null;
    dates.push(date);
  }
  return dates;
}
export function singleInvoiceServiceDate(description,invoiceDate,referenceDate) {
  const dates=invoiceServiceDates(description,invoiceDate,referenceDate);
  return dates?.length===1?dates[0]:null;
}

export function invoiceProposal(issue, invoices) {
  const distance=invoice=>Number.isFinite(Date.parse(invoice.date))?Math.abs(Date.parse(invoice.date)-Date.parse(issue.date)):Infinity;
  const matches = invoices.filter(invoice => key(invoice.customer) === key(issue.customer) && !(issue.clientId && invoice.clientId && issue.clientId !== invoice.clientId))
    .sort((a,b)=>distance(a)-distance(b));
  if(new Set(matches.map(invoice=>invoice.clientRef).filter(Boolean)).size>1)return {evidence:matches.slice(0,12),proposal:null};
  // Exact service-date line items only. Monthly subscriptions, tax and future service
  // cannot be silently assigned to an initial cleanup or delivery.
  const proposals = matches.flatMap(invoice => {
    const lines = invoice.lines.filter(line => singleInvoiceServiceDate(line.description, invoice.date, issue.date) === issue.date && /clean|saniti|scoop|waste|deodor|haul.?away|front yard|rush charge/i.test(line.description) && !/dog.?food|fuel|bag|monthly|subscription/i.test(line.description));
    const components = lines.map(line => ({category:classifyRevenueLine(line,{...invoice,type:"one_time"}).category,revenue:line.amount}));
    return lines.length && lines.every(line => Number.isFinite(line.amount) && line.amount >= 0) && components.every(line=>line.category!=="other") ? [{ amount: lines.reduce((sum,line)=>sum+line.amount,0), invoiceId: invoice.id, source: invoice.source, category: components[0].category, components, match:"service_date", lines }] : [];
  });
  if (!proposals.length) for (const invoice of matches) {
    const days = (Date.parse(issue.date)-Date.parse(invoice.date))/86400000;
    if (!Number.isFinite(days) || days < 0 || days > 3) continue;
    const lines=invoice.lines.filter(line=>/dog.?food|extreme dog|fuel|\bbag\b/i.test(line.description));
    if(lines.length && lines.every(line=>Number.isFinite(line.amount)&&line.amount>0&&!/monthly|subscription/i.test(line.description))) proposals.push({amount:lines.reduce((sum,line)=>sum+line.amount,0),invoiceId:invoice.id,source:invoice.source,category:"dog_food",components:lines.map(line=>({category:"dog_food",revenue:line.amount})),match:"nearby_food",lines});
  }
  // Identical SNG/QBO mirrors corroborate; equal amounts with different products do not.
  const perSource=new Map();
  for(const proposal of proposals){const ids=perSource.get(proposal.source)||new Set();ids.add(proposal.invoiceId);perSource.set(proposal.source,ids);}
  if([...perSource.values()].some(ids=>ids.size>1))return {evidence:matches.slice(0,12),proposal:null};
  const unique = [...new Map(proposals.map(p=>[JSON.stringify([p.category,p.components,p.lines.map(line=>line.description)]),p])).values()];
  return { evidence: matches.slice(0, 12), proposal: unique.length === 1 ? unique[0] : null };
}

export function applyRouteDecisions(records, decisions = {}) {
  // Remove superseded import aliases before exclusions, so excluding an
  // original job cannot accidentally resurrect its older synthetic copy.
  return { ...records, jobs: uniqueRouteRecords(records.jobs || [], "Job ID").flatMap(record => {
    const f=record.fields || {}, id=routeRecordId(f["Job ID"] || record.id);
    const decision=decisions[id];
    if (!decision || decision.date !== String(f.Date || "").slice(0,10) || key(decision.customer) !== key(f["Customer Name"])) return [record];
    // A changed source price reopens review instead of hiding a later correction.
    const source=Number(f["Revenue ($)"]);
    if ((Number.isFinite(source) ? source : null) !== decision.recordedRevenue || (decision.serviceType && decision.serviceType !== f["Service Type"])) return [record];
    if (decision.action === "exclude") return [];
    if (decision.action === "confirm" && Number.isFinite(decision.revenue) && decision.revenue >= 0) {
      // Preserve reviewed food evidence in older decisions that predate category controls.
      const candidate = !decision.category && decision.evidence?.length ? invoiceProposal({date:decision.date,customer:decision.customer,serviceType:f["Service Type"]},decision.evidence).proposal : null;
      const category = validRevenueCategory(decision.category) ? decision.category : ["dog_food","initial"].includes(candidate?.category) && Math.abs(candidate.amount-decision.revenue)<0.005 ? candidate.category : null;
      const components = decision.components || (candidate && Math.abs(candidate.amount-decision.revenue)<0.005 ? candidate.components : null);
      return [{ ...record, fields: { ...f, "Revenue ($)": decision.revenue, "Route Revenue Verified": true, "Route Revenue Reason": decision.reason, ...(category ? {"Route Revenue Category":category} : {}), ...(components ? {"Route Revenue Components":components} : {}) } }];
    }
    return [record];
  }) };
}

export function reviewResolved(issue, decision) {
  return Boolean(decision && decision.date === issue.date && key(decision.customer) === key(issue.customer) && decision.recordedRevenue === issue.recordedRevenue && (!decision.serviceType || decision.serviceType === issue.serviceType) && (!issue.requiresClassification && issue.issue !== "Service category needs verification" || decision.action === "exclude" || (validRevenueCategory(decision.category) && decision.category !== "other")));
}
