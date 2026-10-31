import { verifyAdminRequest } from '@/lib/admin-auth';
import { getDb } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { readBoundedProviderJson } from '@/lib/bounded-body.mjs';
import { marketingHandlers } from '@/lib/marketing-store.mjs';
export const dynamic = 'force-dynamic';
const handlers = marketingHandlers({verifyAdminRequest,getDb,checkRateLimit,readBody:readBoundedProviderJson});
export const GET = handlers.GET;
export const POST = handlers.POST;
