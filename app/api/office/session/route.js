import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticateOfficeMember, createFieldSession, expiredOfficeSessionCookie, officeSessionCookie, revokeOfficeSession, verifyOfficeRequest } from "@/lib/field-auth";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await verifyOfficeRequest(request.headers, getDb());
  return NextResponse.json({ ok: true, authenticated: auth.authorized, member: auth.authorized ? auth.member : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const db = getDb();
  if (!db) return NextResponse.json({ ok: false, error: "Office access is not configured." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const email = String(body?.email || "").trim().slice(0, 160);
  const pin = String(body?.pin || "").replace(/\D/g, "").slice(0, 6);
  if (!email || pin.length !== 6) return NextResponse.json({ ok: false, error: "Enter your email and six-digit PIN." }, { status: 400 });
  const auth = await authenticateOfficeMember(db, email, pin);
  if (!auth.authorized) return NextResponse.json({ ok: false, error: auth.locked ? "Too many attempts. Try again in 15 minutes or contact management." : "That email or PIN is not correct." }, { status: auth.locked ? 429 : 401 });
  const response = NextResponse.json({ ok: true, member: auth.member }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(officeSessionCookie(await createFieldSession(db, auth.member.id), request.url));
  return response;
}

export async function DELETE(request) {
  await revokeOfficeSession(request.headers, getDb());
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(expiredOfficeSessionCookie(request.url));
  return response;
}
