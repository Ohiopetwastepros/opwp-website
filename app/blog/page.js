import Link from "next/link";
import { posts } from "@/data/blog";

export const metadata = {
  title: { absolute: "Dog Waste & Pet Care Blog | Ohio Pet Waste Pros" },
  description:
    "Toledo dog waste removal blog: poop-scooping tips, pricing guides, local pet guides, dog parks and pet health from Ohio Pet Waste Pros, serving Toledo, Sylvania, Perrysburg & SE Michigan.",
  alternates: { canonical: "/blog/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "https://ohiopetwastepros.com/blog/",
    siteName: "Ohio Pet Waste Pros",
    title: "Dog Waste & Pet Care Blog | Ohio Pet Waste Pros",
    description:
      "Poop-scooping tips, pricing guides and local pet guides from your local Toledo-area pros.",
    images: [
      "https://ohiopetwastepros.com/wp-content/uploads/2025/05/cropped-OPWP-CIRCLE-LOGO-11111111.png",
    ],
  },
};

const blogJsonLd = {
  "@context": "https://schema.org",
  "@type": "Blog",
  name: "Ohio Pet Waste Pros Blog",
  description:
    "Poop-scooping tips, pricing guides, local pet guides and pet health.",
  publisher: { "@type": "Organization", name: "Ohio Pet Waste Pros" },
};

const toSrc = (image) =>
  image && image.startsWith("assets/") ? "/" + image : image;

export default function BlogPage() {
  const all = posts || [];
  const featured = all[0] || null;
  const rest = all.slice(1);

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Ohio Pet Waste Pros Blog",
    itemListElement: all.map((a, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: "https://ohiopetwastepros.com/blog/" + a.slug + "/",
      name: a.title,
    })),
  };

  return (
    <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", color: "#1C2A33" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
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
              marginBottom: "20px",
            }}
          >
            From the blog
          </div>
          <h1
            style={{
              fontFamily: "'Bricolage Grotesque'",
              fontWeight: 800,
              fontSize: "45px",
              lineHeight: 1.02,
              letterSpacing: "-0.025em",
              margin: "0 0 16px",
            }}
          >
            Toledo dog scoop blog: tips, pricing &amp; local guides
          </h1>
          <p
            style={{
              fontSize: "18px",
              lineHeight: 1.55,
              color: "#c4d2df",
              margin: "0 auto",
              maxWidth: "580px",
            }}
          >
            Your go-to space for pet waste removal tips, service pricing guides,
            and local scooping insights across NW Ohio &amp; SE Michigan.
          </p>
        </div>
      </section>

      {/* FEATURED */}
      {featured && (
        <section style={{ background: "#fff", padding: "64px 0 30px" }}>
          <div
            style={{ maxWidth: "1100px", margin: "0 auto", padding: "0 28px" }}
          >
            <Link
              href={"/blog/" + featured.slug + "/"}
              className="opwp-gsplit"
              style={{
                display: "grid",
                gridTemplateColumns: "1.05fr 0.95fr",
                gap: "40px",
                alignItems: "center",
                textDecoration: "none",
                color: "inherit",
                background: "#F6F5EF",
                borderRadius: "22px",
                overflow: "hidden",
              }}
            >
              <img
                src={toSrc(featured.image)}
                alt={featured.alt || featured.title}
                style={{
                  width: "100%",
                  height: "340px",
                  objectFit: "cover",
                  display: "block",
                }}
              />
              <div style={{ padding: "10px 36px 10px 0" }}>
                <div
                  style={{
                    fontSize: "12.5px",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "#4F9E3A",
                    marginBottom: "12px",
                  }}
                >
                  Featured &middot; {featured.category}
                </div>
                <h2
                  style={{
                    fontFamily: "'Bricolage Grotesque'",
                    fontWeight: 700,
                    fontSize: "29px",
                    lineHeight: 1.12,
                    letterSpacing: "-0.02em",
                    margin: "0 0 14px",
                  }}
                >
                  {featured.title}
                </h2>
                <p
                  style={{
                    fontSize: "15.5px",
                    lineHeight: 1.6,
                    color: "#475259",
                    margin: "0 0 18px",
                  }}
                >
                  {featured.excerpt}
                </p>
                <span
                  style={{
                    color: "#1A3C5A",
                    fontWeight: 700,
                    fontSize: "15px",
                    borderBottom: "2px solid #4F9E3A",
                    paddingBottom: "3px",
                  }}
                >
                  Read article &rarr;
                </span>
              </div>
            </Link>
          </div>
        </section>
      )}

      {/* GRID */}
      <section style={{ background: "#fff", padding: "30px 0 84px" }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "0 28px" }}>
          <div
            className="opwp-g3"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3,1fr)",
              gap: "26px 26px",
            }}
          >
            {rest.map((a) => (
              <Link
                key={a.slug}
                href={"/blog/" + a.slug + "/"}
                style={{
                  textDecoration: "none",
                  color: "inherit",
                  display: "block",
                }}
              >
                <img
                  src={toSrc(a.image)}
                  alt={a.alt || a.title}
                  style={{
                    width: "100%",
                    height: "200px",
                    objectFit: "cover",
                    borderRadius: "16px",
                    marginBottom: "16px",
                    display: "block",
                  }}
                />
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "#658461",
                    marginBottom: "8px",
                  }}
                >
                  {a.category}
                </div>
                <h3
                  style={{
                    fontFamily: "'Bricolage Grotesque'",
                    fontWeight: 700,
                    fontSize: "19px",
                    lineHeight: 1.22,
                    margin: "0 0 8px",
                  }}
                >
                  {a.title}
                </h3>
                <p
                  style={{
                    fontSize: "14px",
                    lineHeight: 1.55,
                    color: "#5b6770",
                    margin: 0,
                  }}
                >
                  {a.excerpt}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section
        style={{
          background: "linear-gradient(160deg,#1F4566,#14304A)",
          color: "#fff",
          padding: "70px 0",
        }}
      >
        <div
          style={{
            maxWidth: "820px",
            margin: "0 auto",
            padding: "0 28px",
            textAlign: "center",
          }}
        >
          <h2
            style={{
              fontFamily: "'Bricolage Grotesque'",
              fontWeight: 800,
              fontSize: "34px",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              margin: "0 0 14px",
            }}
          >
            Spend less time scooping, more time with your dog.
          </h2>
          <p
            style={{
              fontSize: "17px",
              lineHeight: 1.55,
              color: "#c4d2df",
              margin: "0 0 28px",
            }}
          >
            Get your free quote and let our family keep your yard clean
            year-round.
          </p>
          <Link
            href="/free-quote/"
            className="hov-cta"
            style={{
              display: "inline-block",
              background: "#4F9E3A",
              color: "#fff",
              textDecoration: "none",
              padding: "16px 32px",
              borderRadius: "12px",
              fontWeight: 800,
              fontSize: "16.5px",
              boxShadow: "0 14px 28px -12px rgba(79,158,58,.7)",
            }}
          >
            Get My Free Quote
          </Link>
        </div>
      </section>
    </div>
  );
}
