import AdminWorkspace from '../../AdminWorkspace';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {verifyAdminRequest} from '@/lib/admin-auth';
import SalesReviewClient from './SalesReviewClient';
export const dynamic='force-dynamic';
export const metadata={title:'Food sales office review',robots:{index:false,follow:false}};
export default async function SalesReviewPage() {
  const auth=await verifyAdminRequest(await headers());if(!auth.authorized)redirect('/admin/login/?next=/admin/dog-food/review/');
  return <AdminWorkspace section='dog-food' email={auth.email}><SalesReviewClient/></AdminWorkspace>;
}
