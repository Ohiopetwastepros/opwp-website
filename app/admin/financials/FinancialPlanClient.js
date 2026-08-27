"use client";

import { useState } from "react";
import styles from "./financials.module.css";

const fields = {
  cash: [
    ["verified_cash_balance", "Verified cash", "number"], ["verified_cash_as_of", "Cash verified as of", "date"],
    ["protected_cash_floor", "Protected cash floor", "number"], ["minimum_monthly_retained_cash", "Minimum retained monthly", "number"],
    ["monthly_tax_reserve", "Monthly tax reserve", "number"],
  ],
  owner: [["owner_monthly_pay", "Owner monthly pay", "number"], ["payroll_burden_percent", "Payroll burden %", "number"]],
  staffing: [
    ["tony_current_rate", "Tony current rate", "number"], ["tony_current_weekly_hours", "Tony current weekly hours", "number"],
    ["tony_target_rate", "Tony target rate", "number"], ["tony_target_weekly_hours", "Tony guaranteed weekly hours (minimum)", "number", 40],
    ["bria_current_rate", "Bria current rate", "number"], ["bria_current_weekly_hours", "Bria current weekly hours", "number"],
    ["bria_target_weekly_hours", "Bria target weekly hours", "number"],
  ],
  truck: [
    ["truck_purchase_price", "Truck out-the-door price", "number"], ["truck_down_payment", "Down payment", "number"],
    ["truck_apr_percent", "APR %", "number"], ["truck_term_months", "Loan term (months)", "number"],
    ["truck_monthly_insurance", "Monthly insurance", "number"], ["truck_monthly_maintenance", "Monthly maintenance reserve", "number"],
  ],
};

function InputGroup({ title, rows, form, update }) {
  return <fieldset className={styles.formGroup}><legend>{title}</legend><div className={styles.formGrid}>{rows.map(([name, label, type, minimum]) => <label key={name}><span>{label}</span><input type={type} min={type === "number" ? String(minimum ?? 0) : undefined} step={type === "number" ? "0.01" : undefined} value={form[name] ?? ""} onChange={(event) => update(name, event.target.value)}/></label>)}</div></fieldset>;
}

export default function FinancialPlanClient({ initialSettings }) {
  const [form, setForm] = useState(initialSettings);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  async function save(event) {
    event.preventDefault(); setSaving(true); setStatus("");
    try {
      const response = await fetch("/api/admin/financial-management/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "The plan could not be saved.");
      setStatus("Saved. Recalculating the financial plan…");
      window.location.reload();
    } catch (error) { setStatus(error.message || "The plan could not be saved."); setSaving(false); }
  }
  return <form className={styles.planForm} onSubmit={save}>
    <div className={styles.formTop}><label><span>Book reliability</span><select value={form.books_status} onChange={(event) => update("books_status", event.target.value)}><option value="rectifying">Being rectified</option><option value="provisional">Provisional</option><option value="verified">Verified</option></select></label></div>
    <InputGroup title="Cash policy" rows={fields.cash} form={form} update={update}/>
    <InputGroup title="Owner compensation" rows={fields.owner} form={form} update={update}/>
    <InputGroup title="Staffing scenario" rows={fields.staffing} form={form} update={update}/>
    <InputGroup title="Truck scenario" rows={fields.truck} form={form} update={update}/>
    <label className={styles.notes}><span>Management notes</span><textarea rows="3" value={form.notes || ""} onChange={(event) => update("notes", event.target.value)} placeholder="Explain assumptions, pending bookkeeping corrections, or the decision being tested."/></label>
    <div className={styles.formActions}><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save assumptions & recalculate"}</button><span aria-live="polite">{status}</span></div>
  </form>;
}
