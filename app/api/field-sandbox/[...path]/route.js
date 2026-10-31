import { getCloudflareContext } from '@opennextjs/cloudflare';
import { handleSandboxRequest } from '@/lib/field-sandbox-server.mjs';
export const dynamic='force-dynamic';
async function handle(request){const {env}=await getCloudflareContext({async:true});return handleSandboxRequest(request,env);}
export {handle as GET,handle as POST,handle as PUT,handle as DELETE};
