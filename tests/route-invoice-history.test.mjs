import test from 'node:test';
import assert from 'node:assert/strict';
import {allocateDatedRouteInvoices} from '../lib/route-invoice-allocation.mjs';
import {applyRouteDecisions,invoiceProposal,invoiceServiceDates} from '../lib/route-data-quality.mjs';
import {buildInvoiceRevenueFacts,summarizeInvoiceRevenue} from '../lib/revenue-report.mjs';
import {classifyRevenueLine} from '../lib/revenue-classification.mjs';
const job=(id,label,amount)=>({fields:{'Job ID':id,Date:'2026-02-28','Customer Name':'Example','Source Client ID':'123',Status:'Completed','Tech Name':"Cody Example",'Service Type':'initial','Source Service Label':label,'Revenue ($)':amount}});
const invoice={source:'Sweep & Go',id:'10',clientId:'123',customer:'Example',date:'2026-02-28',type:'one_time',status:'Paid',subtotal:270,lines:[{description:'Initial Cleanup - 2/28',amount:120},{description:'One Time Sanitization - 2/28',amount:30},{description:'3 Dogs Weekly service March',amount:120}]};
test('dated haul-away is allocated separately and an adjacent word does not hide a service date',()=>{
 const records={jobs:[job('1','Regular Plan Cleanup',141),job('2','Haul Away',0)]};
 const dated={...invoice,subtotal:141,lines:[{description:'Initial Cleanup on02/28/26',amount:120},{description:'Initial Haul Away-02/28/26',amount:21}]};
 assert.deepEqual(allocateDatedRouteInvoices(records,[dated]).map(d=>[d.jobId,d.revenue]),[['1',120],['2',21]]);
 assert.deepEqual(invoiceServiceDates('Initial cleanup on12/15/25','2025-12-15','2025-12-15'),['2025-12-15']);
 assert.equal(invoiceServiceDates('Cleanup on02/30/26','2026-02-28','2026-02-28'),null);
 const monthly={...dated,lines:[dated.lines[0],{description:'Monthly haul away 02/28/26',amount:21}]};
 assert.deepEqual(allocateDatedRouteInvoices(records,[monthly]).map(d=>[d.jobId,d.revenue]),[['1',120]]);
});
test('initial invoice allocation removes future subscription and splits separate add-on without changing technician or visit count',()=>{
 const records={jobs:[job('1','Regular Plan Cleanup',270),job('2','Sanitization Treatment',undefined)]};
 const corrections=allocateDatedRouteInvoices(records,[invoice]);
 assert.deepEqual(corrections.map(d=>[d.jobId,d.revenue,d.category]),[['1',120,'initial'],['2',30,'addon']]);
 const applied=applyRouteDecisions(records,Object.fromEntries(corrections.map(d=>[d.jobId,d])));
 assert.equal(applied.jobs.length,2);assert.equal(applied.jobs.reduce((s,j)=>s+j.fields['Revenue ($)'],0),150);
 assert.ok(applied.jobs.every(j=>j.fields['Tech Name']==="Cody Example"));
 // A changed source reopens the correction, instead of silently overwriting it.
 const changed={jobs:[job('1','Regular Plan Cleanup',280)]};
 assert.equal(applyRouteDecisions(changed,{'1':corrections[0]}).jobs[0].fields['Revenue ($)'],280);
});
test('an exact-date haul line cannot replace a rescheduled cleanup package with only the haul value',()=>{
 const records={jobs:[job('1','Regular Plan Cleanup',251)]};
 const mixed={...invoice,subtotal:251,lines:[{description:'Initial Cleanup - 2/26/26',amount:150},{description:'One Time Haul Away - 2/28/26',amount:41},{description:'Regular Cleanup - 3/12/26',amount:60}]};
 assert.deepEqual(allocateDatedRouteInvoices(records,[mixed],{from:'2026-01-01',through:'2026-03-31'}),[]);
});
test('ambiguous visits, wrong original client, voided invoice and unexplained fees cannot be auto-allocated',()=>{
 const records={jobs:[job('1','Regular Plan Cleanup',270),job('2','Sanitization Treatment',undefined)]};
 for(const invoices of [[{...invoice,clientId:'999'}],[{...invoice,status:'Voided'}],[{...invoice,lines:[...invoice.lines,{description:'Unexplained fee',amount:25}]}],[invoice,{...invoice,id:'11'}]])assert.deepEqual(allocateDatedRouteInvoices(records,invoices),[]);
 assert.deepEqual(allocateDatedRouteInvoices({jobs:[...records.jobs,job('3','Regular Plan Cleanup',0)]},[invoice]),[]);
 assert.deepEqual(allocateDatedRouteInvoices({jobs:[job('2','Sanitization Treatment',0)]},[invoice]),[]);
});
test('a separately dated future visit is excluded, but undated and bundled service charges remain ambiguous',()=>{
 const records={jobs:[job('1','Regular Plan Cleanup',170)]};
 const base={...invoice,subtotal:170,lines:[{description:'Initial Cleanup - 2/28',amount:120},{description:'Regular Cleanup - 3/14/2026',amount:50}]};
 assert.equal(allocateDatedRouteInvoices(records,[base])[0].revenue,120);
 assert.equal(allocateDatedRouteInvoices(records,[{...base,lines:[base.lines[0],{description:'Regular cleanups - 3/7 and 3/14',amount:50}]}])[0].revenue,120);
 for(const description of ['Regular Cleanup','Regular Cleanup - 2/28 and 3/14','Regular Cleanup - 2/30'])assert.deepEqual(allocateDatedRouteInvoices(records,[{...base,lines:[base.lines[0],{description,amount:50}]}]),[]);
});
test('a dated cleanup anchors explicitly completed package add-ons and free services once',()=>{
 const records={jobs:[job('1','Regular Plan Cleanup',undefined),job('2','Sanitization Treatment',undefined),job('3','Deodorization',0)]};
 const bundled={...invoice,subtotal:260,lines:[{description:'Initial Cleanup - 2/28',amount:225},{description:'Sanitization Treatment - One Time',amount:35},{description:'Deodorizer - no charge',amount:0}]};
 const corrections=allocateDatedRouteInvoices(records,[bundled]);
 assert.deepEqual(corrections.map(d=>[d.jobId,d.revenue]),[['1',225],['2',35],['3',0]]);
 assert.deepEqual(allocateDatedRouteInvoices({jobs:[records.jobs[0]]},[bundled]),[]);
 assert.deepEqual(allocateDatedRouteInvoices({...records,jobs:[...records.jobs,job('4','Sanitization Treatment',0)]},[bundled]),[]);
 const future={...bundled,lines:[...bundled.lines,{description:'Cleanup - 3/14',amount:30}]};
 assert.deepEqual(allocateDatedRouteInvoices(records,[future]),[]);
 const wrong={...invoice,lines:[{description:'Initial Cleanup - 2/28',amount:120},{description:'Sanitization - 2/28',amount:30}]};
 assert.deepEqual(allocateDatedRouteInvoices({jobs:[job('1','Regular Plan Cleanup',150),job('2','Haul Away',0)]},[wrong]),[]);
});
test('undated or rescheduled initial charges require original identity, nearby invoice and complete unique-visit coverage',()=>{
 const records={jobs:[job('1','Regular Plan Cleanup',0)]};
 const undated={...invoice,date:'2026-02-26',subtotal:60,lines:[{description:'Initial Cleanup | 2 Dogs, 1 month',amount:60}]};
 const coverage={from:'2026-01-01',through:'2026-03-31'};
 assert.equal(allocateDatedRouteInvoices(records,[undated],coverage)[0].revenue,60);
 const rescheduled={...undated,lines:[{description:'Initial Cleanup - 2/27',amount:60}]};
 assert.equal(allocateDatedRouteInvoices(records,[rescheduled],coverage)[0].date,'2026-02-28');
 assert.deepEqual(allocateDatedRouteInvoices(records,[undated],{from:'2026-02-20'}),[]);
 const competing=job('2','Regular Plan Cleanup',0);competing.fields.Date='2026-02-21';
 assert.deepEqual(allocateDatedRouteInvoices({jobs:[...records.jobs,competing]},[undated],coverage),[]);
 for(const candidate of [{...undated,id:'2',date:'2026-02-01'},{...undated,lines:[{description:'Initial Cleanup - 2/27 and 3/7',amount:60}]},{...undated,lines:[{description:'Initial Cleanup - 2/01',amount:60}]}])assert.deepEqual(allocateDatedRouteInvoices(records,[candidate],coverage),[]);
 assert.deepEqual(allocateDatedRouteInvoices(records,[undated,{...undated,id:'2'}],coverage),[]);
});
test('invoice ranges include both boundaries, omit voids, separate recurring lines and tips, and retain unexplained gift credit',()=>{
 const facts=buildInvoiceRevenueFacts([invoice,{...invoice,id:'void',status:'Voided'},{...invoice,id:'future',date:'2026-03-01'}, {source:'Sweep & Go',id:'tip',date:'2026-02-01',subtotal:150,type:'one_time',lines:[{description:'One Time Technician Tip',amount:50},{description:'Gift Certificate',amount:100}]}]);
 const total=summarizeInvoiceRevenue(facts,'2026-02-01','2026-02-28');
 assert.equal(total.invoices,2);assert.equal(total.matrix.initial.one_time,120);assert.equal(total.matrix.addon.one_time,30);assert.equal(total.matrix.scooping.subscription,120);assert.equal(total.tips,50);assert.equal(total.unclassified,100);
 assert.equal(total.subtotal,420);
});
test('legacy SNG labels and yearless dated lines classify correctly without assuming invoice cadence',()=>{
 for(const [description,category]of [['Initial Job: 2d 0.00-0.00','initial'],['March 1 Dog Biweekly','recurring'],['Regular Plan - 2d-1xW April Service','recurring'],['One Time Job: 1d 27.72-37.50','one_time'],['Cleanup - 2/12','one_time']])assert.equal(classifyRevenueLine({description},{type:'subscription'}).category,category);
});
test('historical review shows the nearby invoice rather than burying it behind later subscription bills',()=>{
 const later=Array.from({length:20},(_,i)=>({...invoice,id:`later-${i}`,date:`2026-09-${String(i+1).padStart(2,'0')}`,lines:[{description:'Monthly cleanups',amount:100}]}));
 const result=invoiceProposal({customer:'Example',clientId:'123',date:'2026-02-28'},[...later,invoice]);
 assert.equal(result.evidence[0].id,invoice.id);assert.equal(result.evidence.length,12);
});

test('an undated package matching the recorded cleanup total splits unpriced haul-away without increasing revenue',()=>{
 const records={jobs:[job('1','One Time Cleanup',241),job('2','Haul Away Service',undefined)]};
 records.jobs.forEach(j=>j.fields['Service Type']='one_time');
 const pack={...invoice,date:'2026-02-27',subtotal:241,lines:[{description:'One Time Cleanup-',amount:220},{description:'One Time Haul Away-',amount:21}]};
 const coverage={from:'2026-01-01',through:'2026-03-31'};
 const result=allocateDatedRouteInvoices(records,[pack],coverage);
 assert.deepEqual(result.map(d=>[d.jobId,d.revenue,d.category]),[['1',220,'one_time'],['2',21,'addon']]);
 assert.equal(result.reduce((sum,d)=>sum+d.revenue,0),241);
 for(const invoices of [[pack,{...pack,id:'duplicate'}],[{...pack,clientId:'other'}],[{...pack,status:'Voided'}],[{...pack,subtotal:242}],[{...pack,type:'subscription'}],[{...pack,lines:[...pack.lines,{description:'Monthly subscription',amount:60}]}]])assert.deepEqual(allocateDatedRouteInvoices(records,invoices,coverage),[]);
 assert.deepEqual(allocateDatedRouteInvoices(records,[pack],{from:'2026-02-20',through:'2026-03-31'}),[]);
 assert.deepEqual(allocateDatedRouteInvoices({jobs:[...records.jobs,job('3','One Time Cleanup',241)]},[pack],coverage),[]);
 records.jobs[1].fields['Revenue ($)']=21;
 assert.deepEqual(allocateDatedRouteInvoices(records,[pack],coverage),[]);
});
