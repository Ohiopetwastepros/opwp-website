import PaymentSuccessClient from "./PaymentSuccessClient";
import styles from "./success.module.css";

export const metadata = { title: "Payment Confirmation | OPWP", robots: { index: false, follow: false } };

export default function DogFoodPaymentSuccessPage() {
  return <main className={styles.page}>
    <a className={styles.brand} href="/"><span>OPWP</span><small>Ohio Pet Waste Pros</small></a>
    <PaymentSuccessClient />
  </main>;
}
