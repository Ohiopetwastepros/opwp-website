import Link from "next/link";

export default function Footer() {
  return (
    <div data-opwp-footer style={{ fontFamily: "var(--font-hanken), sans-serif", background: "#14304A", color: "#aebecd" }}>
      <div
        className="opwp-gfoot"
        style={{ maxWidth: 1200, margin: "0 auto", padding: "60px 28px 30px", display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1.2fr", gap: 40 }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <img src="/assets/opwp-logo.png" alt="Ohio Pet Waste Pros logo" style={{ width: 54, height: 54, background: "#fff", borderRadius: "50%" }} />
            <span style={{ fontFamily: "var(--font-bricolage)", fontWeight: 800, fontSize: 18, lineHeight: 1.0, color: "#fff" }}>Ohio Pet<br />Waste Pros</span>
          </div>
          <p style={{ fontSize: 14.5, lineHeight: 1.6, margin: "0 0 20px", maxWidth: 330, color: "#9fb1c2" }}>
            Northwest Ohio &amp; Southeast Michigan&apos;s family-owned dog poop removal service. Gate photos, double-bagged waste hauled away, and eco-friendly sanitizing — a clean yard without the dirty work.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <a href="https://www.facebook.com/profile.php?id=61575239054687" aria-label="Facebook" className="hov-white-08" style={{ width: 40, height: 40, borderRadius: 9, background: "rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="#fff"><path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.9 3.78-3.9 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.9h-2.34V22c4.78-.79 8.44-4.94 8.44-9.94z" /></svg>
            </a>
            <a href="https://www.instagram.com/ohio.pet.waste.pros.llc/" aria-label="Instagram" className="hov-white-08" style={{ width: 40, height: 40, borderRadius: 9, background: "rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="#fff"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07zm0 1.62c-3.15 0-3.52.01-4.76.07-1.15.05-1.77.24-2.19.41-.55.21-.94.47-1.35.88-.41.41-.67.8-.88 1.35-.17.42-.36 1.04-.41 2.19-.06 1.24-.07 1.61-.07 4.76s.01 3.52.07 4.76c.05 1.15.24 1.77.41 2.19.21.55.47.94.88 1.35.41.41.8.67 1.35.88.42.17 1.04.36 2.19.41 1.24.06 1.61.07 4.76.07s3.52-.01 4.76-.07c1.15-.05 1.77-.24 2.19-.41.55-.21.94-.47 1.35-.88.41-.41.67-.8.88-1.35.17-.42.36-1.04.41-2.19.06-1.24.07-1.61.07-4.76s-.01-3.52-.07-4.76c-.05-1.15-.24-1.77-.41-2.19-.21-.55-.47-.94-.88-1.35-.41-.41-.8-.67-1.35-.88-.42-.17-1.04-.36-2.19-.41-1.24-.06-1.61-.07-4.76-.07zm0 2.76a5.3 5.3 0 100 10.6 5.3 5.3 0 000-10.6zm0 8.74a3.44 3.44 0 110-6.88 3.44 3.44 0 010 6.88zm6.74-8.94a1.24 1.24 0 11-2.48 0 1.24 1.24 0 012.48 0z" /></svg>
            </a>
          </div>
        </div>

        <div>
          <div style={{ fontFamily: "var(--font-bricolage)", fontWeight: 700, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fff", marginBottom: 16 }}>Services</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 11, fontSize: 14.5 }}>
            <Link href="/weekly-dog-poop-removal/" style={{ textDecoration: "none", color: "#aebecd" }}>Weekly Cleanups</Link>
            <Link href="/bi-weekly-dog-poop-removal/" style={{ textDecoration: "none", color: "#aebecd" }}>Bi-Weekly Cleanups</Link>
            <Link href="/one-time-yard-cleanup/" style={{ textDecoration: "none", color: "#aebecd" }}>One-Time / Initial Cleanup</Link>
            <Link href="/yard-sanitizing-deodorizing/" style={{ textDecoration: "none", color: "#aebecd" }}>Yard Deodorizing</Link>
            <Link href="/yard-sanitizing-deodorizing/" style={{ textDecoration: "none", color: "#aebecd" }}>Sanitizing Treatment</Link>
            <Link href="/commercial-services/" style={{ textDecoration: "none", color: "#aebecd" }}>Commercial Service</Link>
            <Link href="/dog-food/" style={{ textDecoration: "none", color: "#aebecd" }}>Extreme Dog Fuel</Link>
          </div>
        </div>

        <div>
          <div style={{ fontFamily: "var(--font-bricolage)", fontWeight: 700, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fff", marginBottom: 16 }}>Company</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 11, fontSize: 14.5 }}>
            <Link href="/" style={{ textDecoration: "none", color: "#aebecd" }}>Home</Link>
            <Link href="/about-our-pet-waste-removal-team/" style={{ textDecoration: "none", color: "#aebecd" }}>About Us</Link>
            <Link href="/contact/" style={{ textDecoration: "none", color: "#aebecd" }}>Contact</Link>
            <Link href="/blog/" style={{ textDecoration: "none", color: "#aebecd" }}>Blog</Link>
            <a href="https://client.sweepandgo.com/login" style={{ textDecoration: "none", color: "#aebecd" }}>Client Login</a>
            <Link href="/free-quote/" style={{ textDecoration: "none", color: "#8fe06a", fontWeight: 700 }}>Get a Free Quote</Link>
          </div>
        </div>

        <div>
          <div style={{ fontFamily: "var(--font-bricolage)", fontWeight: 700, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fff", marginBottom: 16 }}>Get in touch</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 13, fontSize: 14.5 }}>
            <a href="tel:419-262-2371" style={{ textDecoration: "none", color: "#fff", fontFamily: "var(--font-bricolage)", fontWeight: 700, fontSize: 18 }}>419-262-2371</a>
            <a href="mailto:Craig@ohiopetwastepros.com" style={{ textDecoration: "none", color: "#aebecd" }}>Craig@ohiopetwastepros.com</a>
            <span style={{ color: "#9fb1c2" }}>Based in Holland, OH</span>
            <span style={{ color: "#9fb1c2", lineHeight: 1.55 }}>Serving Toledo, Sylvania, Perrysburg, Maumee, Holland, Whitehouse &amp; SE Michigan</span>
          </div>
        </div>
      </div>

      <div style={{ borderTop: "1px solid rgba(255,255,255,.1)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 28px", display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", justifyContent: "space-between", fontSize: 13, color: "#8499aa" }}>
          <span>© 2026 Ohio Pet Waste Pros. All rights reserved.</span>
          <span style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <a href="/privacy-policy/" style={{ textDecoration: "none", color: "#8499aa" }}>Privacy Policy</a>
            <a href="/terms-of-service/" style={{ textDecoration: "none", color: "#8499aa" }}>Terms of Service</a>
            <span>Proudly serving NW Ohio &amp; SE Michigan</span>
          </span>
        </div>
      </div>
    </div>
  );
}
