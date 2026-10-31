import "./fonts.css";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { localBusinessJsonLd, site } from "@/lib/site";

export const metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: "Dog Poop Removal Toledo, Sylvania & Perrysburg | Ohio Pet Waste Pros",
    template: "%s | Ohio Pet Waste Pros",
  },
  description:
    "Ohio Pet Waste Pros is a family-owned dog poop removal service in Toledo, Perrysburg, Sylvania and across NW Ohio & SE Michigan. Weekly, biweekly & one-time yard cleanups. Get your exact price with our instant quote.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  icons: { icon: "/assets/opwp-logo.webp" },
  openGraph: {
    type: "website",
    title: "Dog Poop Removal in Toledo, Sylvania & Perrysburg | Ohio Pet Waste Pros",
    description:
      "Family-owned pooper scooper service for NW Ohio & SE Michigan. A clean yard without scooping it yourself. Get your exact price with our instant quote.",
    url: site.url,
    images: [{
      url: "/assets/photos/opwp-social-share.webp",
      width: 1200,
      height: 630,
      alt: "Dixie beside an Ohio Pet Waste Pros dog poop removal yard sign",
    }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/assets/photos/opwp-social-share.webp"],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="opwp-local-fonts">
      <head>
        <link rel="preload" href="/assets/fonts/313510e2713fb214-s.p.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/assets/fonts/9d5a263311222317-s.p.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd()) }}
        />
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
