import Link from "next/link";

export const metadata = {
  title: "Yard Sanitizing & Deodorizing in Toledo, Sylvania & Perrysburg | Ohio Pet Waste Pros",
  description:
    "Pet-safe yard sanitizing & deodorizing in Toledo, Sylvania, Perrysburg & NW Ohio. Pickup removes the waste — our treatment removes the smell and bacteria. Add it to any weekly, bi-weekly or one-time service.",
  alternates: { canonical: "/yard-sanitizing-deodorizing/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    title: "Yard Sanitizing & Deodorizing | Ohio Pet Waste Pros",
    description:
      "Pet-safe odor and bacteria control for NW Ohio yards — an add-on to any dog waste removal plan.",
    url: "https://ohiopetwastepros.com/yard-sanitizing-deodorizing/",
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
  serviceType: "Yard sanitizing and deodorizing",
  provider: {
    "@type": "LocalBusiness",
    name: "Ohio Pet Waste Pros",
    telephone: "+14192622371",
    areaServed: "Greater Toledo, OH and SE Michigan",
  },
  areaServed: ["Toledo OH", "Sylvania OH", "Perrysburg OH", "Maumee OH", "Holland OH"],
  description:
    "Pet-safe yard sanitizing and deodorizing that neutralizes odor and reduces bacteria after dog waste removal. Available as an add-on to weekly, bi-weekly and one-time service.",
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Is sanitizing a substitute for poop removal?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No. Sanitizing and deodorizing happens after the waste is picked up. Pickup clears the yard; the treatment tackles the lingering odor and bacteria that scooping alone leaves behind.",
      },
    },
    {
      "@type": "Question",
      name: "Is the treatment safe for my pets and kids?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. We use a pet-safe solution and let treated areas dry before pets and children return, typically a short time after application.",
      },
    },
    {
      "@type": "Question",
      name: "How often should I add sanitizing?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "It depends on how heavily the yard is used and how strong the odor is. Many multi-dog homes add it to every visit in summer, while others use it monthly or seasonally.",
      },
    },
  ],
};

const faqData = [
  {
    q: "Is sanitizing a substitute for poop removal?",
    a: "No. Sanitizing and deodorizing happens after the waste is picked up. Pickup clears the yard; the treatment tackles the lingering odor and bacteria that scooping alone leaves behind.",
  },
  {
    q: "Is the treatment safe for my pets and kids?",
    a: "Yes. We use a pet-safe solution and let treated areas dry before pets and children return to those spots — usually a short time after application.",
  },
  {
    q: "How often should I add sanitizing?",
    a: "It depends on how heavily the yard is used and how strong the odor is. Many multi-dog homes add it to every visit in summer, while others use it monthly or seasonally.",
  },
  {
    q: "Will it completely remove the smell?",
    a: "It significantly reduces odor and freshens the yard, especially when paired with consistent cleanup. The more regularly waste is removed and treated, the better the result.",
  },
];

export default function SanitizingPage() {
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
        <div
          className="opwp-gsplit"
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "64px 28px 70px",
            display: "grid",
            gridTemplateColumns: "1.05fr 0.95fr",
            gap: 50,
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                border: "1px solid rgba(255,255,255,.22)",
                borderRadius: 99,
                padding: "7px 15px",
                fontSize: 12.5,
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "#cdd8e2",
                marginBottom: 22,
              }}
            >
              Add-on treatment
            </div>
            <h1
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 800,
                fontSize: 48,
                lineHeight: 1.0,
                letterSpacing: "-0.025em",
                margin: "0 0 20px",
              }}
            >
              A yard that doesn&apos;t just look clean — it smells clean.
            </h1>
            <p
              style={{
                fontSize: 18,
                lineHeight: 1.55,
                color: "#c4d2df",
                margin: "0 0 30px",
                maxWidth: 520,
              }}
            >
              Scooping removes the waste. Our pet-safe sanitizing and deodorizing treatment removes what&apos;s left behind — the odor and bacteria that linger in grass, turf, patios and high-traffic spots across Toledo, Sylvania and Perrysburg.
            </p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Link
                href="/free-quote/"
                className="hov-cta"
                style={{
                  background: "#4F9E3A",
                  color: "#fff",
                  textDecoration: "none",
                  padding: "16px 30px",
                  borderRadius: 11,
                  fontWeight: 800,
                  fontSize: 16.5,
                  boxShadow: "0 12px 26px -10px rgba(79,158,58,.7)",
                }}
              >
                Get My Free Quote
              </Link>
              <a
                href="tel:419-262-2371"
                style={{
                  background: "rgba(255,255,255,.1)",
                  border: "1.5px solid rgba(255,255,255,.3)",
                  color: "#fff",
                  textDecoration: "none",
                  padding: "16px 28px",
                  borderRadius: 11,
                  fontWeight: 700,
                  fontSize: 16.5,
                }}
              >
                Call 419-262-2371
              </a>
            </div>
          </div>
          <div>
            <img
              src="/assets/photos/craig-deodorizing.jpg"
              alt="Ohio Pet Waste Pros owner applying pet-safe yard deodorizing treatment in a NW Ohio yard"
              style={{
                width: "100%",
                aspectRatio: "4/5",
                objectFit: "cover",
                objectPosition: "center",
                borderRadius: 20,
                boxShadow: "0 30px 60px -26px rgba(0,0,0,.6)",
              }}
            />
          </div>
        </div>
      </section>

      {/* WHY */}
      <section style={{ background: "#fff", padding: "82px 0" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 28px", textAlign: "center" }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "#658461",
              marginBottom: 14,
            }}
          >
            Why it matters
          </div>
          <h2
            style={{
              fontFamily: "'Bricolage Grotesque'",
              fontWeight: 700,
              fontSize: 34,
              lineHeight: 1.12,
              letterSpacing: "-0.02em",
              margin: "0 0 18px",
            }}
          >
            If smell is the real complaint, pickup alone won&apos;t fix it.
          </h2>
          <p style={{ fontSize: 18, lineHeight: 1.6, color: "#475259", margin: 0 }}>
            Dog waste leaves bacteria and odor compounds behind in the soil and on hard surfaces — long after the visible mess is gone. That&apos;s what you smell on a warm afternoon, and it&apos;s what keeps a &quot;clean&quot; yard from feeling usable. Our treatment targets it at the source.
          </p>
        </div>
      </section>

      {/* WHAT'S INCLUDED */}
      <section style={{ background: "#14304A", color: "#fff", padding: "80px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 46 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "#8fb0d0",
                marginBottom: 12,
              }}
            >
              What&apos;s included
            </div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: 34,
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              What the treatment does
            </h2>
          </div>
          <div
            className="opwp-g4"
            style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }}
          >
            <div
              style={{
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.1)",
                borderRadius: 18,
                padding: 26,
              }}
            >
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 12,
                  background: "#4F9E3A",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 23,
                  marginBottom: 16,
                }}
              >
                🌿
              </div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>
                Neutralizes odor
              </h3>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>
                Breaks down odor at the source instead of just masking it with fragrance.
              </p>
            </div>
            <div
              style={{
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.1)",
                borderRadius: 18,
                padding: 26,
              }}
            >
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 12,
                  background: "#4F9E3A",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 23,
                  marginBottom: 16,
                }}
              >
                🦠
              </div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>
                Reduces bacteria
              </h3>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>
                A pet-safe solution cuts the bacteria left behind in active yard areas.
              </p>
            </div>
            <div
              style={{
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.1)",
                borderRadius: 18,
                padding: 26,
              }}
            >
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 12,
                  background: "#4F9E3A",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 23,
                  marginBottom: 16,
                }}
              >
                🎯
              </div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>
                Targets hot spots
              </h3>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>
                Focuses on the zones where buildup and smell are strongest — potty corners, turf and patios.
              </p>
            </div>
            <div
              style={{
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.1)",
                borderRadius: 18,
                padding: 26,
              }}
            >
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 12,
                  background: "#4F9E3A",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 23,
                  marginBottom: 16,
                }}
              >
                ✨
              </div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>
                Lasting freshness
              </h3>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>
                Applied after each cleanup so the yard stays fresh between visits, not just right after.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* BEST FOR */}
      <section style={{ background: "#fff", padding: "82px 0" }}>
        <div
          className="opwp-gsplit"
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "0 28px",
            display: "grid",
            gridTemplateColumns: "1.1fr 0.9fr",
            gap: 50,
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "#658461",
                marginBottom: 12,
              }}
            >
              Best for
            </div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: 34,
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                margin: "0 0 22px",
              }}
            >
              Yards where odor is the main problem
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
                <span style={{ color: "#4F9E3A", fontSize: 20, fontWeight: 800 }}>✓</span>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#36424b" }}>
                  <strong>Multi-dog households</strong> where buildup and smell accumulate fast.
                </p>
              </div>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
                <span style={{ color: "#4F9E3A", fontSize: 20, fontWeight: 800 }}>✓</span>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#36424b" }}>
                  <strong>Turf and small yards</strong> that trap odor and don&apos;t drain like natural grass.
                </p>
              </div>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
                <span style={{ color: "#4F9E3A", fontSize: 20, fontWeight: 800 }}>✓</span>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#36424b" }}>
                  <strong>Patios, decks &amp; hard surfaces</strong> where waste residue lingers.
                </p>
              </div>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
                <span style={{ color: "#4F9E3A", fontSize: 20, fontWeight: 800 }}>✓</span>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#36424b" }}>
                  <strong>Warm-weather months</strong> when Ohio humidity makes odor worse.
                </p>
              </div>
            </div>
          </div>
          <div>
            <img
              src="/assets/photos/craig-sanitizing-spray.jpg"
              alt="Ohio Pet Waste Pros owner applying pet-safe yard sanitizing treatment with a sprayer"
              style={{
                width: "100%",
                aspectRatio: "4/5",
                objectFit: "cover",
                borderRadius: 20,
                boxShadow: "0 24px 48px -24px rgba(20,48,74,.4)",
              }}
            />
          </div>
        </div>
      </section>

      {/* HOW TO START */}
      <section style={{ background: "#F6F5EF", padding: "82px 0" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 46 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "#658461",
                marginBottom: 12,
              }}
            >
              How to start
            </div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: 34,
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              Adding it is simple
            </h2>
          </div>
          <div
            className="opwp-g3"
            style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 22 }}
          >
            <div style={{ background: "#fff", border: "1px solid #ece9df", borderRadius: 18, padding: 30 }}>
              <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 30, color: "#4F9E3A", marginBottom: 12 }}>
                1
              </div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 19, margin: "0 0 8px" }}>
                Pick your base plan
              </h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "#5b6770" }}>
                Choose weekly, bi-weekly or a one-time cleanup as your foundation.
              </p>
            </div>
            <div style={{ background: "#fff", border: "1px solid #ece9df", borderRadius: 18, padding: 30 }}>
              <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 30, color: "#4F9E3A", marginBottom: 12 }}>
                2
              </div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 19, margin: "0 0 8px" }}>
                Add the treatment
              </h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "#5b6770" }}>
                Add sanitizing &amp; deodorizing to your quote — pricing depends on how many dogs you have and how often you&apos;d like service — get your exact price with our instant quote.
              </p>
            </div>
            <div style={{ background: "#fff", border: "1px solid #ece9df", borderRadius: 18, padding: 30 }}>
              <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 30, color: "#4F9E3A", marginBottom: 12 }}>
                3
              </div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 19, margin: "0 0 8px" }}>
                We treat after each scoop
              </h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "#5b6770" }}>
                Once the yard&apos;s clean, we apply the treatment to your high-use areas.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARE */}
      <section style={{ background: "#fff", padding: "82px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "#658461",
                marginBottom: 12,
              }}
            >
              Pair it with a plan
            </div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: 34,
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              Choose your base service
            </h2>
          </div>
          <div
            className="opwp-g3"
            style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}
          >
            <Link
              href="/weekly-dog-poop-removal/"
              className="hov-cta"
              style={{
                textDecoration: "none",
                color: "inherit",
                border: "1px solid #ece9df",
                borderRadius: 16,
                padding: 26,
                display: "block",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "#4F9E3A",
                  marginBottom: 8,
                }}
              >
                Most popular
              </div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 20, margin: "0 0 8px" }}>
                Weekly Cleanups
              </h3>
              <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: "#5b6770" }}>
                The safest starting point — keeps the yard from ever getting behind.
              </p>
              <span style={{ color: "#4F9E3A", fontWeight: 700, fontSize: 14 }}>Learn more &rarr;</span>
            </Link>
            <Link
              href="/bi-weekly-dog-poop-removal/"
              className="hov-cta"
              style={{
                textDecoration: "none",
                color: "inherit",
                border: "1px solid #ece9df",
                borderRadius: 16,
                padding: 26,
                display: "block",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "#658461",
                  marginBottom: 8,
                }}
              >
                Lighter use
              </div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 20, margin: "0 0 8px" }}>
                Bi-Weekly Cleanups
              </h3>
              <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: "#5b6770" }}>
                Every-other-week service for yards that don&apos;t need a weekly visit.
              </p>
              <span style={{ color: "#4F9E3A", fontWeight: 700, fontSize: 14 }}>Learn more &rarr;</span>
            </Link>
            <Link
              href="/one-time-yard-cleanup/"
              className="hov-cta"
              style={{
                textDecoration: "none",
                color: "inherit",
                border: "1px solid #ece9df",
                borderRadius: 16,
                padding: 26,
                display: "block",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "#658461",
                  marginBottom: 8,
                }}
              >
                Fresh start
              </div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 20, margin: "0 0 8px" }}>
                One-Time Cleanup
              </h3>
              <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: "#5b6770" }}>
                Reset a built-up yard before guests, a move, or recurring service.
              </p>
              <span style={{ color: "#4F9E3A", fontWeight: 700, fontSize: 14 }}>Learn more &rarr;</span>
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ background: "#F6F5EF", padding: "80px 0" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 42 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "#658461",
                marginBottom: 12,
              }}
            >
              Sanitizing FAQ
            </div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: 34,
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              Good to know
            </h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {faqData.map((f, i) => (
              <div
                key={i}
                style={{
                  background: "#fff",
                  border: "1px solid #ece9df",
                  borderRadius: 14,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "20px 24px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                    fontFamily: "'Bricolage Grotesque'",
                    fontWeight: 700,
                    fontSize: 17,
                    color: "#1C2A33",
                  }}
                >
                  <span>{f.q}</span>
                  <span style={{ color: "#4F9E3A", fontSize: 22, flex: "none" }}>−</span>
                </div>
                <div style={{ padding: "0 24px 22px", fontSize: 15, lineHeight: 1.6, color: "#475259" }}>
                  {f.a}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: "linear-gradient(160deg,#1F4566,#14304A)", color: "#fff", padding: "74px 0" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 28px", textAlign: "center" }}>
          <h2
            style={{
              fontFamily: "'Bricolage Grotesque'",
              fontWeight: 800,
              fontSize: 38,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              margin: "0 0 16px",
            }}
          >
            Ready for a yard that&apos;s fresh, not just clean?
          </h2>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: "#c4d2df", margin: "0 0 30px" }}>
            Get your free quote and add sanitizing &amp; deodorizing to any plan.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Link
              href="/free-quote/"
              className="hov-cta"
              style={{
                background: "#4F9E3A",
                color: "#fff",
                textDecoration: "none",
                padding: "17px 34px",
                borderRadius: 12,
                fontWeight: 800,
                fontSize: 17,
                boxShadow: "0 14px 28px -12px rgba(79,158,58,.7)",
              }}
            >
              Get My Free Quote
            </Link>
            <a
              href="tel:419-262-2371"
              style={{
                background: "rgba(255,255,255,.12)",
                border: "1.5px solid rgba(255,255,255,.32)",
                color: "#fff",
                textDecoration: "none",
                padding: "17px 30px",
                borderRadius: 12,
                fontWeight: 700,
                fontSize: 17,
              }}
            >
              Call 419-262-2371
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
