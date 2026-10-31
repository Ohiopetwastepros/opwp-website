import { verifyAdminRequest } from '@/lib/admin-auth';
import { getRuntimeEnv } from '@/lib/cloudflare';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { readBoundedJson } from '@/lib/public-api-security';
import { recordCatalog, listBusinessRecords, readBusinessRecord, saveBusinessRecord, recordHistory } from '@/lib/admin-record-store.mjs';
import { RecordError } from '@/lib/admin-record-policy.mjs';
export const dynamic='force-dynamic';
const responseHeaders={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
async function context(request,write) {
  const auth=await verifyAdminRequest(request.headers);
  if(!auth.authorized)return {response:Response.json({ok:false,error:'Unauthorized'},{status:401,headers:responseHeaders})};
  if(write&&(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site'))return {response:Response.json({ok:false,error:'Cross-site request blocked.'},{status:403,headers:responseHeaders})};
  const env=getRuntimeEnv();
  if(!env.DB||!env.AIRTABLE_API_KEY)return {response:Response.json({ok:false,error:'Record storage is unavailable.'},{status:503,headers:responseHeaders})};
  const rate=await checkRateLimit(request,{scope:write?'admin_records_write':'admin_records_read',identity:auth.email,limit:write?12:90,windowSeconds:60,failClosed:true});
  if(!rate.allowed)return {response:rateLimitResponse(rate)};
  return {auth,env};
}
function failure(error) {
  const status=error instanceof RecordError?error.status:500;
  console.error(JSON.stringify({event:'admin_records_failed',status}));
  return Response.json({ok:false,error:error instanceof RecordError?error.message:'The operation could not be confirmed. Reload the record before trying again.'},{status,headers:responseHeaders});
}
export async function GET(request) {
  const c=await context(request,false);if(c.response)return c.response;
  try {
    const url=new URL(request.url),base=url.searchParams.get('base'),table=url.searchParams.get('table'),record=url.searchParams.get('record');
    if(!base&&!table)return Response.json({ok:true,bases:await recordCatalog(c.env)},{headers:responseHeaders});
    const data=url.searchParams.get('history')==='1'?{history:await recordHistory(c.env,base,table,record)}:record?await readBusinessRecord(c.env,base,table,record):await listBusinessRecords(c.env,{base,table,search:url.searchParams.get('search')||'',cursor:url.searchParams.get('cursor')||'',ids:(url.searchParams.get('ids')||'').split(',').filter(Boolean)});
    return Response.json({ok:true,...data},{headers:responseHeaders});
  }catch(error){return failure(error);}
}
export async function POST(request) {
  const c=await context(request,true);if(c.response)return c.response;
  const parsed=await readBoundedJson(request,65536);if(parsed.response)return parsed.response;
  try {return Response.json({ok:true,...await saveBusinessRecord(c.env,parsed.body,c.auth.email)},{headers:responseHeaders});}
  catch(error){return failure(error);}
}
