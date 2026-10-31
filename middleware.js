import { NextResponse } from "next/server";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { getDb } from "@/lib/db";
import { verifyFieldRequest, verifyOfficeRequest } from "@/lib/field-auth";

const PUBLIC_ADMIN_PATHS = new Set(["/admin/login", "/admin/login/", "/api/admin/session", "/api/admin/session/"]);
// The offline shell contains no customer data. Every data/proof API remains authenticated.
const PUBLIC_FIELD_PATHS = new Set(["/field/sw.js", "/field/app", "/field/app/", "/field/login", "/field/login/", "/api/field/session", "/api/field/session/"]);
const PUBLIC_OFFICE_PATHS = new Set(["/office/login", "/office/login/", "/api/office/session", "/api/office/session/"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const GOOGLE_MAP_ADMIN_PATHS = new Set(["/admin/call-guide", "/admin/call-guide/"]);
const DENSITY_MAP_ADMIN_PATHS = new Set(["/admin/acquisition", "/admin/acquisition/"]);

function crossSiteMutation(request) {
  if (SAFE_METHODS.has(request.method)) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin !== request.nextUrl.origin;
    } catch {
      return true;
    }
  }
  return request.headers.get("sec-fetch-site") === "cross-site";
}

async function routeMiddleware(request, adminRequestHeaders) {
  const { pathname, search } = request.nextUrl;
  if (crossSiteMutation(request)) {
    return NextResponse.json(
      { ok: false, code: "CROSS_SITE_REQUEST_REJECTED", error: "Cross-site requests are not allowed." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
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
  if (PUBLIC_ADMIN_PATHS.has(pathname)) return NextResponse.next({ request: { headers: adminRequestHeaders } });

  const auth = await verifyAdminRequest(request.headers);
  if (auth.authorized) return NextResponse.next({ request: { headers: adminRequestHeaders } });

  if (pathname.startsWith("/api/admin/")) {
    return NextResponse.json({ ok: false, code: "SESSION_REQUIRED", error: "Your management session has expired." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const login = new URL("/admin/login/", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login, { headers: { "Cache-Control": "no-store" } });
}

export async function middleware(request) {
  const path = request.nextUrl.pathname;
  const foodPortal = path === '/dog-food/account' || path.startsWith('/dog-food/account/') || ['/api/dog-food/account','/api/dog-food/session','/api/dog-food/order'].some(p => path === p || path === p + '/');
  if (foodPortal) {
    if (!SAFE_METHODS.has(request.method) && (request.headers.get('origin') !== request.nextUrl.origin || request.headers.get('sec-fetch-site') === 'cross-site')) return NextResponse.json({error:'Cross-site requests are not allowed.'},{status:403,headers:{'Cache-Control':'private, no-store'}});
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
    const policy = [`default-src 'self'`,`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,`script-src-attr 'none'`,`style-src 'self' 'unsafe-inline'`,`img-src 'self' data:`,`font-src 'self'`,`connect-src 'self' https://challenges.cloudflare.com`,`frame-src https://challenges.cloudflare.com`,`object-src 'none'`,`base-uri 'none'`,`form-action 'self'`,`frame-ancestors 'none'`].join('; ');
    const headers = new Headers(request.headers); headers.set('Content-Security-Policy',policy); headers.set('x-nonce',nonce);
    const response = NextResponse.next({request:{headers}});response.headers.set('Content-Security-Policy',policy);response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Frame-Options','DENY');return response;
  }
  const admin = path === "/admin" || path.startsWith("/admin/") || path === "/api/admin" || path.startsWith("/api/admin/");
  if (!admin) return routeMiddleware(request);

  // Browser mutations always need positive same-origin evidence. A missing
  // Origin must never allow a form or a legacy password-only API client in.
  if (!SAFE_METHODS.has(request.method) && (
    request.headers.get("origin") !== request.nextUrl.origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )) return NextResponse.json({ ok: false, error: "Cross-site requests are not allowed." }, {
    status: 403, headers: { "Cache-Control": "private, no-store", "X-Frame-Options": "DENY" },
  });

  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
  const googleMapPage = GOOGLE_MAP_ADMIN_PATHS.has(path);
  const densityMapPage = DENSITY_MAP_ADMIN_PATHS.has(path);
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "script-src-attr 'none'",
    // Existing React presentation uses inline styles; executable inline code
    // remains forbidden. Fonts, QR codes and proof photos stay local.
    "style-src 'self' 'unsafe-inline'",
    googleMapPage
      ? "img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.googleusercontent.com"
      : densityMapPage ? "img-src 'self' data: blob: https://tile.openstreetmap.org" : "img-src 'self' data: blob:",
    "font-src 'self'",
    googleMapPage
      ? "connect-src 'self' https://*.googleapis.com https://*.google.com"
      : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  requestHeaders.set("x-nonce", nonce);
  const response = await routeMiddleware(request, requestHeaders);
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Cache-Control", "private, no-store");
  // A website-restricted Google Maps browser key needs the site origin in the
  // Referer header. Keep the stricter policy everywhere else in the workspace.
  response.headers.set("Referrer-Policy", googleMapPage || densityMapPage ? "strict-origin-when-cross-origin" : "no-referrer");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*", "/field/:path*", "/api/field/:path*", "/office/:path*", "/api/office/:path*", "/dog-food/account/:path*", "/api/dog-food/account/:path*", "/api/dog-food/session/:path*", "/api/dog-food/order/:path*"] };
