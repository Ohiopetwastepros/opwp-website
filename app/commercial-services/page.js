import Link from "next/link";

export const metadata = {
  title:
    "Commercial Pet Waste Removal & Stations for HOAs & Apartments | Ohio Pet Waste Pros",
  description:
    "Commercial pet waste removal in Greater Toledo. We install & maintain pet waste stations and provide recurring cleanups & sanitizing for HOAs, apartment complexes, condos & businesses across NW Ohio.",
  alternates: { canonical: "/commercial-services/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    title:
      "Commercial Pet Waste Services for HOAs & Apartments | Ohio Pet Waste Pros",
    description:
      "Pet waste stations, recurring cleanups & sanitizing for HOAs, apartments and businesses across Greater Toledo.",
    url: "https://ohiopetwastepros.com/commercial-services/",
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

const serviceLd = {
  "@context": "https://schema.org",
  "@type": "Service",
  serviceType: "Commercial pet waste removal and pet waste stations",
  provider: {
    "@type": "LocalBusiness",
    name: "Ohio Pet Waste Pros",
    telephone: "+14192622371",
  },
  areaServed: [
    "Toledo OH",
    "Sylvania OH",
    "Perrysburg OH",
    "Maumee OH",
    "Holland OH",
  ],
  description:
    "Pet waste station installation and maintenance plus recurring cleanups and sanitizing for HOAs, apartment complexes and commercial properties.",
};

const faqLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Do you install pet waste stations?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. We customize, install and maintain pet waste stations — keeping them stocked with bags and emptied on a regular schedule so common areas stay clean.",
      },
    },
    {
      "@type": "Question",
      name: "What types of properties do you serve?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "We serve HOAs, apartment and condo communities, property managers, parks and businesses throughout the Greater Toledo area and SE Michigan.",
      },
    },
    {
      "@type": "Question",
      name: "How is commercial pricing determined?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Pricing depends on how many dogs you have and how often you'd like service — get your exact price with our instant quote.",
      },
    },
  ],
};

const faqData = [
  {
    q: "Do you install pet waste stations?",
    a: "Yes. We customize, install and maintain pet waste stations — keeping them stocked with bags and emptied on a regular schedule so your common areas stay clean and odor-free.",
  },
  {
    q: "What types of properties do you serve?",
    a: "We serve HOAs, apartment and condo communities, property managers, parks and businesses throughout the Greater Toledo area and SE Michigan.",
  },
  {
    q: "How is commercial pricing determined?",
    a: "Pricing depends on how many dogs you have and how often you'd like service — get your exact price with our instant quote.",
  },
  {
    q: "Can you work with our existing schedule and vendors?",
    a: "Absolutely. We’ll coordinate around your community’s needs and keep communication simple for your management team and residents.",
  },
];

export default function CommercialServicesPage() {
  return (
    <div
      style={{ fontFamily: "'Hanken Grotesk',sans-serif", color: "#1C2A33" }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />

      <section
        style={{
          background: "linear-gradient(160deg,#1F4566,#1A3C5A 55%,#14304A)",
          color: "#fff",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "66px 28px 74px",
            display: "grid",
            gridTemplateColumns: "1.08fr 0.92fr",
            gap: 50,
            alignItems: "center",
          }}
          className="opwp-gsplit"
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
              HOAs · Apartments · Businesses
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
              Cleaner common areas, happier residents.
            </h1>
            <p
              style={{
                fontSize: 18,
                lineHeight: 1.55,
                color: "#c4d2df",
                margin: "0 0 30px",
                maxWidth: 500,
              }}
            >
              We install and maintain pet waste stations and provide recurring
              cleanups and sanitizing for HOAs, apartment communities and
              businesses across Greater Toledo and SE Michigan.
            </p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Link
                href="/contact/"
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
                Request a Commercial Quote
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
              src="/assets/photos/we-scoop-banner.jpg"
              alt="Ohio Pet Waste Pros commercial pet waste removal service"
              style={{
                width: "100%",
                aspectRatio: "4/5",
                objectFit: "cover",
                borderRadius: 20,
                boxShadow: "0 30px 60px -26px rgba(0,0,0,.6)",
              }}
            />
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section style={{ background: "#fff", padding: "82px 0" }}>
        <div
          style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}
        >
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
              What we offer
            </div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: 36,
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              Commercial pet waste solutions
            </h2>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: 22,
            }}
            className="opwp-g3"
          >
            <div
              style={{
                background: "#F6F5EF",
                borderRadius: 18,
                padding: 30,
              }}
            >
              <div style={{ fontSize: 30, marginBottom: 14 }}>🗑️</div>
              <h3
                style={{
                  fontFamily: "'Bricolage Grotesque'",
                  fontWeight: 700,
                  fontSize: 20,
                  margin: "0 0 10px",
                }}
              >
                Pet waste stations
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: 14.5,
                  lineHeight: 1.55,
                  color: "#475259",
                }}
              >
                We customize, install and maintain pet waste stations — kept
                stocked with bags and emptied on a regular schedule.
              </p>
            </div>
            <div
              style={{
                background: "#F6F5EF",
                borderRadius: 18,
                padding: 30,
              }}
            >
              <div style={{ fontSize: 30, marginBottom: 14 }}>🧹</div>
              <h3
                style={{
                  fontFamily: "'Bricolage Grotesque'",
                  fontWeight: 700,
                  fontSize: 20,
                  margin: "0 0 10px",
                }}
              >
                Recurring cleanups
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: 14.5,
                  lineHeight: 1.55,
                  color: "#475259",
                }}
              >
                Scheduled common-area cleanups that keep your grounds clean,
                safe and welcoming for residents and guests.
              </p>
            </div>
            <div
              style={{
                background: "#F6F5EF",
                borderRadius: 18,
                padding: 30,
              }}
            >
              <div style={{ fontSize: 30, marginBottom: 14 }}>🧴</div>
              <h3
                style={{
                  fontFamily: "'Bricolage Grotesque'",
                  fontWeight: 700,
                  fontSize: 20,
                  margin: "0 0 10px",
                }}
              >
                Sanitizing treatments
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: 14.5,
                  lineHeight: 1.55,
                  color: "#475259",
                }}
              >
                Pet-safe sanitizing for dog parks, runs and high-traffic areas
                to reduce bacteria and odor.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* WHO WE SERVE */}
      <section
        style={{ background: "#14304A", color: "#fff", padding: "78px 0" }}
      >
        <div
          style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}
        >
          <div style={{ textAlign: "center", marginBottom: 42 }}>
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
              Who we serve
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
              Trusted by communities across NW Ohio
            </h2>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: 16,
            }}
            className="opwp-g4"
          >
            <div
              style={{
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.1)",
                borderRadius: 14,
                padding: 24,
                textAlign: "center",
                fontWeight: 700,
                fontSize: 15.5,
              }}
            >
              🏘️ HOAs &amp; condos
            </div>
            <div
              style={{
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.1)",
                borderRadius: 14,
                padding: 24,
                textAlign: "center",
                fontWeight: 700,
                fontSize: 15.5,
              }}
            >
              🏢 Apartment communities
            </div>
            <div
              style={{
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.1)",
                borderRadius: 14,
                padding: 24,
                textAlign: "center",
                fontWeight: 700,
                fontSize: 15.5,
              }}
            >
              🌳 Parks &amp; dog parks
            </div>
            <div
              style={{
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.1)",
                borderRadius: 14,
                padding: 24,
                textAlign: "center",
                fontWeight: 700,
                fontSize: 15.5,
              }}
            >
              🏬 Businesses &amp; offices
            </div>
          </div>
        </div>
      </section>

      {/* WHY */}
      <section style={{ background: "#fff", padding: "82px 0" }}>
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "0 28px",
            display: "grid",
            gridTemplateColumns: "1.1fr 0.9fr",
            gap: 50,
            alignItems: "center",
          }}
          className="opwp-gsplit"
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
              Why property managers choose us
            </div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: 34,
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                margin: "0 0 20px",
              }}
            >
              Reliable, professional, and easy to work with
            </h2>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 15,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 13,
                  alignItems: "flex-start",
                }}
              >
                <span style={{ color: "#4F9E3A", fontSize: 18 }}>✓</span>
                <span
                  style={{
                    fontSize: 15.5,
                    lineHeight: 1.5,
                    color: "#36424b",
                  }}
                >
                  <strong>Dependable schedules</strong> your residents can count
                  on.
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 13,
                  alignItems: "flex-start",
                }}
              >
                <span style={{ color: "#4F9E3A", fontSize: 18 }}>✓</span>
                <span
                  style={{
                    fontSize: 15.5,
                    lineHeight: 1.5,
                    color: "#36424b",
                  }}
                >
                  <strong>Fully insured</strong> and locally owned in Holland,
                  OH.
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 13,
                  alignItems: "flex-start",
                }}
              >
                <span style={{ color: "#4F9E3A", fontSize: 18 }}>✓</span>
                <span
                  style={{
                    fontSize: 15.5,
                    lineHeight: 1.5,
                    color: "#36424b",
                  }}
                >
                  <strong>Clear communication</strong> and simple, flexible
                  billing.
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 13,
                  alignItems: "flex-start",
                }}
              >
                <span style={{ color: "#4F9E3A", fontSize: 18 }}>✓</span>
                <span
                  style={{
                    fontSize: 15.5,
                    lineHeight: 1.5,
                    color: "#36424b",
                  }}
                >
                  <strong>Eco-friendly</strong> disposal and sanitizing.
                </span>
              </div>
            </div>
          </div>
          <div>
            <img
              src="/assets/photos/team-maumee-river.jpg"
              alt="The Ohio Pet Waste Pros team"
              style={{
                width: "100%",
                aspectRatio: "4/3",
                objectFit: "cover",
                borderRadius: 20,
                boxShadow: "0 24px 48px -24px rgba(20,48,74,.4)",
              }}
            />
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
              Commercial FAQ
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
              Questions from property managers
            </h2>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
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
                <button
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
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
                  <span
                    style={{ color: "#4F9E3A", fontSize: 22, flex: "none" }}
                  >
                    −
                  </span>
                </button>
                <div
                  style={{
                    padding: "0 24px 22px",
                    fontSize: 15,
                    lineHeight: 1.6,
                    color: "#475259",
                  }}
                >
                  {f.a}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        style={{
          background: "linear-gradient(160deg,#1F4566,#14304A)",
          color: "#fff",
          padding: "74px 0",
        }}
      >
        <div
          style={{
            maxWidth: 880,
            margin: "0 auto",
            padding: "0 28px",
            textAlign: "center",
          }}
        >
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
            Let&apos;s keep your community clean.
          </h2>
          <p
            style={{
              fontSize: 18,
              lineHeight: 1.55,
              color: "#c4d2df",
              margin: "0 0 30px",
            }}
          >
            Get a free, no-obligation commercial quote for your HOA, apartment
            community or business.
          </p>
          <div
            style={{
              display: "flex",
              gap: 14,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/contact/"
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
              Request a Commercial Quote
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
