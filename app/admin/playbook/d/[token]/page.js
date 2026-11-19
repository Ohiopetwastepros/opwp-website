import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {verifyAdminRequest} from '@/lib/admin-auth';
import {getRuntimeEnv} from '@/lib/cloudflare';
import {getDb} from '@/lib/db';
import {listPlaybookWorkspace, PlaybookError} from '@/lib/lead-playbook-service';
import PlaybookQueueClient from '../../PlaybookQueueClient';
export const dynamic = 'force-dynamic';
export const metadata = {title: 'Review lead reply | OPWP', robots: {index: false, follow: false, nocache: true}, referrer: 'no-referrer'};
export default async function PlaybookReviewPage({params}) {
  const {token} = await params;
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) redirect('/admin/login/?next=' + encodeURIComponent(`/admin/playbook/d/${token}/`));
  try {
    const workspace = await listPlaybookWorkspace(getDb(), getRuntimeEnv(), {token});
    return <main><PlaybookQueueClient initialWorkspace={workspace} token={token} /></main>;
  } catch (error) {
    return <main style={{maxWidth: 600, margin: '40px auto', padding: 20}}><h1>Reply review</h1><p>{error instanceof PlaybookError ? error.message : 'This review is temporarily unavailable.'}</p><a href="/admin/playbook/">Open drafts</a></main>;
  }
}
