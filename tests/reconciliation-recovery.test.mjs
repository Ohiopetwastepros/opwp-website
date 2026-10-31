import {runPrivateInNewContext} from './helpers/private-vm.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as quality from '../lib/route-data-quality.mjs';
test('display filtering preserves the complete deferred review backlog', async () => {
 const source=fs.readFileSync(new URL('../lib/route-data-quality.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('export async function readRouteReview'),source.indexOf('async function saveSnapshot')).replace('export ','');
 const issues=[{jobId:'1',ownerActionRequired:false},{jobId:'2',ownerActionRequired:true}];
 const db={prepare:()=>({bind:()=>({all:async()=>({results:[{snapshot_key:quality.REVIEW_KEY,payload:JSON.stringify({issues})}]})})})};
 const read=runPrivateInNewContext(body+'\nreadRouteReview',{...quality});
 const review=await read(db); assert.equal(review.issues.length,1); assert.equal(review.allIssues.length,2);assert.equal(review.deferredCount,1);
});
test('reclean jobs map to an existing Airtable choice and preserve their financial value', () => {
 const source=fs.readFileSync(new URL('../lib/airtable.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('function sngJobFields('),source.indexOf('\n}',source.indexOf('function sngJobFields('))+2);
 const fields=runPrivateInNewContext(body+'\nsngJobFields',{number:Number,durationMinutes:()=>0,minutesBetween:()=>0});
 const record=fields({job_id:123,job_type:'reclean',end_time:'2026-09-22T12:00:00Z',price:0});
 assert.equal(record['Service Type'],'custom'); assert.equal(record['Revenue ($)'],0);assert.equal(record['Job ID'],'123');
});
