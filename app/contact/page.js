export const metadata = {
  title: {
    absolute: "Contact Ohio Pet Waste Pros | Free Dog Poop Removal Quote in Toledo",
  },
  description:
    "Contact Ohio Pet Waste Pros for a free dog poop removal quote in Toledo, Sylvania, Perrysburg & SE Michigan. Call or text (419) 262-2371 or request your quote online.",
  alternates: { canonical: "/contact/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "https://ohiopetwastepros.com/contact/",
    siteName: "Ohio Pet Waste Pros",
    title: "Contact Ohio Pet Waste Pros | Free Quote",
    description:
      "Call or text (419) 262-2371, or request a free dog waste removal quote online.",
    images: [
      "https://ohiopetwastepros.com/wp-content/uploads/2025/05/cropped-OPWP-CIRCLE-LOGO-11111111.png",
    ],
  },
};

const contactJsonLd = {
  "@context": "https://schema.org",
  "@type": "ContactPage",
  name: "Contact Ohio Pet Waste Pros",
  mainEntity: {
    "@type": "LocalBusiness",
    name: "Ohio Pet Waste Pros",
    telephone: "+14192622371",
    email: "Craig@ohiopetwastepros.com",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Holland",
      addressRegion: "OH",
      addressCountry: "US",
    },
    areaServed: "Greater Toledo, OH and SE Michigan",
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "09:00",
        closes: "18:00",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "Saturday",
        opens: "09:00",
        closes: "14:00",
      },
    ],
  },
};

const methodCard = {
  display: "flex",
  gap: "14px",
  alignItems: "center",
  textDecoration: "none",
  color: "#1C2A33",
  background: "#F6F5EF",
  borderRadius: "14px",
  padding: "18px 20px",
};

export default function ContactPage() {
  return (
    <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", color: "#1C2A33" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(contactJsonLd) }}
      />

      <section
        style={{
          background: "linear-gradient(160deg,#1F4566,#1A3C5A 55%,#14304A)",
          color: "#fff",
        }}
      >
        <div
          style={{
            maxWidth: "920px",
            margin: "0 auto",
            padding: "60px 28px 56px",
            textAlign: "center",
          }}
        >
          <h1
            style={{
              fontFamily: "'Bricolage Grotesque'",
              fontWeight: 800,
              fontSize: "46px",
              lineHeight: 1.0,
              letterSpacing: "-0.025em",
              margin: "0 0 16px",
            }}
          >
            Let&apos;s get your yard on the schedule.
          </h1>
          <p
            style={{
              fontSize: "18px",
              lineHeight: 1.55,
              color: "#c4d2df",
              margin: "0 auto",
              maxWidth: "560px",
            }}
          >
            Call or text us anytime — we&apos;ll confirm your service area and
            build a plan that fits your dogs and your yard.
          </p>
        </div>
      </section>

      <section style={{ background: "#fff", padding: "70px 0" }}>
        <div
          className="opwp-gsplit"
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "0 28px",
            display: "grid",
            gridTemplateColumns: "0.9fr 1.1fr",
            gap: "50px",
            alignItems: "start",
          }}
        >
          {/* contact methods */}
          <div>
            <div
              style={{
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "#658461",
                marginBottom: "16px",
              }}
            >
              Get in touch
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "18px",
              }}
            >
              <a href="tel:419-262-2371" className="hov-cream" style={methodCard}>
                <span style={{ fontSize: "24px" }}>📞</span>
                <div>
                  <div
                    style={{
                      fontSize: "12.5px",
                      color: "#7c8891",
                      fontWeight: 600,
                    }}
                  >
                    Call us
                  </div>
                  <div
                    style={{
                      fontFamily: "'Bricolage Grotesque'",
                      fontWeight: 700,
                      fontSize: "19px",
                      color: "#1A3C5A",
                    }}
                  >
                    419-262-2371
                  </div>
                </div>
              </a>
              <a href="sms:419-262-2371" className="hov-cream" style={methodCard}>
                <span style={{ fontSize: "24px" }}>💬</span>
                <div>
                  <div
                    style={{
                      fontSize: "12.5px",
                      color: "#7c8891",
                      fontWeight: 600,
                    }}
                  >
                    Text us
                  </div>
                  <div
                    style={{
                      fontFamily: "'Bricolage Grotesque'",
                      fontWeight: 700,
                      fontSize: "19px",
                      color: "#1A3C5A",
                    }}
                  >
                    419-262-2371
                  </div>
                </div>
              </a>
              <a
                href="mailto:Craig@ohiopetwastepros.com"
                className="hov-cream"
                style={methodCard}
              >
                <span style={{ fontSize: "24px" }}>✉️</span>
                <div>
                  <div
                    style={{
                      fontSize: "12.5px",
                      color: "#7c8891",
                      fontWeight: 600,
                    }}
                  >
                    Email
                  </div>
                  <div
                    style={{
                      fontFamily: "'Bricolage Grotesque'",
                      fontWeight: 700,
                      fontSize: "16px",
                      color: "#1A3C5A",
                    }}
                  >
                    Craig@ohiopetwastepros.com
                  </div>
                </div>
              </a>
              <div
                style={{
                  display: "flex",
                  gap: "14px",
                  alignItems: "center",
                  background: "#F6F5EF",
                  borderRadius: "14px",
                  padding: "18px 20px",
                }}
              >
                <span style={{ fontSize: "24px" }}>📍</span>
                <div>
                  <div
                    style={{
                      fontSize: "12.5px",
                      color: "#7c8891",
                      fontWeight: 600,
                    }}
                  >
                    Based in
                  </div>
                  <div
                    style={{
                      fontFamily: "'Bricolage Grotesque'",
                      fontWeight: 700,
                      fontSize: "16px",
                      color: "#1A3C5A",
                    }}
                  >
                    Holland, OH · serving Greater Toledo &amp; SE Michigan
                  </div>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "14px",
                  alignItems: "flex-start",
                  background: "#F6F5EF",
                  borderRadius: "14px",
                  padding: "18px 20px",
                }}
              >
                <span style={{ fontSize: "24px" }}>🕒</span>
                <div>
                  <div
                    style={{
                      fontSize: "12.5px",
                      color: "#7c8891",
                      fontWeight: 600,
                      marginBottom: "4px",
                    }}
                  >
                    Hours
                  </div>
                  <div
                    style={{
                      fontSize: "14.5px",
                      color: "#1A3C5A",
                      lineHeight: 1.5,
                    }}
                  >
                    <strong>Mon–Fri</strong> 9:00am–6:00pm &nbsp;·&nbsp;{" "}
                    <strong>Sat</strong> 9:00am–2:00pm &nbsp;·&nbsp;{" "}
                    <strong>Sun</strong> closed
                  </div>
                </div>
              </div>
            </div>
            <a
              href="https://client.sweepandgo.com/login"
              style={{
                display: "block",
                marginTop: "22px",
                textAlign: "center",
                background: "#fff",
                border: "1.5px solid #d6dbd2",
                color: "#1A3C5A",
                textDecoration: "none",
                padding: "13px 18px",
                borderRadius: "10px",
                fontWeight: 700,
                fontSize: "14.5px",
              }}
            >
              Client Login
            </a>
            <div style={{ marginTop: "20px" }}>
              <div
                style={{
                  fontSize: "12.5px",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: "#7c8891",
                  marginBottom: "11px",
                }}
              >
                Follow us
              </div>
              <div style={{ display: "flex", gap: "11px" }}>
                <a
                  href="https://www.facebook.com/profile.php?id=61575239054687"
                  aria-label="Facebook"
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "12px",
                    background: "#1877F2",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textDecoration: "none",
                  }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff">
                    <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.9 3.78-3.9 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.9h-2.34V22c4.78-.79 8.44-4.94 8.44-9.94z" />
                  </svg>
                </a>
                <a
                  href="https://www.instagram.com/ohio.pet.waste.pros.llc/"
                  aria-label="Instagram"
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "12px",
                    background:
                      "linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textDecoration: "none",
                  }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff">
                    <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07zm0 1.62c-3.15 0-3.52.01-4.76.07-1.15.05-1.77.24-2.19.41-.55.21-.94.47-1.35.88-.41.41-.67.8-.88 1.35-.17.42-.36 1.04-.41 2.19-.06 1.24-.07 1.61-.07 4.76s.01 3.52.07 4.76c.05 1.15.24 1.77.41 2.19.21.55.47.94.88 1.35.41.41.8.67 1.35.88.42.17 1.04.36 2.19.41 1.24.06 1.61.07 4.76.07s3.52-.01 4.76-.07c1.15-.05 1.77-.24 2.19-.41.55-.21.94-.47 1.35-.88.41-.41.67-.8.88-1.35.17-.42.36-1.04.41-2.19.06-1.24.07-1.61.07-4.76s-.01-3.52-.07-4.76c-.05-1.15-.24-1.77-.41-2.19-.21-.55-.47-.94-.88-1.35-.41-.41-.8-.67-1.35-.88-.42-.17-1.04-.36-2.19-.41-1.24-.06-1.61-.07-4.76-.07zm0 2.76a5.3 5.3 0 100 10.6 5.3 5.3 0 000-10.6zm0 8.74a3.44 3.44 0 110-6.88 3.44 3.44 0 010 6.88zm6.74-8.94a1.24 1.24 0 11-2.48 0 1.24 1.24 0 012.48 0z" />
                  </svg>
                </a>
              </div>
            </div>
          </div>

          {/* service area map */}
          <div>
            <div
              style={{
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "#658461",
                marginBottom: "16px",
              }}
            >
              Our service area
            </div>
            <div
              style={{
                borderRadius: "18px",
                overflow: "hidden",
                border: "1px solid #ece9df",
                boxShadow: "0 18px 40px -24px rgba(20,48,74,.3)",
              }}
            >
              <iframe
                src="https://www.google.com/maps/d/u/0/embed?mid=1Jwhc-QqZowSQq-WFqPm0kChFHD32o9g&ehbc=2E312F"
                style={{
                  width: "100%",
                  height: "470px",
                  border: 0,
                  display: "block",
                }}
                loading="lazy"
                title="Ohio Pet Waste Pros service area map"
              />
            </div>
            <p
              style={{
                fontSize: "13.5px",
                color: "#7c8891",
                margin: "14px 2px 0",
                lineHeight: 1.55,
              }}
            >
              Serving Toledo, Sylvania, Perrysburg, Maumee, Holland, Whitehouse,
              Waterville, Rossford, Oregon and surrounding NW Ohio &amp; SE
              Michigan communities — including Temperance, Lambertville &amp;
              Bedford, MI.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
