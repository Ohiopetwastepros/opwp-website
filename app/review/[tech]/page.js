import { notFound } from "next/navigation";
import { REVIEW_TECHS, REVIEW_URL, reviewPageMetadata } from "@/lib/review-request-content.mjs";
import styles from "../review.module.css";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(REVIEW_TECHS).map(tech => ({ tech }));
}

export async function generateMetadata({ params }) {
  const { tech } = await params;
  if (!Object.hasOwn(REVIEW_TECHS, tech)) return {};
  return reviewPageMetadata(tech);
}

export default async function ReviewPage({ params }) {
  const { tech: slug } = await params;
  if (!Object.hasOwn(REVIEW_TECHS, slug)) notFound();
  const tech = REVIEW_TECHS[slug];
  return <section className={styles.page}>
    <div className={styles.card}>
      <div className={styles.photo}>
        <img src={tech.image} alt={tech.imageAlt} width="1200" height="630" fetchPriority="high" />
        <span className={styles.photoLabel}>{tech.placeholder ? "Team photo - Chad's photo coming soon" : tech.name}</span>
      </div>
      <div className={styles.content}>
        <p className={styles.eyebrow}>A clean yard. A little more free time.</p>
        <h1>{tech.title}</h1>
        <p className={styles.thanks}>Thanks for choosing Ohio Pet Waste Pros for your cleanup! We appreciate the chance to take care of your yard.</p>
        <p className={styles.ask}>If you have a minute, an honest Google review would mean a lot.</p>
        <a className={styles.button} href={REVIEW_URL}>Leave a review <span aria-hidden="true">&rarr;</span></a>
        <p className={styles.signoff}>Thank you!<br />{tech.slug === "team" ? "The Ohio Pet Waste Pros team" : tech.name + " & the Ohio Pet Waste Pros team"}</p>
      </div>
    </div>
  </section>;
}
