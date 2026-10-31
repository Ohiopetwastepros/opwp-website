import { NextResponse } from 'next/server';
import { getRuntimeEnv } from '@/lib/cloudflare';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { beginMfaLogin, finishMfaLogin, changeMfaSecurity, revokeMfaSession, listMfaDevices, MFA_SESSION_COOKIE, MFA_CHALLENGE_COOKIE, CHALLENGE_SECONDS, readMfaCookie, mfaCookie, MfaError } from '@/lib/admin-mfa.mjs';

export const dynamic = 'force-dynamic';
const json = (body,status=200) => NextResponse.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
function sameOrigin(request) {return request.headers.get('sec-fetch-site') !== 'cross-site' && request.headers.get('origin') === new URL(request.url).origin;}
async function input(request) {
  if(!String(request.headers.get('content-type')||'').startsWith('application/json'))throw new MfaError('Send JSON input.',415);
  if(Number(request.headers.get('content-length')||0)>8192)throw new MfaError('Request is too large.',413);
  const reader=request.body?.getReader();if(!reader)throw new MfaError('Invalid request.',400);
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();throw new MfaError('Request is too large.',413);}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{const body=JSON.parse(new TextDecoder().decode(bytes));if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return body;}catch{throw new MfaError('Invalid request.',400);}
}
function failed(error) {
  if(error instanceof MfaError)return json({ok:false,error:error.message},error.status);
  console.error(JSON.stringify({event:'admin_mfa_unavailable'}));
  return json({ok:false,error:'Secure sign-in is temporarily unavailable. Please try again later.'},503);
}
function challengeResponse(result) {
  const response=json({ok:true,step:result.step,secret:result.secret,uri:result.uri},202);
  response.cookies.set(mfaCookie(MFA_CHALLENGE_COOKIE,result.challengeToken,CHALLENGE_SECONDS));
  return response;
}
export async function GET(request) {
  const auth=await verifyAdminRequest(request.headers);
  if(!auth.authorized)return json({ok:true,authenticated:false,identity:null});
  try{return json({ok:true,authenticated:true,identity:auth.email,expiresAt:auth.expiresAt,devices:await listMfaDevices(getRuntimeEnv())});}catch(error){return failed(error);}
}
export async function POST(request) {
  if(!sameOrigin(request))return json({ok:false,error:'Cross-site requests are not allowed.'},403);
  try{
    const rate=await checkRateLimit(request,{scope:'admin_mfa_login',limit:20,windowSeconds:300,failClosed:true});
    if(!rate.allowed)return rateLimitResponse(rate);
    const body=await input(request);const env=getRuntimeEnv();
    if(!body.action||body.action==='password')return challengeResponse(await beginMfaLogin(env,body));
    if(body.action==='verify'){
      const result=await finishMfaLogin(env,readMfaCookie(request.headers,MFA_CHALLENGE_COOKIE),body,request.headers.get('user-agent')||'Browser');
      const response=json({ok:true,step:result.recoveryCodes.length?'recovery_codes':'complete',recoveryCodes:result.recoveryCodes,recovery:result.recovery,expiresAt:result.expiresAt});
      response.cookies.set(mfaCookie(MFA_SESSION_COOKIE,result.sessionToken,result.duration));
      response.cookies.set(mfaCookie(MFA_CHALLENGE_COOKIE,'',0));
      response.cookies.set({name:'opwp_admin_session',value:'',httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:0});
      return response;
    }
    if(['reset','revoke_all'].includes(body.action)){
      const result=await changeMfaSecurity(env,body);
      const response=result.challengeToken?challengeResponse(result):json({ok:true,step:'revoked'});
      response.cookies.set(mfaCookie(MFA_SESSION_COOKIE,'',0));return response;
    }
    throw new MfaError('Choose a valid sign-in action.',400);
  }catch(error){return failed(error);}
}
export async function DELETE(request) {
  if(!sameOrigin(request))return json({ok:false,error:'Cross-site requests are not allowed.'},403);
  try{
    await revokeMfaSession(getRuntimeEnv(),readMfaCookie(request.headers,MFA_SESSION_COOKIE));
    const response=json({ok:true});response.cookies.set(mfaCookie(MFA_SESSION_COOKIE,'',0));response.cookies.set(mfaCookie(MFA_CHALLENGE_COOKIE,'',0));return response;
  }catch(error){return failed(error);}
}
