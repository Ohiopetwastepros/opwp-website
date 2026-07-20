import DogFoodOrderTool from "./DogFoodOrderTool";
import styles from "./dog-food.module.css";
import { stripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Extreme Dog Fuel Delivered in Northwest Ohio",
  description:
    "Find the right Extreme Dog Fuel formula for every dog and order convenient local delivery from Ohio Pet Waste Pros.",
  alternates: { canonical: "/dog-food/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    title: "Extreme Dog Fuel, delivered by Ohio Pet Waste Pros",
    description:
      "Personalized formula recommendations and convenient local dog food delivery across Greater Toledo.",
    url: "https://ohiopetwastepros.com/dog-food/",
    siteName: "Ohio Pet Waste Pros",
    images: ["/assets/edf/30-20.png"],
  },
};

const formulas = [
  {
    code: "22-12",
    color: "Pink",
    image: "/assets/edf/22-12.png",
    title: "Chicken & Brown Rice",
    fit: "Less-active and senior dogs",
  },
  {
    code: "26-14",
    color: "Blue",
    image: "/assets/edf/26-14.png",
    title: "Puppies & Active Dogs",
    fit: "Puppies and growing dogs",
  },
  {
    code: "26-18",
    color: "Green",
    image: "/assets/edf/26-18.png",
    title: "Active Dogs",
    fit: "Everyday active adult dogs",
  },
  {
    code: "30-20",
    color: "Red",
    image: "/assets/edf/30-20.png",
    title: "Pro Athlete",
    fit: "High-energy and working dogs",
  },
];

const productJsonLd = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Extreme Dog Fuel formulas delivered by Ohio Pet Waste Pros",
  itemListElement: formulas.map((formula, index) => ({
    "@type": "Product",
    position: index + 1,
    name: `Extreme Dog Fuel ${formula.code} ${formula.title}`,
    description: `${formula.code} formula for ${formula.fit.toLowerCase()}. Available for local delivery from Ohio Pet Waste Pros.`,
    brand: { "@type": "Brand", name: "Extreme Dog Fuel" },
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: "59.00",
      availability: "https://schema.org/InStock",
    },
  })),
};

export default function DogFoodPage() {
  return (
    <div className={styles.page}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />

      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroInner}>
          <div className={styles.brandLockup}>
            <div className={styles.brandCardOpwp}>
              <img src="/assets/opwp-logo.webp" alt="Ohio Pet Waste Pros" width="320" height="320" />
              <span>Local delivery by<br /><strong>Ohio Pet Waste Pros</strong></span>
            </div>
            <span className={styles.brandPlus}>+</span>
            <div className={styles.brandCardEdf}>
              <img src="/assets/edf/logo.png" alt="Extreme Dog Fuel" />
            </div>
          </div>

          <div className={styles.eyebrow}>Premium nutrition • dependable local delivery</div>
          <h1>The right fuel for every dog.<br />Delivered on your route.</h1>
          <p className={styles.heroCopy}>
            Tell us about each dog, get a personalized Extreme Dog Fuel recommendation,
            and choose free recurring delivery or a faster on-demand option.
          </p>
          <a className={styles.heroCta} href="#order-tool">Find My Dogs&apos; Food</a>

          <div className={styles.heroProof}>
            <span><strong>Four</strong> targeted blends</span>
            <span><strong>Free</strong> route-day delivery</span>
            <span><strong>Local</strong> OPWP service</span>
          </div>
        </div>

        <div className={styles.bagRow} aria-label="Four Extreme Dog Fuel formulas">
          {formulas.map((formula) => (
            <img key={formula.code} src={formula.image} alt={`${formula.code} ${formula.color} bag`} />
          ))}
        </div>
      </section>

      <section className={styles.toolSection} id="order-tool">
        <div className={styles.sectionHeading}>
          <span>Dog Food Finder & Order</span>
          <h2>Build your delivery in a few simple steps.</h2>
          <p>One household, up to ten dogs, and one easy recurring order.</p>
        </div>
        <DogFoodOrderTool paymentConfigured={stripeConfigured()} />
      </section>
    </div>
  );
}
