import { identityConflicts } from './field-policy.mjs';
export function reviewCloseoutIdentity(manifest,rows) {
  const byId=new Map();
  for(const row of rows){const id=String(row.id ?? '');byId.set(id,[...(byId.get(id)||[]),row]);}
  const conflicts=[];let matched=0,nativeServices=0;
  for(const job of manifest.jobs){
    if(manifest.schema==='opwp.field-closeout.v2'&&job.sourceProvider!=='sweep_and_go'){nativeServices++;continue;}
    const matches=byId.get(String(job.sourceJobId)) || [];
    const reasons=matches.length!==1?['Job is missing or duplicated in current SNG dispatch']:identityConflicts({identity:job.source},matches[0],manifest.employeeId);
    if(job.outcome==='exception_requires_mapping')reasons.push('SNG skip reason and billing mapping required');
    if(reasons.length)conflicts.push({jobId:job.sourceJobId,reasons});else matched++;
  }
  return {matched,conflicts,writeEnabled:false,...(manifest.schema==='opwp.field-closeout.v2'?{nativeServices}:{})};
}
