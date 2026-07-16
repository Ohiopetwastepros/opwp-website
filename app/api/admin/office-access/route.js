import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { createFieldCredential } from "@/lib/field-auth";
import { getDb } from "@/lib/db";
import { OPWP_ORGANIZATION_ID } from "@/lib/route-partner";

export const dynamic = "force-dynamic";

async function context() {
  const auth = await verifyAdminRequest(await headers());
  const db = getDb();
  if (!auth.authorized) return { response: Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  if (!db) return { response: Response.json({ ok: false, error: "Office access storage is not configured." }, { status: 503 }) };
  return { auth, db };
}

async function users(db) {
  const result = await db.prepare(
    `SELECT m.id,m.email,m.display_name,m.role,m.status,m.created_at,c.last_login_at,
      (SELECT COUNT(*) FROM route_partner_field_sessions s WHERE s.member_id=m.id AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP) AS active_sessions
     FROM route_partner_members m LEFT JOIN route_partner_field_credentials c ON c.member_id=m.id
     WHERE m.organization_id=? AND m.role IN ('manager','dispatcher')
     ORDER BY CASE m.status WHEN 'active' THEN 0 ELSE 1 END,m.display_name`
  ).bind(OPWP_ORGANIZATION_ID).all();
  return result.results || [];
}

export async function GET() {
  const current = await context();
  if (current.response) return current.response;
  return Response.json({ ok: true, users: await users(current.db) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const current = await context();
  if (current.response) return current.response;
  const body = await request.json().catch(() => null);
  const action = String(body?.action || "");
  try {
    if (action === "save_user") {
      const name = String(body?.name || "").trim().slice(0, 100);
      const email = String(body?.email || "").trim().toLowerCase().slice(0, 160);
      const pin = String(body?.pin || "").replace(/\D/g, "");
      if (!name || !/^\S+@\S+\.\S+$/.test(email) || !/^\d{6}$/.test(pin)) throw new Error("Name, email, and a six-digit PIN are required.");
      const existing = await current.db.prepare("SELECT id,role FROM route_partner_members WHERE organization_id=? AND email=? COLLATE NOCASE").bind(OPWP_ORGANIZATION_ID, email).first();
      if (existing && !["manager", "dispatcher"].includes(existing.role)) throw new Error("That email already belongs to a different team role. Use a different office email.");
      const memberId = existing?.id || crypto.randomUUID();
      if (existing) await current.db.prepare("UPDATE route_partner_members SET display_name=?,role='dispatcher',status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(name, memberId).run();
      else await current.db.prepare("INSERT INTO route_partner_members (id,organization_id,email,display_name,role,status) VALUES (?,?,?,?, 'dispatcher','active')").bind(memberId, OPWP_ORGANIZATION_ID, email, name).run();
      await createFieldCredential(current.db, memberId, pin);
      await current.db.prepare("UPDATE route_partner_field_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE member_id=? AND revoked_at IS NULL").bind(memberId).run();
      console.log(JSON.stringify({ event: "office_access_saved", memberId, actor: current.auth.email }));
    } else if (action === "set_status") {
      const memberId = String(body?.memberId || "");
      const status = body?.status === "inactive" ? "inactive" : "active";
      await current.db.prepare("UPDATE route_partner_members SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND role IN ('manager','dispatcher')").bind(status, memberId, OPWP_ORGANIZATION_ID).run();
      if (status === "inactive") await current.db.prepare("UPDATE route_partner_field_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE member_id=? AND revoked_at IS NULL").bind(memberId).run();
      console.log(JSON.stringify({ event: "office_access_status_changed", memberId, status, actor: current.auth.email }));
    } else throw new Error("The requested office-access action is not supported.");
    return Response.json({ ok: true, users: await users(current.db) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Office access could not be saved.";
    console.error(JSON.stringify({ event: "office_access_action_failed", action, actor: current.auth.email, error: message }));
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
