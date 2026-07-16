import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";

const PUBLIC_ADMIN_PATHS = new Set(["/admin/login", "/admin/login/", "/api/admin/session", "/api/admin/session/"]);

export async function middleware(request) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_ADMIN_PATHS.has(pathname)) return NextResponse.next();

  const auth = await verifyAdminRequest(request.headers);
  if (auth.authorized) return NextResponse.next();

  if (pathname.startsWith("/api/admin/")) {
    return NextResponse.json({ ok: false, code: "SESSION_REQUIRED", error: "Your management session has expired." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const login = new URL("/admin/login/", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login, { headers: { "Cache-Control": "no-store" } });
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
