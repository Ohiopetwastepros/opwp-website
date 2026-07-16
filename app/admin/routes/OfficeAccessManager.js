"use client";

import { useEffect, useState } from "react";
import styles from "./routes.module.css";

export default function OfficeAccessManager() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ name: "", email: "", pin: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => { fetch("/api/admin/office-access/", { cache: "no-store" }).then((response) => response.json()).then((data) => { if (data.ok) setUsers(data.users || []); }).catch(() => {}); }, []);
  const update = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  async function action(body, success) {
    setLoading(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/office-access/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "The account could not be updated.");
      setUsers(data.users || []); setMessage(success); return true;
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "The account could not be updated."); return false; }
    finally { setLoading(false); }
  }
  async function save(event) { event.preventDefault(); if (await action({ action: "save_user", ...form }, "Office access is ready.")) setForm({ name: "", email: "", pin: "" }); }
  return <section className={styles.officeAccess}><div className={styles.candidateHead}><div><div className={styles.eyebrow}>Least-privilege access</div><h2>Office route workspace</h2></div><p>Create individual office access to the route checker without exposing the executive cockpit. Login URL: <b>/office/login/</b></p></div><form onSubmit={save}><label><span>Name</span><input required value={form.name} onChange={update("name")} placeholder="Office team member"/></label><label><span>Email</span><input required type="email" value={form.email} onChange={update("email")} placeholder="name@ohiopetwastepros.com"/></label><label><span>Six-digit PIN</span><input required inputMode="numeric" pattern="[0-9]{6}" maxLength="6" value={form.pin} onChange={update("pin")} placeholder="000000"/></label><button disabled={loading}>{loading ? "Saving…" : "Create or reset access"}</button></form>{error ? <div className={styles.error}>{error}</div> : null}{message ? <div className={styles.disclosure}><strong>{message}</strong> Give the team member their email, PIN, and the office login URL.</div> : null}{users.length ? <div className={styles.tableWrap}><table className={styles.routeTable}><thead><tr><th>Team member</th><th>Email</th><th>Last login</th><th>Sessions</th><th>Status</th><th>Access</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.display_name}</strong></td><td>{user.email}</td><td>{user.last_login_at ? new Date(`${user.last_login_at.replace(" ", "T")}Z`).toLocaleString() : "Never"}</td><td>{user.active_sessions}</td><td>{user.status}</td><td><button disabled={loading} onClick={() => action({ action: "set_status", memberId: user.id, status: user.status === "active" ? "inactive" : "active" }, "Office access was updated.")}>{user.status === "active" ? "Deactivate" : "Reactivate"}</button></td></tr>)}</tbody></table></div> : <div className={styles.disclosure}><strong>No office accounts yet.</strong> Create the first individual login above.</div>}</section>;
}
