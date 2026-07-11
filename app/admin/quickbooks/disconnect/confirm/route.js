import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { disconnectQuickBooks } from "@/lib/quickbooks";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const auth = await verifyAdminRequest(await headers());
  if (!auth.authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await disconnectQuickBooks();
    return Response.redirect(new URL("/admin/?quickbooks=disconnected", request.url), 303);
  } catch (error) {
    console.error(JSON.stringify({ event: "quickbooks_disconnect_error", message: String(error) }));
    return Response.redirect(new URL("/admin/?quickbooks=disconnect_error", request.url), 303);
  }
}
