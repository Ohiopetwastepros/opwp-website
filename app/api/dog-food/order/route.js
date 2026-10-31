import { POST as accountPost } from '../account/route';
export const runtime = 'nodejs';
// All ordering now goes through verified customer ownership and server pricing.
// Old cached forms are rejected safely; never mutate a customer by guest email.
export async function POST(request) { return accountPost(request); }
