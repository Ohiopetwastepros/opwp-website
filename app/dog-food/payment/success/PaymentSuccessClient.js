"use client";

import { useEffect, useState } from "react";
import styles from "./success.module.css";

const money = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);

export default function PaymentSuccessClient() {
  const [state, setState] = useState({ status: "processing" });

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) { setState({ status: "invalid" }); return undefined; }
    let cancelled = false;
    let attempts = 0;
    const check = async () => {
      attempts += 1;
      try {
        const response = await fetch(`/api/dog-food/payment-status/?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
        const data = await response.json();
        if (!cancelled && response.ok) setState(data);
        if (!cancelled && data.status === "processing" && attempts < 10) window.setTimeout(check, 1200);
      } catch {
        if (!cancelled && attempts < 10) window.setTimeout(check, 1200);
      }
    };
    check();
    return () => { cancelled = true; };
  }, []);

  const paid = state.status === "paid";
  const methodSaved = state.status === "payment_method_saved";
  return <section className={styles.card} aria-live="polite">
    <div className={`${styles.icon} ${paid || methodSaved ? styles.iconPaid : ""}`}>{paid || methodSaved ? "✓" : state.status === "failed" ? "!" : <i />}</div>
    <span className={styles.kicker}>{paid ? "Payment confirmed" : methodSaved ? "Payment method secured" : state.status === "failed" ? "Payment needs attention" : "Confirming secure payment"}</span>
    <h1>{paid ? "Your dog food is ordered." : methodSaved ? "You’re ready for automatic payments." : state.status === "failed" ? "Your card was not charged." : "We’re finalizing your order."}</h1>
    {paid ? <>
      <p>Thank you. Your payment is recorded and the OPWP team will confirm the best delivery date for your route.</p>
      <div className={styles.receipt}><div><span>Order</span><strong>{state.orderNumber}</strong></div><div><span>Paid</span><strong>{money(state.totalCents)}</strong></div></div>
      {state.monthly ? <div className={styles.monthly}><strong>Monthly delivery is ready for scheduling.</strong><span>Your saved Stripe payment method will be charged approximately 48 hours before each future confirmed delivery.</span></div> : null}
    </> : methodSaved ? <p>Your card was securely saved by Stripe. OPWP does not receive or store your full card number, and no additional payment was collected on this step.</p> : state.status === "failed" ? <p>Return to the order tool to try again, or contact OPWP if you need help completing payment.</p> : <p>This normally takes only a few seconds. You may safely leave this page after Stripe finishes confirming the payment.</p>}
    <div className={styles.actions}><a href="/dog-food/">Back to dog food</a><a href="tel:+14192622371">Call OPWP</a></div>
  </section>;
}
