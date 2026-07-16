"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./team.module.css";

const dateLabel = (date) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));

export default function TeamClient() {
  const [team, setTeam] = useState({ members: [], plans: [], vehicles: [] });
  const [loading, setLoading] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const unassigned = useMemo(() => team.plans.filter((plan) => !plan.assigned_member_id), [team]);

  async function parse(response) {
    if (response.status === 401) { window.location.assign("/admin/login/?next=/admin/route-partner/team/"); throw new Error("Session expired."); }
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "The field team could not be loaded.");
    return data;
  }
  async function load() {
    try { setTeam((await parse(await fetch("/api/admin/route-partner/team/", { cache: "no-store" }))).team); setError(""); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(""); }
  }
  useEffect(() => { load(); }, []);

  async function action(body, message) {
    if (loading) return false;
    setLoading(body.action); setError(""); setNotice("");
    try { setTeam((await parse(await fetch("/api/admin/route-partner/team/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))).team); setNotice(message); return true; }
    catch (requestError) { setError(requestError.message); return false; }
    finally { setLoading(""); }
  }

  async function saveMember(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await action({ action: "save_member", name: form.get("name"), email: form.get("email"), externalEmployeeId: form.get("externalId"), pin: form.get("pin") }, "Technician access is ready.");
    if (saved) { event.currentTarget.reset(); setFormOpen(false); }
  }

  return <>
    <section className={styles.summary}><div><span>Active technicians</span><strong>{team.members.filter((member) => member.status === "active").length}</strong></div><div><span>Upcoming routes</span><strong>{team.plans.length}</strong></div><div className={unassigned.length ? styles.attention : ""}><span>Needs assignment</span><strong>{unassigned.length}</strong></div><button type="button" onClick={() => setFormOpen(true)}>+ Add technician</button></section>
    <div className={styles.messages} aria-live="polite">{error ? <p className={styles.error}>{error}</p> : null}{notice ? <p className={styles.notice}>{notice}</p> : null}</div>
    {loading === "load" ? <div className={styles.loading}>Loading field access…</div> : <div className={styles.grid}>
      <section className={styles.panel}><div className={styles.panelHead}><div><span>Individual access</span><h2>Technicians</h2></div><a href="/field/login/">Open field login ↗</a></div>{team.members.length ? <div className={styles.memberList}>{team.members.map((member) => <article key={member.id}><div className={styles.avatar}>{String(member.display_name || member.email).slice(0,1).toUpperCase()}</div><div><strong>{member.display_name || "Technician"}</strong><p>{member.email}</p><small>CRM employee ID: {member.external_employee_id || "Not connected"}</small></div><div className={styles.memberStatus}><span className={member.status === "active" ? styles.live : styles.inactive}>{member.status}</span><small>{member.last_login_at ? `Last login ${new Date(`${member.last_login_at.replace(" ","T")}Z`).toLocaleDateString()}` : "Never signed in"}</small><button type="button" onClick={() => action({ action: "set_status", memberId: member.id, status: member.status === "active" ? "inactive" : "active" }, `${member.display_name}'s access was updated.`)}>{member.status === "active" ? "Deactivate" : "Reactivate"}</button></div></article>)}</div> : <div className={styles.empty}><h3>No technician access yet.</h3><p>Add the first technician, their CRM employee ID, and a six-digit PIN.</p><button onClick={() => setFormOpen(true)}>Add technician</button></div>}</section>
      <section className={styles.panel}><div className={styles.panelHead}><div><span>Release ownership</span><h2>Upcoming routes</h2></div></div>{team.plans.length ? <div className={styles.planList}>{team.plans.map((plan) => <article key={plan.id}><div><strong>{plan.technician_name || "Unassigned route"}</strong><p>{dateLabel(plan.service_date)} · {plan.source_route_id || "Default route"}</p><small>{plan.shift_status ? `Field status: ${plan.shift_status.replaceAll("_"," ")}` : "Not released to a field account"}</small></div><select value={plan.assigned_member_id || ""} onChange={(event) => action({ action: "assign_route", planId: plan.id, memberId: event.target.value }, "Route assignment updated.")} aria-label={`Assign ${plan.technician_name}`}><option value="" disabled>Assign technician</option>{team.members.filter((member) => member.status === "active").map((member) => <option key={member.id} value={member.id}>{member.display_name}</option>)}</select></article>)}</div> : <div className={styles.empty}><h3>No released routes yet.</h3><p>Finalize a route from Route control and it will appear here.</p><a href="/admin/route-partner/">Go to Route control</a></div>}</section>
    </div>}
    {formOpen ? <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setFormOpen(false); }}><form className={styles.modal} onSubmit={saveMember}><span>New field account</span><h2>Add a technician</h2><p>The CRM employee ID must match the technician ID on imported routes.</p><label>Full name<input name="name" required autoFocus /></label><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>CRM employee ID<input name="externalId" required /></label><label>Six-digit PIN<input name="pin" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" autoComplete="new-password" required /></label><div><button type="button" onClick={() => setFormOpen(false)}>Cancel</button><button type="submit" disabled={Boolean(loading)}>Create access</button></div></form></div> : null}
  </>;
}
