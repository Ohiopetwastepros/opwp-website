import Link from "next/link";

export const metadata = {
  title: "Bi-Weekly Dog Poop Removal in Toledo, Sylvania & Perrysburg | Ohio Pet Waste Pros",
  description: "Bi-weekly (every-other-week) dog poop removal in Toledo, Sylvania, Perrysburg & NW Ohio. A lighter-frequency plan for low-traffic yards — with gate photos, double-bagging and text updates. No contracts.",
  alternates: { canonical: "/bi-weekly-dog-poop-removal/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    title: "Bi-Weekly Dog Poop Removal | Ohio Pet Waste Pros",
    description: "Every-other-week pooper scooper service for lighter-use yards across Greater Toledo & SE Michigan.",
    url: "https://ohiopetwastepros.com/bi-weekly-dog-poop-removal/",
    siteName: "Ohio Pet Waste Pros",
    images: ["https://ohiopetwastepros.com/wp-content/uploads/2025/05/cropped-OPWP-CIRCLE-LOGO-11111111.png"],
  },
  twitter: { card: "summary_large_image" },
  other: {
    "geo.region": "US-OH",
    "geo.placename": "Holland, Ohio",
  },
};

const serviceLd = {
  "@context": "https://schema.org",
  "@type": "Service",
  serviceType: "Bi-weekly dog poop removal",
  provider: {
    "@type": "LocalBusiness",
    name: "Ohio Pet Waste Pros",
    telephone: "+14192622371",
    areaServed: "Greater Toledo, OH and SE Michigan",
  },
  areaServed: ["Toledo OH", "Sylvania OH", "Perrysburg OH", "Maumee OH", "Holland OH"],
  description: "Every-other-week residential dog waste removal with gate photos, double-bagging and text updates. A lighter-frequency plan for low-traffic yards. No contracts.",
};

const faqLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What does bi-weekly service mean?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Bi-weekly means we visit once every two weeks (every other week) to remove all dog waste from your yard. It's a lighter-frequency option than weekly service.",
      },
    },
    {
      "@type": "Question",
      name: "Who is bi-weekly service best for?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "It works well for single-dog homes, lower-traffic yards, or households where the yard isn't used heavily. If waste builds up quickly between visits, weekly service is usually the better long-term fit.",
      },
    },
    {
      "@type": "Question",
      name: "Can I switch between bi-weekly and weekly?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. There are no contracts, so you can move up to weekly in busy months or drop back to bi-weekly anytime through your client portal.",
      },
    },
  ],
};

const faqData = [
  {
    q: "What does bi-weekly service mean?",
    a: "Bi-weekly means we visit once every two weeks (every other week) to remove all dog waste from your yard. It’s a lighter-frequency option than weekly service.",
  },
  {
    q: "Who is bi-weekly service best for?",
    a: "It works well for single-dog homes, lower-traffic yards, or households where the yard isn’t used heavily. If waste builds up quickly between visits, weekly service is usually the better long-term fit.",
  },
  {
    q: "Can I switch between bi-weekly and weekly?",
    a: "Yes. There are no contracts, so you can move up to weekly in busy months or drop back to bi-weekly anytime through your client portal.",
  },
  {
    q: "Do I need to be home?",
    a: "No. As long as we have safe access to your yard, we complete the visit while you’re away and text you a gate photo when we’re done.",
  },
];

export default function BiWeeklyPage() {
  return (
    <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", color: "#1C2A33" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />

      {/* HERO */}
      <section style={{ background: "linear-gradient(160deg,#1F4566,#1A3C5A 55%,#14304A)", color: "#fff" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "64px 28px 70px", display: "grid", gridTemplateColumns: "1.08fr 0.92fr", gap: 50, alignItems: "center" }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid rgba(255,255,255,.22)", borderRadius: 99, padding: "7px 15px", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#cdd8e2", marginBottom: 22 }}>Every-other-week service</div>
            <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 50, lineHeight: 1.0, letterSpacing: "-0.025em", margin: "0 0 20px" }}>Every-other-week cleanups for lighter-use yards.</h1>
            <p style={{ fontSize: 18, lineHeight: 1.55, color: "#c4d2df", margin: "0 0 30px", maxWidth: 510 }}>If your yard doesn&apos;t need a weekly visit, bi-weekly keeps it under control with a professional cleanup every two weeks — across Toledo, Sylvania, Perrysburg and the surrounding area, with a gate photo every time.</p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Link href="/free-quote/" className="hov-cta" style={{ background: "#4F9E3A", color: "#fff", textDecoration: "none", padding: "16px 30px", borderRadius: 11, fontWeight: 800, fontSize: 16.5, boxShadow: "0 12px 26px -10px rgba(79,158,58,.7)" }}>Get My Free Quote</Link>
              <a href="tel:419-262-2371" style={{ background: "rgba(255,255,255,.1)", border: "1.5px solid rgba(255,255,255,.3)", color: "#fff", textDecoration: "none", padding: "16px 28px", borderRadius: 11, fontWeight: 700, fontSize: 16.5 }}>Call 419-262-2371</a>
            </div>
          </div>
          <div><img src="/assets/photos/craig-standing-horizontal.webp" alt="Ohio Pet Waste Pros technician on a bi-weekly dog poop removal visit near Perrysburg" style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 20, boxShadow: "0 30px 60px -26px rgba(0,0,0,.6)" }} /></div>
        </div>
      </section>

      {/* THE BASICS */}
      <section style={{ background: "#fff", padding: "82px 0" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 28px", textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 14 }}>The basics</div>
          <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 34, lineHeight: 1.12, letterSpacing: "-0.02em", margin: "0 0 18px" }}>What bi-weekly service looks like</h2>
          <p style={{ fontSize: 18, lineHeight: 1.6, color: "#475259", margin: 0 }}>We visit your home <strong>once every two weeks</strong> and clear all the dog waste from your yard. It&apos;s the same thorough cleanup as our weekly plan — gate photo, double-bagging and a text update — just on a lighter schedule. It&apos;s a good fit when the yard sees less traffic, but keep in mind waste does accumulate more between visits than it does with weekly service.</p>
        </div>
      </section>

      {/* WHAT'S INCLUDED */}
      <section style={{ background: "#14304A", color: "#fff", padding: "80px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 46 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#8fb0d0", marginBottom: 12 }}>Every visit includes</div>
            <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 34, letterSpacing: "-0.02em", margin: 0 }}>Same care, lighter schedule</h2>
          </div>
          <div className="opwp-g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}>
            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 26 }}><div style={{ width: 46, height: 46, borderRadius: 12, background: "#4F9E3A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, marginBottom: 16 }}>🗓️</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>Every two weeks</h3><p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>A predictable every-other-week visit on a consistent day.</p></div>
            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 26 }}><div style={{ width: 46, height: 46, borderRadius: 12, background: "#4F9E3A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, marginBottom: 16 }}>📷</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>Gate photo proof</h3><p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>A photo of your closed gate after every cleanup, so pets stay secure.</p></div>
            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 26 }}><div style={{ width: 46, height: 46, borderRadius: 12, background: "#4F9E3A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, marginBottom: 16 }}>♻️</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>Double-bagged disposal</h3><p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>Waste is double-bagged and placed in your bin — clean and odor-free.</p></div>
            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 26 }}><div style={{ width: 46, height: 46, borderRadius: 12, background: "#4F9E3A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, marginBottom: 16 }}>💬</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>Text updates</h3><p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>A quick heads-up when we finish so you always know we&apos;ve been by.</p></div>
          </div>
        </div>
      </section>

      {/* WEEKLY VS BIWEEKLY */}
      <section style={{ background: "#fff", padding: "82px 0" }}>
        <div className="opwp-gsplit" style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px", display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 50, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 12 }}>Is it right for you?</div>
            <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 34, lineHeight: 1.05, letterSpacing: "-0.02em", margin: "0 0 22px" }}>Bi-weekly works best when…</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}><span style={{ color: "#4F9E3A", fontSize: 20, fontWeight: 800 }}>✓</span><p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#36424b" }}>You have a <strong>single dog</strong> or a larger, lower-use yard.</p></div>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}><span style={{ color: "#4F9E3A", fontSize: 20, fontWeight: 800 }}>✓</span><p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#36424b" }}>The yard <strong>isn&apos;t used heavily</strong> day-to-day.</p></div>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}><span style={{ color: "#4F9E3A", fontSize: 20, fontWeight: 800 }}>✓</span><p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#36424b" }}>You want professional help but a <strong>lighter budget</strong> than weekly.</p></div>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}><span style={{ color: "#E7A734", fontSize: 20, fontWeight: 800 }}>!</span><p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#36424b" }}>If buildup gets ahead of you, <Link href="/weekly-dog-poop-removal/" style={{ color: "#4F9E3A", fontWeight: 700, textDecoration: "none" }}>weekly</Link> is the better long-term choice.</p></div>
            </div>
          </div>
          <div><img src="/assets/photos/cody-scooping-vest.webp" alt="Ohio Pet Waste Pros technician double-bagging waste during a bi-weekly visit" style={{ width: "100%", aspectRatio: "4/5", objectFit: "cover", borderRadius: 20, boxShadow: "0 24px 48px -24px rgba(20,48,74,.4)" }} /></div>
        </div>
      </section>

      {/* COMPARE */}
      <section style={{ background: "#F6F5EF", padding: "82px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 12 }}>Compare options</div>
            <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 34, letterSpacing: "-0.02em", margin: 0 }}>See the other plans</h2>
          </div>
          <div className="opwp-g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
            <Link href="/weekly-dog-poop-removal/" style={{ textDecoration: "none", color: "inherit", background: "#fff", border: "2px solid #4F9E3A", borderRadius: 16, padding: 26, display: "block", boxShadow: "0 14px 30px -20px rgba(79,158,58,.5)" }}><div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#4F9E3A", marginBottom: 8 }}>Most popular</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 20, margin: "0 0 8px" }}>Weekly Cleanups</h3><p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: "#5b6770" }}>The safest starting point — keeps the yard from ever getting behind.</p><span style={{ color: "#4F9E3A", fontWeight: 700, fontSize: 14 }}>Learn more →</span></Link>
            <Link href="/one-time-yard-cleanup/" className="hov-cream" style={{ textDecoration: "none", color: "inherit", background: "#fff", border: "1px solid #ece9df", borderRadius: 16, padding: 26, display: "block" }}><div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#658461", marginBottom: 8 }}>Fresh start</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 20, margin: "0 0 8px" }}>One-Time Cleanup</h3><p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: "#5b6770" }}>Reset a built-up yard, then start recurring service.</p><span style={{ color: "#4F9E3A", fontWeight: 700, fontSize: 14 }}>Learn more →</span></Link>
            <Link href="/yard-sanitizing-deodorizing/" className="hov-cream" style={{ textDecoration: "none", color: "inherit", background: "#fff", border: "1px solid #ece9df", borderRadius: 16, padding: 26, display: "block" }}><div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#658461", marginBottom: 8 }}>Add-on</div><h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 20, margin: "0 0 8px" }}>Sanitizing &amp; Deodorizing</h3><p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: "#5b6770" }}>Add pet-safe odor &amp; bacteria control to your visits.</p><span style={{ color: "#4F9E3A", fontWeight: 700, fontSize: 14 }}>Learn more →</span></Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ background: "#fff", padding: "80px 0" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 42 }}><div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 12 }}>Bi-Weekly FAQ</div><h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 34, letterSpacing: "-0.02em", margin: 0 }}>Good to know</h2></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {faqData.map((f, i) => (
              <div key={i} style={{ background: "#F6F5EF", border: "1px solid #ece9df", borderRadius: 14, overflow: "hidden" }}>
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
          <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 38, lineHeight: 1.05, letterSpacing: "-0.02em", margin: "0 0 16px" }}>Start bi-weekly service today.</h2>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: "#c4d2df", margin: "0 0 30px" }}>Get your free Toledo-area quote in about a minute — no contracts, switch plans anytime.</p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/free-quote/" className="hov-cta" style={{ background: "#4F9E3A", color: "#fff", textDecoration: "none", padding: "17px 34px", borderRadius: 12, fontWeight: 800, fontSize: 17, boxShadow: "0 14px 28px -12px rgba(79,158,58,.7)" }}>Get My Free Quote</Link>
            <a href="tel:419-262-2371" style={{ background: "rgba(255,255,255,.12)", border: "1.5px solid rgba(255,255,255,.32)", color: "#fff", textDecoration: "none", padding: "17px 30px", borderRadius: 12, fontWeight: 700, fontSize: 17 }}>Call 419-262-2371</a>
          </div>
        </div>
      </section>
    </div>
  );
}
