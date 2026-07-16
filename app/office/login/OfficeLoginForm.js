"use client";

import { useState } from "react";
import styles from "@/app/field/login/login.module.css";

export default function OfficeLoginForm({ next }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/office/session/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), pin: form.get("pin") }), cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Sign in failed.");
      window.location.assign(next);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Sign in failed.");
      setLoading(false);
    }
  }
  return <form className={styles.form} onSubmit={submit}><label>Email<input name="email" type="email" autoComplete="username" inputMode="email" required autoFocus disabled={loading}/></label><label>Six-digit PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" autoComplete="current-password" required disabled={loading}/></label>{error ? <div role="alert" className={styles.error}>{error}</div> : null}<button disabled={loading}>{loading ? <><i/>Signing in…</> : <>Open office workspace <span>→</span></>}</button></form>;
}
