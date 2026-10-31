import { getRuntimeEnv } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";
import { metaLeadIds, verifyMetaSignature, verifyMetaToken } from "@/lib/meta-leads.mjs";
import { storeMetaLead, processMetaConfirmations } from "@/lib/meta-lead-workflow.mjs";
import { readBoundedBytes, readBoundedProviderJson } from "@/lib/bounded-body.mjs";
import { processAirtableQueue } from "@/lib/lead-assistant";
import { outboundFetch } from "@/lib/outbound-request";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { OPWP_ORGANIZATION_ID } from "@/lib/route-partner";

export const dynamic = "force-dynamic";
const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const MAX_BODY_BYTES = 64 * 1024;

export async function GET(request) {
  const env = getRuntimeEnv();
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (!env.META_WEBHOOK_VERIFY_TOKEN) return new Response("Unavailable", { status: 503, headers: responseHeaders });
  if (mode !== "subscribe" || !await verifyMetaToken(token, env.META_WEBHOOK_VERIFY_TOKEN) || !challenge || challenge.length > 500) return new Response("Forbidden", { status: 403, headers: responseHeaders });
  return new Response(challenge, { status: 200, headers: { ...responseHeaders, "Content-Type": "text/plain; charset=utf-8" } });
}

async function fetchMetaLead(env, event) {
  const version = String(env.META_GRAPH_API_VERSION || "");
  if (!/^v\d{1,2}\.\d$/.test(version) || !env.META_PAGE_ACCESS_TOKEN) throw new Error("Meta lead retrieval is not configured.");
  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(event.leadId)}`);
  url.searchParams.set("fields", "id,created_time,field_data,form_id");
  const response = await outboundFetch(url, { headers: { Authorization: `Bearer ${env.META_PAGE_ACCESS_TOKEN}`, Accept: "application/json" }, cache: "no-store" }, { provider: "meta", operation: "retrieve_lead", timeoutMs: 12000, retries: 1, retryable: true });
  const data = await readBoundedProviderJson(response);
  if (!response.ok || !data?.id) throw new Error(`Meta lead retrieval failed (${response.status}).`);
  return data;
}

export async function POST(request) {
  const env = getRuntimeEnv();
  if (!env.META_APP_SECRET || !env.META_PAGE_ACCESS_TOKEN || !env.META_GRAPH_API_VERSION) return Response.json({ ok: false, error: "Meta lead intake is not configured." }, { status: 503, headers: responseHeaders });
  const rate = await checkRateLimit(request, { scope: "webhook_meta_leads", limit: 300, windowSeconds: 60, failClosed: true });
  if (!rate.allowed) return rateLimitResponse(rate);
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return Response.json({ ok: false, error: "Request is too large." }, { status: 413, headers: responseHeaders });
  let raw;
  try { raw = await readBoundedBytes(request, MAX_BODY_BYTES); } catch { return Response.json({ ok: false, error: "Request is too large." }, { status: 413, headers: responseHeaders }); }
  if (!await verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), env.META_APP_SECRET)) return Response.json({ ok: false, error: "Invalid signature." }, { status: 401, headers: responseHeaders });
  let body;
  try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return Response.json({ ok: false, error: "Invalid request." }, { status: 400, headers: responseHeaders }); }
  const events = metaLeadIds(body);
  const allowedPages = String(env.META_ALLOWED_PAGE_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!allowedPages.length) return Response.json({ ok: false, error: "Meta page scope is not configured." }, { status: 503, headers: responseHeaders });
  if (events.some((event) => !allowedPages.includes(event.pageId))) return Response.json({ ok: false, error: "Page is not authorized." }, { status: 403, headers: responseHeaders });
  if (!events.length) return Response.json({ ok: true, accepted: 0 }, { headers: responseHeaders });
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "Storage is unavailable." }, { status: 503, headers: responseHeaders });
  let accepted = 0;
  for (const event of events) {
    const claim = await db.prepare(`INSERT INTO lead_webhook_events (provider,event_id,organization_id,status)
      VALUES ('meta',?,?,'received')
      ON CONFLICT(provider,event_id) DO UPDATE SET status='received',received_at=CURRENT_TIMESTAMP,error_message=NULL,processed_at=NULL
      WHERE lead_webhook_events.status='failed' OR (lead_webhook_events.status='received' AND lead_webhook_events.received_at<datetime('now','-5 minutes'))`).bind(event.leadId, OPWP_ORGANIZATION_ID).run();
    if (!Number(claim.meta?.changes || 0)) {
      const receipt = await db.prepare(`SELECT status FROM lead_webhook_events WHERE provider='meta' AND event_id=? AND organization_id=?`).bind(event.leadId, OPWP_ORGANIZATION_ID).first();
      if (receipt?.status !== "processed") return Response.json({ ok: false, error: "Lead processing is pending; retry delivery." }, { status: 503, headers: { ...responseHeaders, "Retry-After": "60" } });
      continue;
    }
    try {
      const data = await fetchMetaLead(env, event);
      const lead = await storeMetaLead(db, env, data, event);
      await processAirtableQueue({ ...env, DB: db }, 1, lead.id);
      await db.prepare(`UPDATE lead_webhook_events SET status='processed',processed_at=CURRENT_TIMESTAMP WHERE provider='meta' AND event_id=?`).bind(event.leadId).run();
      accepted += 1;
      // The durable outbox remains available to cron if this immediate attempt is interrupted.
      await processMetaConfirmations({ ...env, DB: db }, { submissionId: lead.id, limit: 1 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Meta lead processing failed.";
      await db.prepare(`UPDATE lead_webhook_events SET status='failed',error_message=?,processed_at=CURRENT_TIMESTAMP WHERE provider='meta' AND event_id=?`).bind(message.slice(0, 500), event.leadId).run();
      console.error(JSON.stringify({ event: "meta_lead_processing_failed", leadId: event.leadId, message }));
      return Response.json({ ok: false, error: "Meta lead processing failed." }, { status: 503, headers: responseHeaders });
    }
  }
  return Response.json({ ok: true, accepted }, { headers: responseHeaders });
}
