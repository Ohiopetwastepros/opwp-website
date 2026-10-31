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
    url: "https://www.ohiopetwastepros.com/dog-food/",
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
            Find the right Extreme Dog Fuel formula for your dog, then choose
            a one-time order or monthly delivery.
          </p>
          <div className={styles.heroActions}>
            <div>
              <a className={styles.heroCta} href="#order-tool">Find My Dog&apos;s Food <span aria-hidden="true">→</span></a>
              <span>No account needed to get started</span>
            </div>
            <div>
              <a className={styles.accountCta} href="/dog-food/account/">Dog Food Sign In <span aria-hidden="true">→</span></a>
              <span>Order again or manage your deliveries</span>
            </div>
          </div>
          <p className={styles.accountEntry}>Your dog-food account is separate from your scooping account.</p>

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
          <span>Start with your dog—not a signup form</span>
          <h2>Find their food. Then make delivery easy.</h2>
          <p>Answer a few nutrition questions, see your formula match, then create your account and order. One-time or monthly—you choose.</p>
        </div>
        <DogFoodOrderTool paymentConfigured={stripeConfigured()} />
      </section>
    </div>
  );
}
