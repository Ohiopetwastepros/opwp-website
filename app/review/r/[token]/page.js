import { cache } from "react";
import { notFound } from "next/navigation";
import { getRuntimeEnv } from "@/lib/cloudflare";
import { getReviewPreview } from "@/lib/review-previews.mjs";
import { REVIEW_TECHS, REVIEW_URL, personalizedReviewMetadata } from "@/lib/review-request-content.mjs";
import styles from "./personalized-review.module.css";

// Every valid token resolves from R2 even on the first OpenNext cache miss.
export const dynamic = "force-dynamic";
const previewFor = cache(token => getReviewPreview(getRuntimeEnv(), token));

export async function generateMetadata({ params }) {
  const { token } = await params;
  const preview = await previewFor(token);
  if (!preview) return { robots: { index: false, follow: false } };
  return personalizedReviewMetadata(preview);
}

export default async function PersonalizedReviewPage({ params }) {
  const { token } = await params;
  const preview = await previewFor(token);
  if (!preview) notFound();
  const tech = REVIEW_TECHS[preview.tech];
  return <section className={styles.page}>
    <div className={styles.card}>
      <img className={styles.image} src={preview.imageUrl} width="1200" height="630" alt={`${tech.imageAlt}, with a personalized thank you`} fetchPriority="high" />
      <div className={styles.content}>
        <h1>{tech.title}</h1>
        <p>Thanks for choosing Ohio Pet Waste Pros for your cleanup! If you have a minute, an honest Google review would mean a lot.</p>
        <a className={styles.button} href={REVIEW_URL} rel="noreferrer">Leave a review <span aria-hidden="true">&rarr;</span></a>
        <p className={styles.signoff}>Thank you!<br />{tech.name} &amp; the Ohio Pet Waste Pros team</p>
      </div>
    </div>
  </section>;
}
