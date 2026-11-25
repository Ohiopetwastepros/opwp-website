// Central site config — single source of truth for contact info and structured data.
export const site = {
  name: "Ohio Pet Waste Pros",
  tagline: "NW Ohio & SE Michigan",
  url: "https://www.ohiopetwastepros.com",
  logoPath: "/assets/opwp-logo.webp",
  phone: "419-262-2371",
  phoneHref: "tel:419-262-2371",
  email: "Craig@ohiopetwastepros.com",
  locality: "Holland",
  region: "OH",
  hours: "Mon–Fri, 8am–6pm",
  seasonalHours: "Saturdays in March through May, 9am–2pm",
};

export const localBusinessId = site.url + "/#business";

export function localBusinessJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": localBusinessId,
    name: site.name,
    image: site.url + site.logoPath,
    description:
      "Family-owned dog poop removal and pet waste cleanup service for residential and commercial properties across Northwest Ohio and Southeast Michigan.",
    telephone: "+14192622371",
    email: site.email,
    url: `${site.url}/`,
    priceRange: "$$",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Holland",
      addressRegion: "OH",
      addressCountry: "US",
    },
    geo: { "@type": "GeoCoordinates", latitude: 41.6217, longitude: -83.7141 },
    areaServed: [
      "Toledo OH", "Sylvania OH", "Perrysburg OH", "Maumee OH", "Holland OH",
      "Whitehouse OH", "Waterville OH", "Monclova OH", "Rossford OH", "Oregon OH",
      "Ottawa Hills OH", "Temperance MI", "Lambertville MI", "Bedford Township MI",
    ],
    knowsAbout: [
      "pet waste removal service", "pooper scooper service", "dog poop removal",
      "dog waste removal", "yard sanitizing and deodorizing",
    ],
    founder: [
      { "@type": "Person", name: "Craig Bridgman" },
      { "@type": "Person", name: "Amanda Bridgman" },
    ],
    sameAs: [
      "https://www.facebook.com/profile.php?id=61575239054687",
      "https://www.instagram.com/ohio.pet.waste.pros.llc/",
    ],
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "5.0",
      reviewCount: "175",
    },
    openingHoursSpecification: {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "08:00",
      closes: "18:00",
    },
  };
}
