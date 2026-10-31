import { sngRequest, sngRows } from "./sweepandgo";
import { fieldQuota } from "./field-quota.mjs";
import { identityConflicts } from "./field-policy.mjs";
import { normalizePhone } from "./field-workday-store.mjs";
import { readBoundedProviderJson } from "./bounded-body.mjs";
export function fieldMessagesConfigured(env) {
  const daily = Number(env.FIELD_SMS_DAILY_LIMIT || 100);
  return (
    env.FIELD_NOTIFICATIONS_ENABLED === "true" &&
    Boolean(
      env.QUO_API_KEY &&
        normalizePhone(env.QUO_FROM_NUMBER) &&
        env.FIELD_QUO_WEBHOOK_SIGNING_KEY,
    ) &&
    Number.isInteger(daily) &&
    daily >= 1 &&
    daily <= 200
  );
}

// This adapter never creates SNG jobs, payroll records, invoices or subscription changes.
// Unknown provider outcomes are held, never blindly retried.
export async function processFieldMessages(
  env,
  { shiftId = "", limit = 8 } = {},
) {
  const db = env.DB;
  if (!db) return { configured: false };
  await db
    .prepare(
      "UPDATE field_workday_messages SET status='expired',detail='Arrival or completion window expired; no message sent.',updated_at=CURRENT_TIMESTAMP WHERE status='queued' AND expires_at<?",
    )
    .bind(new Date().toISOString())
    .run();
  await db
    .prepare(
      "UPDATE field_workday_messages SET status='uncertain',detail='Interrupted sending attempt. Verify provider before any resend.',updated_at=CURRENT_TIMESTAMP WHERE status='sending' AND updated_at<datetime('now','-10 minutes')",
    )
    .bind()
    .run();
  if (
    env.FIELD_NOTIFICATIONS_ENABLED !== "true" ||
    !env.QUO_API_KEY ||
    !normalizePhone(env.QUO_FROM_NUMBER) ||
    !env.FIELD_QUO_WEBHOOK_SIGNING_KEY
  )
    return { configured: false, sending: false };
  const daily = Number(env.FIELD_SMS_DAILY_LIMIT || 100);
  if (!Number.isInteger(daily) || daily < 1 || daily > 200)
    return { configured: false, sending: false };
  const rows = await db
    .prepare(
      "SELECT n.*,w.state_json FROM field_workday_messages n JOIN field_workdays w ON w.shift_id=n.shift_id WHERE n.status='queued' AND (?='' OR n.shift_id=?) ORDER BY n.created_at LIMIT ?",
    )
    .bind(shiftId, shiftId, Math.min(8, Math.max(1, limit)))
    .all();
  let accepted = 0;
  for (const row of rows.results) {
    const claim = await db
      .prepare(
        "UPDATE field_workday_messages SET status='sending',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued' AND expires_at>? RETURNING id",
      )
      .bind(row.id, new Date().toISOString())
      .first();
    if (!claim) continue;
    async function hold(status, detail) {
      await db
        .prepare(
          "UPDATE field_workday_messages SET status=?,detail=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(status, detail, row.id)
        .run();
    }
    try {
      const suppressed = await db
        .prepare(
          "SELECT suppressed FROM field_message_suppression WHERE phone=?",
        )
        .bind(row.recipient)
        .first();
      if (suppressed?.suppressed) {
        await hold("suppressed", "Recipient opted out. No provider request.");
        continue;
      }
      if (
        !(await fieldQuota(
          db,
          row.organization_id,
          "field_sms_daily",
          daily,
          86400,
        ))
      ) {
        await hold(
          "held",
          "Daily messaging allowance reached. No provider request.",
        );
        continue;
      }
      const day = JSON.parse(row.state_json),
        stop = day.stops.find((s) => s.id === row.stop_id),
        source = stop?.tasks.find(
          (t) => t.source?.provider === "sweep_and_go" && t.source.identity,
        )?.source;
      if (!source) {
        await hold(
          "held",
          "No verified SNG service preference contract for this visit. No provider request.",
        );
        continue;
      }
      const dispatch = await sngRequest(
        "/api/v1/dispatch_board/jobs_for_date",
        { searchParams: { date: day.date } },
      );
      if (!dispatch.ok) {
        await hold(
          "held",
          "Could not verify current SNG recipient and schedule. No provider request.",
        );
        continue;
      }
      const matches = sngRows(dispatch).filter(
        (r) => String(r.id) === String(source.jobId),
      );
      const current = matches[0],
        event = row.kind === "on_way" ? "on_the_way" : "completed";
      if (
        matches.length !== 1 ||
        identityConflicts(
          { identity: source.identity },
          current,
          day.employeeId,
        ).length ||
        ![1, 2, 6].includes(Number(current.status_id)) ||
        normalizePhone(current.cell_phone) !== row.recipient ||
        current.cleanup_notification_channel !== "sms" ||
        !String(current.cleanup_notification_type || "")
          .split(",")
          .map((s) => s.trim())
          .includes(event)
      ) {
        await hold(
          "held",
          "SNG identity, recipient or notification preference changed. No provider request.",
        );
        continue;
      }
      if (Date.parse(row.expires_at) <= Date.now()) {
        await hold(
          "expired",
          "Message window expired during verification. No provider request.",
        );
        continue;
      }
      // Never accept a configurable arbitrary upstream URL or a browser-selected recipient.
      const response = await fetch("https://api.quo.com/v1/messages", {
        method: "POST",
        headers: {
          Authorization: env.QUO_API_KEY,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          from: normalizePhone(env.QUO_FROM_NUMBER),
          to: [row.recipient],
          content: row.content,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(12000),
      });
      const result = await readBoundedProviderJson(response, 64 * 1024),
        providerId = result?.data?.id || result?.id;
      if (
        response.ok &&
        typeof providerId === "string" &&
        providerId.length <= 160
      ) {
        await db
          .prepare(
            "UPDATE field_workday_messages SET status=COALESCE((SELECT status FROM field_message_delivery_receipts WHERE provider_id=?),'accepted'),provider_id=?,detail='Provider accepted; status includes any matching delivery receipt.',updated_at=CURRENT_TIMESTAMP WHERE id=?",
          )
          .bind(providerId, providerId, row.id)
          .run();
        accepted++;
      } else
        await hold(
          response.status >= 500 ? "uncertain" : "failed",
          response.status >= 500
            ? "Provider result uncertain. Verify before retrying."
            : `Provider rejected (${response.status}). No automatic resend.`,
        );
    } catch (error) {
      await hold(
        "uncertain",
        "Sending outcome is uncertain. Verify provider before retrying.",
      );
      console.error(
        JSON.stringify({
          event: "field_sms_uncertain",
          messageId: row.id,
          error: error.message,
        }),
      );
    }
  }
  return { configured: true, accepted };
}
