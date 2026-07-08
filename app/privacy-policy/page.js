import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | Ohio Pet Waste Pros",
  description:
    "How Ohio Pet Waste Pros collects, uses, and protects the personal information of customers across Greater Toledo and SE Michigan.",
  alternates: { canonical: "/privacy-policy/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    title: "Privacy Policy | Ohio Pet Waste Pros",
    description: "How we collect, use, and protect your personal information.",
    url: "https://ohiopetwastepros.com/privacy-policy/",
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

export default function PrivacyPolicyPage() {
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
            Privacy Policy
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
            Ohio Pet Waste Pros (&ldquo;OPWP,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo;
            or &ldquo;our&rdquo;) respects your privacy. This Privacy Policy explains
            what information we collect when you visit our website, request a quote, or
            use our dog waste removal services, how we use that information, and the
            choices you have.
          </p>

          <h2 style={h2}>Information We Collect</h2>
          <p style={p}>We collect information you provide directly to us, including:</p>
          <ul style={{ paddingLeft: 22, margin: "0 0 14px" }}>
            <li style={li}>
              <strong>Contact details</strong> &mdash; your name, email address, phone
              number, and service address when you request a quote or sign up for
              service.
            </li>
            <li style={li}>
              <strong>Service details</strong> &mdash; information about your property,
              the number of dogs you have, your preferred service frequency, and gate or
              yard access instructions.
            </li>
            <li style={li}>
              <strong>Payment information</strong> &mdash; card details are collected and
              processed by our payment processor (Fiserv/CardPointe). We do not store full card
              numbers on our own systems.
            </li>
            <li style={li}>
              <strong>Communications</strong> &mdash; messages, requests, and feedback
              you send us by email, phone, or text.
            </li>
          </ul>
          <p style={p}>
            We also automatically collect limited technical information when you visit our
            site, such as your IP address, browser type, pages viewed, and referring page,
            through cookies and similar analytics technologies.
          </p>

          <h2 style={h2}>How We Use Your Information</h2>
          <ul style={{ paddingLeft: 22, margin: "0 0 14px" }}>
            <li style={li}>Provide quotes, schedule visits, and deliver our services.</li>
            <li style={li}>Process payments and manage your account and subscription.</li>
            <li style={li}>
              Send service updates, gate-closed confirmation photos, appointment
              reminders, and customer support.
            </li>
            <li style={li}>
              Send promotional messages where you have asked to receive them (you can opt
              out at any time).
            </li>
            <li style={li}>Improve our website, services, and customer experience.</li>
            <li style={li}>Comply with legal obligations and protect our rights.</li>
          </ul>

          <h2 style={h2}>How We Share Your Information</h2>
          <p style={p}>
            We do not sell your personal information. We share it only with service
            providers who help us operate, including our scheduling and customer-management
            platform (Sweep &amp; Go) and our payment processor (Fiserv/CardPointe), and only as needed
            to provide our services. We may also disclose information when required by law or
            to protect the safety, rights, or property of OPWP, our customers, or others.
          </p>

          <h2 style={h2}>Text Messages (SMS)</h2>
          <p style={p}>
            If you provide your mobile number, we may send you service-related text messages
            such as appointment reminders, schedule changes, and visit confirmations.
            Message and data rates may apply, and message frequency varies. You can opt out
            of text messages at any time by replying STOP, or reply HELP for help.
            Opting out of texts will not affect your service but may limit reminders.
          </p>

          <h2 style={h2}>Cookies &amp; Analytics</h2>
          <p style={p}>
            Our website uses cookies and analytics tools to understand how visitors use the
            site so we can improve it. Most browsers let you refuse or delete cookies through
            their settings; some site features may not work as well if you do.
          </p>

          <h2 style={h2}>Data Retention</h2>
          <p style={p}>
            We keep your information for as long as your account is active or as needed to
            provide services, and afterward only as long as necessary to meet legal,
            accounting, or reporting requirements.
          </p>

          <h2 style={h2}>Your Choices &amp; Rights</h2>
          <p style={p}>
            You may request access to, correction of, or deletion of your personal
            information, and you may opt out of marketing emails or texts at any time. To
            make a request, contact us using the details below. We will respond consistent
            with applicable law.
          </p>

          <h2 style={h2}>Children&rsquo;s Privacy</h2>
          <p style={p}>
            Our services and website are intended for adults. We do not knowingly collect
            personal information from children under 16.
          </p>

          <h2 style={h2}>Security</h2>
          <p style={p}>
            We use reasonable administrative and technical safeguards to protect your
            information. No method of transmission or storage is completely secure, however,
            and we cannot guarantee absolute security.
          </p>

          <h2 style={h2}>Changes to This Policy</h2>
          <p style={p}>
            We may update this Privacy Policy from time to time. When we do, we will revise
            the &ldquo;Effective&rdquo; date above. Your continued use of our services after
            changes take effect means you accept the updated policy.
          </p>

          <h2 style={h2}>Contact Us</h2>
          <p style={p}>
            Questions about this policy? Email{" "}
            <a href="mailto:Craig@ohiopetwastepros.com" style={{ color: "#4F9E3A", fontWeight: 600 }}>
              Craig@ohiopetwastepros.com
            </a>{" "}
            or call{" "}
            <a href="tel:419-262-2371" style={{ color: "#4F9E3A", fontWeight: 600 }}>
              419-262-2371
            </a>
            .
          </p>

          <p style={{ ...p, marginTop: 34 }}>
            See also our{" "}
            <Link href="/terms-of-service/" style={{ color: "#4F9E3A", fontWeight: 600 }}>
              Terms of Service
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
