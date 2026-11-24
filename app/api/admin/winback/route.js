import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getRuntimeEnv } from "@/lib/cloudflare";
import { protectJsonRequest } from "@/lib/public-api-security";
import { WINBACK_ORG, winbackCampaign, winbackRecipients, winbackSwitches } from "@/lib/winback-store.mjs";
import { winbackReport } from "@/lib/winback-policy.mjs";
import { runWinbackBatch } from "@/lib/winback-runner.mjs";

export const dynamic = "force-dynamic";
const privateHeaders = {"Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff"};
const campaignKey = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const json = (body, status = 200) => Response.json(body, {status, headers: privateHeaders});
const switches = env => ({storageReady: env.WINBACK_STORAGE_READY === "true", enabled: env.WINBACK_ENABLED === "true",
  sendEnabled: env.WINBACK_SEND_ENABLED === "true", stopped: env.WINBACK_KILL_SWITCH !== "false", autoReplyEnabled: env.WINBACK_AUTOREPLY_ENABLED === "true"});
const active = config => config.enabled && config.sendEnabled && !config.stopped;

export async function GET(request) {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return json({ok: false, error: "Unauthorized"}, 401);
  const url = new URL(request.url), campaignId = url.searchParams.get("campaignId");
  if ([...url.searchParams.keys()].some(key => key !== "campaignId") || url.searchParams.getAll("campaignId").length > 1 || campaignId !== null && !campaignKey(campaignId)) {
    return json({ok: false, error: "A valid campaign ID is required."}, 400);
  }
  const env = getRuntimeEnv(), config = switches(env);
  if (!config.storageReady) return json({ok: true, config, report: null, held: "storage_not_ready"});
  if (!env.DB) return json({ok: false, error: "Campaign storage is unavailable."}, 503);
  if (!campaignId) return json({ok: true, config, report: null});
  try {
    const campaign = await winbackCampaign(env.DB, campaignId);
    if (!campaign) return json({ok: false, error: "Campaign not found."}, 404);
    const recipients = await winbackRecipients(env.DB, campaignId);
    const gate = await winbackSwitches(env.DB, env, campaignId);
    const counts = Object.fromEntries(["queued", "sent", "failed", "replied", "opted_out", "skipped"].map(status => [status, recipients.filter(row => row.status === status).length]));
    // Aggregate only. Private copy, contact data, source files and provider
    // messages never become browser response fields.
    return json({ok: true, config, campaign: {id: campaign.id, enabled: campaign.enabled === 1, stopped: campaign.kill_switch !== 0,
      approvalRecorded: Boolean(campaign.approved_by?.trim() && campaign.approval_evidence?.trim())},
    switchesAllowAttempt: gate.allowed === true, eligibilityVerified: false, held: gate.allowed ? null : gate.reason,
    counts, report: winbackReport(recipients)});
  } catch {return json({ok: false, error: "Campaign report could not be loaded."}, 503);}
}

export async function POST(request) {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return json({ok: false, error: "Unauthorized"}, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin || ![null, "same-origin"].includes(request.headers.get("sec-fetch-site"))) {
    return json({ok: false, error: "Cross-site request blocked."}, 403);
  }
  const guarded = await protectJsonRequest(request, {scope: `admin_winback:${auth.email}`, limit: 12, windowSeconds: 600, maxBytes: 1024, turnstile: false, failClosed: true});
  if (guarded.response) return guarded.response;
  const body = guarded.body;
  if (!body || Array.isArray(body) || typeof body !== "object" || !["kill_all", "cancel_campaign", "run_batch"].includes(body.action) ||
      Object.keys(body).some(key => !["action", "campaignId"].includes(key)) ||
      (body.action === "kill_all" ? Object.hasOwn(body, "campaignId") : !campaignKey(body.campaignId))) {
    return json({ok: false, error: "Use kill_all, cancel_campaign, or run_batch with a campaign ID."}, 400);
  }
  const env = getRuntimeEnv(), config = switches(env);
  if (!config.storageReady) return json({ok: false, held: "storage_not_ready"}, 409);
  if (!env.DB) return json({ok: false, error: "Campaign storage is unavailable."}, 503);
  try {
    if (body.action === "kill_all") {
      await env.DB.prepare("UPDATE winback_settings SET enabled=0,kill_switch=1,updated_at=CURRENT_TIMESTAMP WHERE organization_id=?").bind(WINBACK_ORG).run();
      console.log(JSON.stringify({event: "winback_admin_stopped", actor: auth.email}));
      return json({ok: true, stopped: true});
    }
    const campaign = await winbackCampaign(env.DB, body.campaignId);
    if (!campaign) return json({ok: false, error: "Campaign not found."}, 404);
    if (body.action === "cancel_campaign") {
      await env.DB.batch([
        env.DB.prepare("UPDATE winback_campaigns SET enabled=0,kill_switch=1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(campaign.id, WINBACK_ORG),
        env.DB.prepare("UPDATE winback_recipients SET status='skipped',skip_reason='owner_cancelled',updated_at=CURRENT_TIMESTAMP WHERE campaign_id IN (SELECT id FROM winback_campaigns WHERE id=? AND organization_id=?) AND status='queued'").bind(campaign.id, WINBACK_ORG),
        env.DB.prepare("UPDATE winback_deliveries SET status='cancelled',error_code='owner_cancelled',updated_at=CURRENT_TIMESTAMP WHERE recipient_id IN (SELECT r.id FROM winback_recipients r JOIN winback_campaigns c ON c.id=r.campaign_id WHERE c.id=? AND c.organization_id=?) AND status IN ('draft','reserved','sending')").bind(campaign.id, WINBACK_ORG),
      ]);
      console.log(JSON.stringify({event: "winback_admin_cancelled", campaignId: campaign.id, actor: auth.email}));
      return json({ok: true, campaignId: campaign.id, stopped: true});
    }
    if (!active(config)) return json({ok: false, held: "environment_disabled"}, 409);
    const gate = await winbackSwitches(env.DB, env, campaign.id);
    if (!gate.allowed) return json({ok: false, held: gate.reason}, 409);
    // No client copy, approval, provider, recipient or file input is accepted.
    // The engine checks stored owner approval, copy hashes, schedule, all fresh
    // provider evidence and switches again. Unknown adapters leave work queued.
    const result = await runWinbackBatch(env, {campaignId: campaign.id, limit: 1});
    console.log(JSON.stringify({event: "winback_admin_batch_attempt", campaignId: campaign.id, actor: auth.email}));
    return json({ok: true, campaignId: campaign.id, result: {enabled: result.enabled === true, sent: result.sent || 0, skipped: result.skipped || 0,
      failed: result.failed || 0, held: result.held || null}});
  } catch {return json({ok: false, error: "Campaign action could not be completed. Refresh before trying again."}, 503);}
}
