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

const inputStyle = {
  width: "100%",
  padding: "13px 14px",
  border: "1.5px solid #dfe2da",
  borderRadius: "10px",
  fontSize: "15px",
  fontFamily: "inherit",
};

const labelStyle = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#46545d",
  display: "block",
  marginBottom: "7px",
};

const freqOptions = [
  { label: "Twice a Week", active: false },
  { label: "Once a Week", active: true },
  { label: "Bi-Weekly", active: false },
  { label: "Once a Month", active: false },
];

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
      <style>{`
        input[type=range].opwp-range { -webkit-appearance:none; appearance:none; width:100%; height:8px; border-radius:99px; background:#dfe5dc; outline:none; }
        input[type=range].opwp-range::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:30px; height:30px; border-radius:50%; background:#4F9E3A; border:4px solid #fff; box-shadow:0 2px 8px rgba(0,0,0,.25); cursor:pointer; }
        input[type=range].opwp-range::-moz-range-thumb { width:30px; height:30px; border-radius:50%; background:#4F9E3A; border:4px solid #fff; box-shadow:0 2px 8px rgba(0,0,0,.25); cursor:pointer; }
      `}</style>

      <section
        style={{
          background:
            "linear-gradient(165deg,#1F4566 0%,#1A3C5A 60%,#14304A 100%)",
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
            {/* FORM CARD */}
            <div
              style={{
                background: "#fff",
                borderRadius: "22px",
                padding: "34px",
                boxShadow: "0 30px 60px -28px rgba(0,0,0,.5)",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "18px",
                  marginBottom: "22px",
                }}
              >
                <div>
                  <label style={labelStyle}>Zip Code</label>
                  <input placeholder="43528" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Coupon Code</label>
                  <input placeholder="Optional" style={inputStyle} />
                </div>
              </div>

              <div style={{ marginBottom: "26px" }}>
                <label
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "#46545d",
                    display: "block",
                    marginBottom: "14px",
                  }}
                >
                  Number of dogs:{" "}
                  <span
                    style={{
                      color: "#4F9E3A",
                      fontFamily: "'Bricolage Grotesque'",
                      fontSize: "16px",
                    }}
                  >
                    1
                  </span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="4"
                  defaultValue="1"
                  className="opwp-range"
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#8a96a0",
                    marginTop: "8px",
                    padding: "0 2px",
                  }}
                >
                  <span>1</span>
                  <span>2</span>
                  <span>3</span>
                  <span>4+</span>
                </div>
              </div>

              <div style={{ marginBottom: "26px" }}>
                <label
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "#46545d",
                    display: "block",
                    marginBottom: "12px",
                  }}
                >
                  Cleanup frequency
                </label>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4,1fr)",
                    gap: "8px",
                  }}
                >
                  {freqOptions.map((f) => (
                    <button
                      key={f.label}
                      type="button"
                      style={{
                        border: `1.5px solid ${f.active ? "#4F9E3A" : "#dfe2da"}`,
                        background: f.active ? "#4F9E3A" : "#fff",
                        color: f.active ? "#fff" : "#46545d",
                        borderRadius: "10px",
                        padding: "12px 6px",
                        fontWeight: 700,
                        fontSize: "13px",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        lineHeight: 1.25,
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: "20px" }}>
                <label style={labelStyle}>Cell Phone Number</label>
                <input placeholder="(419) 000-0000" style={inputStyle} />
              </div>

              <label
                style={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "flex-start",
                  fontSize: "12px",
                  lineHeight: 1.5,
                  color: "#7c8891",
                  marginBottom: "22px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  style={{
                    marginTop: "2px",
                    width: "16px",
                    height: "16px",
                    accentColor: "#4F9E3A",
                  }}
                />
                <span>
                  I consent to receive marketing and service messages from Ohio
                  Pet Waste Pros at the phone number provided. Message frequency
                  may vary; message &amp; data rates may apply. Reply STOP to opt
                  out.
                </span>
              </label>

              <a
                href="https://ohiopetwastepros.com/sng/ohio-pet-waste-pros-qkr3c-client-onboarding/"
                className="hov-cta"
                style={{
                  display: "block",
                  textAlign: "center",
                  width: "100%",
                  background: "#4F9E3A",
                  color: "#fff",
                  textDecoration: "none",
                  borderRadius: "12px",
                  padding: "17px",
                  fontFamily: "'Bricolage Grotesque'",
                  fontWeight: 800,
                  fontSize: "18px",
                  cursor: "pointer",
                  boxShadow: "0 14px 28px -12px rgba(79,158,58,.7)",
                }}
              >
                See My Instant Price &amp; Sign Up &rarr;
              </a>
              <div
                style={{
                  textAlign: "center",
                  fontSize: "12px",
                  color: "#9aa6ae",
                  marginTop: "12px",
                }}
              >
                🔒 Secure signup powered by Sweep&amp;Go
              </div>
            </div>

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
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "9px",
                  }}
                >
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
                  <span
                    style={{
                      color: "#E7A734",
                      letterSpacing: "2px",
                      fontSize: "18px",
                    }}
                  >
                    ★★★★★
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    color: "#7c8891",
                    marginTop: "4px",
                  }}
                >
                  100+ verified Google reviews
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                }}
              >
                {reviews.map((r) => (
                  <div
                    key={r.name}
                    style={{
                      background: "#F6F5EF",
                      borderRadius: "14px",
                      padding: "18px",
                    }}
                  >
                    <div
                      style={{
                        color: "#E7A734",
                        letterSpacing: "2px",
                        fontSize: "14px",
                        marginBottom: "8px",
                      }}
                    >
                      ★★★★★
                    </div>
                    <p
                      style={{
                        margin: "0 0 10px",
                        fontSize: "14px",
                        lineHeight: 1.5,
                        color: "#36424b",
                      }}
                    >
                      &quot;{r.text}&quot;
                    </p>
                    <div style={{ fontWeight: 700, fontSize: "13.5px" }}>
                      — {r.name}
                    </div>
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
            <a
              href="tel:419-262-2371"
              style={{
                color: "#fff",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              419-262-2371
            </a>{" "}
            — we&apos;re a local, family-owned team and happy to help.
          </p>
        </div>
      </section>
    </div>
  );
}
