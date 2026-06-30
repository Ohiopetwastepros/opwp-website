"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV_LINK = { textDecoration: "none" };

const cities = [
  ["Toledo", "/dog-poop-removal-toledo-oh/"],
  ["Sylvania", "/dog-poop-removal-sylvania-oh/"],
  ["Perrysburg", "/dog-poop-removal-perrysburg-oh/"],
  ["Maumee", "/dog-poop-removal-maumee-oh/"],
  ["Holland", "/dog-poop-removal-holland-oh/"],
  ["Oregon", "/dog-poop-removal-oregon-oh/"],
  ["Whitehouse", "/dog-poop-removal-whitehouse-oh/"],
  ["Waterville", "/dog-poop-removal-waterville-oh/"],
  ["Rossford", "/dog-poop-removal-rossford-oh/"],
  ["Bowling Green", "/dog-poop-removal-bowling-green-oh/"],
  ["Temperance, MI", "/dog-poop-removal-temperance-mi/"],
  ["Lambertville, MI", "/dog-poop-removal-lambertville-mi/"],
];

const services = [
  ["Weekly Cleanups", "Our most popular plan", "/weekly-dog-poop-removal/"],
  ["Bi-Weekly Cleanups", "Every-other-week service", "/bi-weekly-dog-poop-removal/"],
  ["One-Time & Spring Cleanup", "Reset a built-up yard", "/one-time-yard-cleanup/"],
  ["Sanitizing & Deodorizing", "Pet-safe odor & bacteria control", "/yard-sanitizing-deodorizing/"],
  ["Commercial & HOA Service", "Stations & community cleanups", "/commercial-services/"],
  ["Extreme Dog Fuel", "Premium dog food, delivered", "/dog-food/"],
];

export default function Header({ active }) {
  const pathname = usePathname();
  const [isOpen, setOpen] = useState(false);
  const [menu, setMenu] = useState(null);
  const [sub, setSub] = useState(null);

  const section = (() => {
    if (active) return active;
    if (!pathname) return "home";
    if (pathname === "/") return "home";
    if (/residential|weekly|one-time|sanitizing/.test(pathname)) return "residential";
    if (/commercial/.test(pathname)) return "commercial";
    if (/dog-food/.test(pathname)) return "dogfood";
    if (/service-areas|dog-poop-removal/.test(pathname)) return "areas";
    if (/about/.test(pathname)) return "about";
    if (/blog/.test(pathname)) return "blog";
    if (/contact/.test(pathname)) return "contact";
    return "home";
  })();

  const c = (k) => (section === k ? "#8fe06a" : "#e3ebf3");
  const cServices = section === "residential" || section === "commercial" ? "#8fe06a" : "#e3ebf3";
  const cAreas = section === "areas" ? "#8fe06a" : "#e3ebf3";

  const close = () => { setOpen(false); setSub(null); };
  const mItem = { textDecoration: "none", color: "#fff", padding: "12px 4px", borderBottom: "1px solid rgba(255,255,255,.1)", display: "flex", alignItems: "center", justifyContent: "space-between" };
  const mSubItem = { textDecoration: "none", color: "#dbe7f1", padding: "10px 4px 10px 16px", fontSize: 15, fontWeight: 600 };

  return (
    <div
      data-opwp-header
      style={{
        fontFamily: "var(--font-hanken), sans-serif",
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        background: "#ffffff",
        padding: "14px 16px 16px",
      }}
    >
      <header
        className="opwp-bar"
        style={{
          maxWidth: 1320,
          margin: "0 auto",
          background: "#23527A",
          borderRadius: 24,
          boxShadow: "0 16px 36px -16px rgba(0,0,0,.45)",
          padding: "12px 18px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", minWidth: 0 }}>
            <img
              src="/assets/opwp-logo.png"
              alt="Ohio Pet Waste Pros logo"
              style={{ width: 52, height: 52, flex: "none", display: "block", background: "#fff", borderRadius: "50%" }}
            />
            <span className="opwp-wordmark" style={{ fontFamily: "var(--font-bricolage)", fontWeight: 800, fontSize: 18, lineHeight: 1.0, color: "#fff" }}>
              Ohio Pet<br />Waste Pros
            </span>
          </Link>

          <nav className="opwp-desk-nav" style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 22, fontSize: 15.5, fontWeight: 600 }}>
              <Link href="/" style={{ ...NAV_LINK, color: c("home") }}>Home</Link>

              <div onMouseEnter={() => setMenu("services")} onMouseLeave={() => setMenu(null)} style={{ position: "relative" }}>
                <Link href="/residential/" style={{ ...NAV_LINK, color: cServices, display: "inline-flex", alignItems: "center", gap: 5, padding: "20px 0", whiteSpace: "nowrap" }}>
                  Services <span style={{ fontSize: 10, opacity: 0.7 }}>▼</span>
                </Link>
                {menu === "services" && (
                  <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", zIndex: 60, background: "#fff", border: "1px solid #ece9df", borderRadius: 16, boxShadow: "0 22px 46px -18px rgba(0,0,0,.4)", padding: 20, display: "flex", gap: 28 }}>
                    <div style={{ minWidth: 230 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9aa6ae", marginBottom: 8, padding: "0 10px" }}>Recurring cleanup</div>
                      {services.slice(0, 3).map(([t, d, h]) => (
                        <Link key={h} href={h} className="hov-soft" style={{ display: "block", textDecoration: "none", padding: "9px 10px", borderRadius: 9, color: "#2b3942" }}><div style={{ fontWeight: 700, fontSize: 14.5 }}>{t}</div><div style={{ fontSize: 12.5, color: "#7c8891" }}>{d}</div></Link>
                      ))}
                    </div>
                    <div style={{ minWidth: 230, borderLeft: "1px solid #f0eee6", paddingLeft: 24 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9aa6ae", marginBottom: 8, padding: "0 10px" }}>More options</div>
                      {services.slice(3).map(([t, d, h]) => (
                        <Link key={h} href={h} className="hov-soft" style={{ display: "block", textDecoration: "none", padding: "9px 10px", borderRadius: 9, color: "#2b3942" }}><div style={{ fontWeight: 700, fontSize: 14.5 }}>{t}</div><div style={{ fontSize: 12.5, color: "#7c8891" }}>{d}</div></Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div onMouseEnter={() => setMenu("areas")} onMouseLeave={() => setMenu(null)} style={{ position: "relative" }}>
                <Link href="/service-areas/" style={{ ...NAV_LINK, color: cAreas, display: "inline-flex", alignItems: "center", gap: 5, padding: "20px 0", whiteSpace: "nowrap" }}>
                  Service Areas <span style={{ fontSize: 10, opacity: 0.7 }}>▼</span>
                </Link>
                {menu === "areas" && (
                  <div style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", zIndex: 60, background: "#fff", border: "1px solid #ece9df", borderRadius: 16, boxShadow: "0 22px 46px -18px rgba(0,0,0,.4)", padding: "20px 22px", width: 430 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9aa6ae", marginBottom: 12 }}>Cities we serve</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "3px 10px", marginBottom: 14 }}>
                      {cities.map(([name, href]) => (
                        <Link key={href} href={href} className="hov-soft" style={{ textDecoration: "none", padding: "7px 9px", borderRadius: 8, color: "#2b3942", fontWeight: 600, fontSize: 14 }}>{name}</Link>
                      ))}
                    </div>
                    <Link href="/service-areas/" style={{ textDecoration: "none", color: "#4F9E3A", fontWeight: 700, fontSize: 14 }}>View all 25 service areas →</Link>
                  </div>
                )}
              </div>

              <Link href="/dog-food/" style={{ ...NAV_LINK, color: c("dogfood") }}>Dog Food</Link>
              <Link href="/about-our-pet-waste-removal-team/" style={{ ...NAV_LINK, color: c("about") }}>About</Link>
              <Link href="/blog/" style={{ ...NAV_LINK, color: c("blog") }}>Blog</Link>
              <Link href="/contact/" style={{ ...NAV_LINK, color: c("contact") }}>Contact</Link>
              <a href="https://client.sweepandgo.com/login" style={{ textDecoration: "none", color: "#9fc3e0", fontWeight: 600 }}>Client Login</a>
            </div>
          </nav>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <a className="opwp-phone" href="tel:419-262-2371" style={{ textDecoration: "none", color: "#fff", fontFamily: "var(--font-bricolage)", fontWeight: 700, fontSize: 16, whiteSpace: "nowrap" }}>419-262-2371</a>
            <Link href="/free-quote/" className="hov-cta opwp-cta" style={{ background: "#4F9E3A", color: "#fff", textDecoration: "none", padding: "12px 22px", borderRadius: 99, fontWeight: 800, fontSize: 15, whiteSpace: "nowrap", boxShadow: "0 8px 18px -8px rgba(79,158,58,.7)" }}>Get My Price</Link>
            <button
              className="opwp-burger"
              onClick={() => setOpen((v) => !v)}
              aria-label="Menu"
              aria-expanded={isOpen}
              style={{ background: "rgba(255,255,255,.14)", border: "none", borderRadius: 10, width: 46, height: 46, display: "none", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 22, color: "#fff", flex: "none" }}
            >
              {isOpen ? "✕" : "☰"}
            </button>
          </div>
        </div>

        {isOpen && (
          <div className="opwp-mobile-menu" style={{ borderTop: "1px solid rgba(255,255,255,.14)", marginTop: 12, paddingTop: 8, display: "flex", flexDirection: "column", fontSize: 16, fontWeight: 600 }}>
            <Link href="/" onClick={close} style={mItem}>Home</Link>

            <button onClick={() => setSub(sub === "services" ? null : "services")} aria-expanded={sub === "services"} style={{ ...mItem, background: "none", border: "none", borderBottom: "1px solid rgba(255,255,255,.1)", width: "100%", font: "inherit", fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
              <span>Services</span><span style={{ color: "#8fe06a", fontSize: 13 }}>{sub === "services" ? "▲" : "▼"}</span>
            </button>
            {sub === "services" && (
              <div style={{ display: "flex", flexDirection: "column", borderBottom: "1px solid rgba(255,255,255,.1)", paddingBottom: 6 }}>
                {services.map(([t, d, h]) => (
                  <Link key={h} href={h} onClick={close} style={mSubItem}>{t}</Link>
                ))}
              </div>
            )}

            <button onClick={() => setSub(sub === "areas" ? null : "areas")} aria-expanded={sub === "areas"} style={{ ...mItem, background: "none", border: "none", borderBottom: "1px solid rgba(255,255,255,.1)", width: "100%", fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
              <span>Service Areas</span><span style={{ color: "#8fe06a", fontSize: 13 }}>{sub === "areas" ? "▲" : "▼"}</span>
            </button>
            {sub === "areas" && (
              <div style={{ display: "flex", flexDirection: "column", borderBottom: "1px solid rgba(255,255,255,.1)", paddingBottom: 6 }}>
                {cities.map(([name, href]) => (
                  <Link key={href} href={href} onClick={close} style={mSubItem}>{name}</Link>
                ))}
                <Link href="/service-areas/" onClick={close} style={{ ...mSubItem, color: "#8fe06a", fontWeight: 700 }}>View all 25 service areas →</Link>
              </div>
            )}

            <Link href="/dog-food/" onClick={close} style={mItem}>Dog Food</Link>
            <Link href="/about-our-pet-waste-removal-team/" onClick={close} style={mItem}>About</Link>
            <Link href="/blog/" onClick={close} style={mItem}>Blog</Link>
            <Link href="/contact/" onClick={close} style={mItem}>Contact</Link>
            <a href="https://client.sweepandgo.com/login" style={{ ...mItem }}>Client Login</a>

            <Link href="/free-quote/" onClick={close} style={{ textAlign: "center", background: "#4F9E3A", color: "#fff", textDecoration: "none", padding: "14px", borderRadius: 12, fontWeight: 800, margin: "14px 0 4px" }}>Get My Free Quote</Link>

            <a href="tel:419-262-2371" style={{ textDecoration: "none", color: "#fff", fontFamily: "var(--font-bricolage)", fontWeight: 700, fontSize: 18, padding: "10px 4px 2px" }}>📞 419-262-2371</a>
            <a href="mailto:Craig@ohiopetwastepros.com" style={{ textDecoration: "none", color: "#cdd8e2", padding: "2px 4px", fontWeight: 500, fontSize: 14.5 }}>Craig@ohiopetwastepros.com</a>
            <span style={{ color: "#9fb3c4", padding: "2px 4px 10px", fontWeight: 500, fontSize: 14.5 }}>Holland, OH · Mon–Sat</span>

            <div style={{ display: "flex", gap: 12, padding: "4px" }}>
              <a href="https://www.facebook.com/profile.php?id=61575239054687" aria-label="Facebook" style={{ width: 38, height: 38, borderRadius: 9, background: "rgba(255,255,255,.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.9 3.78-3.9 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.9h-2.34V22c4.78-.79 8.44-4.94 8.44-9.94z" /></svg>
              </a>
              <a href="https://www.instagram.com/ohio.pet.waste.pros.llc/" aria-label="Instagram" style={{ width: 38, height: 38, borderRadius: 9, background: "rgba(255,255,255,.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85z" /></svg>
              </a>
            </div>
          </div>
        )}
      </header>

      <style>{`
        @media (max-width: 1000px) {
          [data-opwp-header] .opwp-desk-nav { display: none !important; }
          [data-opwp-header] .opwp-phone { display: none !important; }
          [data-opwp-header] .opwp-burger { display: flex !important; }
        }
        @media (min-width: 1001px) {
          [data-opwp-header] .opwp-mobile-menu { display: none !important; }
        }
        @media (max-width: 600px) {
          [data-opwp-header] .opwp-cta { padding: 10px 16px !important; font-size: 14px !important; }
        }
        @media (max-width: 420px) {
          [data-opwp-header] .opwp-wordmark { display: none !important; }
        }
      `}</style>
    </div>
  );
}
