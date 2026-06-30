import Link from "next/link";

export const metadata = {
  title: {
    absolute:
      "Service Areas | Dog Poop Removal Across Greater Toledo & SE Michigan",
  },
  description:
    "Ohio Pet Waste Pros provides dog poop removal across Toledo, Sylvania, Perrysburg, Maumee, Holland, Bowling Green and 20+ communities in NW Ohio & SE Michigan. Find your city.",
  alternates: { canonical: "/service-areas/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "https://ohiopetwastepros.com/service-areas/",
    siteName: "Ohio Pet Waste Pros",
    title: "Service Areas | Ohio Pet Waste Pros",
    images: [
      "https://ohiopetwastepros.com/wp-content/uploads/2025/05/cropped-OPWP-CIRCLE-LOGO-11111111.png",
    ],
  },
};

const ohio = [
  { name: "Toledo", href: "/dog-poop-removal-toledo-oh/" },
  { name: "Sylvania", href: "/dog-poop-removal-sylvania-oh/" },
  { name: "Perrysburg", href: "/dog-poop-removal-perrysburg-oh/" },
  { name: "Maumee", href: "/dog-poop-removal-maumee-oh/" },
  { name: "Holland", href: "/dog-poop-removal-holland-oh/" },
  { name: "Oregon", href: "/dog-poop-removal-oregon-oh/" },
  { name: "Northwood", href: "/dog-poop-removal-northwood-oh/" },
  { name: "Rossford", href: "/dog-poop-removal-rossford-oh/" },
  { name: "Whitehouse", href: "/dog-poop-removal-whitehouse-oh/" },
  { name: "Waterville", href: "/dog-poop-removal-waterville-oh/" },
  { name: "Monclova", href: "/dog-poop-removal-monclova-oh/" },
  { name: "Swanton", href: "/dog-poop-removal-swanton-oh/" },
  { name: "Berkey", href: "/dog-poop-removal-berkey-oh/" },
  { name: "Bowling Green", href: "/dog-poop-removal-bowling-green-oh/" },
  { name: "Walbridge", href: "/dog-poop-removal-walbridge-oh/" },
  { name: "Genoa", href: "/dog-poop-removal-genoa-oh/" },
  { name: "Curtice", href: "/dog-poop-removal-curtice-oh/" },
  { name: "Dunbridge", href: "/dog-poop-removal-dunbridge-oh/" },
  { name: "Haskins", href: "/dog-poop-removal-haskins-oh/" },
  { name: "Neapolis", href: "/dog-poop-removal-neapolis-oh/" },
  { name: "Tontogany", href: "/dog-poop-removal-tontogany-oh/" },
  { name: "Delta", href: "/dog-poop-removal-delta-oh/" },
];

const michigan = [
  { name: "Lambertville", href: "/dog-poop-removal-lambertville-mi/" },
  { name: "Temperance", href: "/dog-poop-removal-temperance-mi/" },
  { name: "Ottawa Lake", href: "/dog-poop-removal-ottawa-lake-mi/" },
];

const cityCard = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  textDecoration: "none",
  background: "#F6F5EF",
  border: "1px solid #ece9df",
  borderRadius: "12px",
  padding: "15px 18px",
  color: "#1C2A33",
  fontWeight: 700,
  fontSize: "15px",
};

export default function ServiceAreasPage() {
  return (
    <div style={{ fontFamily: "'Hanken Grotesk',sans-serif", color: "#1C2A33" }}>
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
            padding: "64px 28px 58px",
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
            25+ communities served
          </div>
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
            Dog poop removal across NW Ohio &amp; SE Michigan
          </h1>
          <p
            style={{
              fontSize: "18px",
              lineHeight: 1.55,
              color: "#c4d2df",
              margin: "0 auto",
              maxWidth: "600px",
            }}
          >
            Find your city below for local dog waste removal — or request a free
            quote and we&apos;ll confirm coverage at your address.
          </p>
        </div>
      </section>

      <section style={{ background: "#fff", padding: "70px 0" }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "0 28px" }}>
          <div
            style={{
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "#658461",
              marginBottom: "18px",
            }}
          >
            Northwest Ohio
          </div>
          <div
            className="opwp-g4"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: "12px",
              marginBottom: "46px",
            }}
          >
            {ohio.map((c) => (
              <Link
                key={c.name}
                href={c.href}
                className="hov-cream"
                style={cityCard}
              >
                {c.name} <span style={{ color: "#4F9E3A" }}>→</span>
              </Link>
            ))}
          </div>
          <div
            style={{
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "#658461",
              marginBottom: "18px",
            }}
          >
            Southeast Michigan
          </div>
          <div
            className="opwp-g4"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: "12px",
            }}
          >
            {michigan.map((c) => (
              <Link
                key={c.name}
                href={c.href}
                className="hov-cream"
                style={cityCard}
              >
                {c.name} <span style={{ color: "#4F9E3A" }}>→</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section style={{ background: "#F6F5EF", padding: 0 }}>
        <iframe
          src="https://www.google.com/maps/d/u/0/embed?mid=1Jwhc-QqZowSQq-WFqPm0kChFHD32o9g&ehbc=2E312F"
          style={{ width: "100%", height: "440px", border: 0, display: "block" }}
          loading="lazy"
          title="Ohio Pet Waste Pros service area map"
        />
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
            }}
          >
            Don&apos;t see your town? Just ask.
          </h2>
          <p
            style={{
              fontSize: "18px",
              lineHeight: 1.55,
              color: "#c4d2df",
              margin: "0 0 30px",
            }}
          >
            We&apos;re always expanding. Request a free quote and we&apos;ll
            confirm whether we can reach your yard.
          </p>
          <Link
            href="/free-quote/"
            className="hov-cta"
            style={{
              display: "inline-block",
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
        </div>
      </section>
    </div>
  );
}
