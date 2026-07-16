"use client";

export default function OfficeSignOut() {
  async function signOut() {
    try { await fetch("/api/office/session/", { method: "DELETE", cache: "no-store" }); }
    finally { window.location.assign("/office/login/"); }
  }
  return <button type="button" onClick={signOut}>Sign out</button>;
}
