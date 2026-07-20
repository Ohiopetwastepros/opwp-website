import Link from "next/link";

export const metadata = {
  title: "Residential Dog Poop Removal in Toledo, Sylvania & Perrysburg | Ohio Pet Waste Pros",
  description:
    "Reliable residential pet waste removal & pooper scooper service in Toledo, Sylvania, Perrysburg & SE Michigan. Weekly, bi-weekly & one-time dog poop removal with gate photos, double-bagging & eco-friendly sanitizing.",
  alternates: { canonical: "/residential/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    title: "Residential Dog Poop Removal in Greater Toledo | Ohio Pet Waste Pros",
    description:
      "Weekly, bi-weekly & one-time dog waste removal for homeowners across NW Ohio & SE Michigan.",
    url: "https://ohiopetwastepros.com/residential/",
    siteName: "Ohio Pet Waste Pros",
    images: ["https://ohiopetwastepros.com/wp-content/uploads/2025/05/cropped-OPWP-CIRCLE-LOGO-11111111.png"],
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
  serviceType: "Residential dog poop removal",
  provider: { "@type": "LocalBusiness", name: "Ohio Pet Waste Pros", telephone: "+14192622371", areaServed: "Greater Toledo, OH and SE Michigan" },
  areaServed: ["Toledo OH", "Sylvania OH", "Perrysburg OH", "Maumee OH", "Holland OH"],
  description: "Weekly, bi-weekly and one-time residential dog waste removal with gate photos, double-bagging and eco-friendly sanitizing.",
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    { "@type": "Question", name: "How often should I have my dog's waste removed?", acceptedAnswer: { "@type": "Answer", text: "Most homeowners choose weekly service to keep the yard clean, safe and odor-free. We also offer bi-weekly and one-time cleanups to match how many dogs you have and how often the yard is used." } },
    { "@type": "Question", name: "Do I need to be home?", acceptedAnswer: { "@type": "Answer", text: "No. As long as we have safe access to your yard, we can complete service while you're away, and we'll text you and send a gate photo when we're done." } },
    { "@type": "Question", name: "What if I have more than one dog?", acceptedAnswer: { "@type": "Answer", text: "No problem — we tailor your plan to the number of dogs and the size of your yard. Just request a free quote and we'll build the right plan." } },
  ],
};

const faqData = [
  { q: "How often should I have my dog’s waste removed?", a: "Most homeowners choose weekly service to keep the yard clean, safe and odor-free while cutting down on flies and bacteria. We also offer bi-weekly and one-time cleanups to match how many dogs you have and how often the yard is used." },
  { q: "Do I need to be home for service?", a: "No. As long as we have safe access to your yard, we can complete service while you’re away — and we’ll text you and send a gate photo when we’re done." },
  { q: "What if I have more than one dog?", a: "No problem — we tailor your plan to the number of dogs and the size of your yard. Just request a free quote and we’ll build the right plan for you." },
  { q: "Is there a contract?", a: "No contracts. Keep your service as long as it’s helpful, and adjust or pause anytime through your client portal." },
];

export default function ResidentialPage() {
  return (
    <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", color: "#1C2A33" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* HERO */}
      <section style={{ background: "linear-gradient(160deg,#1F4566,#1A3C5A 55%,#14304A)", color: "#fff" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "66px 28px 74px", display: "grid", gridTemplateColumns: "1.08fr 0.92fr", gap: 50, alignItems: "center" }} className="opwp-gsplit">
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid rgba(255,255,255,.22)", borderRadius: 99, padding: "7px 15px", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#cdd8e2", marginBottom: 22 }}>Residential pooper scooper service</div>
            <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 50, lineHeight: 1.0, letterSpacing: "-0.025em", margin: "0 0 20px" }}>A clean, safe yard — without the weekly chore.</h1>
            <p style={{ fontSize: 18, lineHeight: 1.55, color: "#c4d2df", margin: "0 0 30px", maxWidth: 500 }}>We remove your dog&apos;s waste on a dependable schedule across Toledo, Sylvania, Perrysburg, Maumee and the surrounding area — with a gate photo after every visit and eco-friendly sanitizing on request.</p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Link href="/free-quote/" className="hov-cta" style={{ background: "#4F9E3A", color: "#fff", textDecoration: "none", padding: "16px 30px", borderRadius: 11, fontWeight: 800, fontSize: 16.5, boxShadow: "0 12px 26px -10px rgba(79,158,58,.7)" }}>Get My Free Quote</Link>
              <a href="tel:419-262-2371" style={{ background: "rgba(255,255,255,.1)", border: "1.5px solid rgba(255,255,255,.3)", color: "#fff", textDecoration: "none", padding: "16px 28px", borderRadius: 11, fontWeight: 700, fontSize: 16.5 }}>Call 419-262-2371</a>
            </div>
          </div>
          <div><img src="/assets/photos/craig-standing-horizontal.webp" alt="Ohio Pet Waste Pros technician ready for a residential dog waste cleanup in Toledo" style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 20, boxShadow: "0 30px 60px -26px rgba(0,0,0,.6)" }} /></div>
        </div>
      </section>

      {/* PLANS */}
      <section style={{ background: "#fff", padding: "82px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 46 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 12 }}>Choose your plan</div>
            <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 36, letterSpacing: "-0.02em", margin: 0 }}>Pick the cleanup schedule your yard needs</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 22 }} className="opwp-g3">
            <Link href="/weekly-dog-poop-removal/" style={{ textDecoration: "none", color: "inherit", border: "2px solid #4F9E3A", borderRadius: 18, overflow: "hidden", boxShadow: "0 18px 36px -22px rgba(79,158,58,.45)", display: "block" }}>
              <img src="/assets/photos/scooping-bell.webp" alt="Weekly dog poop removal" style={{ width: "100%", height: 180, objectFit: "cover" }} />
              <div style={{ padding: 26 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#4F9E3A", marginBottom: 8 }}>Most popular</div>
                <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 22, margin: "0 0 10px" }}>Weekly Cleanups</h3>
                <p style={{ margin: "0 0 14px", fontSize: 14.5, lineHeight: 1.55, color: "#475259" }}>The easiest way to stay ahead of it. A dependable weekly route keeps your yard clean, safe and ready to use all season.</p><span style={{ color: "#4F9E3A", fontWeight: 700, fontSize: 14 }}>Learn more →</span>
              </div>
            </Link>
            <Link href="/bi-weekly-dog-poop-removal/" style={{ textDecoration: "none", color: "inherit", border: "1px solid #ece9df", borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.04)", display: "block" }}>
              <img src="/assets/photos/craig-standing-horizontal.webp" alt="Bi-weekly dog waste removal" style={{ width: "100%", height: 180, objectFit: "cover" }} />
              <div style={{ padding: 26 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#658461", marginBottom: 8 }}>Lighter-use yards</div>
                <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 22, margin: "0 0 10px" }}>Bi-Weekly Cleanups</h3>
                <p style={{ margin: "0 0 14px", fontSize: 14.5, lineHeight: 1.55, color: "#475259" }}>Every-other-week service for yards that don&apos;t need a weekly visit but still deserve a professional touch.</p><span style={{ color: "#4F9E3A", fontWeight: 700, fontSize: 14 }}>Learn more →</span>
              </div>
            </Link>
            <Link href="/one-time-yard-cleanup/" style={{ textDecoration: "none", color: "inherit", border: "1px solid #ece9df", borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.04)", display: "block" }}>
              <img src="/assets/photos/cody-scooping-vest.webp" alt="One-time and spring dog waste cleanup" style={{ width: "100%", height: 180, objectFit: "cover" }} />
              <div style={{ padding: 26 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#658461", marginBottom: 8 }}>Fresh start</div>
                <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 22, margin: "0 0 10px" }}>One-Time &amp; Spring Cleanup</h3>
                <p style={{ margin: "0 0 14px", fontSize: 14.5, lineHeight: 1.55, color: "#475259" }}>Get a built-up yard back under control before guests, mowing, a move, or starting recurring service.</p><span style={{ color: "#4F9E3A", fontWeight: 700, fontSize: 14 }}>Learn more →</span>
              </div>
            </Link>
          </div>
          <p style={{ textAlign: "center", fontSize: 15, color: "#6b7680", margin: "26px 0 0" }}>Plans are tailored to your yard and number of dogs. <Link href="/free-quote/" style={{ color: "#4F9E3A", fontWeight: 700, textDecoration: "none" }}>Request your free quote →</Link></p>
        </div>
      </section>

      {/* WHAT'S INCLUDED */}
      <section style={{ background: "#14304A", color: "#fff", padding: "80px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 46 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#8fb0d0", marginBottom: 12 }}>What&apos;s included</div>
            <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 34, letterSpacing: "-0.02em", margin: 0 }}>Every visit, done right</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }} className="opwp-g4">
            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 26 }}><div style={{ width: 46, height: 46, borderRadius: 12, background: "#4F9E3A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, marginBottom: 16 }}>📷</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>Gate photo proof</h3><p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>A photo of your closed gate after every cleanup, so your pets stay secure.</p></div>
            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 26 }}><div style={{ width: 46, height: 46, borderRadius: 12, background: "#4F9E3A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, marginBottom: 16 }}>♻️</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>Double-bagged disposal</h3><p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>Waste is double-bagged and tucked into your trash bin — clean and odor-free.</p></div>
            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 26 }}><div style={{ width: 46, height: 46, borderRadius: 12, background: "#4F9E3A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, marginBottom: 16 }}>💬</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>Service text updates</h3><p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>A quick text before we arrive and after we finish keeps you in the loop.</p></div>
            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 26 }}><div style={{ width: 46, height: 46, borderRadius: 12, background: "#4F9E3A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, marginBottom: 16 }}>🧴</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>Sanitized equipment</h3><p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>Tools are disinfected with kennel-grade solution between every property.</p></div>
          </div>
        </div>
      </section>

      {/* ADD-ONS */}
      <section style={{ background: "#fff", padding: "82px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px", display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 50, alignItems: "center" }} className="opwp-gsplit">
          <div><img src="/assets/photos/wysiwash-application.webp" alt="Eco-friendly yard sanitizing and deodorizing treatment" style={{ width: "100%", aspectRatio: "4/5", objectFit: "cover", borderRadius: 20, boxShadow: "0 24px 48px -24px rgba(20,48,74,.4)" }} /></div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 12 }}>Add-on services</div>
            <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 34, lineHeight: 1.05, letterSpacing: "-0.02em", margin: "0 0 18px" }}>Go beyond a clean yard</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 22 }}>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}><span style={{ fontSize: 22 }}>🌿</span><div><div style={{ fontWeight: 700, fontSize: 16 }}>Yard deodorizing</div><p style={{ margin: "4px 0 0", fontSize: 14.5, lineHeight: 1.5, color: "#5b6770" }}>Neutralizes and eliminates pet-related odors, leaving your yard fresh.</p></div></div>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}><span style={{ fontSize: 22 }}>🧴</span><div><div style={{ fontWeight: 700, fontSize: 16 }}>Sanitizing treatment</div><p style={{ margin: "4px 0 0", fontSize: 14.5, lineHeight: 1.5, color: "#5b6770" }}>Pet-safe solution eliminates bacteria and odors on patios, decks, driveways and rock beds.</p></div></div>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}><span style={{ fontSize: 22 }}>♻️</span><div><div style={{ fontWeight: 700, fontSize: 16 }}>Haul-away</div><p style={{ margin: "4px 0 0", fontSize: 14.5, lineHeight: 1.5, color: "#5b6770" }}>Prefer the waste gone entirely? We&apos;ll remove it from your property for a small fee.</p></div></div>
            </div>
            <Link href="/yard-sanitizing-deodorizing/" style={{ color: "#4F9E3A", fontWeight: 700, fontSize: 15, textDecoration: "none" }}>Learn about sanitizing &amp; deodorizing →</Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ background: "#F6F5EF", padding: "80px 0" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 42 }}><div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 12 }}>Residential FAQ</div><h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 34, letterSpacing: "-0.02em", margin: 0 }}>Good to know</h2></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {faqData.map((f, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid #ece9df", borderRadius: 14, overflow: "hidden" }}>
                <div style={{ width: "100%", textAlign: "left", padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, color: "#1C2A33" }}><span>{f.q}</span><span style={{ color: "#4F9E3A", fontSize: 22, flex: "none" }}>−</span></div>
                <div style={{ padding: "0 24px 22px", fontSize: 15, lineHeight: 1.6, color: "#475259" }}>{f.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: "linear-gradient(160deg,#1F4566,#14304A)", color: "#fff", padding: "74px 0" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 28px", textAlign: "center" }}>
          <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 38, lineHeight: 1.05, letterSpacing: "-0.02em", margin: "0 0 16px" }}>Ready for a yard you can actually enjoy?</h2>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: "#c4d2df", margin: "0 0 30px" }}>Get your free Toledo-area quote in about a minute — then let our family handle the rest.</p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/free-quote/" className="hov-cta" style={{ background: "#4F9E3A", color: "#fff", textDecoration: "none", padding: "17px 34px", borderRadius: 12, fontWeight: 800, fontSize: 17, boxShadow: "0 14px 28px -12px rgba(79,158,58,.7)" }}>Get My Free Quote</Link>
            <a href="tel:419-262-2371" style={{ background: "rgba(255,255,255,.12)", border: "1.5px solid rgba(255,255,255,.32)", color: "#fff", textDecoration: "none", padding: "17px 30px", borderRadius: 12, fontWeight: 700, fontSize: 17 }}>Call 419-262-2371</a>
          </div>
        </div>
      </section>
    </div>
  );
}
