import Link from "next/link";

export const metadata = {
  title: "Terms of Service | Ohio Pet Waste Pros",
  description:
    "The terms that govern dog waste removal services provided by Ohio Pet Waste Pros across Greater Toledo and SE Michigan.",
  alternates: { canonical: "/terms-of-service/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    title: "Terms of Service | Ohio Pet Waste Pros",
    description: "The terms that govern our pet waste removal services.",
    url: "https://ohiopetwastepros.com/terms-of-service/",
    siteName: "Ohio Pet Waste Pros",
  },
};

const EFFECTIVE = "June 30, 2026";

const h2 = {
  fontFamily: "'Bricolage Grotesque'",
  fontWeight: 800,
  fontSize: 24,
  lineHeight: 1.15,
  letterSpacing: "-0.01em",
  color: "#14304A",
  margin: "38px 0 12px",
};
const p = { fontSize: 16, lineHeight: 1.7, color: "#475259", margin: "0 0 14px" };
const li = { fontSize: 16, lineHeight: 1.7, color: "#475259", margin: "0 0 8px" };

export default function TermsOfServicePage() {
  return (
    <div>
      {/* Header band */}
      <section
        style={{
          background: "linear-gradient(160deg,#1F4566,#1A3C5A,#14304A)",
          color: "#fff",
          padding: "66px 0 56px",
        }}
      >
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 28px" }}>
          <h1
            style={{
              fontFamily: "'Bricolage Grotesque'",
              fontWeight: 800,
              fontSize: 44,
              lineHeight: 1.04,
              letterSpacing: "-0.02em",
              margin: "0 0 12px",
            }}
          >
            Terms of Service
          </h1>
          <p style={{ fontSize: 16, color: "#c4d2df", margin: 0 }}>
            Effective {EFFECTIVE}
          </p>
        </div>
      </section>

      {/* Body */}
      <section style={{ background: "#fff", padding: "20px 0 72px" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 28px" }}>
          <p style={{ ...p, marginTop: 28 }}>
            These Terms of Service (&ldquo;Terms&rdquo;) govern the dog waste removal and
            related services provided by Ohio Pet Waste Pros (&ldquo;OPWP,&rdquo;
            &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;). By requesting a quote,
            scheduling service, or using our services, you agree to these Terms.
          </p>

          <h2 style={h2}>Our Services</h2>
          <p style={p}>
            We provide recurring and one-time dog waste removal, yard sanitizing and
            deodorizing, and related cleanup services for residential and commercial
            customers. The specific services, frequency, and price are confirmed when you
            sign up.
          </p>

          <h2 style={h2}>Service Area</h2>
          <p style={p}>
            We serve Greater Toledo, Ohio and parts of Southeast Michigan. If your property
            is outside our current service area, we will let you know and cancel any pending
            order.
          </p>

          <h2 style={h2}>Scheduling &amp; Yard Access</h2>
          <ul style={{ paddingLeft: 22, margin: "0 0 14px" }}>
            <li style={li}>
              You are responsible for providing safe, unobstructed access to the service
              area on your scheduled day, including unlocking gates and securing any
              hazards.
            </li>
            <li style={li}>
              If we cannot access your yard (locked gate, blocked access, or a dog left
              loose in the yard), we may be unable to complete the visit. Missed visits due
              to access issues are still billable.
            </li>
            <li style={li}>
              We send a photo confirming the gate is closed after each visit when possible.
            </li>
          </ul>

          <h2 style={h2}>Pets &amp; Safety</h2>
          <p style={p}>
            For the safety of our team, please secure aggressive or anxious dogs during your
            scheduled visit. We reserve the right to skip a visit, or to pause or end
            service, if a dog or any condition on the property poses a safety risk. You agree
            to disclose any known hazards on the property.
          </p>

          <h2 style={h2}>Billing &amp; Payment</h2>
          <ul style={{ paddingLeft: 22, margin: "0 0 14px" }}>
            <li style={li}>
              Recurring service is billed on a subscription basis through our payment
              processor (Fiserv/CardPointe) using the payment method on file.
            </li>
            <li style={li}>
              By providing a payment method, you authorize us to charge it for the services
              you select until you cancel.
            </li>
            <li style={li}>
              Prices are based on the details you provide (number of dogs, frequency, and
              property). We may adjust pricing with advance notice.
            </li>
          </ul>

          <h2 style={h2}>Cancellation, Pauses &amp; Refunds</h2>
          <p style={p}>
            You may cancel or pause recurring service by contacting us. To avoid being billed
            for an upcoming visit, please give us reasonable advance notice before your next
            scheduled service day. Completed services are non-refundable. If you are not
            satisfied with a visit, contact us within 48 hours and we will make it right (see
            below).
          </p>

          <h2 style={h2}>Satisfaction Guarantee</h2>
          <p style={p}>
            If we miss something on a scheduled visit, let us know within 48 hours and we
            will return to re-clean the affected area at no additional charge.
          </p>

          <h2 style={h2}>Weather &amp; Holidays</h2>
          <p style={p}>
            Severe weather, snow cover, or holidays may delay or reschedule a visit. We will
            make reasonable efforts to complete service as close to your normal schedule as
            conditions allow.
          </p>

          <h2 style={h2}>Photos &amp; Media</h2>
          <p style={p}>
            We may take photos of the service area (such as gate-closed confirmations) for
            quality and record-keeping. We will not publish identifiable images of your
            property for marketing without your consent.
          </p>

          <h2 style={h2}>Communications</h2>
          <p style={p}>
            By providing your contact information, you agree that we may contact you by email,
            phone, and text about your service. See our{" "}
            <Link href="/privacy-policy/" style={{ color: "#4F9E3A", fontWeight: 600 }}>
              Privacy Policy
            </Link>{" "}
            for details, including how to opt out of text messages.
          </p>

          <h2 style={h2}>Limitation of Liability</h2>
          <p style={p}>
            To the fullest extent permitted by law, OPWP is not liable for indirect,
            incidental, or consequential damages arising from our services. Our total
            liability for any claim is limited to the amount you paid us for the service
            giving rise to the claim. Services are provided &ldquo;as is&rdquo; without
            warranties beyond those expressly stated here.
          </p>

          <h2 style={h2}>Governing Law</h2>
          <p style={p}>
            These Terms are governed by the laws of the State of Ohio, without regard to its
            conflict-of-laws rules.
          </p>

          <h2 style={h2}>Changes to These Terms</h2>
          <p style={p}>
            We may update these Terms from time to time. When we do, we will revise the
            &ldquo;Effective&rdquo; date above. Your continued use of our services after
            changes take effect means you accept the updated Terms.
          </p>

          <h2 style={h2}>Contact Us</h2>
          <p style={p}>
            Questions about these Terms? Email{" "}
            <a href="mailto:Craig@ohiopetwastepros.com" style={{ color: "#4F9E3A", fontWeight: 600 }}>
              Craig@ohiopetwastepros.com
            </a>{" "}
            or call{" "}
            <a href="tel:419-262-2371" style={{ color: "#4F9E3A", fontWeight: 600 }}>
              419-262-2371
            </a>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
