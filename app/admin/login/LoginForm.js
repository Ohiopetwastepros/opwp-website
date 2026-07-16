"use client";

import { useState } from "react";
import styles from "./login.module.css";

export default function LoginForm({ next }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/session/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: form.get("username"), password: form.get("password") }), cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Sign in could not be completed.");
      window.location.assign(next);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Sign in could not be completed.");
      setLoading(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-busy={loading}>
      <label><span>Username</span><input name="username" type="text" autoComplete="username" inputMode="email" required autoFocus disabled={loading} /></label>
      <label><span>Password</span><input name="password" type="password" autoComplete="current-password" required disabled={loading} /></label>
      {error ? <div className={styles.formError} role="alert"><span aria-hidden="true">!</span>{error}</div> : null}
      <button type="submit" disabled={loading}>{loading ? <><i aria-hidden="true" />Signing in…</> : <>Enter workspace <span aria-hidden="true">→</span></>}</button>
    </form>
  );
}
