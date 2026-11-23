import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {verifyAdminRequest} from '@/lib/admin-auth';
import AdminWorkspace from '../AdminWorkspace';
import CrmWorkspace from './CrmWorkspace';
export const dynamic='force-dynamic';
export const metadata={title:'Route OS | Ohio Pet Waste Pros',robots:{index:false,follow:false}};
export default async function Page(){const auth=await verifyAdminRequest(await headers());if(!auth.authorized)redirect('/admin/login/?next=/admin/crm/');return <AdminWorkspace section='crm-dashboard' email={auth.email}><CrmWorkspace screen='dashboard'/></AdminWorkspace>;}
