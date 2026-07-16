import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { verifyFieldRequest, verifyOfficeRequest } from "@/lib/field-auth";

const PUBLIC_ADMIN_PATHS = new Set(["/admin/login", "/admin/login/", "/api/admin/session", "/api/admin/session/"]);
const PUBLIC_FIELD_PATHS = new Set(["/field/login", "/field/login/", "/api/field/session", "/api/field/session/"]);
const PUBLIC_OFFICE_PATHS = new Set(["/office/login", "/office/login/", "/api/office/session", "/api/office/session/"]);

export async function middleware(request) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_OFFICE_PATHS.has(pathname)) return NextResponse.next();
  if (pathname === "/office" || pathname.startsWith("/office/") || pathname.startsWith("/api/office/")) {
    const auth = await verifyOfficeRequest(request.headers, getDb());
    if (auth.authorized) return NextResponse.next();
    if (pathname.startsWith("/api/office/")) return NextResponse.json({ ok: false, code: "OFFICE_SESSION_REQUIRED", error: "Your office session has expired." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const login = new URL("/office/login/", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login, { headers: { "Cache-Control": "no-store" } });
  }
  if (PUBLIC_FIELD_PATHS.has(pathname)) return NextResponse.next();
  if (pathname === "/field" || pathname.startsWith("/field/") || pathname.startsWith("/api/field/")) {
    const auth = await verifyFieldRequest(request.headers, getDb());
    if (auth.authorized) return NextResponse.next();
    if (pathname.startsWith("/api/field/")) return NextResponse.json({ ok: false, code: "FIELD_SESSION_REQUIRED", error: "Your field session has expired." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const login = new URL("/field/login/", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login, { headers: { "Cache-Control": "no-store" } });
  }
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

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*", "/field/:path*", "/api/field/:path*", "/office/:path*", "/api/office/:path*"] };
