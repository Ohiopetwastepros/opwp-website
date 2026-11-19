import {authorizePlaybookRequest, playbookJson, playbookFailure} from '@/lib/lead-playbook-admin';
import {listPlaybookWorkspace} from '@/lib/lead-playbook-service';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  const context = await authorizePlaybookRequest(request);
  if (context.response) return context.response;
  try { return playbookJson(await listPlaybookWorkspace(context.db, context.env)); }
  catch (error) { return playbookFailure(error); }
}
