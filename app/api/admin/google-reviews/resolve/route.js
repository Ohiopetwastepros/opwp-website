import { verifyAdminRequest } from '@/lib/admin-auth';
import { getRuntimeEnv } from '@/lib/cloudflare';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { readBoundedJson } from '@/lib/public-api-security';
import { reviewResolutionData, resolveGoogleReview } from '@/lib/google-review-resolution';
import { RecordError } from '@/lib/admin-record-policy.mjs';
export const dynamic='force-dynamic';
const responseHeaders={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
async function context(request,write) {
  const auth=await verifyAdminRequest(request.headers);
  if(!auth.authorized)return {response:Response.json({ok:false,error:'Unauthorized'},{status:401,headers:responseHeaders})};
  if(write&&(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site'))return {response:Response.json({ok:false,error:'Cross-site request blocked.'},{status:403,headers:responseHeaders})};
  const env=getRuntimeEnv();if(!env.DB||!env.AIRTABLE_API_KEY)return {response:Response.json({ok:false,error:'Review storage is unavailable.'},{status:503,headers:responseHeaders})};
  const rate=await checkRateLimit(request,{scope:write?'google_review_resolve':'google_review_read',identity:auth.email,limit:write?15:60,windowSeconds:60,failClosed:true});
  return rate.allowed?{auth,env}:{response:rateLimitResponse(rate)};
}
function failure(error){console.error(JSON.stringify({event:'review_resolution_failed',status:error instanceof RecordError?error.status:500}));return Response.json({ok:false,error:error instanceof RecordError?error.message:'Review data could not be confirmed. Reload before trying again.'},{status:error instanceof RecordError?error.status:500,headers:responseHeaders});}
export async function GET(request){const c=await context(request,false);if(c.response)return c.response;try{return Response.json({ok:true,...await reviewResolutionData(c.env)},{headers:responseHeaders});}catch(error){return failure(error);}}
export async function POST(request){
  const c=await context(request,true);if(c.response)return c.response;
  const parsed=await readBoundedJson(request,4096);if(parsed.response)return parsed.response;
  if(parsed.body.action==='check'){
    const rate=await checkRateLimit(request,{scope:'google_review_manual_check',identity:'org-opwp',limit:2,windowSeconds:300,failClosed:true});
    if(!rate.allowed)return rateLimitResponse(rate);
  }
  try{return Response.json({ok:true,...await resolveGoogleReview(c.env,parsed.body,c.auth.email)},{headers:responseHeaders});}catch(error){return failure(error);}
}
