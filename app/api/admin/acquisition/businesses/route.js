import { verifyAdminRequest } from '@/lib/admin-auth';
import { getDb } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { readBoundedProviderJson } from '@/lib/bounded-body.mjs';
import { businessAcquisitionHandlers } from '@/lib/business-acquisition.mjs';
export const dynamic='force-dynamic';
const handlers=businessAcquisitionHandlers({verifyAdminRequest,getDb,checkRateLimit,readBody:readBoundedProviderJson});
export const GET=handlers.GET;
export const POST=handlers.POST;
