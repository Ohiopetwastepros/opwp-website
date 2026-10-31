import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import test from "node:test";
import assert from "node:assert/strict";
import { routePriceIssues,invoiceProposal,applyRouteDecisions,reviewResolved } from "../lib/route-data-quality.mjs";
import {buildRouteProfitabilityFacts} from "../lib/route-profitability.mjs";
const job=(price=0)=>({fields:{"Job ID":"123",Date:"2026-08-27","Customer Name":"Example Customer","Service Type":"one_time",Status:"Completed","Revenue ($)":price}});
test("missing, negative and excessive visit prices enter review; skipped visits do not",()=>{
  for(const price of [0,-1,600])assert.equal(routePriceIssues({jobs:[job(price)]}).length,1);
  assert.equal(routePriceIssues({jobs:[job(20)]}).length,0);
  const skipped=job();skipped.fields["Service Type"]="skip";
  assert.equal(routePriceIssues({jobs:[skipped]}).length,0);
});
test("invoice proposals include only dated visit lines, not future monthly revenue",()=>{
  const issue=routePriceIssues({jobs:[job()]})[0];
  const invoice={id:"i1",customer:issue.customer,source:"archive",date:"2026-08-26",lines:[{description:"Initial Cleanup- 08/27/26",amount:55},{description:"One Time Sanitization- 08/27/26",amount:35},{description:"September Biweekly Service",amount:68}]};
  assert.equal(invoiceProposal(issue,[invoice]).proposal.amount,90);
  assert.equal(invoiceProposal(issue,[invoice,{...invoice,id:"i2",lines:[{description:"Cleanup 08/27/26",amount:200}]}]).proposal,null);
  const delivery={...invoice,lines:[{description:"Extreme Dog Fuel Green Bag",amount:59}]};
  assert.equal(invoiceProposal(issue,[delivery]).proposal.amount,59);
});
test("reviewed zero visits remain counted; source changes invalidate corrections",()=>{
  const issue=routePriceIssues({jobs:[job()]})[0];
  const decision={...issue,action:"confirm",revenue:0};
  assert.equal(reviewResolved(issue,decision),true);
  const records=applyRouteDecisions({jobs:[job()]},{123:decision});
  const facts=buildRouteProfitabilityFacts(records,{throughDate:"2026-08-31"});
  assert.equal(facts[0].jobs,1);assert.equal(facts[0].missingValues,0);
  assert.equal(applyRouteDecisions({jobs:[job(25)]},{123:{...decision,revenue:90}}).jobs[0].fields["Revenue ($)"],25);
  assert.equal(applyRouteDecisions({jobs:[job()]},{123:{...decision,action:"exclude"}}).jobs.length,0);
});

test("dated recovery accepts single-digit dates and never assigns a bundled multi-date line to one visit",()=>{
  const issue={...routePriceIssues({jobs:[job()]})[0],date:"2026-02-25"};
  const invoice=description=>({id:"1",customer:issue.customer,source:"SNG",date:"2026-02-01",lines:[{description,amount:200}]});
  for(const date of ["2/25/26","02/25/2026","2026-02-25"]) assert.equal(invoiceProposal(issue,[invoice(`Initial Cleanup ${date}`)]).proposal.amount,200);
  for(const description of ["Regular scheduled cleanups 02/25, 03/10, 03/24/26","Cleanups 02/25/26 and 03/10/26","Monthly cleanup 02/25/26"]) assert.equal(invoiceProposal(issue,[invoice(description)]).proposal,null);
});

test("yearless service dates require a nearby invoice and exclude other service dates",()=>{
  const issue={...routePriceIssues({jobs:[job()]})[0],date:"2026-02-12"};
  const invoice={id:"1364",customer:issue.customer,source:"SNG",date:"2026-02-10",lines:[{description:"Initial Cleanup - 2/12",amount:65},{description:"Regular Weekly Cleanup - 2/24",amount:21.94}]};
  assert.equal(invoiceProposal(issue,[invoice]).proposal.amount,65);
  for(const date of [undefined,"invalid","2025-02-10","2026-04-01"])assert.equal(invoiceProposal(issue,[{...invoice,date}]).proposal,null);
  assert.equal(invoiceProposal(issue,[{...invoice,lines:[{description:"Cleanups 2/12 and 2/24",amount:86.94}]}]).proposal,null);
  assert.equal(invoiceProposal(issue,[invoice,{...invoice,id:"second",lines:[{description:"Initial Cleanup 2/12",amount:70}]}]).proposal,null);
  assert.equal(invoiceProposal({...issue,date:"2026-01-02"},[{...invoice,date:"2025-12-30",lines:[{description:"Initial cleanup 1/2",amount:65}]}]).proposal.amount,65);
});
test("source ID variants and richer duplicate records agree between review and reporting",()=>{
  const sparse=job();sparse.fields["Job ID"]="123.0";
  const richer=job(25);richer.fields["Tech Name"]=staffPrivate.primaryName;
  const source={jobs:[sparse,richer]};
  assert.equal(routePriceIssues(source).length,0);
  assert.equal(buildRouteProfitabilityFacts(source,{throughDate:"2026-08-31"})[0].jobs,1);
});
