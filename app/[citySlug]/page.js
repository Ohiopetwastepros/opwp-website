import { notFound } from "next/navigation";
import CityPage from "@/components/CityPage";
import { cities, getCity } from "@/data/cities";
import { site } from "@/lib/site";

export function generateStaticParams() {
  // Only city slugs — static routes (about, blog, etc.) take priority.
  return cities.map((c) => ({ citySlug: c.slug }));
}

export async function generateMetadata({ params }) {
  const { citySlug } = await params;
  const c = getCity(citySlug);
  if (!c) return {};
  const url = `${site.url}/${c.slug}/`;
  const title = `Dog Poop Removal in ${c.city}, ${c.stateAbbr} | Ohio Pet Waste Pros`;
  const description = `Professional dog poop removal in ${c.city}, ${c.state} (ZIP ${c.zips}). Weekly, bi-weekly & one-time pooper scooper service from Ohio Pet Waste Pros — gate photos, double-bagging & eco-friendly sanitizing. Free instant quote.`;
  return {
    title,
    description,
    alternates: { canonical: `/${c.slug}/` },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      title,
      description: `Reliable, family-owned dog waste removal serving ${c.city}, ${c.state} and the Greater Toledo area.`,
      url,
      siteName: "Ohio Pet Waste Pros",
      images: ["https://ohiopetwastepros.com/wp-content/uploads/2025/05/cropped-OPWP-CIRCLE-LOGO-11111111.png"],
    },
    twitter: { card: "summary_large_image" },
    other: {
      "geo.region": `US-${c.stateAbbr}`,
      "geo.placename": `${c.city}, ${c.state}`,
    },
  };
}

export default async function Page({ params }) {
  const { citySlug } = await params;
  const c = getCity(citySlug);
  if (!c) notFound();

  const url = `${site.url}/${c.slug}/`;

  const serviceJsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Dog poop removal",
    name: `Dog Poop Removal in ${c.city}, ${c.stateAbbr}`,
    provider: {
      "@type": "LocalBusiness",
      "@id": "https://ohiopetwastepros.com/#business",
      name: "Ohio Pet Waste Pros",
      image: "https://ohiopetwastepros.com/wp-content/uploads/2025/05/cropped-OPWP-CIRCLE-LOGO-11111111.png",
      telephone: "+14192622371",
      email: "Craig@ohiopetwastepros.com",
      url: "https://ohiopetwastepros.com/",
      priceRange: "$$",
      address: { "@type": "PostalAddress", addressLocality: "Holland", addressRegion: "OH", addressCountry: "US" },
      sameAs: ["https://www.facebook.com/profile.php?id=61575239054687", "https://www.instagram.com/ohio.pet.waste.pros.llc"],
      aggregateRating: { "@type": "AggregateRating", ratingValue: "5.0", reviewCount: "159" },
    },
    areaServed: {
      "@type": "City",
      name: `${c.city}, ${c.state}`,
      geo: { "@type": "GeoCoordinates", latitude: c.lat, longitude: c.lng },
    },
    description: `Weekly, bi-weekly and one-time residential dog waste removal in ${c.city}, ${c.state} (ZIP ${c.zips}) with gate photos, double-bagging and eco-friendly sanitizing.`,
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `How much does dog poop removal cost in ${c.city}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `Pricing in ${c.city} depends on how many dogs you have and how often you want service. Weekly visits offer the best value, with no contracts. Use our instant quote tool to see your exact price.`,
        },
      },
      {
        "@type": "Question",
        name: `What ZIP codes do you serve in ${c.city}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `We provide dog waste removal in ${c.city} (${c.zips}) and the surrounding Greater Toledo and SE Michigan area. Request a free quote to confirm coverage at your address.`,
        },
      },
    ],
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://ohiopetwastepros.com/" },
      { "@type": "ListItem", position: 2, name: "Service Areas", item: "https://ohiopetwastepros.com/service-areas/" },
      { "@type": "ListItem", position: 3, name: `${c.city}, ${c.state}`, item: url },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <CityPage city={c.city} state={c.state} />
    </>
  );
}
