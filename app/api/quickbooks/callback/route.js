import { completeQuickBooksAuthorization } from "@/lib/quickbooks";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state");
  if (error) return Response.redirect(new URL(`/admin/?quickbooks=${encodeURIComponent(error)}`, url.origin), 302);
  if (!code || !realmId || !state) return Response.json({ error: "Invalid QuickBooks callback." }, { status: 400 });
  try {
    await completeQuickBooksAuthorization({ code, realmId, state });
    return Response.redirect(new URL("/admin/?quickbooks=connected", url.origin), 302);
  } catch (authorizationError) {
    console.error(JSON.stringify({ event: "quickbooks_oauth_callback_error", message: String(authorizationError) }));
    return Response.redirect(new URL("/admin/?quickbooks=error", url.origin), 302);
  }
}
