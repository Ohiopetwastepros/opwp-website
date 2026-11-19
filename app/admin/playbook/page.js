import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {verifyAdminRequest} from '@/lib/admin-auth';
import {getRuntimeEnv} from '@/lib/cloudflare';
import {getDb} from '@/lib/db';
import {listPlaybookWorkspace} from '@/lib/lead-playbook-service';
import AdminWorkspace from '../AdminWorkspace';
import PlaybookQueueClient from './PlaybookQueueClient';
export const dynamic = 'force-dynamic';
export const metadata = {title: 'Playbook drafts | OPWP', robots: {index: false, follow: false, nocache: true}};
export default async function PlaybookPage() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect('/admin/login/?next=/admin/playbook/');
  const workspace = await listPlaybookWorkspace(getDb(), getRuntimeEnv());
  return <AdminWorkspace section="pipeline" email={auth.email}><PlaybookQueueClient initialWorkspace={workspace} /></AdminWorkspace>;
}
