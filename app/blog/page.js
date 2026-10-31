import Link from "next/link";
import { posts } from "@/data/blog";
import { site } from "@/lib/site";

export const metadata = {
  title: { absolute: "Dog Poop & Yard Care Advice | Ohio Pet Waste Pros" },
  description:
    "Simple, practical answers about dog poop cleanup, yard health, pricing, and pet-friendly places from local NW Ohio pet waste professionals.",
  alternates: { canonical: "/blog/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: `${site.url}/blog/`,
    siteName: "Ohio Pet Waste Pros",
    title: "Dog Poop & Yard Care Advice | Ohio Pet Waste Pros",
    description:
      "Clear answers and local advice for cleaner, healthier yards across NW Ohio and SE Michigan.",
    images: [`${site.url}/assets/photos/we-scoop-banner.webp`],
  },
  twitter: {
    card: "summary_large_image",
    title: "Dog Poop & Yard Care Advice | Ohio Pet Waste Pros",
    description: "Clear answers and local advice for cleaner, healthier yards.",
    images: [`${site.url}/assets/photos/we-scoop-banner.webp`],
  },
};

const toSrc = (image) =>
  image && image.startsWith("assets/") ? "/" + image : image;

const toId = (value) =>
  value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const toIsoDate = (date) => {
  const value = new Date(date);
  return Number.isNaN(value.valueOf()) ? undefined : value.toISOString().slice(0, 10);
};

export default function BlogPage() {
  const all = posts || [];
  const featured = all[0] || null;
  const rest = all.slice(1);
  const categories = [...new Set(all.map((post) => post.category))];

  const blogJsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Ohio Pet Waste Pros Blog",
    description:
      "Practical dog waste cleanup, yard health, pricing, and local pet advice for NW Ohio and SE Michigan.",
    url: `${site.url}/blog/`,
    publisher: {
      "@type": "Organization",
      name: "Ohio Pet Waste Pros",
      url: site.url,
    },
    blogPost: all.map((post) => ({
      "@type": "BlogPosting",
      headline: post.title,
      url: `${site.url}/blog/${post.slug}/`,
      ...(toIsoDate(post.date) ? { datePublished: toIsoDate(post.date) } : {}),
    })),
  };

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Ohio Pet Waste Pros articles",
    itemListElement: all.map((post, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${site.url}/blog/${post.slug}/`,
      name: post.title,
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

      <header className="opwp-blog-hero">
        <div style={{ maxWidth: "980px", margin: "0 auto", padding: "62px 28px 58px" }}>
          <div style={{ color: "#9FD586", fontSize: "13px", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: "17px" }}>
            Advice from your local scoop crew
          </div>
          <h1 style={{ maxWidth: "760px", fontSize: "clamp(38px, 5.5vw, 62px)", lineHeight: 1.01, letterSpacing: "-.035em", margin: "0 0 19px" }}>
            Straight answers for cleaner, healthier yards.
          </h1>
          <p style={{ maxWidth: "690px", fontSize: "18px", lineHeight: 1.65, color: "#C8D6E2", margin: 0 }}>
            Simple dog poop cleanup advice, local service guides, and yard-care answers from the family behind Ohio Pet Waste Pros.
          </p>
        </div>
      </header>

      <div className="opwp-blog-main">
        {featured && (
          <section aria-labelledby="featured-article" style={{ padding: "64px 0 44px" }}>
            <div style={{ maxWidth: "1080px", margin: "0 auto", padding: "0 28px" }}>
              <div style={{ color: "#658461", fontSize: "12.5px", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: "16px" }}>
                New from the blog
              </div>
              <article>
                <Link href={`/blog/${featured.slug}/`} className="opwp-blog-feature" style={{ color: "inherit", textDecoration: "none" }}>
                  <img src={toSrc(featured.image)} alt={featured.alt || featured.title} style={{ objectPosition: featured.imagePosition || "center" }} />
                  <div className="opwp-blog-feature-copy">
                    <div className="opwp-blog-meta">
                      <span>{featured.category}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={toIsoDate(featured.date)}>{featured.date}</time>
                    </div>
                    <h2 id="featured-article">{featured.title}</h2>
                    <p>{featured.excerpt}</p>
                    <span className="opwp-blog-read">Get the answer <span aria-hidden="true">→</span></span>
                  </div>
                </Link>
              </article>
            </div>
          </section>
        )}

        <nav aria-label="Browse blog topics" className="opwp-blog-topics">
          <div style={{ maxWidth: "1080px", margin: "0 auto", padding: "0 28px" }}>
            <span>Browse by topic</span>
            {categories.map((category) => (
              <a key={category} href={`#${toId(category)}`}>{category}</a>
            ))}
          </div>
        </nav>

        <section aria-labelledby="all-articles" style={{ padding: "54px 0 82px" }}>
          <div style={{ maxWidth: "1080px", margin: "0 auto", padding: "0 28px" }}>
            <div className="opwp-blog-directory-heading">
              <div>
                <div style={{ color: "#658461", fontSize: "12.5px", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: "8px" }}>
                  Practical help, organized
                </div>
                <h2 id="all-articles">Explore all articles</h2>
              </div>
              <p>Choose a question below for a short, useful answer—without the fluff.</p>
            </div>

            {categories.map((category) => {
              const categoryPosts = rest.filter((post) => post.category === category);
              if (!categoryPosts.length) return null;

              return (
                <section key={category} id={toId(category)} className="opwp-blog-topic-section" aria-labelledby={`${toId(category)}-heading`}>
                  <div className="opwp-blog-topic-label">
                    <h3 id={`${toId(category)}-heading`}>{category}</h3>
                    <span>{categoryPosts.length} {categoryPosts.length === 1 ? "article" : "articles"}</span>
                  </div>
                  <div>
                    {categoryPosts.map((post) => (
                      <article key={post.slug} className="opwp-blog-row">
                        <Link href={`/blog/${post.slug}/`} aria-label={`Read: ${post.title}`}>
                          <img src={toSrc(post.image)} alt={post.alt || ""} loading="lazy" style={{ objectPosition: post.imagePosition || "center" }} />
                          <div className="opwp-blog-row-copy">
                            <time dateTime={toIsoDate(post.date)}>{post.date}</time>
                            <h4>{post.title}</h4>
                            <p>{post.excerpt}</p>
                          </div>
                          <span className="opwp-blog-arrow" aria-hidden="true">→</span>
                        </Link>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </section>

        <section className="opwp-blog-cta">
          <div>
            <p>Prefer a clean yard without the reading?</p>
            <h2>We’ll handle the dirty work.</h2>
            <Link href="/free-quote/" className="hov-cta">Get My Free Quote</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
