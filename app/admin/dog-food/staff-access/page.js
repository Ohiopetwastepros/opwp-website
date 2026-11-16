import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {verifyAdminRequest} from '@/lib/admin-auth';
import AdminWorkspace from '../../AdminWorkspace';
import StaffAccessClient from './StaffAccessClient';
export const dynamic='force-dynamic';
export const metadata={title:'Dog food staff accounts',robots:{index:false,follow:false}};
export default async function StaffAccessPage(){
  const auth=await verifyAdminRequest(await headers());if(!auth.authorized)redirect('/admin/login/?next=/admin/dog-food/staff-access/');
  return <AdminWorkspace section='food-staff' email={auth.email}><StaffAccessClient/></AdminWorkspace>;
}
