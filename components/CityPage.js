import Link from "next/link";

// City landing template — reproduces City Page.dc.html.
// Header & Footer are provided by the root layout, so this renders body sections only.
export default function CityPage({ city, state }) {
  return (
    <div style={{ fontFamily: "var(--font-hanken), sans-serif", color: "#1C2A33" }}>
      {/* HERO */}
      <section style={{ background: "linear-gradient(160deg,#1F4566,#1A3C5A 55%,#14304A)", color: "#fff" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "64px 28px 72px", display: "grid", gridTemplateColumns: "1.08fr 0.92fr", gap: 50, alignItems: "center" }} className="opwp-gsplit">
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid rgba(255,255,255,.22)", borderRadius: 99, padding: "7px 15px", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#cdd8e2", marginBottom: 22 }}>Serving {city} &amp; nearby</div>
            <h1 style={{ fontFamily: "var(--font-bricolage)", fontWeight: 800, fontSize: 48, lineHeight: 1.0, letterSpacing: "-0.025em", margin: "0 0 20px" }}>Dog poop removal in {city}, {state}</h1>
            <p style={{ fontSize: 18, lineHeight: 1.55, color: "#c4d2df", margin: "0 0 30px", maxWidth: 500 }}>Ohio Pet Waste Pros is your local, family-owned pooper scooper service in {city}. We keep your yard clean and safe with weekly, bi-weekly and one-time cleanups — gate photo every visit, waste double-bagged, and eco-friendly sanitizing on request.</p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Link href="/free-quote/" className="hov-cta" style={{ background: "#4F9E3A", color: "#fff", textDecoration: "none", padding: "16px 30px", borderRadius: 11, fontWeight: 800, fontSize: 16.5, boxShadow: "0 12px 26px -10px rgba(79,158,58,.7)" }}>Get My Free Quote</Link>
              <a href="tel:419-262-2371" style={{ background: "rgba(255,255,255,.1)", border: "1.5px solid rgba(255,255,255,.3)", color: "#fff", textDecoration: "none", padding: "16px 28px", borderRadius: 11, fontWeight: 700, fontSize: 16.5 }}>Call 419-262-2371</a>
            </div>
          </div>
          <div><img src="/assets/photos/scooping-bell.webp" alt={`Dog poop removal service in ${city}, ${state}`} width="1400" height="1050" style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 20, boxShadow: "0 30px 60px -26px rgba(0,0,0,.6)" }} /></div>
        </div>
      </section>

      {/* INTRO */}
      <section style={{ background: "#fff", padding: "70px 0 30px" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 28px", textAlign: "center" }}>
          <h2 style={{ fontFamily: "var(--font-bricolage)", fontWeight: 700, fontSize: 30, letterSpacing: "-0.02em", margin: "0 0 18px" }}>Your local {city} pooper scooper service</h2>
          <p style={{ fontSize: 17, lineHeight: 1.65, color: "#475259", margin: 0 }}>Looking for reliable dog poop removal in {city}? We make a clean yard the easiest part of your week. As a family-owned business based right here in Northwest Ohio, we service {city} yards on a consistent schedule, text you before we arrive, and send a photo of your closed gate after every visit. No contracts, no hassle — just a yard that&apos;s clean, safe, and ready to enjoy.</p>
        </div>
      </section>

      {/* SERVICES */}
      <section style={{ background: "#fff", padding: "30px 0 76px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }} className="opwp-g3">
            <Link href="/residential/" className="hov-cream" style={{ textDecoration: "none", color: "inherit", background: "#F6F5EF", borderRadius: 16, padding: 28, display: "block" }}><div style={{ fontSize: 26, marginBottom: 12 }}>📅</div><h3 style={{ fontFamily: "var(--font-bricolage)", fontWeight: 700, fontSize: 19, margin: "0 0 8px" }}>Weekly &amp; bi-weekly cleanups</h3><p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#5b6770" }}>Dependable recurring service that keeps your {city} yard spotless.</p></Link>
            <Link href="/residential/" className="hov-cream" style={{ textDecoration: "none", color: "inherit", background: "#F6F5EF", borderRadius: 16, padding: 28, display: "block" }}><div style={{ fontSize: 26, marginBottom: 12 }}>🌱</div><h3 style={{ fontFamily: "var(--font-bricolage)", fontWeight: 700, fontSize: 19, margin: "0 0 8px" }}>One-time &amp; spring cleanup</h3><p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#5b6770" }}>Reset a built-up yard before guests, mowing, or starting service.</p></Link>
            <Link href="/commercial-services/" className="hov-cream" style={{ textDecoration: "none", color: "inherit", background: "#F6F5EF", borderRadius: 16, padding: 28, display: "block" }}><div style={{ fontSize: 26, marginBottom: 12 }}>🏢</div><h3 style={{ fontFamily: "var(--font-bricolage)", fontWeight: 700, fontSize: 19, margin: "0 0 8px" }}>Commercial &amp; HOA</h3><p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#5b6770" }}>Pet waste stations and cleanups for {city}-area communities.</p></Link>
          </div>
        </div>
      </section>

      {/* TRUST */}
      <section style={{ background: "#14304A", color: "#fff", padding: "60px 0" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 28px", display: "flex", flexWrap: "wrap", gap: "14px 16px", justifyContent: "center" }}>
          <span style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 99, padding: "11px 20px", fontWeight: 700, fontSize: 14.5 }}>📷 Gate photo every visit</span>
          <span style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 99, padding: "11px 20px", fontWeight: 700, fontSize: 14.5 }}>♻️ Waste double-bagged</span>
          <span style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 99, padding: "11px 20px", fontWeight: 700, fontSize: 14.5 }}>🌿 Eco-friendly sanitizing</span>
          <span style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 99, padding: "11px 20px", fontWeight: 700, fontSize: 14.5 }}>🏡 Family-owned &amp; insured</span>
          <span style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 99, padding: "11px 20px", fontWeight: 700, fontSize: 14.5 }}>⭐ 5.0 on Google</span>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ background: "#F6F5EF", padding: "74px 0" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 28px" }}>
          <h2 style={{ fontFamily: "var(--font-bricolage)", fontWeight: 700, fontSize: 30, letterSpacing: "-0.02em", margin: "0 0 28px", textAlign: "center" }}>Dog poop removal in {city} — common questions</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: "#fff", border: "1px solid #ece9df", borderRadius: 14, padding: "22px 24px" }}><div style={{ fontFamily: "var(--font-bricolage)", fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Do you serve all of {city}?</div><p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#475259" }}>Yes — we provide dog waste removal throughout {city} and the surrounding Greater Toledo and SE Michigan communities. Request a free quote and we&apos;ll confirm your address is on our route.</p></div>
            <div style={{ background: "#fff", border: "1px solid #ece9df", borderRadius: 14, padding: "22px 24px" }}><div style={{ fontFamily: "var(--font-bricolage)", fontWeight: 700, fontSize: 17, marginBottom: 8 }}>How much does service cost in {city}?</div><p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#475259" }}>Pricing depends on how many dogs you have and how often you&apos;d like service. Weekly visits offer the best value, with no contracts. Use our instant quote tool to see your {city} price.</p></div>
            <div style={{ background: "#fff", border: "1px solid #ece9df", borderRadius: 14, padding: "22px 24px" }}><div style={{ fontFamily: "var(--font-bricolage)", fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Do I need to be home?</div><p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#475259" }}>No. As long as we have safe access to your yard, we&apos;ll complete service while you&apos;re away and send a gate photo when we&apos;re done.</p></div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: "linear-gradient(160deg,#1F4566,#14304A)", color: "#fff", padding: "72px 0" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 28px", textAlign: "center" }}>
          <h2 style={{ fontFamily: "var(--font-bricolage)", fontWeight: 800, fontSize: 36, lineHeight: 1.05, letterSpacing: "-0.02em", margin: "0 0 16px" }}>Ready for a cleaner yard in {city}?</h2>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: "#c4d2df", margin: "0 0 30px" }}>Get your free instant quote in about a minute.</p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/free-quote/" className="hov-cta" style={{ background: "#4F9E3A", color: "#fff", textDecoration: "none", padding: "17px 34px", borderRadius: 12, fontWeight: 800, fontSize: 17, boxShadow: "0 14px 28px -12px rgba(79,158,58,.7)" }}>Get My Free Quote</Link>
            <a href="tel:419-262-2371" style={{ background: "rgba(255,255,255,.12)", border: "1.5px solid rgba(255,255,255,.32)", color: "#fff", textDecoration: "none", padding: "17px 30px", borderRadius: 12, fontWeight: 700, fontSize: 17 }}>Call 419-262-2371</a>
          </div>
        </div>
      </section>
    </div>
  );
}
