import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getAirtableSchema } from "@/lib/airtable";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await getAirtableSchema(), { headers: { "Cache-Control": "no-store" } });
}
