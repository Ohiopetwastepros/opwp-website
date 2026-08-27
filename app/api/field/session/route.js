import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticateFieldMember, createFieldSession, expiredFieldSessionCookie, fieldAuthConfigured, fieldSessionCookie, revokeFieldSession, verifyFieldRequest } from "@/lib/field-auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { readBoundedJson } from "@/lib/public-api-security";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await verifyFieldRequest(request.headers, getDb());
  return NextResponse.json({ ok: true, authenticated: auth.authorized, member: auth.authorized ? auth.member : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const rate = await checkRateLimit(request, { scope: "field_login", limit: 20, windowSeconds: 900, failClosed: true });
  if (!rate.allowed) return rateLimitResponse(rate);
  const db = getDb();
  if (!db || !fieldAuthConfigured()) return NextResponse.json({ ok: false, error: "Field access is not configured." }, { status: 503 });
  const parsed = await readBoundedJson(request, 8 * 1024);
  if (parsed.response) return parsed.response;
  const body = parsed.body;
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
