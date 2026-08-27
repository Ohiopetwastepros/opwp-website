import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getFinancialManagementSettings, saveFinancialManagementSettings } from "@/lib/financial-management";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };

async function authorize() {
  const auth = await verifyAdminRequest(await headers());
  return auth.authorized ? auth : null;
}

export async function GET() {
  if (!await authorize()) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  return Response.json({ ok: true, settings: await getFinancialManagementSettings() }, { headers: responseHeaders });
}

export async function POST(request) {
  const auth = await authorize();
  if (!auth) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  try {
    const body = await request.json();
    const settings = await saveFinancialManagementSettings(body || {}, auth.email);
    console.log(JSON.stringify({ event: "financial_management_settings_updated", actor: auth.email }));
    return Response.json({ ok: true, settings }, { headers: responseHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Financial assumptions could not be saved.";
    console.error(JSON.stringify({ event: "financial_management_settings_failed", actor: auth.email, message }));
    return Response.json({ ok: false, error: message }, { status: 400, headers: responseHeaders });
  }
}
