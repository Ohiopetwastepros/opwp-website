import Link from "next/link";

export const metadata = {
  title: {
    absolute:
      "About Ohio Pet Waste Pros | Family-Owned Dog Waste Removal in NW Ohio",
  },
  description:
    "Meet the family behind Ohio Pet Waste Pros — Craig & Amanda Bridgman, based in Holland, Ohio, serving Perrysburg, Toledo, Sylvania & the surrounding area with reliable, eco-friendly dog waste removal.",
  alternates: { canonical: "/about-our-pet-waste-removal-team/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "article",
    url: "https://ohiopetwastepros.com/about-our-pet-waste-removal-team/",
    siteName: "Ohio Pet Waste Pros",
    title: "About Ohio Pet Waste Pros | Family-Owned in NW Ohio",
    description:
      "A family-owned, eco-friendly dog waste removal team serving Greater Toledo & SE Michigan.",
    images: [
      "https://ohiopetwastepros.com/wp-content/uploads/2025/05/cropped-OPWP-CIRCLE-LOGO-11111111.png",
    ],
  },
};

const aboutJsonLd = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  name: "About Ohio Pet Waste Pros",
  mainEntity: {
    "@type": "LocalBusiness",
    name: "Ohio Pet Waste Pros",
    telephone: "+14192622371",
    email: "Craig@ohiopetwastepros.com",
    founder: [
      { "@type": "Person", name: "Craig Bridgman" },
      { "@type": "Person", name: "Amanda Bridgman" },
    ],
    address: {
      "@type": "PostalAddress",
      addressLocality: "Holland",
      addressRegion: "OH",
      addressCountry: "US",
    },
    areaServed: "Perrysburg, Toledo, Holland and surrounding NW Ohio",
    sameAs: ["https://www.facebook.com/profile.php?id=61575239054687"],
  },
};

export default function AboutPage() {
  return (
    <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", color: "#1C2A33" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(aboutJsonLd) }}
      />

      {/* HERO */}
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
            padding: "70px 28px 64px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              border: "1px solid rgba(255,255,255,.22)",
              borderRadius: "99px",
              padding: "7px 15px",
              fontSize: "12.5px",
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "#cdd8e2",
              marginBottom: "22px",
            }}
          >
            Our story
          </div>
          <h1
            style={{
              fontFamily: "'Bricolage Grotesque'",
              fontWeight: 800,
              fontSize: "50px",
              lineHeight: 1.0,
              letterSpacing: "-0.025em",
              margin: "0 0 18px",
            }}
          >
            A family that treats your yard like our own.
          </h1>
          <p
            style={{
              fontSize: "18.5px",
              lineHeight: 1.55,
              color: "#c4d2df",
              margin: "0 auto",
              maxWidth: "640px",
            }}
          >
            Ohio Pet Waste Pros is a tight-knit, family-owned business based in
            Holland, Ohio — passionate about keeping your yard clean and your
            pets happy with reliable, eco-friendly service.
          </p>
        </div>
      </section>

      {/* MISSION */}
      <section style={{ background: "#fff", padding: "84px 0" }}>
        <div
          className="opwp-gsplit"
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "0 28px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "56px",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "#658461",
                marginBottom: "12px",
              }}
            >
              Our mission
            </div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: "34px",
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                margin: "0 0 18px",
              }}
            >
              Growing a family business, one scoop at a time
            </h2>
            <p
              style={{
                fontSize: "16.5px",
                lineHeight: 1.65,
                color: "#475259",
                margin: "0 0 16px",
              }}
            >
              At Ohio Pet Waste Pros, our mission is to grow our family business
              by providing a much-needed service that improves your life with a
              clean, pet-friendly yard — while giving us the freedom to be our
              own bosses and spend more quality time together as a family.
            </p>
            <p
              style={{
                fontSize: "16.5px",
                lineHeight: 1.65,
                color: "#475259",
                margin: 0,
              }}
            >
              As a tight-knit team with deep roots in Perrysburg, Toledo and
              Holland, we&apos;re passionate about bringing our love for NW
              Ohio&apos;s vibrant communities into every yard we clean. We
              cherish the chance to build lasting memories while serving the
              families and pet lovers of this amazing region.
            </p>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: "18px",
            }}
          >
            <img
              src="/assets/photos/team-new-sign.webp"
              alt="The Bridgman family with the new Ohio Pet Waste Pros sign"
              style={{
                width: "100%",
                aspectRatio: "16/10",
                objectFit: "cover",
                borderRadius: "22px",
                boxShadow: "0 24px 48px -24px rgba(20,48,74,.4)",
              }}
            />
            <img
              src="/assets/photos/team-maumee-river.webp"
              alt="The Ohio Pet Waste Pros family along the Maumee River"
              style={{
                width: "100%",
                aspectRatio: "16/9",
                objectFit: "cover",
                borderRadius: "22px",
                boxShadow: "0 24px 48px -24px rgba(20,48,74,.4)",
              }}
            />
          </div>
        </div>
      </section>

      {/* OWNERS */}
      <section style={{ background: "#F6F5EF", padding: "84px 0" }}>
        <div
          className="opwp-gsplit"
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "0 28px",
            display: "grid",
            gridTemplateColumns: "1fr 1.1fr",
            gap: "56px",
            alignItems: "center",
          }}
        >
          <div>
            <img
              src="/assets/photos/dixie-craig-posed-1.webp"
              alt="Craig Bridgman, co-owner of Ohio Pet Waste Pros, with rescue dog Dixie"
              style={{
                width: "100%",
                aspectRatio: "4/5",
                objectFit: "cover",
                borderRadius: "22px",
                boxShadow: "0 24px 48px -24px rgba(20,48,74,.4)",
              }}
            />
          </div>
          <div>
            <div
              style={{
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "#658461",
                marginBottom: "12px",
              }}
            >
              Our owners
            </div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: "34px",
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                margin: "0 0 18px",
              }}
            >
              Meet the heart behind Ohio Pet Waste Pros
            </h2>
            <p
              style={{
                fontSize: "16.5px",
                lineHeight: 1.65,
                color: "#475259",
                margin: "0 0 16px",
              }}
            >
              Hi, I&apos;m <strong>Craig</strong> — a dedicated family man,
              married with three kids, and a proud dad to our rescue dog, Dixie,
              who inspires our mission to keep yards clean and safe for pets and
              families across NW Ohio. I was born and raised in Perrysburg and
              now live in Holland.
            </p>
            <p
              style={{
                fontSize: "16.5px",
                lineHeight: 1.65,
                color: "#475259",
                margin: "0 0 16px",
              }}
            >
              And I&apos;m <strong>Amanda</strong>, the other part of Ohio Pet
              Waste Pros! Together, we&apos;re addressing the essential need to
              remove dog poop for everyone in the area — no matter the reason.
            </p>
            <p
              style={{
                fontSize: "16.5px",
                lineHeight: 1.65,
                color: "#475259",
                margin: "0 0 18px",
              }}
            >
              We&apos;re both passionate about serving our community and making
              life easier for pet lovers like us, one scoop at a time.
            </p>
            <p
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: "18px",
                color: "#1C2A33",
                margin: 0,
              }}
            >
              — Craig &amp; Amanda Bridgman
            </p>
          </div>
        </div>
      </section>

      {/* MEET DIXIE */}
      <section style={{ background: "#fff", padding: "84px 0" }}>
        <div
          className="opwp-gsplit"
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "0 28px",
            display: "grid",
            gridTemplateColumns: "1.1fr 1fr",
            gap: "56px",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "#658461",
                marginBottom: "12px",
              }}
            >
              Meet Dixie
            </div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: "34px",
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                margin: "0 0 18px",
              }}
            >
              Our inspiration, four paws at a time
            </h2>
            <p
              style={{
                fontSize: "16.5px",
                lineHeight: 1.65,
                color: "#475259",
                margin: "0 0 16px",
              }}
            >
              Dixie, our spirited Lab / Husky / American Staffordshire Terrier
              mix, is a rescue who&apos;s stolen our hearts with her boundless
              energy and love for chasing squirrels out of our yard. When
              she&apos;s not swimming or playing fetch, she&apos;s the
              inspiration behind Ohio Pet Waste Pros — reminding us to keep yards
              clean and fun for every pet.
            </p>
            <p
              style={{
                fontSize: "16.5px",
                lineHeight: 1.65,
                color: "#475259",
                margin: 0,
              }}
            >
              We&apos;d love to serve other dogs like Dixie by keeping their
              yards clean, safe, and ready for endless playtime.
            </p>
          </div>
          <div>
            <img
              src="/assets/photos/dixie-frisbee.webp"
              alt="Dixie, the rescue dog who inspired Ohio Pet Waste Pros"
              style={{
                width: "100%",
                aspectRatio: "4/5",
                objectFit: "cover",
                borderRadius: "22px",
                boxShadow: "0 24px 48px -24px rgba(20,48,74,.4)",
              }}
            />
          </div>
        </div>
      </section>

      {/* MEET THE TEAM */}
      <section style={{ background: "#F6F5EF", padding: "84px 0" }}>
        <div
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "0 28px",
          }}
        >
          <div style={{ textAlign: "center", marginBottom: "46px" }}>
            <div
              style={{
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "#658461",
                marginBottom: "12px",
              }}
            >
              Meet the team
            </div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: "34px",
                letterSpacing: "-0.02em",
                margin: "0 0 12px",
              }}
            >
              The people keeping your yard clean
            </h2>
            <p
              style={{
                fontSize: "16px",
                lineHeight: 1.6,
                color: "#5b6770",
                margin: "0 auto",
                maxWidth: "560px",
              }}
            >
              Friendly, uniformed, and background-checked — here&apos;s the crew
              you&apos;ll see around your yard.
            </p>
          </div>
          <div
            className="opwp-g4"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: "22px",
            }}
          >
            <div
              style={{
                border: "1px solid #e7e6df",
                borderRadius: "18px",
                overflow: "hidden",
                background: "#fff",
              }}
            >
              <img
                src="/assets/photos/team-craig.webp"
                alt="Craig Bridgman, co-owner"
                style={{
                  width: "100%",
                  height: "240px",
                  objectFit: "cover",
                  objectPosition: "center top",
                  display: "block",
                }}
              />
              <div style={{ padding: "20px" }}>
                <h3
                  style={{
                    fontFamily: "'Bricolage Grotesque'",
                    fontWeight: 700,
                    fontSize: "18px",
                    margin: "0 0 3px",
                  }}
                >
                  Craig Bridgman
                </h3>
                <div
                  style={{
                    fontSize: "12.5px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: "#658461",
                    marginBottom: "10px",
                  }}
                >
                  Owner
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: "13.5px",
                    lineHeight: 1.55,
                    color: "#5b6770",
                  }}
                >
                  Perrysburg native, Holland resident, and the friendly face
                  behind most cleanups. Dad to three and to rescue pup Dixie.
                </p>
              </div>
            </div>
            <div
              style={{
                border: "1px solid #e7e6df",
                borderRadius: "18px",
                overflow: "hidden",
                background: "#fff",
              }}
            >
              <img
                src="/assets/photos/team-amanda.webp"
                alt="Amanda Bridgman, co-owner of Ohio Pet Waste Pros"
                style={{
                  width: "100%",
                  height: "240px",
                  objectFit: "contain",
                  objectPosition: "center",
                  display: "block",
                  background: "#F1F3EE",
                }}
              />
              <div style={{ padding: "20px" }}>
                <h3
                  style={{
                    fontFamily: "'Bricolage Grotesque'",
                    fontWeight: 700,
                    fontSize: "18px",
                    margin: "0 0 3px",
                  }}
                >
                  Amanda Bridgman
                </h3>
                <div
                  style={{
                    fontSize: "12.5px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: "#658461",
                    marginBottom: "10px",
                  }}
                >
                  Co-owner
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: "13.5px",
                    lineHeight: 1.55,
                    color: "#5b6770",
                  }}
                >
                  The other half of Ohio Pet Waste Pros — keeping the business
                  running and the community served, one scoop at a time.
                </p>
              </div>
            </div>
            <div
              style={{
                border: "1px solid #e7e6df",
                borderRadius: "18px",
                overflow: "hidden",
                background: "#fff",
              }}
            >
              <img
                src="/assets/photos/team-tony.webp"
                alt="Tony B, Ohio Pet Waste Pros technician"
                style={{
                  width: "100%",
                  height: "240px",
                  objectFit: "cover",
                  objectPosition: "center top",
                  display: "block",
                }}
              />
              <div style={{ padding: "20px" }}>
                <h3
                  style={{
                    fontFamily: "'Bricolage Grotesque'",
                    fontWeight: 700,
                    fontSize: "18px",
                    margin: "0 0 3px",
                  }}
                >
                  Tony B.
                </h3>
                <div
                  style={{
                    fontSize: "12.5px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: "#658461",
                    marginBottom: "10px",
                  }}
                >
                  Technician
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: "13.5px",
                    lineHeight: 1.55,
                    color: "#5b6770",
                  }}
                >
                  One of our dependable field techs — thorough, friendly, and
                  great with every dog he meets. He leaves yards spotless and
                  gates closed, every visit.
                </p>
              </div>
            </div>
            <div
              style={{
                border: "1px solid #e7e6df",
                borderRadius: "18px",
                overflow: "hidden",
                background: "#fff",
              }}
            >
              <img
                src="/assets/photos/team-bria.webp"
                alt="Bria, Ohio Pet Waste Pros technician"
                style={{
                  width: "100%",
                  height: "240px",
                  objectFit: "cover",
                  objectPosition: "center top",
                  display: "block",
                }}
              />
              <div style={{ padding: "20px" }}>
                <h3
                  style={{
                    fontFamily: "'Bricolage Grotesque'",
                    fontWeight: 700,
                    fontSize: "18px",
                    margin: "0 0 3px",
                  }}
                >
                  Bria M.
                </h3>
                <div
                  style={{
                    fontSize: "12.5px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: "#658461",
                    marginBottom: "10px",
                  }}
                >
                  Technician
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: "13.5px",
                    lineHeight: 1.55,
                    color: "#5b6770",
                  }}
                >
                  Detail-oriented and always greeted with a wagging tail. Bria
                  keeps yards clean and safe so families can enjoy them
                  worry-free.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CLIENT PROMISE */}
      <section style={{ background: "#14304A", color: "#fff", padding: "84px 0" }}>
        <div
          style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 28px" }}
        >
          <div style={{ textAlign: "center", marginBottom: "46px" }}>
            <div
              style={{
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "#8fb98a",
                marginBottom: "12px",
              }}
            >
              Our client promise
            </div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: "34px",
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              A small, family-owned business with a personal touch
            </h2>
          </div>
          <div
            className="opwp-g3"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: "22px",
            }}
          >
            <div
              style={{
                background: "#fff",
                borderRadius: "18px",
                overflow: "hidden",
                color: "#1C2A33",
              }}
            >
              <img
                src="/assets/photos/scooping-bell.webp"
                alt="Ohio Pet Waste Pros owner with scooping equipment and a customer's dog in Toledo"
                style={{
                  width: "100%",
                  height: "200px",
                  objectFit: "cover",
                  display: "block",
                }}
              />
              <div style={{ padding: "24px" }}>
                <h3
                  style={{
                    fontFamily: "'Bricolage Grotesque'",
                    fontWeight: 700,
                    fontSize: "19px",
                    margin: "0 0 10px",
                  }}
                >
                  Local, family owned &amp; operated
                </h3>
                <p
                  style={{
                    margin: 0,
                    fontSize: "14.5px",
                    lineHeight: 1.6,
                    color: "#5b6770",
                  }}
                >
                  Led by an owner-operator born and raised in Perrysburg and now
                  calling Holland home. Our deep love for this community drives
                  top-notch cleanup with a personal touch.
                </p>
              </div>
            </div>
            <div
              style={{
                background: "#fff",
                borderRadius: "18px",
                overflow: "hidden",
                color: "#1C2A33",
              }}
            >
              <img
                src="/assets/photos/cody-scooping-vest.webp"
                alt="Ohio Pet Waste Pros technician in uniform scooping a yard in Sylvania"
                style={{
                  width: "100%",
                  height: "200px",
                  objectFit: "cover",
                  display: "block",
                }}
              />
              <div style={{ padding: "24px" }}>
                <h3
                  style={{
                    fontFamily: "'Bricolage Grotesque'",
                    fontWeight: 700,
                    fontSize: "19px",
                    margin: "0 0 10px",
                  }}
                >
                  Reliable &amp; professional
                </h3>
                <p
                  style={{
                    margin: 0,
                    fontSize: "14.5px",
                    lineHeight: 1.6,
                    color: "#5b6770",
                  }}
                >
                  Our skilled technicians are expertly trained to thoroughly and
                  carefully remove your pet&apos;s waste. Arriving in our
                  distinctive uniforms, we&apos;re easily recognizable and ready
                  to serve.
                </p>
              </div>
            </div>
            <div
              style={{
                background: "#fff",
                borderRadius: "18px",
                overflow: "hidden",
                color: "#1C2A33",
              }}
            >
              <img
                src="/assets/photos/dixie-red-scoop.webp"
                alt="Happy dog next to an Ohio Pet Waste Pros sign in a clean yard"
                style={{
                  width: "100%",
                  height: "200px",
                  objectFit: "cover",
                  display: "block",
                }}
              />
              <div style={{ padding: "24px" }}>
                <h3
                  style={{
                    fontFamily: "'Bricolage Grotesque'",
                    fontWeight: 700,
                    fontSize: "19px",
                    margin: "0 0 10px",
                  }}
                >
                  Environmentally aware
                </h3>
                <p
                  style={{
                    margin: 0,
                    fontSize: "14.5px",
                    lineHeight: 1.6,
                    color: "#5b6770",
                  }}
                >
                  Removing waste prevents water contamination, reduces harmful
                  bacteria and parasites, and protects your grass — creating a
                  cleaner, safer outdoor environment for all.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* VALUES */}
      <section style={{ background: "#F6F5EF", padding: "80px 0" }}>
        <div
          style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 28px" }}
        >
          <div style={{ textAlign: "center", marginBottom: "46px" }}>
            <div
              style={{
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "#658461",
                marginBottom: "12px",
              }}
            >
              What we stand for
            </div>
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque'",
                fontWeight: 700,
                fontSize: "34px",
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              The values behind every visit
            </h2>
          </div>
          <div
            className="opwp-g4"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: "20px",
            }}
          >
            <div
              style={{
                background: "#fff",
                borderRadius: "16px",
                padding: "26px",
              }}
            >
              <div style={{ fontSize: "28px", marginBottom: "12px" }}>🏡</div>
              <h3
                style={{
                  fontFamily: "'Bricolage Grotesque'",
                  fontWeight: 700,
                  fontSize: "17px",
                  margin: "0 0 8px",
                }}
              >
                Family-owned
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: "13.5px",
                  lineHeight: 1.55,
                  color: "#5b6770",
                }}
              >
                Locally owned and operated — you&apos;re working with neighbors,
                not a franchise.
              </p>
            </div>
            <div
              style={{
                background: "#fff",
                borderRadius: "16px",
                padding: "26px",
              }}
            >
              <div style={{ fontSize: "28px", marginBottom: "12px" }}>🌿</div>
              <h3
                style={{
                  fontFamily: "'Bricolage Grotesque'",
                  fontWeight: 700,
                  fontSize: "17px",
                  margin: "0 0 8px",
                }}
              >
                Eco-friendly
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: "13.5px",
                  lineHeight: 1.55,
                  color: "#5b6770",
                }}
              >
                Pet-safe sanitizing and responsible disposal on every job.
              </p>
            </div>
            <div
              style={{
                background: "#fff",
                borderRadius: "16px",
                padding: "26px",
              }}
            >
              <div style={{ fontSize: "28px", marginBottom: "12px" }}>🤝</div>
              <h3
                style={{
                  fontFamily: "'Bricolage Grotesque'",
                  fontWeight: 700,
                  fontSize: "17px",
                  margin: "0 0 8px",
                }}
              >
                Dependable
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: "13.5px",
                  lineHeight: 1.55,
                  color: "#5b6770",
                }}
              >
                Consistent schedules, clear communication, and gate photos every
                time.
              </p>
            </div>
            <div
              style={{
                background: "#fff",
                borderRadius: "16px",
                padding: "26px",
              }}
            >
              <div style={{ fontSize: "28px", marginBottom: "12px" }}>❤️</div>
              <h3
                style={{
                  fontFamily: "'Bricolage Grotesque'",
                  fontWeight: 700,
                  fontSize: "17px",
                  margin: "0 0 8px",
                }}
              >
                Community-minded
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: "13.5px",
                  lineHeight: 1.55,
                  color: "#5b6770",
                }}
              >
                Proud supporters of pet welfare in the Toledo area.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* COMMUNITY */}
      <section style={{ background: "#14304A", color: "#fff", padding: "72px 0" }}>
        <div
          style={{
            maxWidth: "900px",
            margin: "0 auto",
            padding: "0 28px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "34px", marginBottom: "16px" }}>🐾</div>
          <h2
            style={{
              fontFamily: "'Bricolage Grotesque'",
              fontWeight: 700,
              fontSize: "30px",
              letterSpacing: "-0.02em",
              margin: "0 0 16px",
            }}
          >
            Supporting local pets
          </h2>
          <p
            style={{
              fontSize: "17px",
              lineHeight: 1.6,
              color: "#c4d2df",
              margin: 0,
            }}
          >
            We&apos;re proud to support the{" "}
            <a
              href="https://toledohumane.org/"
              style={{
                color: "#8fe06a",
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              Toledo Humane Society
            </a>
            , a local organization dedicated to the care and well-being of pets
            in our community. By keeping yards clean and safe, we help create
            healthier environments for pets and families throughout the Toledo
            area.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section style={{ background: "#fff", padding: "78px 0" }}>
        <div
          style={{
            maxWidth: "880px",
            margin: "0 auto",
            padding: "0 28px",
            textAlign: "center",
          }}
        >
          <h2
            style={{
              fontFamily: "'Bricolage Grotesque'",
              fontWeight: 800,
              fontSize: "36px",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              margin: "0 0 16px",
              color: "#1C2A33",
            }}
          >
            Let our family take care of your yard.
          </h2>
          <p
            style={{
              fontSize: "18px",
              lineHeight: 1.55,
              color: "#475259",
              margin: "0 0 30px",
            }}
          >
            Get your free quote and see why Toledo-area dog owners trust Ohio Pet
            Waste Pros.
          </p>
          <div
            style={{
              display: "flex",
              gap: "14px",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <Link
              href="/free-quote/"
              className="hov-cta"
              style={{
                background: "#4F9E3A",
                color: "#fff",
                textDecoration: "none",
                padding: "17px 34px",
                borderRadius: "12px",
                fontWeight: 800,
                fontSize: "17px",
                boxShadow: "0 14px 28px -12px rgba(79,158,58,.7)",
              }}
            >
              Get My Free Quote
            </Link>
            <a
              href="tel:419-262-2371"
              style={{
                background: "#F1F3EE",
                color: "#1C2A33",
                textDecoration: "none",
                padding: "17px 30px",
                borderRadius: "12px",
                fontWeight: 700,
                fontSize: "17px",
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
