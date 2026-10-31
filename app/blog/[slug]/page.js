import Link from "next/link";
import { notFound } from "next/navigation";
import { posts, getPost } from "@/data/blog";
import { site } from "@/lib/site";

export function generateStaticParams() {
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const p = getPost(slug);
  if (!p) return {};
  return {
    title: p.title,
    description: p.excerpt,
    alternates: { canonical: `/blog/${p.slug}/` },
    openGraph: {
      type: "article",
      title: p.title,
      description: p.excerpt,
      url: `${site.url}/blog/${p.slug}/`,
      siteName: "Ohio Pet Waste Pros",
      images: [`${site.url}${p.image}`],
    },
    twitter: { card: "summary_large_image" },
  };
}

function isoDate(date) {
  const d = new Date(date);
  return isNaN(d) ? undefined : d.toISOString().slice(0, 10);
}

export default async function Page({ params }) {
  const { slug } = await params;
  const p = getPost(slug);
  if (!p) notFound();

  const url = `${site.url}/blog/${p.slug}/`;
  const iso = isoDate(p.date);

  // Related posts: next 3 by index, wrapping around.
  const idx = posts.findIndex((x) => x.slug === p.slug);
  const related = [1, 2, 3].map((n) => posts[(idx + n) % posts.length]);

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    headline: p.title,
    description: p.excerpt,
    image: [`${site.url}${p.image}`],
    articleSection: p.category,
    ...(iso ? { datePublished: iso, dateModified: iso } : {}),
    author: {
      "@type": "Organization",
      name: "Ohio Pet Waste Pros",
      url: `${site.url}/about-our-pet-waste-removal-team/`,
    },
    publisher: {
      "@type": "Organization",
      name: "Ohio Pet Waste Pros",
      logo: {
        "@type": "ImageObject",
        url: "https://www.ohiopetwastepros.com/wp-content/uploads/2025/05/cropped-OPWP-CIRCLE-LOGO-11111111.png",
      },
    },
    isAccessibleForFree: true,
    url,
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${site.url}/` },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${site.url}/blog/` },
      { "@type": "ListItem", position: 3, name: p.title, item: url },
    ],
  };

  return (
    <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", color: "#1C2A33" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      {/* ARTICLE HERO */}
      <section style={{ background: "linear-gradient(160deg,#1F4566,#1A3C5A 55%,#14304A)", color: "#fff" }}>
        <div style={{ maxWidth: "820px", margin: "0 auto", padding: "50px 28px 46px" }}>
          <Link
            href="/blog/"
            style={{ color: "#9fb8cf", textDecoration: "none", fontSize: "14px", fontWeight: 600 }}
          >
            &larr; All articles
          </Link>
          <div
            style={{
              fontSize: "12.5px",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#8fe06a",
              margin: "18px 0 14px",
            }}
          >
            {p.category}
          </div>
          <h1
            style={{
              fontFamily: "'Bricolage Grotesque'",
              fontWeight: 800,
              fontSize: "39px",
              lineHeight: 1.06,
              letterSpacing: "-0.02em",
              margin: "0 0 16px",
            }}
          >
            {p.title}
          </h1>
          <div style={{ fontSize: "14.5px", color: "#c4d2df" }}>Posted {p.date} &middot; Ohio Pet Waste Pros</div>
        </div>
      </section>

      {/* BODY */}
      <article style={{ maxWidth: "760px", margin: "0 auto", padding: "50px 28px 28px" }}>
        <img
          src={p.image}
          alt={p.alt || p.title}
          style={{
            width: "100%",
            height: "380px",
            objectFit: "cover",
            objectPosition: p.imagePosition || "center",
            borderRadius: "18px",
            marginBottom: "34px",
            display: "block",
          }}
        />
        <p style={{ fontSize: "19px", lineHeight: 1.6, color: "#2b3942", fontWeight: 600, margin: "0 0 26px" }}>
          {p.excerpt}
        </p>
        {p.quickAnswer && (
          <div
            style={{
              background: "#EEF6EA",
              border: "1px solid #CFE5C6",
              borderRadius: "16px",
              padding: "22px 24px",
              margin: "0 0 30px",
            }}
          >
            <div style={{ color: "#2F6825", fontSize: "13px", fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase", marginBottom: "7px" }}>
              The short answer
            </div>
            <p style={{ fontSize: "17px", lineHeight: 1.65, color: "#294424", margin: 0 }}>
              {p.quickAnswer}
            </p>
          </div>
        )}
        {p.comparison && (
          <div
            className="opwp-blog-comparison"
            aria-label="Comparison of dog poop and lawn fertilizer"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", margin: "0 0 38px" }}
          >
            {p.comparison.map((item) => {
              const safe = item.tone === "safe";
              return (
                <div
                  key={item.label}
                  style={{
                    border: `1px solid ${safe ? "#CFE5C6" : "#F0CDC4"}`,
                    background: safe ? "#F4F9F1" : "#FFF6F3",
                    borderRadius: "16px",
                    padding: "22px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "13px" }}>
                    <span
                      aria-hidden="true"
                      style={{
                        display: "grid",
                        placeItems: "center",
                        width: "30px",
                        height: "30px",
                        borderRadius: "50%",
                        background: safe ? "#4F9E3A" : "#C75B45",
                        color: "#fff",
                        fontWeight: 900,
                      }}
                    >
                      {safe ? "✓" : "×"}
                    </span>
                    <h2 style={{ fontSize: "20px", lineHeight: 1.2, margin: 0 }}>{item.label}</h2>
                  </div>
                  <ul style={{ paddingLeft: "20px", margin: 0, color: "#3d4954" }}>
                    {item.items.map((text) => (
                      <li key={text} style={{ fontSize: "15.5px", lineHeight: 1.55, marginBottom: "8px" }}>{text}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
        {p.sections
          ? p.sections.map((section) => (
              <section key={section.title} style={{ margin: "0 0 34px" }}>
                <h2 style={{ fontSize: "26px", lineHeight: 1.18, color: "#1C2A33", margin: "0 0 14px" }}>
                  {section.title}
                </h2>
                {section.paragraphs?.map((para) => (
                  <p key={para} style={{ fontSize: "17px", lineHeight: 1.72, color: "#3d4954", margin: "0 0 17px" }}>
                    {para}
                  </p>
                ))}
                {section.bullets && (
                  <ul style={{ paddingLeft: "22px", margin: 0, color: "#3d4954" }}>
                    {section.bullets.map((bullet) => (
                      <li key={bullet} style={{ fontSize: "17px", lineHeight: 1.65, marginBottom: "10px", paddingLeft: "4px" }}>
                        {bullet}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))
          : p.paragraphs.map((para, i) => (
              <p key={i} style={{ fontSize: "17px", lineHeight: 1.72, color: "#3d4954", margin: "0 0 22px" }}>
                {para}
              </p>
            ))}
        {p.tip && (
          <div
            style={{
              background: "#EEF6EA",
              borderLeft: "4px solid #4F9E3A",
              borderRadius: "0 12px 12px 0",
              padding: "20px 24px",
              margin: "6px 0 24px",
              fontSize: "16.5px",
              lineHeight: 1.6,
              color: "#2f5a25",
            }}
          >
            &#128161; {p.tip}
          </div>
        )}
        {p.source && (
          <p style={{ fontSize: "15px", color: "#6b7680", margin: "0 0 8px" }}>
            Further reading:{" "}
            <a
              href={p.source.href}
              target="_blank"
              rel="noopener"
              style={{ color: "#4F9E3A", fontWeight: 700, textDecoration: "none" }}
            >
              {p.source.label}
            </a>
          </p>
        )}
        {p.sources && (
          <div style={{ margin: "2px 0 8px" }}>
            <div style={{ fontSize: "15px", color: "#6b7680", marginBottom: "7px" }}>Sources and further reading:</div>
            <ul style={{ margin: 0, paddingLeft: "20px" }}>
              {p.sources.map((source) => (
                <li key={source.href} style={{ color: "#6b7680", marginBottom: "6px" }}>
                  <a href={source.href} target="_blank" rel="noopener" style={{ color: "#4F9E3A", fontWeight: 700, textDecoration: "none" }}>
                    {source.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </article>

      {/* INLINE CTA */}
      <section style={{ maxWidth: "760px", margin: "14px auto 0", padding: "0 28px" }}>
        <div style={{ background: "#14304A", color: "#fff", borderRadius: "20px", padding: "34px", textAlign: "center" }}>
          <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "26px", margin: "0 0 10px" }}>
            Want it handled for you?
          </h2>
          <p style={{ fontSize: "16px", color: "#c4d2df", margin: "0 0 22px" }}>
            Get a free quote from your local, family-owned NW Ohio team.
          </p>
          <Link
            href="/free-quote/"
            className="hov-cta"
            style={{
              display: "inline-block",
              background: "#4F9E3A",
              color: "#fff",
              textDecoration: "none",
              padding: "15px 30px",
              borderRadius: "11px",
              fontWeight: 800,
              fontSize: "16px",
              boxShadow: "0 12px 26px -12px rgba(79,158,58,.7)",
            }}
          >
            Get My Free Quote
          </Link>
        </div>
      </section>

      {/* RELATED */}
      <section style={{ background: "#fff", padding: "60px 0 84px" }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "0 28px" }}>
          <h2
            style={{
              fontFamily: "'Bricolage Grotesque'",
              fontWeight: 700,
              fontSize: "26px",
              letterSpacing: "-0.02em",
              margin: "0 0 26px",
            }}
          >
            More from the blog
          </h2>
          <div className="opwp-g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "26px" }}>
            {related.map((r) => (
              <Link
                key={r.slug}
                href={`/blog/${r.slug}/`}
                style={{ textDecoration: "none", color: "inherit", display: "block" }}
              >
                <img
                  src={r.image}
                  alt={r.title}
                  style={{
                    width: "100%",
                    height: "180px",
                    objectFit: "cover",
                    borderRadius: "14px",
                    marginBottom: "14px",
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
                    marginBottom: "6px",
                  }}
                >
                  {r.category}
                </div>
                <h3
                  style={{
                    fontFamily: "'Bricolage Grotesque'",
                    fontWeight: 700,
                    fontSize: "17px",
                    lineHeight: 1.25,
                    margin: 0,
                  }}
                >
                  {r.title}
                </h3>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
