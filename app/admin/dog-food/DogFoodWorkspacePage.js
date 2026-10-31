import AdminWorkspace from '../AdminWorkspace';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {verifyAdminRequest} from '@/lib/admin-auth';
import {getDb} from '@/lib/db';
import {readFoodOperations} from '@/lib/dog-food-ops-store';
import DogFoodSalesWorkspace from './DogFoodSalesWorkspace';
export default async function DogFoodWorkspacePage({initialTab='queue',section='dog-food',destination='/admin/dog-food/'}) {
  const auth=await verifyAdminRequest(await headers());
  if(!auth.authorized)redirect(`/admin/login/?next=${encodeURIComponent(destination)}`);
  const db=getDb();
  if(!db)return <AdminWorkspace section={section} email={auth.email}><main>Dog-food storage is unavailable.</main></AdminWorkspace>;
  const data=await readFoodOperations(db);
  return <AdminWorkspace section={section} email={auth.email}><DogFoodSalesWorkspace initialData={data} initialTab={initialTab}/></AdminWorkspace>;
}
