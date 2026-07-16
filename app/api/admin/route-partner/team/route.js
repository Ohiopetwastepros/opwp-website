import { headers } from "next/headers";
import { verifyAdminRequest } from "@/lib/admin-auth";
import { createFieldCredential } from "@/lib/field-auth";
import { getDb } from "@/lib/db";
import { OPWP_ORGANIZATION_ID } from "@/lib/route-partner";
import { prepareFieldRelease } from "@/lib/field-operations";

export const dynamic = "force-dynamic";

async function context() {
  const auth = await verifyAdminRequest(await headers());
  const db = getDb();
  if (!auth.authorized) return { response: Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  if (!db) return { response: Response.json({ ok: false, error: "Route Partner storage is not configured." }, { status: 503 }) };
  return { auth, db };
}

async function teamSnapshot(db) {
  const [members, plans, vehicles] = await Promise.all([
    db.prepare(`SELECT m.id,m.email,m.display_name,m.external_employee_id,m.status,m.created_at,c.last_login_at,
      (SELECT COUNT(*) FROM route_partner_field_sessions s WHERE s.member_id=m.id AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP) AS active_sessions
      FROM route_partner_members m LEFT JOIN route_partner_field_credentials c ON c.member_id=m.id
      WHERE m.organization_id=? AND m.role='technician' ORDER BY CASE m.status WHEN 'active' THEN 0 ELSE 1 END,m.display_name`).bind(OPWP_ORGANIZATION_ID).all(),
    db.prepare(`SELECT p.id,p.service_date,p.technician_name,p.technician_external_id,p.source_route_id,p.status,p.assigned_member_id,
      s.id AS shift_id,s.status AS shift_status FROM route_partner_route_plans p
      LEFT JOIN route_partner_field_shifts s ON s.route_plan_id=p.id
      WHERE p.organization_id=? AND p.service_date>=date('now','-1 day') AND p.status IN ('finalized','in_progress','completed')
      ORDER BY p.service_date,p.technician_name`).bind(OPWP_ORGANIZATION_ID).all(),
    db.prepare("SELECT id,name,status FROM route_partner_vehicles WHERE organization_id=? ORDER BY name").bind(OPWP_ORGANIZATION_ID).all(),
  ]);
  return { members: members.results || [], plans: plans.results || [], vehicles: vehicles.results || [] };
}

export async function GET() {
  const current = await context();
  if (current.response) return current.response;
  return Response.json({ ok: true, team: await teamSnapshot(current.db) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const current = await context();
  if (current.response) return current.response;
  let body;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "A valid request is required." }, { status: 400 }); }
  const action = String(body?.action || "");
  try {
    if (action === "save_member") {
      const name = String(body.name || "").trim().slice(0, 100);
      const email = String(body.email || "").trim().toLowerCase().slice(0, 160);
      const externalId = String(body.externalEmployeeId || "").trim().slice(0, 100);
      const pin = String(body.pin || "").replace(/\D/g, "");
      if (!name || !/^\S+@\S+\.\S+$/.test(email) || !externalId || !/^\d{6}$/.test(pin)) throw new Error("Name, email, CRM employee ID, and a six-digit PIN are required.");
      let member = await current.db.prepare("SELECT id FROM route_partner_members WHERE organization_id=? AND email=? COLLATE NOCASE").bind(OPWP_ORGANIZATION_ID, email).first();
      const memberId = member?.id || crypto.randomUUID();
      if (member) await current.db.prepare("UPDATE route_partner_members SET display_name=?,external_employee_id=?,role='technician',status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(name, externalId, memberId).run();
      else await current.db.prepare("INSERT INTO route_partner_members (id,organization_id,email,display_name,role,external_employee_id) VALUES (?,?,?,?, 'technician',?)").bind(memberId, OPWP_ORGANIZATION_ID, email, name, externalId).run();
      await createFieldCredential(current.db, memberId, pin);
      const matching = await current.db.prepare("SELECT id FROM route_partner_route_plans WHERE organization_id=? AND technician_external_id=? AND status='finalized' AND service_date>=date('now')").bind(OPWP_ORGANIZATION_ID, externalId).all();
      for (const plan of matching.results || []) await prepareFieldRelease(current.db, plan.id, memberId);
      console.log(JSON.stringify({ message: "field member saved", memberId, actor: current.auth.email }));
    } else if (action === "assign_route") {
      const planId = String(body.planId || "");
      const memberId = String(body.memberId || "");
      if (!planId || !memberId) throw new Error("Choose a route and technician.");
      await prepareFieldRelease(current.db, planId, memberId);
    } else if (action === "set_status") {
      const memberId = String(body.memberId || "");
      const status = body.status === "inactive" ? "inactive" : "active";
      await current.db.prepare("UPDATE route_partner_members SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND role='technician'").bind(status, memberId, OPWP_ORGANIZATION_ID).run();
      if (status === "inactive") await current.db.prepare("UPDATE route_partner_field_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE member_id=? AND revoked_at IS NULL").bind(memberId).run();
    } else throw new Error("The requested team action is not supported.");
    return Response.json({ ok: true, team: await teamSnapshot(current.db) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The technician setup could not be saved.";
    console.error(JSON.stringify({ message: "field team action failed", action, actor: current.auth.email, error: message }));
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
