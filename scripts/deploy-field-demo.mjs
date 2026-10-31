import fs from 'node:fs';
import path from 'node:path';
import { root,receiptDir,lockPath,run,record,readRuns,acquireLock,recoverAbandonedLock } from './deployment-store.mjs';
import { MAX_DEPLOYMENT_ATTEMPTS,retryTime } from '../lib/deployment-policy.mjs';
import { demoFingerprint,demoProject,demoOrigin,prepareDemoProject } from './field-demo-project.mjs';
export async function verifyDemoRelease(id,fetcher=fetch,{attempts=6,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  for(let attempt=0;attempt<attempts;attempt++){try{
    const status=await fetcher(demoOrigin+'/api/demo-release/',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});const text=await status.text();if(!status.ok||text.length>2048||JSON.parse(text).id!==id)throw new Error('Release mismatch');
    const page=await fetcher(demoOrigin+'/field-demo/',{redirect:'error',signal:AbortSignal.timeout(15000)});await page.body?.cancel();if(page.status!==200)throw new Error('Demo page unavailable');
    const blocked=await fetcher(demoOrigin+'/api/field-demo/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'start'}),signal:AbortSignal.timeout(15000)});await blocked.body?.cancel();if(blocked.status!==403)throw new Error('Origin protection missing');
    const admin=await fetcher(demoOrigin+'/admin/',{redirect:'manual',signal:AbortSignal.timeout(15000)});await admin.body?.cancel();if(admin.status!==404)throw new Error('Production route exposed');
    for(const route of ['/field-sandbox/','/field-sandbox/office/']){const r=await fetcher(demoOrigin+route,{redirect:'error',signal:AbortSignal.timeout(15000)});await r.body?.cancel();if(r.status!==200)throw new Error('Unified training page unavailable');}
    const sandbox=await fetcher(demoOrigin+'/api/field-sandbox/session/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'start'}),signal:AbortSignal.timeout(15000)});await sandbox.body?.cancel();if(sandbox.status!==403)throw new Error('Training origin protection missing');
    const anonymous=await fetcher(demoOrigin+'/api/field-sandbox/workday/',{signal:AbortSignal.timeout(15000)});await anonymous.body?.cancel();if(anonymous.status!==401)throw new Error('Training ownership protection missing');
    for(const route of ['/api/field/workday/','/api/admin/field-workdays/']){const r=await fetcher(demoOrigin+route,{redirect:'manual',signal:AbortSignal.timeout(15000)});await r.body?.cancel();if(r.status!==404)throw new Error('Production API exposed');}
    return {checkedAt:new Date().toISOString(),releaseMatched:true,demoPage:200,unifiedSandboxPages:200,originProtected:true,trainingOwnershipProtected:true,productionRoutesAbsent:true,url:demoOrigin+'/field-sandbox/',officeUrl:demoOrigin+'/field-sandbox/office/'};
  }catch{if(attempt===attempts-1)throw new Error('Demo live verification failed; release, page, origin protection or route isolation did not pass.');}await pause(10000);}
}
export async function attemptDemoRelease(release){
  recoverAbandonedLock(lockPath);if(!acquireLock(lockPath,release.id)){release.status='blocked';release.reason='Waiting for another deployment to finish.';release.nextRetryAt=new Date().toISOString();record(release);return false;}
  try{
    const latest=readRuns().find(item=>item.id===release.id);if(latest)Object.assign(release,latest);
    if(['verified','superseded'].includes(release.status))return true;if((release.attempts||0)>=MAX_DEPLOYMENT_ATTEMPTS)return false;
    if(demoFingerprint()!==release.sourceHash){release.status='blocked';release.reason='Demo source changed; waiting for the owning session to submit current source.';record(release);return false;}
    release.attempts=(release.attempts||0)+1;release.status='validating';release.reason='';release.nextRetryAt=null;record(release);
    const logFile=path.join(receiptDir,`${release.id}-attempt-${release.attempts}.log`);
    for(const [stage,cmd,args] of [['Tests','npm',['test']],['Dependency audit','npm',['audit','--audit-level=high']],['Diff validation','git',['diff','--check']]]){release.stage=stage;record(release);console.log(stage);run(cmd,args,{logFile});}
    release.stage='Isolated demo production build';record(release);console.log(release.stage);prepareDemoProject(release,{logFile});run('npm',['run','build:cloudflare'],{cwd:demoProject,logFile});
    if(demoFingerprint()!==release.sourceHash){release.status='blocked';throw new Error('Demo source changed during build; waiting for its owning session.');}
    release.stage='Isolated demo migration';record(release);run('wrangler',['d1','migrations','apply','opwp-field-demo','--remote','--config',path.join(root,'wrangler.field-demo.jsonc')],{logFile});
    release.status='deploying';release.stage='Cloudflare demo deployment';record(release);console.log(release.stage);run('wrangler',['deploy','--config',path.join(root,'wrangler.field-demo.jsonc')],{logFile});
    release.status='verifying';release.stage='Verify live demo and isolation';record(release);release.verification=await verifyDemoRelease(release.id);release.status='verified';release.stage='Live demo verified';release.verifiedAt=new Date().toISOString();release.reason='';record(release);
    for(const old of readRuns())if(old.id!==release.id&&old.target==='field_demo'&&!['verified','superseded'].includes(old.status)&&(old.createdAt||old.updatedAt)<release.createdAt){old.status='superseded';old.resolvedBy=release.id;old.reason='Replaced by the verified isolated demo release.';record(old);}
    console.log('VERIFIED DEMO',release.verification.url);return true;
  }catch(error){if(!['verified','blocked'].includes(release.status))release.status=release.attempts>=MAX_DEPLOYMENT_ATTEMPTS?'attention_required':'retry_scheduled';release.reason=['Command failed','Command timed out'].includes(error.message)?`${error.message} at ${release.stage}. Inspect the private attempt log.`:error.message;release.nextRetryAt=retryTime(release.attempts);try{record(release);}catch{}console.error(release.status,release.reason);return release.status==='verified';}finally{fs.unlinkSync(lockPath);}
}
