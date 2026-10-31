"use client";

import { useState } from "react";
import { ADMIN_NAVIGATION } from "./admin-navigation.mjs";
import SignOutButton from "./route-partner/SignOutButton";
import styles from "./admin-navigation.module.css";

export default function AdminWorkspace({ section, email, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentLabel = ADMIN_NAVIGATION.flatMap((group) => group.items).find((item) => item.id === section)?.label || "Executive overview";
  const itemLink = (item) => <a key={item.id} href={item.href} aria-current={section === item.id ? "page" : undefined}>{item.label}</a>;
  return <div className={`${styles.frame} opwp-admin-shell`}>
    <a className={styles.skip} href="#admin-content">Skip to content</a>
    <aside className={styles.sidebar}>
      <a className={styles.brand} href="/admin/"><img src="/assets/opwp-logo.png" alt="" /><span><strong>OPWP</strong><small>Owner workspace</small></span></a>
      <button type="button" className={styles.mobileToggle} aria-expanded={mobileOpen} aria-controls="admin-menu" onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? "Close menu" : "Open menu"}<span>{currentLabel}</span></button>
      <div id="admin-menu" className={`${styles.menuBody} ${mobileOpen ? styles.menuOpen : ""}`}>
      <nav aria-label="Admin navigation">
        {itemLink({ id: "overview", label: "Executive overview", href: "/admin/" })}
        {ADMIN_NAVIGATION.map((group) => <details key={group.id} open={group.items.some((item) => item.id === section) || (section === "overview" && group.id === "financials")}>
          <summary>{group.label}</summary>
          <div className={styles.links}>{group.items.map(itemLink)}</div>
        </details>)}
      </nav>
      <div className={styles.account}><span>Signed in as</span><strong>{email || "OPWP administrator"}</strong><SignOutButton /></div>
      </div>
    </aside>
    <div id="admin-content" tabIndex={-1} className={styles.content}>{children}</div>
  </div>;
}
