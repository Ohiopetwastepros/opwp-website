import Link from "next/link";

export const metadata = {
  title:
    "One-Time & Spring Yard Cleanup in Toledo, Sylvania & Perrysburg | Ohio Pet Waste Pros",
  description:
    "One-time dog poop cleanup in Toledo, Sylvania, Perrysburg & NW Ohio. Reset a built-up yard before guests, a move, mowing or starting recurring service — with double-bagging and a gate photo. No contracts.",
  alternates: { canonical: "/one-time-yard-cleanup/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    title: "One-Time & Spring Yard Cleanup | Ohio Pet Waste Pros",
    description:
      "A thorough one-time dog waste reset for built-up yards across Greater Toledo & SE Michigan.",
    url: "https://ohiopetwastepros.com/one-time-yard-cleanup/",
    siteName: "Ohio Pet Waste Pros",
    images: [
      "https://ohiopetwastepros.com/wp-content/uploads/2025/05/cropped-OPWP-CIRCLE-LOGO-11111111.png",
    ],
  },
  twitter: { card: "summary_large_image" },
  other: {
    "geo.region": "US-OH",
    "geo.placename": "Holland, Ohio",
  },
};

const serviceJsonLd = {
  "@context": "https://schema.org",
  "@type": "Service",
  serviceType: "One-time dog waste cleanup",
  provider: {
    "@type": "LocalBusiness",
    name: "Ohio Pet Waste Pros",
    telephone: "+14192622371",
    areaServed: "Greater Toledo, OH and SE Michigan",
  },
  areaServed: ["Toledo OH", "Sylvania OH", "Perrysburg OH", "Maumee OH", "Holland OH"],
  description:
    "A thorough one-time or spring dog waste cleanup to reset a built-up yard, with double-bagging and a gate photo. No contracts.",
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is a one-time cleanup?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A one-time cleanup is a single, thorough visit where we remove all the accumulated dog waste from your yard — ideal after winter, before an event, or before starting recurring service. There's no ongoing commitment.",
      },
    },
    {
      "@type": "Question",
      name: "How is one-time pricing determined?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Pricing depends on how many dogs you have and how often you'd like service — get your exact price with our instant quote.",
      },
    },
    {
      "@type": "Question",
      name: "Can I start recurring service after a one-time cleanup?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Absolutely. Many clients book a one-time reset to get the yard back to zero, then roll right into weekly or bi-weekly service to keep it that way.",
      },
    },
  ],
};

const faqData = [
  {
    q: "What is a one-time cleanup?",
    a: "A one-time cleanup is a single, thorough visit where we remove all the accumulated dog waste from your yard — ideal after winter, before an event, or before starting recurring service. There’s no ongoing commitment.",
  },
  {
    q: "How is one-time pricing determined?",
    a: "Pricing depends on how many dogs you have and how often you’d like service — get your exact price with our instant quote.",
  },
  {
    q: "Can I start recurring service after a one-time cleanup?",
    a: "Absolutely. Many clients book a one-time reset to get the yard back to zero, then roll right into weekly or bi-weekly service to keep it that way.",
  },
  {
    q: "Is there a limit to how much you’ll clean?",
    a: "No. A one-time cleanup is a complete reset — we clear it all, however long it’s been. Heavier buildup just factors into the quote.",
  },
];

export default function OneTimePage() {
  return (
    <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", color: "#1C2A33" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* HERO */}
      <section style={{ background: "linear-gradient(160deg,#1F4566,#1A3C5A 55%,#14304A)", color: "#fff" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "64px 28px 70px", display: "grid", gridTemplateColumns: "1.08fr 0.92fr", gap: 50, alignItems: "center" }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid rgba(255,255,255,.22)", borderRadius: 99, padding: "7px 15px", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#cdd8e2", marginBottom: 22 }}>One-time &amp; spring reset</div>
            <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 50, lineHeight: 1.0, letterSpacing: "-0.025em", margin: "0 0 20px" }}>Get a built-up yard back to a clean slate.</h1>
            <p style={{ fontSize: 18, lineHeight: 1.55, color: "#c4d2df", margin: "0 0 30px", maxWidth: 510 }}>One thorough cleanup to reset your yard — perfect after a long winter, before guests or a move, or right before you start recurring service. Serving Toledo, Sylvania, Perrysburg and the surrounding area. No commitment.</p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Link href="/free-quote/" className="hov-cta" style={{ background: "#4F9E3A", color: "#fff", textDecoration: "none", padding: "16px 30px", borderRadius: 11, fontWeight: 800, fontSize: 16.5, boxShadow: "0 12px 26px -10px rgba(79,158,58,.7)" }}>Get My Free Quote</Link>
              <a href="tel:419-262-2371" style={{ background: "rgba(255,255,255,.1)", border: "1.5px solid rgba(255,255,255,.3)", color: "#fff", textDecoration: "none", padding: "16px 28px", borderRadius: 11, fontWeight: 700, fontSize: 16.5 }}>Call 419-262-2371</a>
            </div>
          </div>
          <div><img src="/assets/photos/cody-scooping-vest.jpg" alt="Ohio Pet Waste Pros technician performing a one-time spring yard cleanup in Toledo" style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 20, boxShadow: "0 30px 60px -26px rgba(0,0,0,.6)" }} /></div>
        </div>
      </section>

      {/* THE BASICS */}
      <section style={{ background: "#fff", padding: "82px 0" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 28px", textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 14 }}>The basics</div>
          <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 34, lineHeight: 1.12, letterSpacing: "-0.02em", margin: "0 0 18px" }}>What a one-time cleanup looks like</h2>
          <p style={{ fontSize: 18, lineHeight: 1.6, color: "#475259", margin: 0 }}>We come out <strong>once</strong> and do a complete, top-to-bottom cleanup — removing every bit of accumulated waste, no matter how long it&apos;s been. There&apos;s no schedule and no commitment. When we&apos;re done, the yard is back to a clean slate, double-bagged and hauled to your bin, with a gate photo to confirm we locked up.</p>
        </div>
      </section>

      {/* PERFECT FOR */}
      <section style={{ background: "#14304A", color: "#fff", padding: "80px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 46 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#8fb0d0", marginBottom: 12 }}>Perfect for</div>
            <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 34, letterSpacing: "-0.02em", margin: 0 }}>When a one-time reset makes sense</h2>
          </div>
          <div className="opwp-g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 26 }}><div style={{ width: 46, height: 46, borderRadius: 12, background: "#4F9E3A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, marginBottom: 16 }}>🌷</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>Spring thaw</h3><p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>Clear a whole winter&apos;s worth of buildup once the snow melts.</p></div>
            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 26 }}><div style={{ width: 46, height: 46, borderRadius: 12, background: "#4F9E3A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, marginBottom: 16 }}>🎉</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>Before an event</h3><p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>A party, cookout or graduation — get the yard guest-ready.</p></div>
            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 26 }}><div style={{ width: 46, height: 46, borderRadius: 12, background: "#4F9E3A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, marginBottom: 16 }}>🏡</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>Moving in or out</h3><p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>Hand over — or move into — a clean, fresh yard.</p></div>
            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 26 }}><div style={{ width: 46, height: 46, borderRadius: 12, background: "#4F9E3A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, marginBottom: 16 }}>🔄</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>Before recurring</h3><p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>Reset to zero, then start weekly or bi-weekly service.</p></div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ background: "#fff", padding: "82px 0" }}>
        <div className="opwp-gsplit" style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px", display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 50, alignItems: "center" }}>
          <div><img src="/assets/photos/we-scoop-banner.jpg" alt="A reset, clean NW Ohio backyard after a one-time dog waste cleanup" style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 20, boxShadow: "0 24px 48px -24px rgba(20,48,74,.4)" }} /></div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 12 }}>How it works</div>
            <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 34, lineHeight: 1.05, letterSpacing: "-0.02em", margin: "0 0 22px" }}>From request to clean yard</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}><div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 22, color: "#4F9E3A", flex: "none", width: 30 }}>1</div><div><div style={{ fontWeight: 700, fontSize: 16 }}>Request a free quote</div><p style={{ margin: "4px 0 0", fontSize: 14.5, lineHeight: 1.5, color: "#5b6770" }}>Tell us your yard size and number of dogs — we&apos;ll confirm your one-time price.</p></div></div>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}><div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 22, color: "#4F9E3A", flex: "none", width: 30 }}>2</div><div><div style={{ fontWeight: 700, fontSize: 16 }}>We schedule your visit</div><p style={{ margin: "4px 0 0", fontSize: 14.5, lineHeight: 1.5, color: "#5b6770" }}>Pick a date that works — no contract, no recurring charge.</p></div></div>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}><div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 22, color: "#4F9E3A", flex: "none", width: 30 }}>3</div><div><div style={{ fontWeight: 700, fontSize: 16 }}>We reset the yard</div><p style={{ margin: "4px 0 0", fontSize: 14.5, lineHeight: 1.5, color: "#5b6770" }}>A complete cleanup, double-bagged disposal, and a gate photo when we finish.</p></div></div>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARE */}
      <section style={{ background: "#F6F5EF", padding: "82px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 12 }}>Keep it clean</div>
            <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 34, letterSpacing: "-0.02em", margin: 0 }}>Stay ahead after your reset</h2>
          </div>
          <div className="opwp-g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
            <Link href="/weekly-dog-poop-removal/" style={{ textDecoration: "none", color: "inherit", background: "#fff", border: "2px solid #4F9E3A", borderRadius: 16, padding: 26, display: "block", boxShadow: "0 14px 30px -20px rgba(79,158,58,.5)" }}><div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#4F9E3A", marginBottom: 8 }}>Most popular</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 20, margin: "0 0 8px" }}>Weekly Cleanups</h3><p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: "#5b6770" }}>Keep the yard from ever building up again with a weekly visit.</p><span style={{ color: "#4F9E3A", fontWeight: 700, fontSize: 14 }}>Learn more &rarr;</span></Link>
            <Link href="/bi-weekly-dog-poop-removal/" className="hov-soft" style={{ textDecoration: "none", color: "inherit", background: "#fff", border: "1px solid #ece9df", borderRadius: 16, padding: 26, display: "block" }}><div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#658461", marginBottom: 8 }}>Lighter use</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 20, margin: "0 0 8px" }}>Bi-Weekly Cleanups</h3><p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: "#5b6770" }}>Every-other-week upkeep for low-traffic yards.</p><span style={{ color: "#4F9E3A", fontWeight: 700, fontSize: 14 }}>Learn more &rarr;</span></Link>
            <Link href="/yard-sanitizing-deodorizing/" className="hov-soft" style={{ textDecoration: "none", color: "inherit", background: "#fff", border: "1px solid #ece9df", borderRadius: 16, padding: 26, display: "block" }}><div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#658461", marginBottom: 8 }}>Add-on</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 20, margin: "0 0 8px" }}>Sanitizing &amp; Deodorizing</h3><p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: "#5b6770" }}>Add pet-safe odor &amp; bacteria control to your cleanup.</p><span style={{ color: "#4F9E3A", fontWeight: 700, fontSize: 14 }}>Learn more &rarr;</span></Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ background: "#fff", padding: "80px 0" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 42 }}><div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 12 }}>One-Time FAQ</div><h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 34, letterSpacing: "-0.02em", margin: 0 }}>Good to know</h2></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {faqData.map((f, i) => (
              <div key={i} style={{ background: "#F6F5EF", border: "1px solid #ece9df", borderRadius: 14, overflow: "hidden" }}>
                <div style={{ width: "100%", textAlign: "left", padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, color: "#1C2A33" }}><span>{f.q}</span><span style={{ color: "#4F9E3A", fontSize: 22, flex: "none" }}>&minus;</span></div>
                <div style={{ padding: "0 24px 22px", fontSize: 15, lineHeight: 1.6, color: "#475259" }}>{f.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: "linear-gradient(160deg,#1F4566,#14304A)", color: "#fff", padding: "74px 0" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 28px", textAlign: "center" }}>
          <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 38, lineHeight: 1.05, letterSpacing: "-0.02em", margin: "0 0 16px" }}>Ready to reset your yard?</h2>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: "#c4d2df", margin: "0 0 30px" }}>Get your free Toledo-area quote for a one-time cleanup — no commitment required.</p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/free-quote/" className="hov-cta" style={{ background: "#4F9E3A", color: "#fff", textDecoration: "none", padding: "17px 34px", borderRadius: 12, fontWeight: 800, fontSize: 17, boxShadow: "0 14px 28px -12px rgba(79,158,58,.7)" }}>Get My Free Quote</Link>
            <a href="tel:419-262-2371" style={{ background: "rgba(255,255,255,.12)", border: "1.5px solid rgba(255,255,255,.32)", color: "#fff", textDecoration: "none", padding: "17px 30px", borderRadius: 12, fontWeight: 700, fontSize: 17 }}>Call 419-262-2371</a>
          </div>
        </div>
      </section>
    </div>
  );
}
