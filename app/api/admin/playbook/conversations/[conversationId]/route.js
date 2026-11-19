import {authorizePlaybookRequest, playbookJson, playbookFailure, playbookId} from '@/lib/lead-playbook-admin';
import {setPlaybookOwner} from '@/lib/lead-playbook-service';
export const dynamic = 'force-dynamic';
export async function POST(request, {params}) {
  const context = await authorizePlaybookRequest(request, true);
  if (context.response) return context.response;
  const id = playbookId((await params).conversationId);
  if (!id || !['hand_back', 'take_over'].includes(context.body.action)) return playbookJson({error: 'Invalid ownership action.'}, 400);
  try { return playbookJson(await setPlaybookOwner(context.db, context.env, id, context.body.action === 'hand_back' ? 'backend' : 'craig')); }
  catch (error) { return playbookFailure(error); }
}
