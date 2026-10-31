import { getDb } from "./db";
import { verifyFieldRequest } from "./field-auth";
import { verifyAdminRequest } from "./admin-auth";
import { FieldError } from "./field-policy.mjs";
import { checkRateLimit } from "./rate-limit";
import { fieldQuota } from "./field-quota.mjs";
export const workdayJson = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
export async function workdayContext(
  request,
  { admin = false, write = false, scope = "workday", limit = 90 } = {},
) {
  const db = getDb();
  if (!db) throw new FieldError("Field storage is not configured.", 503);
  const auth = admin
    ? await verifyAdminRequest(request.headers)
    : await verifyFieldRequest(request.headers, db);
  if (!auth.authorized)
    throw new FieldError("Sign in to continue. Local work is retained.", 401);
  if (
    write &&
    (request.headers.get("origin") !== new URL(request.url).origin ||
      request.headers.get("sec-fetch-site") === "cross-site")
  )
    throw new FieldError("Cross-site request blocked.", 403);
  const rate = await checkRateLimit(request, {
    scope,
    limit,
    windowSeconds: 60,
    failClosed: true,
  });
  if (
    !rate.allowed ||
    !(await fieldQuota(
      db,
      admin ? auth.email : auth.member.id,
      scope + "_account",
      limit,
    ))
  )
    throw new FieldError("Please wait a minute before trying again.", 429);
  return { db, auth };
}
export function workdayError(error) {
  console.error(
    JSON.stringify({
      event: "unified_field_request_failed",
      error: error instanceof Error ? error.message : "unknown",
    }),
  );
  return workdayJson(
    {
      ok: false,
      error:
        error instanceof FieldError
          ? error.message
          : "The request could not be saved. Your local work is retained.",
    },
    error instanceof FieldError ? error.status : 503,
  );
}
