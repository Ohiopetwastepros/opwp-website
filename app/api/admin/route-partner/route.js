import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { finalizeRoutePartnerPlan, getRoutePartnerDay, importRoutePartnerDay, validateRoutePartnerCompletions } from "@/lib/route-partner";
import { prepareFieldRelease } from "@/lib/field-operations";
import { sngRequest, sngRows } from "@/lib/sweepandgo";
import { readBoundedProviderJson } from "@/lib/bounded-body.mjs";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { validDispatchDate } from "@/lib/daily-route-optimizer.mjs";

export const dynamic = "force-dynamic";
const json = (body, options = {}) => Response.json(body, { ...options, headers: { ...options.headers, "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } });

function validDate(value) {
  return validDispatchDate(value);
}

async function context(request) {
  const auth = await verifyAdminRequest(request.headers);
  if (!auth.authorized) return { response: json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  const db = getDb();
  if (!db) return { response: json({ ok: false, error: "Route Partner storage is not configured." }, { status: 503 }) };
  return { auth, db };
}

export async function GET(request) {
  const current = await context(request);
  if (current.response) return current.response;
  const date = new URL(request.url).searchParams.get("date") || "";
  if (!validDate(date)) return json({ ok: false, error: "A valid service date is required." }, { status: 400 });
  const rate = await checkRateLimit(request, { scope: "dispatch_read", limit: 60, windowSeconds: 60, failClosed: true });
  if (!rate.allowed) return rateLimitResponse(rate);
  try {
    return json({ ok: true, day: await getRoutePartnerDay(current.db, date) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The route day could not be loaded.";
    console.error(JSON.stringify({ message: "route partner day load failed", date, error: message }));
    return json({ ok: false, error: "The route day could not be loaded." }, { status: 502 });
  }
}

export async function POST(request) {
  const current = await context(request);
  if (current.response) return current.response;
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return json({ ok: false, error: "Cross-site request blocked." }, { status: 403 });

  let body;
  try {
    body = await readBoundedProviderJson(request, 2048);
  } catch {
    return json({ ok: false, error: "A valid JSON request is required." }, { status: 400 });
  }

  const action = String(body?.action ?? "");
  const allowed = { import: ["action", "date"], finalize: ["action", "date", "planId"], validate_crm: ["action", "date"], review_exception: ["action", "date", "requestId", "decision", "denialReason"] };
  if (!body || !Object.hasOwn(allowed, action) || Object.keys(body).some(key => !allowed[action].includes(key)) || !validDate(body.date)
    || [body.planId, body.requestId].some(id => id !== undefined && (typeof id !== "string" || id.length > 100))
    || (action === "review_exception" && !["approved", "denied"].includes(body.decision))) return json({ ok: false, error: "Provide a valid dispatch action and date." }, { status: 400 });
  const rate = await checkRateLimit(request, { scope: `dispatch_write:${current.auth.email}`, limit: 6, windowSeconds: 60, failClosed: true });
  if (!rate.allowed) return rateLimitResponse(rate);
  let leaseKey, leaseToken;
  try {
    if (action === "import" || action === "finalize") {
      // A server-side account quota cannot be bypassed by changing browser/IP.
      const window = Math.floor(Date.now() / 600000) * 600;
      const quota = await current.db.prepare(`INSERT INTO api_rate_limits(scope,client_key,window_start,request_count,expires_at) VALUES ('dispatch_account',?,?,1,datetime(?,'unixepoch'))
        ON CONFLICT(scope,client_key,window_start) DO UPDATE SET request_count=request_count+1 RETURNING request_count`).bind(current.auth.email, window, window + 1200).first();
      if (!quota || Number(quota.request_count) > 8) return json({ ok: false, error: "Routing refresh limit reached. Try again in ten minutes." }, { status: 429 });
      leaseKey = `dispatch_lock:org-opwp:${body.date}`; leaseToken = crypto.randomUUID();
      const lease = await current.db.prepare(`INSERT INTO airtable_cockpit_snapshots(snapshot_key,payload,status,captured_at) VALUES (?,?,'success',?)
        ON CONFLICT(snapshot_key) DO UPDATE SET payload=excluded.payload,captured_at=excluded.captured_at WHERE captured_at<? RETURNING snapshot_key`)
        .bind(leaseKey, leaseToken, new Date().toISOString(), new Date(Date.now() - 300000).toISOString()).first();
      if (!lease) { leaseKey = null; return json({ ok: false, error: "This date is already being refreshed or released. Please wait." }, { status: 409 }); }
    }
    if (action === "import") {
      const date = String(body?.date ?? "");
      if (!validDate(date)) return json({ ok: false, error: "A valid service date is required." }, { status: 400 });
      const dispatch = await sngRequest("/api/v1/dispatch_board/jobs_for_date", { searchParams: { date } });
      if (!dispatch.configured) return json({ ok: false, error: "Sweep & Go is not configured." }, { status: 503 });
      if (!dispatch.ok) return json({ ok: false, error: `Sweep & Go returned status ${dispatch.status}.` }, { status: 502 });
      const imported = await importRoutePartnerDay({ db: current.db, date, sourceRows: sngRows(dispatch), actor: current.auth.email });
      const day = await getRoutePartnerDay(current.db, date);
      console.log(JSON.stringify({ message: "route partner day imported", date, actor: current.auth.email, ...imported }));
      return json({ ok: true, imported, day }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "finalize") {
      const planId = String(body?.planId ?? "");
      const date = String(body?.date ?? "");
      if (!planId || !validDate(date)) return json({ ok: false, error: "A route plan and service date are required." }, { status: 400 });
      const source = await sngRequest("/api/v1/dispatch_board/jobs_for_date", { searchParams: { date } });
      if (!source.ok) return json({ ok: false, error: "SNG could not confirm current dispatch. Route release is blocked." }, { status: 502 });
      const refreshed = await importRoutePartnerDay({ db: current.db, date, sourceRows: sngRows(source), actor: current.auth.email });
      if (!refreshed.planIds.includes(planId)) return json({ ok: false, error: "Dispatch changed. Refresh and review the latest optimized draft before release." }, { status: 409 });
      const finalized = await finalizeRoutePartnerPlan({ db: current.db, planId, date, actor: current.auth.email });
      const fieldRelease = await prepareFieldRelease(current.db, planId);
      const day = await getRoutePartnerDay(current.db, date);
      console.log(JSON.stringify({ message: "route partner plan finalized", planId, date, actor: current.auth.email, unchanged: finalized.unchanged, fieldAssigned: fieldRelease.assigned }));
      return json({ ok: true, finalized, fieldRelease, day }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "validate_crm") {
      const date = String(body?.date ?? "");
      if (!validDate(date)) return json({ ok: false, error: "A valid service date is required." }, { status: 400 });
      const dispatch = await sngRequest("/api/v1/dispatch_board/jobs_for_date", { searchParams: { date } });
      if (!dispatch.configured) return json({ ok: false, error: "Sweep & Go is not configured." }, { status: 503 });
      if (!dispatch.ok) return json({ ok: false, error: `Sweep & Go returned status ${dispatch.status}.` }, { status: 502 });
      const validation = await validateRoutePartnerCompletions({ db: current.db, date, sourceRows: sngRows(dispatch), actor: current.auth.email });
      return json({ ok: true, validation, day: await getRoutePartnerDay(current.db, date) }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "review_exception") {
      const date = String(body?.date ?? "");
      const requestId = String(body?.requestId ?? "");
      const decision = body?.decision === "denied" ? "denied" : "approved";
      const denialReason = decision === "denied" ? String(body?.denialReason || "").trim().slice(0, 500) : null;
      if (!validDate(date) || !requestId) return json({ ok: false, error: "A valid exception and service date are required." }, { status: 400 });
      if (decision === "denied" && !denialReason) return json({ ok: false, error: "A denial reason is required." }, { status: 400 });
      await current.db.prepare(
        `UPDATE route_partner_change_requests SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,denial_reason=?,updated_at=CURRENT_TIMESTAMP
         WHERE id=? AND organization_id='org-opwp' AND status='pending'
           AND route_plan_id IN (SELECT id FROM route_partner_route_plans WHERE organization_id='org-opwp' AND service_date=?)`
      ).bind(decision, current.auth.email, denialReason, requestId, date).run();
      return json({ ok: true, day: await getRoutePartnerDay(current.db, date) }, { headers: { "Cache-Control": "no-store" } });
    }

    return json({ ok: false, error: "The requested action is not supported." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The route operation failed.";
    console.error(JSON.stringify({ message: "route partner operation failed", action, actor: current.auth.email, error: message }));
    const safe = /^(Dispatch |Every dispatch |A route has already |The CRM connection |No dispatched |Daily routing allowance |Refresh and resolve |Only a draft |The route plan was not found)/.test(message);
    return json({ ok: false, error: safe ? message : "The route operation could not complete. Previous saved routes are retained." }, { status: 502 });
  } finally {
    if (leaseKey) await current.db.prepare("DELETE FROM airtable_cockpit_snapshots WHERE snapshot_key=? AND payload=?").bind(leaseKey, leaseToken).run();
  }
}
