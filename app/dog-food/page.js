import Link from "next/link";

export const metadata = {
  title: "Extreme Dog Fuel — Premium Dog Food in Toledo & NW Ohio | Ohio Pet Waste Pros",
  description:
    "Extreme Dog Fuel premium dog food, available from Ohio Pet Waste Pros in Toledo, Sylvania & Perrysburg. Vet-recommended, no corn/wheat/soy/gluten. Four formulas (22-12, 26-14, 26-18, 30-20) delivered locally.",
  alternates: { canonical: "/dog-food/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    title: "Extreme Dog Fuel — Premium Dog Food in NW Ohio | Ohio Pet Waste Pros",
    description:
      "Vet-recommended premium dog food with no corn, wheat, soy or glutens. Four formulas for every dog, delivered locally in Greater Toledo.",
    url: "https://ohiopetwastepros.com/dog-food/",
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

const itemListJsonLd = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Extreme Dog Fuel formulas at Ohio Pet Waste Pros",
  itemListElement: [
    {
      "@type": "Product",
      position: 1,
      name: "Extreme Dog Fuel 22-12",
      description:
        "22% protein / 12% fat. Chicken meal & brown rice formula for less active and senior dogs. No corn, wheat, soy, or glutens. 40 lb bag.",
      brand: { "@type": "Brand", name: "Extreme Dog Fuel" },
    },
    {
      "@type": "Product",
      position: 2,
      name: "Extreme Dog Fuel 26-14",
      description:
        "26% protein / 14% fat. For puppies and active dogs. Fortified with folic acid, vitamin C, B12 and chelated minerals. No corn, wheat, soy, or glutens. 40 lb bag.",
      brand: { "@type": "Brand", name: "Extreme Dog Fuel" },
    },
    {
      "@type": "Product",
      position: 3,
      name: "Extreme Dog Fuel 26-18",
      description:
        "26% protein / 18% fat. For active dogs, with a healthy joint system featuring glucosamine and chondroitin. No corn, wheat, soy, or glutens. 40 lb bag.",
      brand: { "@type": "Brand", name: "Extreme Dog Fuel" },
    },
    {
      "@type": "Product",
      position: 4,
      name: "Extreme Dog Fuel 30-20 Pro-Athlete",
      description:
        "30% protein / 20% fat. Pro-Athlete formula for high-energy, puppies and active dogs. No corn, wheat, soy, or glutens. 40 lb bag.",
      brand: { "@type": "Brand", name: "Extreme Dog Fuel" },
    },
  ],
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is Extreme Dog Fuel?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Extreme Dog Fuel is a premium, veterinarian-recommended dry dog food with no corn, wheat, soy, or glutens. It uses chelated minerals and an omega skin-and-coat system, and is made in the USA. Ohio Pet Waste Pros offers it locally in the Greater Toledo area.",
      },
    },
    {
      "@type": "Question",
      name: "Which Extreme Dog Fuel formula is right for my dog?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "22-12 suits less active and senior dogs, 26-14 is built for puppies and active dogs, 26-18 adds joint support with glucosamine and chondroitin for active dogs, and 30-20 Pro-Athlete is for high-energy and working dogs. The numbers are the protein and fat percentages.",
      },
    },
    {
      "@type": "Question",
      name: "Do you deliver Extreme Dog Fuel?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. We deliver Extreme Dog Fuel locally throughout Toledo, Sylvania, Perrysburg and the surrounding area — and we can bring it right along with your scheduled pet waste service.",
      },
    },
    {
      "@type": "Question",
      name: "What size bags are available?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Each Extreme Dog Fuel formula comes in a 40 lb (18.14 kg) bag.",
      },
    },
  ],
};

const faqData = [
  {
    q: "What is Extreme Dog Fuel?",
    a: "Extreme Dog Fuel is a premium, veterinarian-recommended dry dog food with no corn, wheat, soy, or glutens. It uses chelated minerals and an Omega Extreme skin-and-coat system, and is made in the USA. Ohio Pet Waste Pros offers it locally throughout the Greater Toledo area.",
  },
  {
    q: "Which formula is right for my dog?",
    a: "22-12 suits less active and senior dogs, 26-14 is built for puppies and active dogs, 26-18 adds joint support with glucosamine and chondroitin for active dogs, and 30-20 Pro-Athlete is for high-energy and working dogs. The two numbers are the protein and fat percentages.",
  },
  {
    q: "Do you deliver, and how do I order?",
    a: "Yes — we deliver locally across Toledo, Sylvania, Perrysburg and the surrounding area. Use our online tool to check pricing and order, or just ask us to add it to your next scheduled pet waste service.",
  },
  {
    q: "What size bags are available?",
    a: "Each Extreme Dog Fuel formula comes in a convenient 40 lb (18.14 kg) bag.",
  },
  {
    q: "Is it grain-free?",
    a: "Extreme Dog Fuel is free of corn, wheat, soy and glutens. The recipes do use wholesome ingredients like brown rice, so it is a clean, filler-free food rather than a strictly grain-free one.",
  },
];

export default function DogFoodPage() {
  return (
    <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", color: "#1C2A33" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* ===== HERO ===== */}
      <section style={{ background: "#17181C", color: "#fff", padding: "66px 0 74px", textAlign: "center" }}>
        <div style={{ maxWidth: 980, margin: "0 auto", padding: "0 28px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(255,255,255,.08)",
              border: "1px solid rgba(255,255,255,.16)",
              borderRadius: 99,
              padding: "6px 15px",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: "#e9c64a",
              marginBottom: 22,
            }}
          >
            🦴 Premium dog food · now at Ohio Pet Waste Pros
          </div>
          <img
            src="/assets/edf/logo.png"
            alt="Extreme Dog Fuel logo"
            style={{ display: "block", height: 84, margin: "0 auto 22px", borderRadius: 9 }}
          />
          <h1
            style={{
              fontFamily: "'Bricolage Grotesque'",
              fontWeight: 800,
              fontSize: 52,
              lineHeight: 1.0,
              letterSpacing: "-0.025em",
              margin: "0 0 18px",
            }}
          >
            Elite nutrition, delivered to your door.
          </h1>
          <p
            style={{
              fontSize: 18.5,
              lineHeight: 1.55,
              color: "#b9bcc4",
              margin: "0 auto 30px",
              maxWidth: 640,
            }}
          >
            Extreme Dog Fuel is a premium, veterinarian-recommended dog food with no corn, wheat, soy, or glutens — built for every age and activity level. We deliver it locally across Greater Toledo, right alongside your pet waste service.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Link
              href="/free-quote/"
              className="hov-cta"
              style={{
                background: "#4F9E3A",
                color: "#fff",
                textDecoration: "none",
                padding: "16px 30px",
                borderRadius: 12,
                fontWeight: 800,
                fontSize: 16.5,
                boxShadow: "0 14px 28px -12px rgba(79,158,58,.7)",
              }}
            >
              Get Your Instant Quote
            </Link>
            <Link
              href="/contact/"
              className="hov-white-08"
              style={{
                background: "rgba(255,255,255,.1)",
                border: "1.5px solid rgba(255,255,255,.3)",
                color: "#fff",
                textDecoration: "none",
                padding: "16px 28px",
                borderRadius: 12,
                fontWeight: 700,
                fontSize: 16.5,
              }}
            >
              Ask a Question
            </Link>
          </div>
        </div>
        <div
          className="opwp-g4"
          style={{
            maxWidth: 1080,
            margin: "46px auto 0",
            padding: "0 28px",
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 16,
          }}
        >
          <img
            src="/assets/edf/22-12.png"
            alt="Extreme Dog Fuel 22-12 bag"
            style={{ width: "100%", height: 210, objectFit: "contain", filter: "drop-shadow(0 18px 26px rgba(0,0,0,.5))" }}
          />
          <img
            src="/assets/edf/26-14.png"
            alt="Extreme Dog Fuel 26-14 bag"
            style={{ width: "100%", height: 210, objectFit: "contain", filter: "drop-shadow(0 18px 26px rgba(0,0,0,.5))" }}
          />
          <img
            src="/assets/edf/26-18.png"
            alt="Extreme Dog Fuel 26-18 bag"
            style={{ width: "100%", height: 210, objectFit: "contain", filter: "drop-shadow(0 18px 26px rgba(0,0,0,.5))" }}
          />
          <img
            src="/assets/edf/30-20.png"
            alt="Extreme Dog Fuel 30-20 bag"
            style={{ width: "100%", height: 210, objectFit: "contain", filter: "drop-shadow(0 18px 26px rgba(0,0,0,.5))" }}
          />
        </div>
      </section>

      {/* ===== WHY ===== */}
      <section style={{ background: "#fff", padding: "78px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
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
              Why Extreme Dog Fuel
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
              Elite Nutrition, recommended by veterinarians
            </h2>
          </div>
          <div
            className="opwp-g3"
            style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}
          >
            <div style={{ background: "#F6F5EF", borderRadius: 16, padding: 26 }}>
              <div style={{ fontSize: 26, marginBottom: 12 }}>🚫🌽</div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 18, margin: "0 0 8px" }}>
                No corn, wheat, soy or glutens
              </h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "#5b6770" }}>
                Clean recipes that skip the common fillers and focus on quality nutrition.
              </p>
            </div>
            <div style={{ background: "#F6F5EF", borderRadius: 16, padding: 26 }}>
              <div style={{ fontSize: 26, marginBottom: 12 }}>🧬</div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 18, margin: "0 0 8px" }}>
                Chelated minerals
              </h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "#5b6770" }}>
                Minerals bound for better absorption, supporting balanced nutrition and digestion.
              </p>
            </div>
            <div style={{ background: "#F6F5EF", borderRadius: 16, padding: 26 }}>
              <div style={{ fontSize: 26, marginBottom: 12 }}>✨</div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 18, margin: "0 0 8px" }}>
                Omega Extreme skin &amp; coat
              </h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "#5b6770" }}>
                An omega system formulated for a healthy skin and a shiny, full hair coat.
              </p>
            </div>
            <div style={{ background: "#F6F5EF", borderRadius: 16, padding: 26 }}>
              <div style={{ fontSize: 26, marginBottom: 12 }}>🐕</div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 18, margin: "0 0 8px" }}>
                All life stages
              </h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "#5b6770" }}>
                Formulas for puppies, active adults, seniors and working dogs alike.
              </p>
            </div>
            <div style={{ background: "#F6F5EF", borderRadius: 16, padding: 26 }}>
              <div style={{ fontSize: 26, marginBottom: 12 }}>🇺🇸</div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 18, margin: "0 0 8px" }}>
                Made in the USA
              </h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "#5b6770" }}>
                Quality you can trust, in convenient 40 lb bags.
              </p>
            </div>
            <div style={{ background: "#F6F5EF", borderRadius: 16, padding: 26 }}>
              <div style={{ fontSize: 26, marginBottom: 12 }}>🚚</div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 18, margin: "0 0 8px" }}>
                Delivered locally
              </h3>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "#5b6770" }}>
                We bring it right to your door — and can include it with your scheduled service.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FORMULAS ===== */}
      <section style={{ background: "#F6F5EF", padding: "80px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
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
              Choose your formula
            </div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: 36,
                letterSpacing: "-0.02em",
                margin: "0 0 10px",
              }}
            >
              Four recipes, one for every dog
            </h2>
            <p style={{ fontSize: 16, color: "#5b6770", margin: 0 }}>
              The numbers are the protein and fat percentages — so you can match the food to your dog&apos;s energy.
            </p>
          </div>
          <div
            className="opwp-gsplit"
            style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 22 }}
          >
            <div
              style={{
                background: "#fff",
                borderRadius: 18,
                padding: 26,
                display: "flex",
                gap: 22,
                boxShadow: "0 1px 3px rgba(0,0,0,.05)",
              }}
            >
              <img
                src="/assets/edf/22-12.png"
                alt="Extreme Dog Fuel 22-12"
                style={{ width: 130, height: 200, objectFit: "contain", flex: "none" }}
              />
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 26, color: "#1A3C5A" }}>
                    22-12
                  </span>
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: "#C0427A",
                      background: "#fbe9f1",
                      padding: "3px 9px",
                      borderRadius: 99,
                    }}
                  >
                    22% protein · 12% fat
                  </span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#1C2A33", marginBottom: 8 }}>
                  Chicken Meal &amp; Brown Rice · less active &amp; senior dogs
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6, color: "#5b6770" }}>
                  <li>All life stages with chelated minerals</li>
                  <li>Omega Extreme skin &amp; haircoat system</li>
                  <li>No corn, wheat, soy or glutens · 40 lb</li>
                </ul>
              </div>
            </div>
            <div
              style={{
                background: "#fff",
                borderRadius: 18,
                padding: 26,
                display: "flex",
                gap: 22,
                boxShadow: "0 1px 3px rgba(0,0,0,.05)",
              }}
            >
              <img
                src="/assets/edf/26-14.png"
                alt="Extreme Dog Fuel 26-14"
                style={{ width: 130, height: 200, objectFit: "contain", flex: "none" }}
              />
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 26, color: "#1A3C5A" }}>
                    26-14
                  </span>
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: "#1E5FA8",
                      background: "#e6f0fb",
                      padding: "3px 9px",
                      borderRadius: 99,
                    }}
                  >
                    26% protein · 14% fat
                  </span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#1C2A33", marginBottom: 8 }}>
                  For puppies &amp; active dogs
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6, color: "#5b6770" }}>
                  <li>Fortified with folic acid, vitamin C &amp; B12</li>
                  <li>Chelated minerals + Omega skin &amp; coat</li>
                  <li>No corn, wheat, soy or glutens · 40 lb</li>
                </ul>
              </div>
            </div>
            <div
              style={{
                background: "#fff",
                borderRadius: 18,
                padding: 26,
                display: "flex",
                gap: 22,
                boxShadow: "0 1px 3px rgba(0,0,0,.05)",
              }}
            >
              <img
                src="/assets/edf/26-18.png"
                alt="Extreme Dog Fuel 26-18"
                style={{ width: 130, height: 200, objectFit: "contain", flex: "none" }}
              />
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 26, color: "#1A3C5A" }}>
                    26-18
                  </span>
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: "#2E7D4F",
                      background: "#e6f4ec",
                      padding: "3px 9px",
                      borderRadius: 99,
                    }}
                  >
                    26% protein · 18% fat
                  </span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#1C2A33", marginBottom: 8 }}>
                  For active dogs · joint &amp; skin support
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6, color: "#5b6770" }}>
                  <li>Healthy joint system with glucosamine &amp; chondroitin</li>
                  <li>Omega Extreme for healthy skin &amp; coat</li>
                  <li>No corn, wheat, soy or glutens · 40 lb</li>
                </ul>
              </div>
            </div>
            <div
              style={{
                background: "#fff",
                borderRadius: 18,
                padding: 26,
                display: "flex",
                gap: 22,
                boxShadow: "0 1px 3px rgba(0,0,0,.05)",
              }}
            >
              <img
                src="/assets/edf/30-20.png"
                alt="Extreme Dog Fuel 30-20 Pro-Athlete"
                style={{ width: 130, height: 200, objectFit: "contain", flex: "none" }}
              />
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 26, color: "#1A3C5A" }}>
                    30-20
                  </span>
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: "#C0392B",
                      background: "#fbeae8",
                      padding: "3px 9px",
                      borderRadius: 99,
                    }}
                  >
                    30% protein · 20% fat
                  </span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#1C2A33", marginBottom: 8 }}>
                  Pro-Athlete · high-energy &amp; working dogs
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6, color: "#5b6770" }}>
                  <li>All life stages for puppies &amp; active dogs</li>
                  <li>Chelated minerals + Omega skin &amp; coat</li>
                  <li>No corn, wheat, soy or glutens · 40 lb</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== ORDER / TOOL ===== */}
      <section style={{ background: "linear-gradient(160deg,#1F4566,#14304A)", color: "#fff", padding: "72px 0" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 28px", textAlign: "center" }}>
          <h2
            style={{
              fontFamily: "'Bricolage Grotesque'",
              fontWeight: 800,
              fontSize: 38,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              margin: "0 0 14px",
            }}
          >
            Add Extreme Dog Fuel to your service
          </h2>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: "#c4d2df", margin: "0 0 30px" }}>
            Contact us for current pricing and to add Extreme Dog Fuel to your service. Already a client? We&apos;ll deliver it right along with your scheduled visit.
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
              Get Your Instant Quote
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

      {/* ===== FAQ ===== */}
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
              Dog food questions
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
              Extreme Dog Fuel FAQ
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
    </div>
  );
}
