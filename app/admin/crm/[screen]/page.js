import {headers} from 'next/headers';
import {redirect,notFound} from 'next/navigation';
import {verifyAdminRequest} from '@/lib/admin-auth';
import AdminWorkspace from '../../AdminWorkspace';
import CrmWorkspace from '../CrmWorkspace';
export const dynamic='force-dynamic';
export const metadata={title:'Route OS workspace | Ohio Pet Waste Pros',robots:{index:false,follow:false}};
export default async function Page({params}){const {screen}=await params;if(!['customers','routes','planning','best-fit','schedule','exceptions','analytics','messages','eta','work-queue','techs','leads','dog-food','reports','settings','sync-issues'].includes(screen))notFound();const auth=await verifyAdminRequest(await headers());if(!auth.authorized)redirect(`/admin/login/?next=/admin/crm/${screen}/`);return <AdminWorkspace section={`crm-${screen==='planning'||screen==='best-fit'?'routes':screen==='eta'?'messages':screen==='reports'?'analytics':screen}`} email={auth.email}><CrmWorkspace screen={screen}/></AdminWorkspace>;}
