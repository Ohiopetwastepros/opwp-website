import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { fieldQuota } from '@/lib/field-quota.mjs';
import { readBoundedBytes, readBoundedProviderJson } from '@/lib/bounded-body.mjs';
import { imageMatches } from '@/lib/field-policy.mjs';
import { DemoError } from '@/lib/field-demo-model.mjs';
import { DEMO_COOKIE, DEMO_TTL, demoHash, demoSession, startDemoSession, saveDemoEvent, demoReceipts } from '@/lib/field-demo-server.mjs';

export const dynamic='force-dynamic';
const json=(body,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const sameOrigin=r=>r.headers.get('origin')===new URL(r.url).origin && r.headers.get('sec-fetch-site')!=='cross-site';
async function limit(db,request,scope,count,seconds=60) {
  const ip=await demoHash(request.headers.get('cf-connecting-ip') || 'local');
  if(!await fieldQuota(db,ip,`field_demo_${scope}`,count,seconds)) throw new DemoError('Demo request limit reached. Your phone keeps unsynced work; retry later.',429);
}
function fail(error){if(error instanceof DemoError)return json({ok:false,error:error.message},error.status);if(error instanceof RangeError)return json({ok:false,error:'This demo upload is too large.'},413);if(error instanceof SyntaxError)return json({ok:false,error:'Invalid demo request.'},400);console.error(JSON.stringify({event:'field_demo_request_failed',type:error?.name||'Error'}));return json({ok:false,error:'Demo sync is unavailable. Work saved on your phone is retained.'},503);}
async function requireSession(db,request){const session=await demoSession(db,request.headers);if(!session)throw new DemoError('This demo session expired. Export your saved day before starting a new demo.',401);return session;}
export async function GET(request){try{
  const db=getDb();if(!db)return json({ok:false,error:'Demo storage unavailable.'},503);
  await limit(db,request,'read',180);
  const session=await demoSession(db,request.headers);if(!session)return json({ok:true,session:null});
  const url=new URL(request.url),photoId=url.searchParams.get('photo');
  if(photoId){const proof=await db.prepare('SELECT body FROM field_demo_photos WHERE session_id=? AND id=?').bind(session.id,photoId.slice(0,40)).first();if(!proof)return json({ok:false,error:'Photo not found.'},404);return new Response(proof.body,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
  return json({ok:true,session:{id:session.id,day:JSON.parse(session.state_json),expiresAt:session.expires_at},receipts:await demoReceipts(db,session)});
}catch(error){return fail(error);}}
export async function POST(request){if(!sameOrigin(request))return json({ok:false,error:'Cross-site request blocked.'},403);try{
  const db=getDb();if(!db)return json({ok:false,error:'Demo storage unavailable.'},503);
  await limit(db,request,'write',180);
  const body=await readBoundedProviderJson(request,12000);
  if(body?.operation==='start'){
    await limit(db,request,'start',12,3600);
    if(!await fieldQuota(db,'all','field_demo_daily_sessions',200,86400))throw new DemoError('The daily demo limit has been reached.',429);
    const session=await startDemoSession(db),response=json({ok:true,session:{id:session.id,day:session.day,expiresAt:session.expiresAt}});
    response.cookies.set({name:DEMO_COOKIE,value:session.token,httpOnly:true,secure:new URL(request.url).protocol==='https:',sameSite:'strict',path:'/api/field-demo',maxAge:DEMO_TTL});return response;
  }
  const session=await requireSession(db,request);
  if(body?.sessionId!==session.id)throw new DemoError('This tab belongs to another demo session. Export its local work before resetting.',409);
  if(!await fieldQuota(db,session.id,'field_demo_session_writes',180))throw new DemoError('Please wait before syncing more demo actions.',429);
  if(body.operation!=='event')throw new DemoError('Unknown demo request.');
  return json({ok:true,...await saveDemoEvent(db,session,body.event)});
}catch(error){return fail(error);}}
export async function PUT(request){if(!sameOrigin(request))return json({ok:false,error:'Cross-site request blocked.'},403);try{
  const db=getDb();if(!db)return json({ok:false,error:'Demo storage unavailable.'},503);
  await limit(db,request,'photo',30);
  const session=await requireSession(db,request),url=new URL(request.url),id=url.searchParams.get('id'),taskId=url.searchParams.get('taskId');
  if(url.searchParams.get('sessionId')!==session.id)throw new DemoError('This photo belongs to another demo session.',409);
  if(!/^[a-f\d-]{36}$/i.test(id||''))throw new DemoError('Invalid photo identifier.');
  const task=JSON.parse(session.state_json).stops.flatMap(s=>s.tasks).find(t=>t.id===taskId);
  if(!task)throw new DemoError('This job cannot receive photos.',409);
  const bytes=await readBoundedBytes(request,400*1024);
  if(request.headers.get('content-type')!=='image/jpeg'||!imageMatches(bytes,'image/jpeg'))throw new DemoError('Choose a valid camera photo.');
  const hash=await demoHash(bytes),prior=await db.prepare('SELECT content_hash,task_id FROM field_demo_photos WHERE session_id=? AND id=?').bind(session.id,id).first();
  if(prior){if(prior.content_hash!==hash||prior.task_id!==taskId)throw new DemoError('Photo identifier conflict.',409);return json({ok:true,id});}
  if(['completed','skipped'].includes(task.status))throw new DemoError('This job cannot receive new photos.',409);
  const count=await db.prepare('SELECT COUNT(*) n FROM field_demo_photos WHERE session_id=?').bind(session.id).first();
  if(count.n>=24)throw new DemoError('This demo allows 24 photos.');
  await db.prepare('INSERT INTO field_demo_photos(session_id,id,task_id,content_hash,body) VALUES (?,?,?,?,?)').bind(session.id,id,taskId,hash,bytes.buffer).run();
  return json({ok:true,id});
}catch(error){return fail(error);}}
