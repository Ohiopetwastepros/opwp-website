import { invoiceProposal, invoiceServiceDates } from "./route-data-quality.mjs";
import { routeRevenueCategory } from "./route-revenue.mjs";
import { routeRecordId, uniqueRouteRecords } from "./route-profitability-calculations.mjs";
import { classifyRevenueLine } from "./revenue-classification.mjs";

const nameKey=value=>String(value||"").toLowerCase().replace(/[^a-z0-9]/g,"");
const product=category=>["initial","one_time","recurring"].includes(category)?"cleanup":category.startsWith("addon")?"addon":category.startsWith("dog_food")?"food":"unknown";
const addonKind=text=>/saniti/i.test(text)?"sanitization":/deodor/i.test(text)?"deodorization":/haul.?away/i.test(text)?"haul":/front yard/i.test(text)?"front":null;

// A dated invoice can include several visits, and an initial job can incorrectly
// contain the whole invoice (including next month's subscription). Allocate each
// dated component once, only when original client identity and visits are unique.
export function allocateDatedRouteInvoices(records,invoices,coverage = {}) {
  const groups=new Map();
  for(const record of uniqueRouteRecords(records.jobs||[],"Job ID")) {
    const f=record.fields||{};
    if(!["completed","job:completed"].includes(String(f.Status||"").toLowerCase())||["recurring","skip","skipped"].includes(String(f["Service Type"]||"").toLowerCase()))continue;
    if(!f["Source Client ID"])continue;
    const key=`${f.Date}|${f["Source Client ID"]}|${nameKey(f["Customer Name"])}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(record);
  }
  const allJobs=[...groups.values()].flat();
  const coveredFrom=coverage.from||allJobs.map(j=>String(j.fields.Date).slice(0,10)).sort()[0];
  const decisions=[];
  for(const jobs of groups.values()) {
    const f=jobs[0].fields;
    const identity={date:String(f.Date).slice(0,10),customer:f["Customer Name"],clientId:String(f["Source Client ID"])};
    const matched=invoices.filter(i=>String(i.clientId||"")===identity.clientId && !/^(void|voided|draft|deleted)$/i.test(i.status||""));
    let {proposal}=invoiceProposal(identity,matched);
    // A dated add-on alone cannot replace a cleanup's package total when its
    // cleanup line carries a different (possibly rescheduled) service date.
    if(proposal && jobs.some(j=>product(routeRevenueCategory(j.fields))==="cleanup")
      && !proposal.components.some(c=>product(c.category)==="cleanup"))proposal=null;
    if(proposal?.match!=="service_date") {
      const candidates=matched.filter(i=>nameKey(i.customer)===nameKey(identity.customer)).flatMap(invoice=>{
        const days=(Date.parse(identity.date)-Date.parse(invoice.date))/86400000;
        if(!Number.isFinite(days)||days < -3||days>14||Date.parse(coveredFrom)>Date.parse(invoice.date)-31*86400000)return [];
        const lines=invoice.lines.filter(l=>{
          if(classifyRevenueLine(l,invoice).category!=="initial")return false;
          const dates=invoiceServiceDates(l.description,invoice.date,identity.date);
          return dates?.length===0 || dates?.length===1&&Math.abs(Date.parse(dates[0])-Date.parse(identity.date))<=7*86400000;
        });
        if(!lines.length||!lines.every(l=>Number.isFinite(l.amount)&&l.amount>=0))return [];
        const peers=allJobs.filter(j=>String(j.fields["Source Client ID"])===identity.clientId&&product(routeRevenueCategory(j.fields))==="cleanup"
          && Math.abs(Date.parse(j.fields.Date)-Date.parse(invoice.date))<=31*86400000);
        if(peers.length!==1||String(peers[0].fields.Date).slice(0,10)!==identity.date)return [];
        return [{invoiceId:invoice.id,source:invoice.source,match:"unique_initial",lines,components:lines.map(l=>({category:"initial",revenue:l.amount}))}];
      });
      proposal=candidates.length===1?candidates[0]:null;
    }
    if(!proposal && jobs.length>1) {
      // Some exports put the whole package on the cleanup and leave its
      // separate add-on empty. An exact recorded package total anchors the
      // undated invoice; allocate it without adding revenue a second time.
      const candidates=matched.filter(i=>nameKey(i.customer)===nameKey(identity.customer)).flatMap(invoice=>{
        const days=(Date.parse(identity.date)-Date.parse(invoice.date))/86400000;
        if(!Number.isFinite(days)||Math.abs(days)>3||Date.parse(coveredFrom)>Date.parse(invoice.date)-31*86400000)return [];
        if(invoice.type!=="one_time"||!invoice.lines.length)return [];
        const components=invoice.lines.map(line=>({category:classifyRevenueLine(line,invoice).category,revenue:line.amount}));
        if(!components.every(c=>["initial","one_time","addon"].includes(c.category)&&Number.isFinite(c.revenue)&&c.revenue>0)
          || !components.some(c=>product(c.category)==="cleanup") || !components.some(c=>c.category==="addon"))return [];
        if(invoice.lines.some(line=>invoiceServiceDates(line.description,invoice.date,identity.date)?.length!==0))return [];
        const total=Math.round(components.reduce((sum,c)=>sum+c.revenue,0)*100)/100;
        if(!Number.isFinite(invoice.subtotal)||Math.abs(total-invoice.subtotal)>.005)return [];
        const cleanup=jobs.filter(j=>product(routeRevenueCategory(j.fields))==="cleanup");
        if(cleanup.length!==1||Math.abs(Number(cleanup[0].fields["Revenue ($)"])-total)>.005||!Number.isFinite(Number(cleanup[0].fields["Revenue ($)"])))return [];
        // Every separate add-on must still be unpriced; otherwise reallocating
        // this package could silently discard independently recorded revenue.
        if(jobs.some(j=>product(routeRevenueCategory(j.fields))!=="cleanup"&&Number(j.fields["Revenue ($)"]||0)!==0))return [];
        const peers=allJobs.filter(j=>String(j.fields["Source Client ID"])===identity.clientId
          && product(routeRevenueCategory(j.fields))==="cleanup"&&Math.abs(Date.parse(j.fields.Date)-Date.parse(invoice.date))<=3*86400000
          && Math.abs(Number(j.fields["Revenue ($)"])-total)<.005);
        if(peers.length!==1)return [];
        return [{invoiceId:invoice.id,source:invoice.source,match:"priced_package",lines:invoice.lines,components}];
      });
      proposal=candidates.length===1?candidates[0]:null;
    }
    if(!proposal)continue;
    const invoice=matched.find(i=>i.id===proposal.invoiceId);
    const lines=[...proposal.lines],components=[...proposal.components];
    const candidatesFor=(component,line)=>{
      if(jobs.length===1&&product(routeRevenueCategory(jobs[0].fields))==="cleanup")return jobs;
      const candidates=jobs.filter(j=>product(routeRevenueCategory(j.fields))===product(component.category));
      const kind=addonKind(line.description);
      return product(component.category)==="addon"&&kind
        ? candidates.filter(j=>{const sourceKind=addonKind(j.fields["Source Service Label"]||j.fields["Service Type"]||"");return !sourceKind||sourceKind===kind;}) : candidates;
    };
    // An undated add-on can be attached only to a uniquely matching completed
    // add-on in a package anchored by this one dated cleanup. Never infer a
    // service that has no completed source job, or use monthly subscription fees.
    const packageDates=invoice.lines.filter(l=>classifyRevenueLine(l,invoice).billing!=="subscription")
      .map(l=>invoiceServiceDates(l.description,invoice.date,identity.date));
    const singlePackageDate=packageDates.every(d=>d!==null&&d.every(date=>date===identity.date))
      && components.some(c=>product(c.category)==="cleanup");
    if(singlePackageDate)for(const line of invoice.lines){
      if(lines.includes(line)||!Number.isFinite(line.amount)||line.amount<0)continue;
      const classified=classifyRevenueLine(line,invoice),kind=addonKind(line.description);
      if(classified.category!=="addon"||!kind||invoiceServiceDates(line.description,invoice.date,identity.date)?.length!==0)continue;
      const matches=jobs.filter(j=>product(routeRevenueCategory(j.fields))==="addon"&&addonKind(j.fields["Source Service Label"]||"")===kind);
      if(matches.length!==1)continue;
      lines.push(line);components.push({category:"addon",revenue:line.amount});
    }
    // Undated fees/other one-time lines may belong to this visit. Do not silently
    // remove them. A remaining monthly charge or tip has an explicit other basis.
    if(invoice.lines.some(line=>{
      if(!(line.amount>0)||lines.some(p=>p.description===line.description&&p.amount===line.amount)
        || /\btips?\b/i.test(line.description)||classifyRevenueLine(line,invoice).billing==="subscription")return false;
      const dates=invoiceServiceDates(line.description,invoice.date,identity.date);
      return !dates?.length||dates.includes(identity.date);
    }))continue;
    const allocations=new Map();let ambiguous=false;
    for(const [index,component] of components.entries()) {
      const candidates=candidatesFor(component,lines[index]);
      if(candidates.length!==1){ambiguous=true;break;}
      const id=routeRecordId(candidates[0].fields["Job ID"]||candidates[0].id);
      const allocation=allocations.get(id)||{record:candidates[0],components:[]};
      allocation.components.push(component);allocations.set(id,allocation);
    }
    if(ambiguous)continue;
    for(const [jobId,{record,components}] of allocations) {
      const fields=record.fields,raw=Number(fields["Revenue ($)"]),recordedRevenue=Number.isFinite(raw)?raw:null;
      const revenue=Math.round(components.reduce((sum,c)=>sum+c.revenue,0)*100)/100;
      if(revenue>0&&revenue===recordedRevenue&&components.length===1&&components[0].category===routeRevenueCategory(fields))continue;
      decisions.push({...identity,jobId,serviceType:fields["Service Type"],recordedRevenue,action:"confirm",revenue,
        category:components[0].category,components,automatic:true,
        reason:`${proposal.match==="unique_initial"?"Unique initial-cleanup":proposal.match==="priced_package"?"Exact recorded package total":"Dated"} SNG invoice ${proposal.invoiceId}: allocated each service line once to the matching original client and visit; monthly subscription charges excluded.${proposal.match==="unique_initial"?" Initial line is undated or scheduled within seven days of the completed visit; one completed cleanup within 31 days of the nearby invoice. Original completion date retained.":""}`,
        reviewer:"Automatic invoice allocation",evidence:matched.filter(i=>i.id===proposal.invoiceId),reviewedAt:new Date().toISOString()});
    }
  }
  return decisions;
}
