import { Bricolage_Grotesque, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { localBusinessJsonLd, site } from "@/lib/site";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-hanken",
  display: "swap",
});

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
    images: ["/assets/photos/hero-craig-driveway.webp"],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${hanken.variable}`}>
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
