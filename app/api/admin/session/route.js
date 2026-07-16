import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { adminSessionCookie, createAdminSession, expiredAdminSessionCookie, loginFingerprint, verifyAdminCredentials, verifyAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

function clientAddress(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function blocked(db, fingerprint) {
  if (!db) return false;
  const row = await db.prepare("SELECT COUNT(*) AS failures FROM admin_login_attempts WHERE fingerprint=? AND succeeded=0 AND occurred_at >= datetime('now','-15 minutes')").bind(fingerprint).first();
  return Number(row?.failures || 0) >= 5;
}

async function record(db, fingerprint, succeeded) {
  if (!db) return;
  await db.prepare("INSERT INTO admin_login_attempts (id,fingerprint,succeeded) VALUES (?,?,?)").bind(crypto.randomUUID(), fingerprint, succeeded ? 1 : 0).run();
}

export async function GET(request) {
  const auth = await verifyAdminRequest(request.headers);
  return NextResponse.json({ ok: true, authenticated: auth.authorized, identity: auth.authorized ? auth.email : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Enter your username and password." }, { status: 400 }); }
  const username = String(body?.username || "").trim().slice(0, 160);
  const password = String(body?.password || "").slice(0, 256);
  if (!username || !password) return NextResponse.json({ ok: false, error: "Enter your username and password." }, { status: 400 });

  const db = getDb();
  const fingerprint = await loginFingerprint(clientAddress(request));
  if (await blocked(db, fingerprint)) return NextResponse.json({ ok: false, error: "Too many attempts. Wait 15 minutes and try again." }, { status: 429, headers: { "Retry-After": "900" } });

  const auth = await verifyAdminCredentials(username, password);
  await record(db, fingerprint, auth.authorized);
  if (!auth.authorized) return NextResponse.json({ ok: false, error: "That username or password is not correct." }, { status: 401 });

  const response = NextResponse.json({ ok: true, identity: auth.email }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(adminSessionCookie(await createAdminSession(auth.email), request.url));
  return response;
}

export async function DELETE(request) {
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(expiredAdminSessionCookie(request.url));
  return response;
}
