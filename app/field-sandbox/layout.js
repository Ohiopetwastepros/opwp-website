import { getCloudflareContext } from '@opennextjs/cloudflare';
import { notFound } from 'next/navigation';
import SandboxFrame from './SandboxFrame';
export const dynamic='force-dynamic';
export const metadata={title:'OPWP Training | Technician & Office',robots:{index:false,follow:false}};
export default async function SandboxLayout({children}){
 const {env}=await getCloudflareContext({async:true});
 if(env.FIELD_SANDBOX_ONLY!=='true')notFound();
 return <SandboxFrame>{children}</SandboxFrame>;
}
