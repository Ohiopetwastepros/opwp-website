import {authorizePlaybookRequest, playbookJson, playbookFailure, playbookId} from '@/lib/lead-playbook-admin';
import {reviewPlaybookCandidate} from '@/lib/lead-playbook-service';
export const dynamic = 'force-dynamic';
export async function POST(request, {params}) {
  const context = await authorizePlaybookRequest(request, true);
  if (context.response) return context.response;
  const id = playbookId((await params).candidateId);
  if (!id) return playbookJson({error: 'Invalid candidate.'}, 400);
  try { return playbookJson(await reviewPlaybookCandidate(context.db, context.env, id, context.body, context.auth.email)); }
  catch (error) { return playbookFailure(error); }
}
