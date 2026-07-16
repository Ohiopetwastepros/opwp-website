import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticateFieldMember, createFieldSession, expiredFieldSessionCookie, fieldSessionCookie, revokeFieldSession, verifyFieldRequest } from "@/lib/field-auth";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await verifyFieldRequest(request.headers, getDb());
  return NextResponse.json({ ok: true, authenticated: auth.authorized, member: auth.authorized ? auth.member : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const db = getDb();
  if (!db) return NextResponse.json({ ok: false, error: "Field access is not configured." }, { status: 503 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Enter your email and six-digit PIN." }, { status: 400 }); }
  const email = String(body?.email || "").trim().slice(0, 160);
  const pin = String(body?.pin || "").replace(/\D/g, "").slice(0, 6);
  if (!email || pin.length !== 6) return NextResponse.json({ ok: false, error: "Enter your email and six-digit PIN." }, { status: 400 });
  const auth = await authenticateFieldMember(db, email, pin);
  if (!auth.authorized) return NextResponse.json({ ok: false, error: auth.locked ? "Too many attempts. Try again in 15 minutes or contact management." : "That email or PIN is not correct." }, { status: auth.locked ? 429 : 401 });
  const response = NextResponse.json({ ok: true, member: auth.member }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(fieldSessionCookie(await createFieldSession(db, auth.member.id), request.url));
  return response;
}

export async function DELETE(request) {
  const db = getDb();
  await revokeFieldSession(request.headers, db);
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(expiredFieldSessionCookie(request.url));
  return response;
}
