// Central site config — single source of truth for contact info and structured data.
export const site = {
  name: "Ohio Pet Waste Pros",
  tagline: "NW Ohio & SE Michigan",
  url: "https://ohiopetwastepros.com",
  phone: "419-262-2371",
  phoneHref: "tel:419-262-2371",
  email: "Craig@ohiopetwastepros.com",
  locality: "Holland",
  region: "OH",
  hours: "Mon–Fri, 8am–6pm",
};

export function localBusinessJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${site.url}/#business`,
    name: site.name,
    image: `${site.url}/wp-content/uploads/2025/05/cropped-OPWP-CIRCLE-LOGO-11111111.png`,
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
    sameAs: [
      "https://www.facebook.com/profile.php?id=61575239054687",
      "https://www.instagram.com/ohio.pet.waste.pros.llc/",
    ],
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "5.0",
      reviewCount: "159",
    },
    openingHoursSpecification: {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "08:00",
      closes: "18:00",
    },
  };
}
