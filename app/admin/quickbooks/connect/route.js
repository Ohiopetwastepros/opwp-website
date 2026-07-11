import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { createQuickBooksAuthorization } from "@/lib/quickbooks";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.redirect(await createQuickBooksAuthorization(auth.email), 302);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 503 });
  }
}
