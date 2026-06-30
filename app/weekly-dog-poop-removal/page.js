import Link from "next/link";

export const metadata = {
  title: "Weekly Dog Poop Removal in Toledo, Sylvania & Perrysburg | Ohio Pet Waste Pros",
  description:
    "Weekly dog poop removal in Toledo, Sylvania, Perrysburg & NW Ohio. Our most popular plan — a dependable once-a-week visit with gate photos, double-bagging and text updates. No contracts.",
  alternates: { canonical: "/weekly-dog-poop-removal/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    title: "Weekly Dog Poop Removal | Ohio Pet Waste Pros",
    description:
      "A dependable once-a-week pooper scooper visit across Greater Toledo & SE Michigan.",
    url: "https://ohiopetwastepros.com/weekly-dog-poop-removal/",
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
  serviceType: "Weekly dog poop removal",
  provider: {
    "@type": "LocalBusiness",
    name: "Ohio Pet Waste Pros",
    telephone: "+14192622371",
    areaServed: "Greater Toledo, OH and SE Michigan",
  },
  areaServed: ["Toledo OH", "Sylvania OH", "Perrysburg OH", "Maumee OH", "Holland OH"],
  description:
    "Once-a-week residential dog waste removal with gate photos, double-bagging and text updates. Ohio Pet Waste Pros' most popular plan. No contracts.",
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Why is weekly the most popular plan?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A once-a-week visit keeps waste from ever building up, which controls odor, flies and bacteria and keeps the yard usable year-round. It's the easiest schedule to stay ahead of, especially for one- and two-dog homes.",
      },
    },
    {
      "@type": "Question",
      name: "Do I need to be home for weekly service?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No. As long as we have safe access to your yard, we complete the visit while you're away and text you with a gate photo when we're done.",
      },
    },
    {
      "@type": "Question",
      name: "Is there a contract for weekly service?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No contracts. Keep weekly service as long as it's helpful, and pause, skip or adjust anytime through your client portal.",
      },
    },
  ],
};

const faqData = [
  {
    q: "Why is weekly the most popular plan?",
    a: "A once-a-week visit keeps waste from ever building up, which controls odor, flies and bacteria and keeps the yard usable year-round. It’s the easiest schedule to stay ahead of, especially for one- and two-dog homes.",
  },
  {
    q: "Do I need to be home for weekly service?",
    a: "No. As long as we have safe access to your yard, we complete the visit while you’re away and text you with a gate photo when we’re done.",
  },
  {
    q: "Is there a contract for weekly service?",
    a: "No contracts. Keep weekly service as long as it’s helpful, and pause, skip or adjust anytime through your client portal.",
  },
  {
    q: "What if I have more than two dogs?",
    a: "Weekly still works great for larger households — we simply tailor the visit to the number of dogs and the size of your yard. If buildup is heavy, we may suggest sanitizing as an add-on.",
  },
];

export default function WeeklyPage() {
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
            gridTemplateColumns: "1.08fr 0.92fr",
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
                background: "#4F9E3A",
                borderRadius: 99,
                padding: "7px 15px",
                fontSize: 12.5,
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "#fff",
                marginBottom: 22,
              }}
            >
              ★ Most popular plan
            </div>
            <h1
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 800,
                fontSize: 50,
                lineHeight: 1.0,
                letterSpacing: "-0.025em",
                margin: "0 0 20px",
              }}
            >
              Weekly cleanups, so the yard never gets behind.
            </h1>
            <p
              style={{
                fontSize: 18,
                lineHeight: 1.55,
                color: "#c4d2df",
                margin: "0 0 30px",
                maxWidth: 510,
              }}
            >
              A dependable once-a-week visit is the easiest way to keep your yard clean, safe and odor-free across Toledo, Sylvania, Perrysburg and the surrounding area — with a gate photo after every cleanup.
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
              src="/assets/photos/scooping-bell.jpg"
              alt="Ohio Pet Waste Pros technician on a weekly dog poop removal visit in Toledo"
              style={{
                width: "100%",
                aspectRatio: "4/3",
                objectFit: "cover",
                borderRadius: 20,
                boxShadow: "0 30px 60px -26px rgba(0,0,0,.6)",
              }}
            />
          </div>
        </div>
      </section>

      {/* THE BASICS */}
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
            The basics
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
            What weekly service looks like
          </h2>
          <p style={{ fontSize: 18, lineHeight: 1.6, color: "#475259", margin: 0 }}>
            We come to your home <strong>once every week</strong>, on a consistent day, and remove all the dog waste from your yard. Because we never let more than a few days go by, the yard stays usable, the smell stays down, and you never face a big buildup. It&apos;s the plan most one- and two-dog households choose — and the safest starting point if you&apos;re not sure how often you need us.
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
              Every visit includes
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
              Done right, every single week
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
                🗓️
              </div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>
                Same day each week
              </h3>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>
                A consistent weekly route you can count on, rain or shine.
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
                📷
              </div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>
                Gate photo proof
              </h3>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>
                A photo of your closed gate after every cleanup, so pets stay secure.
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
                ♻️
              </div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>
                Double-bagged disposal
              </h3>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>
                Waste is double-bagged and placed in your bin — clean and odor-free.
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
                💬
              </div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, margin: "0 0 8px" }}>
                Text updates
              </h3>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "#aebfce" }}>
                A quick heads-up when we finish keeps you in the loop every week.
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
            gridTemplateColumns: "0.9fr 1.1fr",
            gap: 50,
            alignItems: "center",
          }}
        >
          <div>
            <img
              src="/assets/photos/we-scoop-banner.jpg"
              alt="Clean NW Ohio backyard maintained with weekly dog waste removal"
              style={{
                width: "100%",
                aspectRatio: "4/3",
                objectFit: "cover",
                borderRadius: 20,
                boxShadow: "0 24px 48px -24px rgba(20,48,74,.4)",
              }}
            />
          </div>
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
              Weekly is the right fit if…
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
                <span style={{ color: "#4F9E3A", fontSize: 20, fontWeight: 800 }}>✓</span>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#36424b" }}>
                  You have <strong>one or two dogs</strong> and use the yard regularly.
                </p>
              </div>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
                <span style={{ color: "#4F9E3A", fontSize: 20, fontWeight: 800 }}>✓</span>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#36424b" }}>
                  You want the yard <strong>consistently ready</strong> — for kids, guests or mowing.
                </p>
              </div>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
                <span style={{ color: "#4F9E3A", fontSize: 20, fontWeight: 800 }}>✓</span>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#36424b" }}>
                  You&apos;d rather <strong>never think about it</strong> than catch up later.
                </p>
              </div>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
                <span style={{ color: "#4F9E3A", fontSize: 20, fontWeight: 800 }}>✓</span>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#36424b" }}>
                  You&apos;re <strong>not sure which plan to pick</strong> — this is the safe default.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARE */}
      <section style={{ background: "#F6F5EF", padding: "82px 0" }}>
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
              Not quite right?
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
              Compare the other options
            </h2>
          </div>
          <div
            className="opwp-g3"
            style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}
          >
            <Link
              href="/bi-weekly-dog-poop-removal/"
              style={{
                textDecoration: "none",
                color: "inherit",
                background: "#fff",
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
                Every other week for low-traffic yards. Compare before you decide.
              </p>
              <span style={{ color: "#4F9E3A", fontWeight: 700, fontSize: 14 }}>Learn more &rarr;</span>
            </Link>
            <Link
              href="/one-time-yard-cleanup/"
              style={{
                textDecoration: "none",
                color: "inherit",
                background: "#fff",
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
                Reset a built-up yard, then start recurring service.
              </p>
              <span style={{ color: "#4F9E3A", fontWeight: 700, fontSize: 14 }}>Learn more &rarr;</span>
            </Link>
            <Link
              href="/yard-sanitizing-deodorizing/"
              style={{
                textDecoration: "none",
                color: "inherit",
                background: "#fff",
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
                Add-on
              </div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 20, margin: "0 0 8px" }}>
                Sanitizing &amp; Deodorizing
              </h3>
              <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5, color: "#5b6770" }}>
                Add pet-safe odor &amp; bacteria control to your weekly visits.
              </p>
              <span style={{ color: "#4F9E3A", fontWeight: 700, fontSize: 14 }}>Learn more &rarr;</span>
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ background: "#fff", padding: "80px 0" }}>
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
              Weekly FAQ
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
                  background: "#F6F5EF",
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
            Start weekly service today.
          </h2>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: "#c4d2df", margin: "0 0 30px" }}>
            Get your free Toledo-area quote in about a minute — no contracts, cancel anytime.
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
