import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTravel, parseTravelTime, summarizeTravel, summarizeTravelDates, travelDate, travelJobs, travelPairs, travelWeek } from "../lib/stop-travel.mjs";

const event=(job,type,data={},extra={})=>({id:`${job}:${type}`,external_id:`${job}.0`,event_type:`job:${type}`,source:"sweep_and_go",payload:JSON.stringify({data:{job_id:job,employee_id:Number(staffPrivate.providerIds.primary),employee_name:staffPrivate.primaryName,date:"2025-07-09",...data}}),...extra});
const samples=[
  event(1,"started",{client_name:"Fixture Client A",start_time:"2025-07-09 09:00:00",start_latitude:41.5,start_longitude:-83.5}),
  event(1,"completed",{start_time:"2025-07-09 09:00:00",end_time:"2025-07-09 09:12:00"}),
  event(2,"started",{client_name:"Fixture Client B",start_time:"2025-07-09 09:48:00",start_latitude:41.51,start_longitude:-83.51}),
  event(2,"completed",{start_time:"2025-07-09 09:48:00",end_time:"2025-07-09 10:00:00"}),
];
const pair=()=>travelPairs(travelJobs(samples),"2025-07-09").pairs[0];
test("fabricated visits use completion-to-start and exclude the next service interval",()=>{
  const p=pair();assert.equal(p.elapsedMinutes,36);assert.equal(p.completedAt,"2025-07-09T13:12:00.000Z");assert.equal(p.nextStartedAt,"2025-07-09T13:48:00.000Z");
  const result=evaluateTravel(p,{minutes:10,miles:3.7});assert.equal(result.flagged,true);assert.equal(result.excessMinutes,26);assert.equal(result.actualMiles,null);assert.equal(result.previousCustomer,"Fixture Client A");assert.ok(!("fromPoint" in result));
});
test("strict five-minute threshold uses unrounded durations",()=>{
  for(const [elapsed,flag] of [[14.99,false],[15,false],[15.001,true]])assert.equal(evaluateTravel({...pair(),elapsedMinutes:elapsed},{minutes:10,miles:3}).flagged,flag);
  assert.equal(evaluateTravel({...pair(),elapsedMinutes:6},{minutes:0,miles:0}).flagged,true);
});
test("missing and malformed baselines never become zero-minute drive estimates",()=>{
  for(const baseline of [null,{}, {minutes:null,miles:1},{minutes:"",miles:1},{minutes:NaN,miles:1},{minutes:-1,miles:1}]){
    const r=evaluateTravel(pair(),baseline);assert.equal(r.flagged,false);assert.equal(r.status,"pending");assert.equal(r.excessMinutes,null);
  }
});
test("Eastern timestamps handle winter/summer, explicit offsets and midnight",()=>{
  assert.equal(new Date(parseTravelTime("2026-01-16 09:12:00")).toISOString(),"2026-01-16T14:12:00.000Z");
  assert.equal(parseTravelTime("2025-07-09T09:12:00-04:00"),parseTravelTime("2025-07-09 09:12:00"));
  assert.equal(travelDate(Date.parse("2025-07-10T02:00:00Z")),"2025-07-09");
  for(const time of ["2026-03-08 02:30:00","2026-11-01 01:30:00","2026-02-30 11:00:00","2025-07-09",""])assert.equal(parseTravelTime(time),null);
});
test("duplicate job IDs and webhook replays produce one transition",()=>{
  const jobs=travelJobs([...samples,...samples,event("1.0","completed",{start_time:"2025-07-09 09:00:00",end_time:"2025-07-09 09:12:00"})]);
  assert.equal(jobs.length,2);assert.equal(travelPairs(jobs,"2025-07-09").pairs.length,1);
});
test("no cross-technician or overnight comparisons",()=>{
  const jobs=travelJobs(samples);jobs[1].technicianId="different";assert.equal(travelPairs(jobs,"2025-07-09").pairs.length,0);
  jobs[1].technicianId=staffPrivate.providerIds.primary;jobs[1].date="2025-07-10";assert.equal(travelPairs(jobs,"2025-07-09").pairs.length,0);
});
test("missing starts and overlapping work remain in coverage, never flagged",()=>{
  const jobs=travelJobs(samples);jobs[1].start=null;
  let p=travelPairs(jobs,"2025-07-09").pairs[0];assert.equal(p.elapsedMinutes,null);assert.equal(evaluateTravel(p,{minutes:1,miles:1}).flagged,false);
  jobs[1].start=jobs[0].end-60000;p=travelPairs(jobs,"2025-07-09").pairs[0];assert.match(p.issue,/Overlapping/);
  jobs[1].start=jobs[0].end+100000; jobs[0].point=null;p=travelPairs(jobs,"2025-07-09").pairs[0];assert.equal(evaluateTravel(p,{minutes:1,miles:1}).status,"pending");
});
test("an intervening job without any timestamp blocks speculative pairing",()=>{
  const jobs=travelJobs([...samples,event(3,"started",{client_name:"Unknown time"})]);
  const pairs=travelPairs(jobs,"2025-07-09").pairs;
  assert.ok(pairs.every(p=>evaluateTravel(p,{minutes:1,miles:1}).flagged===false));
});
test("repeated weekday patterns distinguish transitions from distinct days",()=>{
  const r=evaluateTravel(pair(),{minutes:10,miles:2});
  const p=summarizeTravel([r,{...r,id:"other"},{...r,date:"2025-07-16"}])[0];
  assert.equal(p.repeatDays,2);assert.equal(p.flagged,3);assert.equal(p.weekday,"Wednesday");
});
test("current-week navigation starts Monday and exposes every day",()=>{
  assert.deepEqual(travelWeek("2025-07-21"),{from:"2025-07-21",through:"2025-07-27",dates:["2025-07-21","2025-07-22","2025-07-23","2025-07-24","2025-07-25","2025-07-26","2025-07-27"]});
  assert.deepEqual(travelWeek("2025-07-27"),{from:"2025-07-21",through:"2025-07-27",dates:["2025-07-21","2025-07-22","2025-07-23","2025-07-24","2025-07-25","2025-07-26","2025-07-27"]});
});
test("daily summaries distinguish saved empty days, flags and missing analysis",()=>{
  const rows=[{date:"2025-07-21",status:"flagged",flagged:true},{date:"2025-07-21",status:"pending",flagged:false}];
  const result=summarizeTravelDates(rows,[{date:"2025-07-21",jobs:3,capturedAt:"2025-07-21T18:00:00Z"}],["2025-07-21","2025-07-22"]);
  assert.deepEqual(result[0],{date:"2025-07-21",analyzed:true,capturedAt:"2025-07-21T18:00:00Z",jobs:3,transitions:2,flagged:1,pending:1,measured:1});
  assert.deepEqual(result[1],{date:"2025-07-22",analyzed:false,capturedAt:null,jobs:0,transitions:0,flagged:0,pending:0,measured:0});
});
