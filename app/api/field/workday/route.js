import {
  workdayContext,
  workdayJson,
  workdayError,
} from "@/lib/field-workday-http";
import { getWorkday, saveWorkdayEvent } from "@/lib/field-workday-store.mjs";
import { operatingDate } from "@/lib/field-policy.mjs";
import { readBoundedProviderJson } from "@/lib/bounded-body.mjs";
import { getRuntimeEnv } from "@/lib/cloudflare";
import {
  processFieldMessages,
  fieldMessagesConfigured,
} from "@/lib/field-messages.js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { offlineAccessUntil } from "@/lib/field-offline-access.mjs";
export const dynamic = "force-dynamic";
export async function GET(request) {
  try {
    const { db, auth } = await workdayContext(request);
    const url = new URL(request.url),
      result = await getWorkday(db, auth.member, {
        date: url.searchParams.get("date") || operatingDate(),
        shiftId: url.searchParams.get("shiftId") || "",
      });
    return workdayJson({
      ok: true,
      ...result,
      offlineUntil: offlineAccessUntil(auth.expiresAt),
      customerTextsEnabled: fieldMessagesConfigured(getRuntimeEnv()),
    });
  } catch (error) {
    return workdayError(error);
  }
}
export async function POST(request) {
  try {
    const { db, auth } = await workdayContext(request, {
        write: true,
        scope: "workday_events",
        limit: 120,
      }),
      event = await readBoundedProviderJson(request, 24 * 1024),
      result = await saveWorkdayEvent(db, auth.member, event, Date.now(), {
        notificationsEnabled: fieldMessagesConfigured(getRuntimeEnv()),
      });
    const env = getRuntimeEnv();
    if (env.FIELD_NOTIFICATIONS_ENABLED === "true")
      getCloudflareContext().ctx.waitUntil(
        processFieldMessages(
          { ...env, DB: db },
          { shiftId: event.shiftId, limit: 1 },
        ).catch((error) =>
          console.error(
            JSON.stringify({
              event: "field_message_processing_failed",
              error: error.message,
            }),
          ),
        ),
      );
    return workdayJson({ ok: true, ...result });
  } catch (error) {
    return workdayError(error);
  }
}
