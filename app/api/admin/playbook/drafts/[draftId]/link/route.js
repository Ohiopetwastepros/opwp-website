import {authorizePlaybookRequest, playbookJson, playbookFailure, playbookId} from '@/lib/lead-playbook-admin';
import {preparePlaybookNotification} from '@/lib/lead-playbook-service';
export const dynamic = 'force-dynamic';
// Generates a capability for review. This endpoint never sends a notification.
export async function POST(request, {params}) {
  const context = await authorizePlaybookRequest(request, true);
  if (context.response) return context.response;
  const id = playbookId((await params).draftId);
  if (!id) return playbookJson({error: 'Invalid draft.'}, 400);
  try { const notice = await preparePlaybookNotification(context.db, context.env, id); return playbookJson({reviewUrl: `/admin/playbook/d/${notice.token}/`}); }
  catch (error) { return playbookFailure(error); }
}
