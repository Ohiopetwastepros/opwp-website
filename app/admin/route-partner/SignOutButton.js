"use client";

import { useState } from "react";
import styles from "./route-partner.module.css";

export default function SignOutButton() {
  const [loading, setLoading] = useState(false);
  async function signOut() {
    if (loading) return;
    setLoading(true);
    try { await fetch("/api/admin/session/", { method: "DELETE", cache: "no-store" }); } finally { window.location.assign("/admin/login/"); }
  }
  return <button className={styles.signOut} type="button" onClick={signOut} disabled={loading}>{loading ? "Signing out…" : "Sign out"}</button>;
}
