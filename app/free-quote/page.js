import QuoteForm from "./QuoteForm";

export const metadata = {
  title: {
    absolute: "Get an Instant Dog Poop Removal Quote | Ohio Pet Waste Pros",
  },
  description:
    "Get an instant quote for dog poop removal in Toledo, Sylvania, Perrysburg & SE Michigan. Enter your ZIP, choose your plan, and sign up online with Ohio Pet Waste Pros.",
  alternates: { canonical: "/free-quote/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "https://ohiopetwastepros.com/free-quote/",
    siteName: "Ohio Pet Waste Pros",
    title: "Get an Instant Quote | Ohio Pet Waste Pros",
    images: [
      "https://ohiopetwastepros.com/wp-content/uploads/2025/05/cropped-OPWP-CIRCLE-LOGO-11111111.png",
    ],
  },
};

const reviews = [
  {
    text: "So far so good! Very thorough and very easy to get ahold of. Our 3 dog household couldn't be happier!",
    name: "Carrie",
  },
  {
    text: "Jacob made sure the gate was locked before he left. I'm picky and would definitely recommend Ohio Pet Waste Pros.",
    name: "Michelle",
  },
  {
    text: "On time and polite, and I loved getting the photo showing my gate closed to keep my fur baby safe.",
    name: "Charlene",
  },
];

export default function FreeQuotePage() {
  return (
    <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", color: "#1C2A33" }}>
      <section
        style={{
          background: "linear-gradient(165deg,#1F4566 0%,#1A3C5A 60%,#14304A 100%)",
          padding: "48px 0 70px",
        }}
      >
        <div style={{ maxWidth: "1180px", margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: "34px" }}>
            <img
              src="/assets/opwp-logo.png"
              alt="Ohio Pet Waste Pros"
              style={{
                width: "78px",
                height: "78px",
                background: "#fff",
                borderRadius: "50%",
                marginBottom: "14px",
              }}
            />
            <h1
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 800,
                fontSize: "40px",
                letterSpacing: "-0.02em",
                color: "#fff",
                margin: "0 0 8px",
              }}
            >
              Get an instant quote
            </h1>
            <p style={{ fontSize: "16.5px", color: "#c4d2df", margin: 0 }}>
              Enter your ZIP, pick your plan, and start service in minutes.
            </p>
          </div>

          <div
            className="opwp-gsplit"
            style={{
              display: "grid",
              gridTemplateColumns: "1.15fr 0.85fr",
              gap: "28px",
              alignItems: "start",
            }}
          >
            {/* INTERACTIVE QUOTE TOOL */}
            <QuoteForm />

            {/* REVIEWS PANEL */}
            <div
              style={{
                background: "#fff",
                borderRadius: "22px",
                padding: "30px",
                boxShadow: "0 30px 60px -28px rgba(0,0,0,.5)",
              }}
            >
              <div style={{ textAlign: "center", marginBottom: "22px" }}>
                <div
                  style={{
                    fontFamily: "'Bricolage Grotesque'",
                    fontWeight: 800,
                    fontSize: "24px",
                    color: "#1C2A33",
                    lineHeight: 1.1,
                    marginBottom: "8px",
                  }}
                >
                  Trusted by NW Ohio dog owners
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "9px" }}>
                  <span
                    style={{
                      fontFamily: "'Bricolage Grotesque'",
                      fontWeight: 800,
                      fontSize: "22px",
                      color: "#1A3C5A",
                    }}
                  >
                    5.0
                  </span>
                  <span style={{ color: "#E7A734", letterSpacing: "2px", fontSize: "18px" }}>
                    ★★★★★
                  </span>
                </div>
                <div style={{ fontSize: "13px", color: "#7c8891", marginTop: "4px" }}>
                  5.0 stars · 159 reviews
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {reviews.map((r) => (
                  <div key={r.name} style={{ background: "#F6F5EF", borderRadius: "14px", padding: "18px" }}>
                    <div style={{ color: "#E7A734", letterSpacing: "2px", fontSize: "14px", marginBottom: "8px" }}>
                      ★★★★★
                    </div>
                    <p style={{ margin: "0 0 10px", fontSize: "14px", lineHeight: 1.5, color: "#36424b" }}>
                      &quot;{r.text}&quot;
                    </p>
                    <div style={{ fontWeight: 700, fontSize: "13.5px" }}>— {r.name}</div>
                  </div>
                ))}
              </div>
              <a
                href="/"
                style={{
                  display: "block",
                  textAlign: "center",
                  marginTop: "18px",
                  color: "#4F9E3A",
                  fontWeight: 700,
                  fontSize: "14px",
                  textDecoration: "none",
                }}
              >
                Read more reviews →
              </a>
            </div>
          </div>

          <p
            style={{
              textAlign: "center",
              color: "#9fb3c4",
              fontSize: "13px",
              margin: "28px auto 0",
              maxWidth: "680px",
            }}
          >
            Prefer to talk first? Call or text{" "}
            <a href="tel:419-262-2371" style={{ color: "#fff", fontWeight: 700, textDecoration: "none" }}>
              419-262-2371
            </a>{" "}
            — we&apos;re a local, family-owned team and happy to help.
          </p>
        </div>
      </section>
    </div>
  );
}
