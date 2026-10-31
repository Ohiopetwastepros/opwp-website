import {
  workdayContext,
  workdayJson,
  workdayError,
} from "@/lib/field-workday-http";
import {
  officeWorkdays,
  officeWorkdayCommand,
} from "@/lib/field-workday-office.mjs";
import { validDispatchDate } from "@/lib/daily-route-optimizer.mjs";
import { readBoundedProviderJson } from "@/lib/bounded-body.mjs";
export const dynamic = "force-dynamic";
export async function GET(request) {
  try {
    const { db } = await workdayContext(request, {
        admin: true,
        scope: "field_office_read",
      }),
      date = new URL(request.url).searchParams.get("date");
    if (!validDispatchDate(date))
      return workdayJson(
        { ok: false, error: "Choose a valid service date." },
        400,
      );
    return workdayJson({ ok: true, ...(await officeWorkdays(db, date)) });
  } catch (error) {
    return workdayError(error);
  }
}
export async function POST(request) {
  try {
    const { db, auth } = await workdayContext(request, {
        admin: true,
        write: true,
        scope: "field_office_write",
        limit: 30,
      }),
      body = await readBoundedProviderJson(request, 24 * 1024),
      result = await officeWorkdayCommand(db, auth.email, body);
    return workdayJson({ ok: true, ...result });
  } catch (error) {
    return workdayError(error);
  }
}
