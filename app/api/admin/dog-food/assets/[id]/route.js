import {verifyAdminRequest} from '@/lib/admin-auth';
import {getRuntimeEnv} from '@/lib/cloudflare';
export const dynamic='force-dynamic';
export async function GET(request,{params}){
  const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"};
  const auth=await verifyAdminRequest(request.headers);if(!auth.authorized)return new Response(null,{status:401,headers});
  const {id}=await params;if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))return new Response(null,{status:404,headers});
  const env=getRuntimeEnv(),asset=await env.DB.prepare('SELECT storage_key,content_type,byte_size FROM dog_food_business_assets WHERE id=?').bind(id).first();
  if(!asset||!/^image\/(jpeg|png|gif|webp)$/.test(asset.content_type)||!asset.storage_key.startsWith('dog-food/archive/products/'))return new Response(null,{status:404,headers});
  const object=await env.FIELD_PROOFS?.get(asset.storage_key);if(!object||object.size!==asset.byte_size)return new Response(null,{status:404,headers});
  return new Response(object.body,{headers:{...headers,'Content-Type':asset.content_type,'Content-Length':String(asset.byte_size)}});
}
