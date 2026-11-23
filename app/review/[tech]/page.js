import { notFound, permanentRedirect } from "next/navigation";
import { REVIEW_TECHS, REVIEW_URL, reviewPageMetadata } from "@/lib/review-request-content.mjs";
import styles from "../review.module.css";

// Allow known pages to render on an OpenNext cache miss; the config check below
// still returns 404 for every unsupported technician.
export function generateStaticParams() {
  return [...Object.keys(REVIEW_TECHS), "team"].map(tech => ({ tech }));
}

export async function generateMetadata({ params }) {
  const { tech } = await params;
  if (tech !== "team" && !Object.hasOwn(REVIEW_TECHS, tech)) return {};
  return reviewPageMetadata(tech);
}

export default async function ReviewPage({ params }) {
  const { tech: slug } = await params;
  if (slug === "team") permanentRedirect("/review/craig/");
  if (!Object.hasOwn(REVIEW_TECHS, slug)) notFound();
  const tech = REVIEW_TECHS[slug];
  return <section className={styles.page}>
    <div className={styles.card}>
      <div className={styles.photo}>
        <picture>
          <source srcSet={tech.image} type="image/webp" />
          <img src={tech.imageFallback} alt={tech.imageAlt} width={tech.imageWidth} height={tech.imageHeight} fetchPriority="high" />
        </picture>
        <span className={styles.photoLabel}>{tech.name}</span>
      </div>
      <div className={styles.content}>
        <p className={styles.eyebrow}>A clean yard. A little more free time.</p>
        <h1>{tech.title}</h1>
        <p className={styles.thanks}>Thanks for choosing Ohio Pet Waste Pros for your cleanup! We appreciate the chance to take care of your yard.</p>
        <p className={styles.ask}>If you have a minute, an honest Google review would mean a lot.</p>
        <a className={styles.button} href={REVIEW_URL}>Leave a review <span aria-hidden="true">&rarr;</span></a>
        <p className={styles.signoff}>Thank you!<br />{tech.name} &amp; the Ohio Pet Waste Pros team</p>
      </div>
    </div>
  </section>;
}
