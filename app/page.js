import Link from "next/link";
import GalleryCarousel from "@/components/GalleryCarousel";

export const metadata = {
  title: "Dog Poop Removal in Toledo, Sylvania & Perrysburg | Ohio Pet Waste Pros",
  description:
    "Ohio Pet Waste Pros is a family-owned pet waste removal service in Toledo, Sylvania, Perrysburg & SE Michigan. Weekly & bi-weekly pooper scooper service near you — gate photos, double-bagging, eco-friendly sanitizing. Pricing depends on how many dogs you have and how often you'd like service — get your exact price with our instant quote.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    title: "Dog Poop Removal in Toledo, Sylvania & Perrysburg | Ohio Pet Waste Pros",
    description:
      "Family-owned dog waste removal in Greater Toledo & SE Michigan. Gate photos, hauled-away waste, eco-friendly sanitizing. Get your exact price with our instant quote.",
    url: "https://ohiopetwastepros.com/",
    siteName: "Ohio Pet Waste Pros",
    images: ["https://ohiopetwastepros.com/wp-content/uploads/2025/05/cropped-OPWP-CIRCLE-LOGO-11111111.png"],
  },
  twitter: { card: "summary_large_image" },
  other: {
    "geo.region": "US-OH",
    "geo.placename": "Holland, Ohio",
  },
};

const localBusinessJsonLd = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": "https://ohiopetwastepros.com/#business",
  name: "Ohio Pet Waste Pros",
  image: "https://ohiopetwastepros.com/wp-content/uploads/2025/05/cropped-OPWP-CIRCLE-LOGO-11111111.png",
  description:
    "Family-owned dog poop removal and pet waste cleanup serving Toledo, Sylvania, Perrysburg and Southeast Michigan.",
  telephone: "+14192622371",
  email: "Craig@ohiopetwastepros.com",
  url: "https://ohiopetwastepros.com/",
  priceRange: "$$",
  address: { "@type": "PostalAddress", addressLocality: "Holland", addressRegion: "OH", addressCountry: "US" },
  areaServed: ["Toledo OH", "Sylvania OH", "Perrysburg OH", "Maumee OH", "Holland OH", "Whitehouse OH", "Waterville OH", "Monclova OH", "Rossford OH", "Oregon OH", "Ottawa Hills OH", "Temperance MI", "Lambertville MI", "Bedford Township MI"],
  geo: { "@type": "GeoCoordinates", latitude: 41.6217, longitude: -83.7141 },
  knowsAbout: ["pet waste removal service", "pooper scooper service", "dog poop removal", "dog waste removal", "yard sanitizing and deodorizing"],
  openingHoursSpecification: [
    { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "08:00", closes: "18:00" },
    { "@type": "OpeningHoursSpecification", dayOfWeek: "Saturday", opens: "09:00", closes: "14:00" },
  ],
  sameAs: ["https://www.facebook.com/profile.php?id=61575239054687", "https://www.instagram.com/ohio.pet.waste.pros.llc"],
  aggregateRating: { "@type": "AggregateRating", ratingValue: "5.0", reviewCount: "159" },
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Ohio Pet Waste Pros",
  url: "https://ohiopetwastepros.com/",
  publisher: { "@id": "https://ohiopetwastepros.com/#business" },
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    { "@type": "Question", name: "How does Ohio Pet Waste Pros ensure a thorough, safe cleanup?", acceptedAnswer: { "@type": "Answer", text: "Our technician carefully walks your yard, removes all visible dog waste, double-bags it, and disposes of it in your trash bin. We take a photo of your closed gate after every visit, and offer optional pet-safe sanitizing and deodorizing." } },
    { "@type": "Question", name: "How much does dog poop removal cost?", acceptedAnswer: { "@type": "Answer", text: "Pricing depends on how many dogs you have and how often you'd like service — get your exact price with our instant quote. Call (419) 262-2371 or request a free quote to get pricing for your yard." } },
    { "@type": "Question", name: "What areas do you serve?", acceptedAnswer: { "@type": "Answer", text: "We are a Holland, Ohio family business serving Toledo, Sylvania, Perrysburg, Maumee and the surrounding NW Ohio and SE Michigan communities." } },
    { "@type": "Question", name: "Do I need to be home for service?", acceptedAnswer: { "@type": "Answer", text: "No. As long as we have safe access to your yard, we can complete service while you are at work or away." } },
    { "@type": "Question", name: "Is the waste removed from my property?", acceptedAnswer: { "@type": "Answer", text: "We double-bag the waste and place it in your trash bin. For added convenience, we also offer a haul-away service for a small fee." } },
    { "@type": "Question", name: "Do you offer commercial pet waste services?", acceptedAnswer: { "@type": "Answer", text: "Yes. We customize, install and maintain pet waste stations and provide cleanups and sanitizing for HOAs, apartment complexes and commercial properties." } },
  ],
};

const reviews = [
  { name: "Carrie", initial: "C", text: "So far so good! Very thorough and very easy to get ahold of. Our 3 dog household couldn’t be happier! Thanks Pet Waste Pros!" },
  { name: "Charlene", initial: "C", text: "They were on time and the young man was polite and did just as I was told he would. I was happy to get the picture showing my gate closed to keep my fur baby safe." },
  { name: "Gail", initial: "G", text: "Tony came to our house and did an AMAZING job. Anyone in need of dog waste clean up, look no farther than Ohio Pet Waste Pros!" },
  { name: "Michelle", initial: "M", text: "Jacob did an excellent job and made sure the gate was locked before he left. I’m a picky person and would definitely recommend Ohio Pet Waste Pros. Thank you!" },
  { name: "Nikole", initial: "N", text: "Great service, booking was simple and easy. Affordable. Jacob was great — we didn’t even know he was there and it was a quick clean up." },
  { name: "Jordan", initial: "J", text: "Great service, quick scheduling, and excellent communication." },
  { name: "Terri", initial: "T", text: "Very thorough and efficient and a very pleasant person. Thank you for the good job done." },
  { name: "Tina", initial: "T", text: "This service is a game changer!!! Amazing and appreciated!!!" },
  { name: "Joyce", initial: "J", text: "He was very thorough and pretty quick. Good job!" },
  { name: "Lori", initial: "L", text: "I haven’t been able to go outside because I’m non weight bearing, but it looked like he did a great job." },
];
const reviewsLoop = reviews.concat(reviews);

const areas = ["Toledo", "Sylvania", "Perrysburg", "Maumee", "Holland", "Whitehouse", "Waterville", "Monclova", "Rossford", "Oregon", "Ottawa Hills", "Berkey", "Swanton", "Bowling Green", "Temperance, MI", "Lambertville, MI", "Ottawa Lake, MI", "Bedford Township, MI"];

const faqData = [
  { q: "How do you ensure a thorough, safe cleanup?", a: "Our technician carefully walks your yard, removes all visible dog waste, double-bags it, and disposes of it in your trash bin. We photograph your closed gate after every visit, and offer optional pet-safe sanitizing and yard deodorizing." },
  { q: "How much does service cost and how do I schedule?", a: "Pricing depends on how many dogs you have and how often you’d like service — get your exact price with our instant quote. Just call (419) 262-2371 or click “Free Quote” to get pricing and book your first cleanup." },
  { q: "What areas do you serve, and how often?", a: "We’re a Holland, Ohio family business serving Toledo, Sylvania, Perrysburg, Maumee and surrounding NW Ohio & SE Michigan communities, with flexible weekly or bi-weekly visits on a consistent day each week." },
  { q: "Do I need to be home for service?", a: "No. As long as we have safe access to your yard, we can complete service while you’re at work, running errands, or otherwise away." },
  { q: "Is the waste removed from my property?", a: "We double-bag the waste and place it in your trash bin. For added convenience, we also offer a haul-away service to remove it from your property entirely for a small fee." },
  { q: "Do you offer commercial pet waste services?", a: "Yes! We customize, install and maintain pet waste stations and provide cleanups and sanitizing for HOAs, apartment complexes, and commercial properties." },
];

export default function HomePage() {
  return (
    <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", color: "#1C2A33" }}>
      <style>{`@keyframes opwp-reviews { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* ===== HERO ===== */}
      <section style={{ background: "linear-gradient(160deg,#1F4566 0%,#1A3C5A 55%,#14304A 100%)", color: "#fff", position: "relative", overflow: "hidden" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "74px 28px 92px", display: "grid", gridTemplateColumns: "1.08fr 0.92fr", gap: 54, alignItems: "center" }} className="opwp-gsplit">
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 9, border: "1px solid rgba(255,255,255,.22)", borderRadius: 99, padding: "7px 15px", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#cdd8e2", marginBottom: 24 }}>
              <span style={{ color: "#E7A734" }}>★★★★★</span> Toledo · Sylvania · Perrysburg · SE Michigan
            </div>
            <h1 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 57, lineHeight: 0.99, letterSpacing: "-0.025em", margin: "0 0 22px" }}>The chore you can finally stop doing.</h1>
            <p style={{ fontSize: 19, lineHeight: 1.55, color: "#c4d2df", margin: "0 0 34px", maxWidth: 500 }}>Ohio Pet Waste Pros is your local, family-run pooper scooper service. Reliable weekly cleanups, a gate photo after every visit, double-bagged waste, and eco-friendly sanitizing and deodorizing — so your yard stays clean, safe, and ready to enjoy.</p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 30 }}>
              <Link href="/free-quote/" className="hov-cta" style={{ background: "#4F9E3A", color: "#fff", textDecoration: "none", padding: "16px 30px", borderRadius: 11, fontWeight: 800, fontSize: 16.5, boxShadow: "0 12px 26px -10px rgba(79,158,58,.7)" }}>Build My Plan — Free Quote</Link>
              <a href="tel:419-262-2371" className="hov-white-08" style={{ background: "rgba(255,255,255,.1)", border: "1.5px solid rgba(255,255,255,.3)", color: "#fff", textDecoration: "none", padding: "16px 28px", borderRadius: 11, fontWeight: 700, fontSize: 16.5 }}>Call 419-262-2371</a>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", color: "#aebfce", fontSize: 14, fontWeight: 600 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ color: "#8fe06a" }}>✓</span> No contracts</span>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ color: "#8fe06a" }}>✓</span> Family-owned</span>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ color: "#8fe06a" }}>✓</span> Eco-friendly</span>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ color: "#8fe06a" }}>✓</span> Fully insured</span>
            </div>
          </div>
          <div style={{ position: "relative" }}>
            <img src="/assets/photos/hero-craig-driveway.webp" alt="Ohio Pet Waste Pros technician with scooping equipment in a Toledo-area driveway" style={{ width: "100%", aspectRatio: "4/5", objectFit: "cover", borderRadius: 22, boxShadow: "0 30px 60px -26px rgba(0,0,0,.6)" }} />
          </div>
        </div>
      </section>

      {/* ===== TRUST STRIP ===== */}
      <section style={{ background: "#fff", borderBottom: "1px solid #ece9df" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "22px 28px", display: "flex", flexWrap: "wrap", gap: "14px 30px", justifyContent: "center", alignItems: "center", fontSize: 14.5, fontWeight: 700, color: "#3a4750" }}>
          <span>📷 Gate photo every visit</span>
          <span style={{ color: "#dcdcd0" }}>|</span>
          <span>♻️ Waste double-bagged &amp; hauled away</span>
          <span style={{ color: "#dcdcd0" }}>|</span>
          <span>🌿 Eco-friendly sanitizing</span>
          <span style={{ color: "#dcdcd0" }}>|</span>
          <span>🏡 Locally owned in Holland, OH</span>
        </div>
      </section>

      {/* ===== REVIEWS MARQUEE ===== */}
      <section style={{ background: "#F6F5EF", padding: "64px 0 70px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px", textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 10 }}>Local proof</div>
          <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 34, letterSpacing: "-0.02em", margin: "0 0 12px" }}>Trusted by dog owners across Greater Toledo</h2>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 15, color: "#475259", fontWeight: 600 }}>
            <span style={{ color: "#E7A734", letterSpacing: "2px", fontSize: 18 }}>★★★★★</span>
            Real, verified reviews from Toledo-area dog owners
          </div>
        </div>
        <div style={{ overflow: "hidden", WebkitMaskImage: "linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)", maskImage: "linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)" }}>
          <div style={{ display: "flex", gap: 18, width: "max-content", animation: "opwp-reviews 60s linear infinite" }}>
            {reviewsLoop.map((r, i) => (
              <div key={i} style={{ width: 320, background: "#fff", border: "1px solid #ece9df", borderRadius: 16, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,.04)", flex: "none" }}>
                <div style={{ color: "#E7A734", letterSpacing: "2px", fontSize: 15, marginBottom: 12 }}>★★★★★</div>
                <p style={{ margin: "0 0 16px", fontSize: 14.5, lineHeight: 1.55, color: "#36424b" }}>{r.text}</p>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#1A3C5A", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>{r.initial}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#1C2A33" }}>{r.name}</div>
                    <div style={{ fontSize: 11.5, color: "#8a96a0" }}>Verified Google review</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FAMILY RUN ===== */}
      <section style={{ background: "#fff", padding: "84px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px", display: "grid", gridTemplateColumns: "0.95fr 1.05fr", gap: 56, alignItems: "center" }} className="opwp-gsplit">
          <div style={{ position: "relative" }}>
            <img src="/assets/photos/team-new-sign.webp" alt="The family team behind Ohio Pet Waste Pros with their We Scoop Dog Poop sign" style={{ width: "100%", aspectRatio: "5/6", objectFit: "cover", borderRadius: 22, boxShadow: "0 24px 48px -24px rgba(20,48,74,.4)" }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 12 }}>Family-run &amp; dog-loving</div>
            <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 38, lineHeight: 1.05, letterSpacing: "-0.02em", margin: "0 0 18px" }}>The part of dog ownership you can finally hand off.</h2>
            <p style={{ fontSize: 17, lineHeight: 1.6, color: "#475259", margin: "0 0 26px", maxWidth: 520 }}>We&apos;re a local, family-owned business in NW Ohio &amp; SE Michigan — built for homeowners, seniors, and busy families who want their yard clean, safe, and ready to enjoy without planning the weekend around a scooper.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}><span style={{ color: "#4F9E3A", fontSize: 18, marginTop: 1 }}>✓</span><span style={{ fontSize: 15.5, lineHeight: 1.5, color: "#36424b" }}><strong>Waste is hauled away or double-bagged</strong> — never left lying in your yard.</span></div>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}><span style={{ color: "#4F9E3A", fontSize: 18, marginTop: 1 }}>✓</span><span style={{ fontSize: 15.5, lineHeight: 1.5, color: "#36424b" }}><strong>A photo of your closed gate</strong> after every visit, so your pets stay safe.</span></div>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}><span style={{ color: "#4F9E3A", fontSize: 18, marginTop: 1 }}>✓</span><span style={{ fontSize: 15.5, lineHeight: 1.5, color: "#36424b" }}><strong>No contracts</strong> — keep service only as long as it helps.</span></div>
              <div style={{ display: "flex", gap: 13, alignItems: "flex-start" }}><span style={{ color: "#4F9E3A", fontSize: 18, marginTop: 1 }}>✓</span><span style={{ fontSize: 15.5, lineHeight: 1.5, color: "#36424b" }}><strong>Eco-friendly, pet-safe sanitizing</strong> and equipment cleaned between every yard.</span></div>
            </div>
            <Link href="/about-our-pet-waste-removal-team/" style={{ display: "inline-block", marginTop: 30, color: "#1A3C5A", fontWeight: 700, fontSize: 15.5, textDecoration: "none", borderBottom: "2px solid #4F9E3A", paddingBottom: 3 }}>Meet the team →</Link>
          </div>
        </div>
      </section>

      {/* ===== SERVICE STANDARDS ===== */}
      <section style={{ background: "#14304A", color: "#fff", padding: "80px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#8fb0d0", marginBottom: 12 }}>Why homeowners trust us</div>
            <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 36, letterSpacing: "-0.02em", margin: 0 }}>Premium service standards, not vague promises</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }} className="opwp-g4">
            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 28 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: "#4F9E3A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 18 }}>📷</div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 18, margin: "0 0 9px" }}>Gate security assurance</h3>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#aebfce" }}>We photograph your closed gate after every cleanup, confirming your yard is secure and your pets are safe.</p>
            </div>
            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 28 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: "#4F9E3A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 18 }}>♻️</div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 18, margin: "0 0 9px" }}>Discreet disposal</h3>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#aebfce" }}>Waste is carefully double-bagged and tucked into your trash bin — clean, odor-free, and out of sight.</p>
            </div>
            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 28 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: "#4F9E3A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 18 }}>💬</div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 18, margin: "0 0 9px" }}>Service updates</h3>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#aebfce" }}>A quick text before we arrive and after we finish keeps you informed without needing to be home.</p>
            </div>
            <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 18, padding: 28 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: "#4F9E3A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 18 }}>🧴</div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 18, margin: "0 0 9px" }}>Sanitized equipment</h3>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#aebfce" }}>Tools are disinfected with kennel-grade, eco-friendly solution between every property to stop the spread of bacteria.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== SERVICES ===== */}
      <section style={{ background: "#fff", padding: "84px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ marginBottom: 40, maxWidth: 620 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 12 }}>Services</div>
            <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 36, letterSpacing: "-0.02em", margin: "0 0 12px" }}>Pick the cleanup your yard needs</h2>
            <p style={{ fontSize: 17, lineHeight: 1.55, color: "#475259", margin: 0 }}>Most clients start with weekly service — it keeps dog waste from ever becoming a bigger job.</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 22, marginBottom: 22 }} className="opwp-g3">
            <Link href="/weekly-dog-poop-removal/" style={{ textDecoration: "none", color: "inherit", border: "1px solid #ece9df", borderRadius: 18, overflow: "hidden", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.04)", display: "block" }}>
              <img src="/assets/photos/scooping-bell.webp" alt="Weekly dog poop removal in a Toledo-area residential yard" style={{ width: "100%", height: 180, objectFit: "cover" }} />
              <div style={{ padding: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#658461", marginBottom: 8 }}>Most popular</div>
                <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 21, margin: "0 0 9px" }}>Weekly cleanups</h3>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "#475259" }}>A dependable weekly route keeps your yard clean, safe, and ready to use — the easiest way to stay ahead of it.</p>
              </div>
            </Link>
            <Link href="/bi-weekly-dog-poop-removal/" style={{ textDecoration: "none", color: "inherit", border: "1px solid #ece9df", borderRadius: 18, overflow: "hidden", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.04)", display: "block" }}>
              <img src="/assets/photos/craig-standing-horizontal.webp" alt="Bi-weekly dog waste removal service" style={{ width: "100%", height: 180, objectFit: "cover" }} />
              <div style={{ padding: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#658461", marginBottom: 8 }}>Lighter-use yards</div>
                <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 21, margin: "0 0 9px" }}>Bi-weekly cleanups</h3>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "#475259" }}>Every-other-week service for yards that still need dependable, professional pet waste removal.</p>
              </div>
            </Link>
            <Link href="/one-time-yard-cleanup/" style={{ textDecoration: "none", color: "inherit", border: "1px solid #ece9df", borderRadius: 18, overflow: "hidden", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.04)", display: "block" }}>
              <img src="/assets/photos/cody-scooping-vest.webp" alt="One-time and spring cleanup dog waste removal" style={{ width: "100%", height: 180, objectFit: "cover" }} />
              <div style={{ padding: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#658461", marginBottom: 8 }}>Fresh start</div>
                <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 21, margin: "0 0 9px" }}>One-time &amp; spring cleanup</h3>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "#475259" }}>Get a built-up yard back under control before guests, mowing, or starting recurring service.</p>
              </div>
            </Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }} className="opwp-g4">
            <div style={{ background: "#F6F5EF", borderRadius: 14, padding: 22 }}>
              <h4 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 16, margin: "0 0 7px" }}>🌿 Yard deodorizing</h4>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "#5b6770" }}>Neutralizes pet odors and leaves your yard fresh.</p>
            </div>
            <div style={{ background: "#F6F5EF", borderRadius: 14, padding: 22 }}>
              <h4 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 16, margin: "0 0 7px" }}>🧴 Sanitizing treatment</h4>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "#5b6770" }}>Pet-safe solution for patios, decks, rock beds &amp; runs.</p>
            </div>
            <div style={{ background: "#F6F5EF", borderRadius: 14, padding: 22 }}>
              <h4 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 16, margin: "0 0 7px" }}>♻️ Haul-away</h4>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "#5b6770" }}>We remove the waste from your property entirely.</p>
            </div>
            <div style={{ background: "#F6F5EF", borderRadius: 14, padding: 22 }}>
              <h4 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 16, margin: "0 0 7px" }}>🏢 Commercial</h4>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "#5b6770" }}>Pet waste stations &amp; cleanups for HOAs &amp; apartments.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== EXTREME DOG FUEL ===== */}
      <section style={{ background: "#17181C", color: "#fff", padding: "82px 0", position: "relative", overflow: "hidden" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 28px", textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.16)", borderRadius: 99, padding: "6px 15px", fontSize: 12, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#e9c64a", marginBottom: 22 }}>🦴 Now offering · premium dog food</div>
          <img src="/assets/edf/logo.png" alt="Extreme Dog Fuel logo" style={{ display: "block", height: 70, margin: "0 auto 22px", borderRadius: 8 }} />
          <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 38, lineHeight: 1.04, letterSpacing: "-0.02em", margin: "0 0 16px" }}>Premium nutrition for your dog, too</h2>
          <p style={{ fontSize: 17, lineHeight: 1.6, color: "#b9bcc4", margin: "0 auto 14px", maxWidth: 620 }}>We don&apos;t just keep your yard clean — we help keep your dog healthy. Ohio Pet Waste Pros now offers <strong style={{ color: "#fff" }}>Extreme Dog Fuel</strong>: premium, veterinarian-recommended kibble with no corn, wheat, soy, or glutens. Four formulas for every age and activity level — delivered right with your service.</p>
          <div style={{ fontSize: 13.5, color: "#8b8f98", fontWeight: 600, letterSpacing: "0.02em", marginBottom: 44 }}>Elite Nutrition · Recommended by Veterinarians · Made in the USA</div>
        </div>

        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 20 }} className="opwp-g4">
            <div style={{ background: "#fff", borderRadius: 18, padding: "20px 18px 22px", textAlign: "center", boxShadow: "0 20px 40px -22px rgba(0,0,0,.6)" }}>
              <img src="/assets/edf/22-12.png" alt="Extreme Dog Fuel 22-12 Chicken Meal & Brown Rice" style={{ width: "100%", height: 230, objectFit: "contain", marginBottom: 14 }} />
              <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 22, color: "#1A3C5A" }}>22-12</div>
              <div style={{ fontSize: 13.5, color: "#5b6770", lineHeight: 1.4, marginTop: 4 }}>Chicken Meal &amp; Brown Rice<br />For less active dogs</div>
            </div>
            <div style={{ background: "#fff", borderRadius: 18, padding: "20px 18px 22px", textAlign: "center", boxShadow: "0 20px 40px -22px rgba(0,0,0,.6)" }}>
              <img src="/assets/edf/26-14.png" alt="Extreme Dog Fuel 26-14 for puppies and active dogs" style={{ width: "100%", height: 230, objectFit: "contain", marginBottom: 14 }} />
              <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 22, color: "#1A3C5A" }}>26-14</div>
              <div style={{ fontSize: 13.5, color: "#5b6770", lineHeight: 1.4, marginTop: 4 }}>For puppies &amp; active dogs<br />Folic acid, vitamins &amp; minerals</div>
            </div>
            <div style={{ background: "#fff", borderRadius: 18, padding: "20px 18px 22px", textAlign: "center", boxShadow: "0 20px 40px -22px rgba(0,0,0,.6)" }}>
              <img src="/assets/edf/26-18.png" alt="Extreme Dog Fuel 26-18 for active dogs with joint and skin system" style={{ width: "100%", height: 230, objectFit: "contain", marginBottom: 14 }} />
              <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 22, color: "#1A3C5A" }}>26-18</div>
              <div style={{ fontSize: 13.5, color: "#5b6770", lineHeight: 1.4, marginTop: 4 }}>For active dogs<br />Joint, glucosamine &amp; skin system</div>
            </div>
            <div style={{ background: "#fff", borderRadius: 18, padding: "20px 18px 22px", textAlign: "center", boxShadow: "0 20px 40px -22px rgba(0,0,0,.6)" }}>
              <img src="/assets/edf/30-20.png" alt="Extreme Dog Fuel 30-20 Pro-Athlete formula" style={{ width: "100%", height: 230, objectFit: "contain", marginBottom: 14 }} />
              <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 22, color: "#1A3C5A" }}>30-20</div>
              <div style={{ fontSize: 13.5, color: "#5b6770", lineHeight: 1.4, marginTop: 4 }}>Pro-Athlete formula<br />For puppies &amp; active dogs</div>
            </div>
          </div>
          <div style={{ textAlign: "center", marginTop: 42 }}>
            <Link href="/dog-food/" className="hov-cta" style={{ display: "inline-block", background: "#4F9E3A", color: "#fff", textDecoration: "none", padding: "16px 32px", borderRadius: 12, fontWeight: 800, fontSize: 16.5, boxShadow: "0 14px 28px -12px rgba(79,158,58,.7)" }}>Explore Extreme Dog Fuel</Link>
          </div>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section style={{ background: "#F6F5EF", padding: "84px 0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 46 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 12 }}>How it works</div>
            <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 36, letterSpacing: "-0.02em", margin: 0 }}>A clean yard in five simple steps</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 18 }} className="opwp-g5">
            <div style={{ background: "#fff", borderRadius: 16, padding: "26px 22px" }}>
              <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#1A3C5A", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Bricolage Grotesque'", fontWeight: 800, marginBottom: 16 }}>1</div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 16.5, margin: "0 0 8px" }}>Request a free quote</h3>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "#5b6770" }}>Tell us your location, number of dogs, and how often you&apos;d like service.</p>
            </div>
            <div style={{ background: "#fff", borderRadius: 16, padding: "26px 22px" }}>
              <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#1A3C5A", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Bricolage Grotesque'", fontWeight: 800, marginBottom: 16 }}>2</div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 16.5, margin: "0 0 8px" }}>Customize your plan</h3>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "#5b6770" }}>Choose weekly, bi-weekly, or one-time service to fit your lifestyle.</p>
            </div>
            <div style={{ background: "#fff", borderRadius: 16, padding: "26px 22px" }}>
              <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#1A3C5A", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Bricolage Grotesque'", fontWeight: 800, marginBottom: 16 }}>3</div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 16.5, margin: "0 0 8px" }}>We reset your yard</h3>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "#5b6770" }}>Our team handles a thorough first cleanup — gate photo included.</p>
            </div>
            <div style={{ background: "#fff", borderRadius: 16, padding: "26px 22px" }}>
              <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#1A3C5A", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Bricolage Grotesque'", fontWeight: 800, marginBottom: 16 }}>4</div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 16.5, margin: "0 0 8px" }}>Your client portal</h3>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "#5b6770" }}>Manage your subscription, invoices, and yard details in one place.</p>
            </div>
            <div style={{ background: "#fff", borderRadius: 16, padding: "26px 22px" }}>
              <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#4F9E3A", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Bricolage Grotesque'", fontWeight: 800, marginBottom: 16 }}>5</div>
              <h3 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 16.5, margin: "0 0 8px" }}>Enjoy your space</h3>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "#5b6770" }}>Spend time in your yard, not cleaning it — we keep it spotless year-round.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== SERVICE AREAS ===== */}
      <section id="areas" style={{ background: "#fff", padding: "84px 0", scrollMarginTop: 90 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 28px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 50, alignItems: "center" }} className="opwp-gsplit">
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 12 }}>Service areas</div>
            <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 34, letterSpacing: "-0.02em", margin: "0 0 16px" }}>Dog waste removal across NW Ohio &amp; SE Michigan</h2>
            <p style={{ fontSize: 16.5, lineHeight: 1.6, color: "#475259", margin: "0 0 24px" }}>We proudly provide professional pet waste removal and yard sanitizing throughout the greater Toledo area and Southern Michigan.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
              {areas.map((city) => (
                <span key={city} style={{ background: "#F1F3EE", border: "1px solid #e4e8df", borderRadius: 99, padding: "8px 15px", fontSize: 13.5, fontWeight: 600, color: "#3a4750", whiteSpace: "nowrap" }}>{city}</span>
              ))}
            </div>
          </div>
          <div style={{ borderRadius: 20, overflow: "hidden", boxShadow: "0 20px 44px -22px rgba(20,48,74,.4)", border: "1px solid #ece9df" }}>
            <iframe src="https://www.google.com/maps/d/u/0/embed?mid=1Jwhc-QqZowSQq-WFqPm0kChFHD32o9g&ehbc=2E312F" style={{ width: "100%", height: 380, border: 0, display: "block" }} loading="lazy" title="Ohio Pet Waste Pros service area map"></iframe>
          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section style={{ background: "#F6F5EF", padding: "84px 0" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "0 28px" }}>
          <div style={{ textAlign: "center", marginBottom: 42 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#658461", marginBottom: 12 }}>Questions</div>
            <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 36, letterSpacing: "-0.02em", margin: 0 }}>What clients ask before booking</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {faqData.map((f, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid #ece9df", borderRadius: 14, overflow: "hidden" }}>
                <div style={{ width: "100%", textAlign: "left", padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, fontFamily: "'Bricolage Grotesque'", fontWeight: 700, fontSize: 17, color: "#1C2A33" }}>
                  <span>{f.q}</span>
                  <span style={{ color: "#4F9E3A", fontSize: 22, flex: "none" }}>−</span>
                </div>
                <div style={{ padding: "0 24px 22px", fontSize: 15, lineHeight: 1.6, color: "#475259" }}>{f.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== PHOTO GALLERY ===== */}
      <GalleryCarousel />

      {/* ===== CTA ===== */}
      <section style={{ background: "linear-gradient(160deg,#1F4566,#14304A)", color: "#fff", padding: "78px 0" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 28px", textAlign: "center" }}>
          <h2 style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: 40, lineHeight: 1.05, letterSpacing: "-0.025em", margin: "0 0 16px" }}>Ready to make dog poop the easiest part of your week?</h2>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: "#c4d2df", margin: "0 0 32px" }}>Get your free Toledo-area quote in about a minute — then let our family take it from here.</p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/free-quote/" className="hov-cta" style={{ background: "#4F9E3A", color: "#fff", textDecoration: "none", padding: "17px 34px", borderRadius: 12, fontWeight: 800, fontSize: 17, boxShadow: "0 14px 28px -12px rgba(79,158,58,.7)" }}>Get My Free Quote</Link>
            <a href="tel:419-262-2371" style={{ background: "rgba(255,255,255,.12)", border: "1.5px solid rgba(255,255,255,.32)", color: "#fff", textDecoration: "none", padding: "17px 30px", borderRadius: 12, fontWeight: 700, fontSize: 17 }}>Call 419-262-2371</a>
          </div>
        </div>
      </section>
    </div>
  );
}
