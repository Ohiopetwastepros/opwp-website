"use client";

import { useEffect, useMemo, useState } from "react";
import {
  PRICING, YARD_TIERS, CHARGE_LABEL,
  isInArea, haulAwayPrice, calcLocalQuote,
} from "./pricing";

// ── Constants ──────────────────────────────────────────────────────────────
const ORG_PHONE    = "(419) 262-2371";
const SNG_PAY_URL  = "https://client.sweepandgo.com/ohio-pet-waste-pros-qkr3c/register";

// Areas we service — mirrors the "Areas To Clean" options enabled in Sweep & Go.
const AREA_OPTIONS = [
  "Back Yard", "Behind Shed", "Kids Play Area",
  "Area With Mulch", "Area With Rocks", "Pool Area", "Area With Pine Straw",
];
const HEARD_ABOUT = [
  { id: "google_search",   label: "Google Search" },
  { id: "google_maps",     label: "Google Maps" },
  { id: "facebook",        label: "Facebook / Social Media" },
  { id: "nextdoor",        label: "Nextdoor" },
  { id: "friend_referral", label: "Friend or Neighbor" },
  { id: "door_hanger",     label: "Door Hanger / Flyer" },
  { id: "yard_sign",       label: "Yard Sign" },
  { id: "other",           label: "Other" },
];

// ── Shared styles ──────────────────────────────────────────────────────────
const inp = {
  width: "100%", padding: "13px 14px",
  border: "1.5px solid #dfe2da", borderRadius: "10px",
  fontSize: "15px", fontFamily: "inherit", background: "#fff", boxSizing: "border-box",
};
const lbl = {
  fontSize: "13px", fontWeight: 700, color: "#46545d",
  display: "block", marginBottom: "7px",
};
const req = <span style={{ color: "#d9534f" }}>*</span>;
const opt = <span style={{ color: "#9aa6ae", fontWeight: 400 }}> (optional)</span>;

const secHead = (first = false) => ({
  fontFamily: "'Bricolage Grotesque'", fontWeight: 800,
  fontSize: "16px", color: "#1A3C5A", marginBottom: "14px",
  ...(first ? {} : { marginTop: "24px", paddingTop: "20px", borderTop: "1px solid #eee" }),
});

const money  = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const rngStr = ([lo, hi]) => `${money(lo)}–${money(hi)}`;

function Btn({ children, active, onClick, style = {} }) {
  return (
    <button type="button" onClick={onClick} style={{
      border: `1.5px solid ${active ? "#4F9E3A" : "#dfe2da"}`,
      background: active ? "#f3f9f0" : "#fff",
      borderRadius: "10px", padding: "10px 12px",
      fontWeight: 700, fontSize: "13px", cursor: "pointer",
      color: active ? "#1A3C5A" : "#46545d",
      fontFamily: "inherit", lineHeight: 1.3, textAlign: "center",
      ...style,
    }}>
      {children}
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════════════
export default function QuoteForm() {

  // ── Step 1 ──────────────────────────────────────────────────────────────
  const [zip,        setZip]        = useState("");
  const [dogs,       setDogs]       = useState(1);
  const [frequency,  setFrequency]  = useState("once_a_week");
  const [lastCleaned,setLastCleaned]= useState("one_month");
  const [yardSize,   setYardSize]   = useState(null);   // YARD_TIERS id
  const [coupon,     setCoupon]     = useState("");
  const [phone,      setPhone]      = useState("");
  const [consent,    setConsent]    = useState(false);
  const [selected,   setSelected]   = useState({});     // add-on ids
  const [showExtras, setShowExtras] = useState(false);
  const [livePrice,  setLivePrice]  = useState(null);

  // ── Step 2 ──────────────────────────────────────────────────────────────
  const [firstName,           setFirstName]           = useState("");
  const [lastName,            setLastName]            = useState("");
  const [email,               setEmail]               = useState("");
  const [address,             setAddress]             = useState("");
  const [city,                setCity]                = useState("");
  const [usState,             setUsState]             = useState("OH");
  const [dogName,             setDogName]             = useState("");
  const [safeDog,             setSafeDog]             = useState("");
  const [dogComment,          setDogComment]          = useState("");
  const [gateLocation,        setGateLocation]        = useState("");
  const [gateCode,            setGateCode]            = useState("");
  const [doggieDoor,          setDoggieDoor]          = useState("");
  const [garbageCan,          setGarbageCan]          = useState("");
  const [areasToClean,        setAreasToClean]        = useState([]);
  const [areasOpen,           setAreasOpen]           = useState(false);
  // Notifications are auto-set (no longer asked on the form):
  // "Job completed (with photo)" delivered by text — the completion photo is proof of service.
  const notifMessage = "job_completed";
  const notifType    = "text";
  const [heardAbout,          setHeardAbout]          = useState("");
  const [additionalComments,  setAdditionalComments]  = useState("");
  const [termsAgreed,         setTermsAgreed]         = useState(false);

  // ── OOA lead capture ────────────────────────────────────────────────────
  const [ooaName,    setOoaName]    = useState("");
  const [ooaEmail,   setOoaEmail]   = useState("");
  const [ooaPhone,   setOoaPhone]   = useState("");
  const [ooaConsent, setOoaConsent] = useState(false);

  // ── Navigation / submission ──────────────────────────────────────────────
  const [step,        setStep]       = useState(1);   // 1 | 2 | "done" | "ooa-done"
  const [submitting,  setSubmitting] = useState(false);
  const [submitError, setSubmitError]= useState(null);

  // ── Derived ─────────────────────────────────────────────────────────────
  const zipClean = zip.trim().slice(0, 5);
  const zipReady = zipClean.length === 5;
  const inArea   = zipReady && isInArea(zipClean);

  const yardTier    = YARD_TIERS.find((t) => t.id === yardSize) ?? null;
  const yardIsXL    = yardTier?.id === "xlarge";   // custom-quote tier
  const yardUpcharge= (yardTier && !yardIsXL) ? (yardTier.upcharge ?? 0) : 0;

  const base = useMemo(
    () => calcLocalQuote({ dogs, frequency, lastCleaned }),
    [dogs, frequency, lastCleaned]
  );

  // Live SNG pricing proxy
  useEffect(() => {
    let cancelled = false;
    setLivePrice(null);
    if (!inArea || frequency === "one_time") return;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/quote?zip=${zipClean}&dogs=${dogs}&frequency=${frequency}`);
        const j = await r.json();
        if (!cancelled && j.configured && j.ok && typeof j.monthly === "number") {
          setLivePrice(j.monthly);
        }
      } catch { /* fallback to local */ }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [inArea, zipClean, dogs, frequency]);

  const baseMonthly   = livePrice ?? base.monthly;
  const monthly       = baseMonthly != null ? baseMonthly + yardUpcharge : null;

  const monthlyAddons = useMemo(() =>
    PRICING.addons
      .filter((a) => a.charge === "monthly" && selected[a.id])
      .map((a) => ({ ...a, price: a.id === "haul_away" ? haulAwayPrice(dogs) : a.price })),
    [selected, dogs]
  );
  const otherAddons = useMemo(() =>
    PRICING.addons.filter((a) => a.charge !== "monthly" && selected[a.id]),
    [selected]
  );
  const monthlyAddonTotal = monthlyAddons.reduce((s, a) => s + a.price, 0);
  const monthlyTotal = monthly != null ? monthly + monthlyAddonTotal : null;

  const toggle     = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const toggleArea = (a)  => setAreasToClean((p) =>
    p.includes(a) ? p.filter((x) => x !== a) : [...p, a]
  );

  const freqMax   = PRICING.frequencies.find((f) => f.id === frequency)?.maxDogs ?? 7;
  const overMax   = frequency !== "one_time" && dogs > freqMax;
  const notOffered= frequency !== "one_time" && monthly == null && !yardIsXL;

  // Step 1 gate: must have in-area ZIP, phone, consent, yard size (recurring)
  const yardSizeSelected = frequency === "one_time" || yardSize !== null;
  const canContinue = inArea && consent
    && phone.replace(/\D/g, "").length >= 10
    && (frequency === "one_time" || !notOffered)
    && yardSizeSelected;

  // Step 2 gate
  const step2Valid =
    firstName.trim() && lastName.trim() &&
    email.trim().includes("@") &&
    address.trim() && city.trim() && usState.trim() &&
    safeDog && gateLocation.trim() && garbageCan.trim() &&
    heardAbout && termsAgreed;

  // ── Build account note ──────────────────────────────────────────────────
  const buildAccountNote = () => {
    const parts = [];
    if (yardTier && yardTier.id !== "tiny") {
      parts.push(yardIsXL
        ? `Yard size: Over 3/4 acre — custom upcharge to be confirmed.`
        : `Yard size: ${yardTier.label} → +$${yardUpcharge}/mo. Subscription rate includes yard upcharge.`
      );
    }
    if (areasToClean.length > 0) {
      parts.push(`Areas to clean: ${areasToClean.join(", ")}.`);
    }
    if (additionalComments.trim()) {
      parts.push(additionalComments.trim());
    }
    return parts.join(" ");
  };

  // ── Build payload ────────────────────────────────────────────────────────
  const buildPayload = () => ({
    // SNG API fields (PUT /api/v1/residential/onboarding)
    organization:     "ohio-pet-waste-pros-qkr3c",
    first_name:       firstName,
    last_name:        lastName,
    email,
    cell_phone_number:phone,
    home_address:     address,
    city,
    state:            usState,
    zip_code:         zipClean,
    number_of_dogs:   dogs,
    clean_up_frequency: frequency,
    last_time_yard_was_thoroughly_cleaned: lastCleaned,
    initial_cleanup_required: ["one_week","two_weeks","three_weeks","one_month","two_months","3_4_months"].includes(lastCleaned) ? 1 : 0,
    coupon:           coupon || undefined,
    marketing_allowed: consent ? 1 : 0,
    terms_open_api:   termsAgreed ? 1 : 0,
    tracking_field:   heardAbout || "Website Instant Quote",
    // Dog info
    "dog_name[]":     [dogName || ""],
    "safe_dog[]":     [safeDog],
    "dog_comment[]":  [dogComment || ""],
    // Non-API fields (Pipedream reads these to add to account notes / Airtable)
    gate_location:    gateLocation,
    gate_code:        gateCode || undefined,
    has_doggie_door:  doggieDoor,
    garbage_can_location: garbageCan,
    areas_to_clean:   areasToClean,
    notification_message: notifMessage,
    notification_type:    notifType,
    account_note:     buildAccountNote() || undefined,
    // Yard / pricing meta
    yard_size_tier:          yardSize,
    yard_upcharge_monthly:   yardUpcharge,
    quoted_monthly_total:    monthlyTotal,
    selected_addons:         Object.keys(selected).filter((k) => selected[k]),
  });

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const j = await r.json();
      if (j.configured === false) {
        // Pipedream not wired yet — show confirmation only
        setStep("done-manual");
      } else if (j.ok) {
        // Account created in SNG → redirect to payment
        setStep("done");
      } else {
        setSubmitError(
          `Something went wrong on our end. Please call or text ${ORG_PHONE} and we'll get you set up right away.`
        );
      }
    } catch {
      setSubmitError(
        `Something went wrong. Please call or text ${ORG_PHONE} and we'll get you set up right away.`
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleOOASubmit = async () => {
    setSubmitting(true);
    try {
      await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zip: zipClean, name: ooaName, email: ooaEmail, phone: ooaPhone, consent: ooaConsent }),
      });
    } catch { /* ignore */ }
    setSubmitting(false);
    setStep("ooa-done");
  };

  // ── Terminal states ────────────────────────────────────────────────────
  if (step === "done") {
    return (
      <div style={{ background: "#fff", borderRadius: "22px", padding: "40px 34px", boxShadow: "0 30px 60px -28px rgba(0,0,0,.5)", textAlign: "center" }}>
        <div style={{ fontSize: "48px", marginBottom: "12px" }}>🐾</div>
        <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "26px", color: "#1A3C5A", marginBottom: "10px" }}>
          Almost done, {firstName}!
        </div>
        <p style={{ fontSize: "15px", color: "#46545d", lineHeight: 1.6, marginBottom: "22px" }}>
          Your account is set up. One last step — add your payment method to confirm your service start date.
        </p>
        <a
          href={SNG_PAY_URL}
          className="hov-cta"
          style={{
            display: "block", textAlign: "center", textDecoration: "none",
            background: "#4F9E3A", color: "#fff", borderRadius: "12px",
            padding: "17px", fontFamily: "'Bricolage Grotesque'",
            fontWeight: 800, fontSize: "18px",
            boxShadow: "0 14px 28px -12px rgba(79,158,58,.7)",
          }}
        >
          Set Up Autopay →
        </a>
        <p style={{ fontSize: "12.5px", color: "#9aa6ae", marginTop: "14px" }}>
          Powered by Sweep &amp; Go · No charge until service begins
        </p>
      </div>
    );
  }

  if (step === "done-manual") {
    return (
      <div style={{ background: "#fff", borderRadius: "22px", padding: "40px 34px", boxShadow: "0 30px 60px -28px rgba(0,0,0,.5)", textAlign: "center" }}>
        <div style={{ fontSize: "48px", marginBottom: "12px" }}>✅</div>
        <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "26px", color: "#1A3C5A", marginBottom: "10px" }}>
          We got your info, {firstName}!
        </div>
        <p style={{ fontSize: "15px", color: "#46545d", lineHeight: 1.6, marginBottom: "14px" }}>
          We&apos;ll reach out within 2 hours to confirm your service start date and walk you through the next step.
        </p>
        <p style={{ fontSize: "14px", color: "#7c8891" }}>
          Want to move faster? Call or text us at{" "}
          <a href={`tel:${ORG_PHONE.replace(/\D/g, "")}`} style={{ color: "#4F9E3A", fontWeight: 700 }}>
            {ORG_PHONE}
          </a>
        </p>
      </div>
    );
  }

  if (step === "ooa-done") {
    return (
      <div style={{ background: "#fff", borderRadius: "22px", padding: "40px 34px", boxShadow: "0 30px 60px -28px rgba(0,0,0,.5)", textAlign: "center" }}>
        <div style={{ fontSize: "48px", marginBottom: "12px" }}>📍</div>
        <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "24px", color: "#1A3C5A", marginBottom: "10px" }}>
          You&apos;re on the list!
        </div>
        <p style={{ fontSize: "15px", color: "#46545d", lineHeight: 1.6 }}>
          We&apos;re growing fast across NW Ohio and SE Michigan. We&apos;ll reach out the moment we start serving your area.
        </p>
      </div>
    );
  }

  // ── Progress bar (steps 1 & 2) ─────────────────────────────────────────
  const StepBar = () => (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "26px" }}>
      {[["1","Your Quote"],["2","Complete Signup"]].map(([n, label], i) => {
        const active = step === i + 1;
        const done   = step > i + 1;
        return (
          <div key={n} style={{ display: "flex", alignItems: "center", gap: "8px", ...(i > 0 ? { flex: 1 } : {}) }}>
            {i > 0 && <div style={{ height: "1px", flex: 1, background: done ? "#4F9E3A" : "#ddd" }} />}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{
                width: "26px", height: "26px", borderRadius: "50%", flexShrink: 0,
                background: active || done ? "#4F9E3A" : "#e0e5de",
                color: active || done ? "#fff" : "#8a96a0",
                fontSize: "12px", fontWeight: 800,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {done ? "✓" : n}
              </div>
              <span style={{ fontSize: "12.5px", fontWeight: 700, color: active ? "#1A3C5A" : "#8a96a0", whiteSpace: "nowrap" }}>
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════
  // STEP 1 — Instant Quote
  // ══════════════════════════════════════════════════════════════════════
  if (step === 1) return (
    <div style={{ background: "#fff", borderRadius: "22px", padding: "34px", boxShadow: "0 30px 60px -28px rgba(0,0,0,.5)" }}>
      <style>{`
        input[type=range].opwp-range{-webkit-appearance:none;appearance:none;width:100%;height:8px;border-radius:99px;background:#dfe5dc;outline:none;}
        input[type=range].opwp-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:30px;height:30px;border-radius:50%;background:#4F9E3A;border:4px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;}
        input[type=range].opwp-range::-moz-range-thumb{width:30px;height:30px;border-radius:50%;background:#4F9E3A;border:4px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;}
      `}</style>

      <StepBar />

      {/* ZIP + coupon */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px", marginBottom: "22px" }}>
        <div>
          <label style={lbl}>Zip Code</label>
          <input
            value={zip} onChange={(e) => setZip(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric" maxLength={5} placeholder="43560"
            style={{ ...inp, borderColor: zipReady ? (inArea ? "#4F9E3A" : "#d9534f") : "#dfe2da" }}
          />
        </div>
        <div>
          <label style={lbl}>Coupon Code</label>
          <input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="Optional" style={inp} />
        </div>
      </div>

      {/* Out-of-area lead capture */}
      {zipReady && !inArea && (
        <>
          <div style={{ background: "#fff5f4", border: "1.5px solid #f1c9c5", borderRadius: "12px", padding: "16px 18px", marginBottom: "18px", fontSize: "14px", color: "#8a3b36", lineHeight: 1.5 }}>
            We&apos;re not in <strong>{zipClean}</strong> yet — but we&apos;re expanding fast. Leave your info and we&apos;ll reach out the moment we cover your area.
          </div>
          <div style={{ display: "grid", gap: "14px", marginBottom: "14px" }}>
            <div>
              <label style={lbl}>Your Name {req}</label>
              <input value={ooaName} onChange={(e) => setOoaName(e.target.value)} placeholder="Jane Smith" style={inp} />
            </div>
            <div>
              <label style={lbl}>Email Address {req}</label>
              <input value={ooaEmail} onChange={(e) => setOoaEmail(e.target.value)} type="email" placeholder="jane@example.com" style={inp} />
            </div>
            <div>
              <label style={lbl}>Cell Phone {opt}</label>
              <input value={ooaPhone} onChange={(e) => setOoaPhone(e.target.value)} inputMode="tel" placeholder="(419) 000-0000" style={inp} />
            </div>
            <label style={{ display: "flex", gap: "10px", alignItems: "flex-start", fontSize: "12px", lineHeight: 1.5, color: "#7c8891", cursor: "pointer" }}>
              <input type="checkbox" checked={ooaConsent} onChange={(e) => setOoaConsent(e.target.checked)} style={{ marginTop: "2px", width: "16px", height: "16px", accentColor: "#4F9E3A" }} />
              <span>I consent to receive marketing messages from Ohio Pet Waste Pros. Message &amp; data rates may apply. Reply STOP to opt out.</span>
            </label>
          </div>
          <button
            type="button" onClick={handleOOASubmit}
            disabled={!ooaName.trim() || !ooaEmail.trim() || !ooaConsent || submitting}
            style={{
              display: "block", width: "100%", textAlign: "center",
              background: ooaName.trim() && ooaEmail.trim() && ooaConsent ? "#1A3C5A" : "#b0bec5",
              color: "#fff", border: "none", borderRadius: "12px", padding: "16px",
              fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "17px",
              cursor: ooaName.trim() && ooaEmail.trim() && ooaConsent ? "pointer" : "not-allowed",
            }}
          >
            {submitting ? "Submitting…" : "Join the Waitlist →"}
          </button>
        </>
      )}

      {/* In-area: full quote tool */}
      {(!zipReady || inArea) && (
        <>
          {/* Dogs */}
          <div style={{ marginBottom: "26px" }}>
            <label style={{ ...lbl, marginBottom: "14px" }}>
              Number of dogs:{" "}
              <span style={{ color: "#4F9E3A", fontFamily: "'Bricolage Grotesque'", fontSize: "16px" }}>
                {dogs}{dogs === 7 ? "+" : ""}
              </span>
            </label>
            <input type="range" min="1" max="7" value={dogs} onChange={(e) => setDogs(Number(e.target.value))} className="opwp-range" />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: 600, color: "#8a96a0", marginTop: "8px", padding: "0 2px" }}>
              {[1,2,3,4,5,6,7].map((n) => <span key={n}>{n === 7 ? "7+" : n}</span>)}
            </div>
          </div>

          {/* Frequency */}
          <div style={{ marginBottom: "22px" }}>
            <label style={{ ...lbl, marginBottom: "12px" }}>Cleanup frequency</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px" }}>
              {PRICING.frequencies.map((f) => {
                const active = f.id === frequency;
                return (
                  <button key={f.id} type="button" onClick={() => setFrequency(f.id)} style={{
                    border: `1.5px solid ${active ? "#4F9E3A" : "#dfe2da"}`,
                    background: active ? "#4F9E3A" : "#fff", color: active ? "#fff" : "#46545d",
                    borderRadius: "10px", padding: "11px 6px", fontWeight: 700, fontSize: "12.5px",
                    cursor: "pointer", fontFamily: "inherit", lineHeight: 1.25,
                  }}>
                    {f.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Last cleaned */}
          <div style={{ marginBottom: "22px" }}>
            <label style={lbl}>When was your yard last thoroughly cleaned?</label>
            <select value={lastCleaned} onChange={(e) => setLastCleaned(e.target.value)} style={inp}>
              {PRICING.lastCleanedOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>

          {/* Yard size (recurring only) */}
          {frequency !== "one_time" && inArea && (
            <div style={{ marginBottom: "22px" }}>
              <label style={{ ...lbl, marginBottom: "10px" }}>
                How big is your yard? {req}{" "}
                <span style={{ color: "#9aa6ae", fontWeight: 400, fontSize: "12px" }}>(affects monthly rate)</span>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "8px" }}>
                {YARD_TIERS.map((t) => {
                  const active   = yardSize === t.id;
                  const isCustom = t.upcharge == null;
                  return (
                    <button key={t.id} type="button" onClick={() => setYardSize(t.id)} style={{
                      border: `1.5px solid ${active ? "#4F9E3A" : "#dfe2da"}`,
                      background: active ? "#f3f9f0" : "#fff",
                      borderRadius: "10px", padding: "10px 12px", textAlign: "left",
                      cursor: "pointer", fontFamily: "inherit",
                    }}>
                      <div style={{ fontWeight: 700, fontSize: "13px", color: active ? "#1A3C5A" : "#36424b" }}>
                        {t.label}
                        {t.upcharge > 0  && <span style={{ color: "#4F9E3A", marginLeft: "6px" }}>+${t.upcharge}/mo</span>}
                        {isCustom        && <span style={{ color: "#d9534f", marginLeft: "6px", fontSize: "11.5px" }}>Custom quote</span>}
                        {t.id === "tiny" && <span style={{ color: "#4F9E3A", marginLeft: "6px", fontSize: "11.5px" }}>Included</span>}
                      </div>
                      <div style={{ fontSize: "11.5px", color: "#9aa6ae", marginTop: "2px" }}>{t.sub}</div>
                    </button>
                  );
                })}
              </div>
              {yardIsXL && (
                <div style={{ marginTop: "10px", background: "#fff8f0", border: "1.5px solid #f5d5a0", borderRadius: "10px", padding: "12px 14px", fontSize: "13px", color: "#7a5a20", lineHeight: 1.5 }}>
                  For properties over 3/4 acre, we&apos;ll confirm pricing after a quick yard assessment. Continue with your signup and we&apos;ll follow up before your first visit.
                </div>
              )}
            </div>
          )}

          {/* Extras */}
          <button type="button" onClick={() => setShowExtras((v) => !v)} style={{
            background: "none", border: "none", padding: 0, color: "#4F9E3A",
            fontWeight: 700, fontSize: "14px", cursor: "pointer",
            marginBottom: showExtras ? "14px" : "22px", fontFamily: "inherit",
          }}>
            {showExtras ? "− Hide extras" : "+ Add extras (front yard, deodorize, sanitize, dog food)"}
          </button>
          {showExtras && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "22px" }}>
              {PRICING.addons.map((a) => {
                const price = a.id === "haul_away" ? haulAwayPrice(dogs) : a.price;
                const on    = !!selected[a.id];
                return (
                  <label key={a.id} style={{
                    display: "flex", gap: "10px", alignItems: "flex-start",
                    border: `1.5px solid ${on ? "#4F9E3A" : "#e6e9e2"}`,
                    background: on ? "#f3f9f0" : "#fbfbf9",
                    borderRadius: "10px", padding: "11px 13px", cursor: "pointer",
                  }}>
                    <input type="checkbox" checked={on} onChange={() => toggle(a.id)} style={{ marginTop: "3px", width: "16px", height: "16px", accentColor: "#4F9E3A" }} />
                    <span style={{ flex: 1 }}>
                      <span style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "13.5px", fontWeight: 700, color: "#36424b" }}>
                        <span>{a.name}</span>
                        <span style={{ color: "#4F9E3A", whiteSpace: "nowrap" }}>+{money(price)}{CHARGE_LABEL[a.charge]}</span>
                      </span>
                      <span style={{ fontSize: "12px", color: "#8a96a0", lineHeight: 1.4 }}>{a.desc}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {/* Price panel */}
          {inArea && (
            <div style={{ background: "#F6F5EF", border: "1.5px solid #e9e6da", borderRadius: "16px", padding: "20px 22px", marginBottom: "22px" }}>
              {frequency === "one_time" ? (
                <>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#7c8891", marginBottom: "4px" }}>One-time cleanup estimate</div>
                  <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "34px", color: "#1A3C5A", lineHeight: 1.05 }}>
                    {base.oneTimeRange ? rngStr(base.oneTimeRange) : "Custom quote"}
                  </div>
                  <div style={{ fontSize: "12.5px", color: "#8a96a0", marginTop: "6px" }}>
                    {base.oneTimeRange
                      ? "Estimate based on dogs + time since last cleaned. Exact price confirmed on-site."
                      : "We'll reach out with an exact price."}
                  </div>
                </>
              ) : notOffered ? (
                <>
                  <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "24px", color: "#1A3C5A" }}>Not offered for this combo</div>
                  <div style={{ fontSize: "13px", color: "#8a96a0", marginTop: "6px", lineHeight: 1.5 }}>
                    {overMax ? `${PRICING.frequencies.find((f) => f.id === frequency)?.name} isn't offered for ${dogs}${dogs===7?"+ ":""}dogs.` : ""} Try Weekly or 2×/week.
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
                    <div>
                      <span style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "38px", color: "#1A3C5A", lineHeight: 1 }}>
                        {monthlyTotal != null ? money(monthlyTotal) : "—"}
                      </span>
                      <span style={{ fontSize: "15px", color: "#7c8891", fontWeight: 700 }}>/mo</span>
                    </div>
                    {base.perVisit != null && (
                      <div style={{ fontSize: "13px", color: "#7c8891", textAlign: "right" }}>
                        {money(base.perVisit)}/visit<br />
                        <span style={{ fontSize: "12px" }}>{base.visits} visits/mo</span>
                      </div>
                    )}
                  </div>
                  {yardUpcharge > 0 && (
                    <div style={{ marginTop: "8px", fontSize: "12.5px", color: "#4F9E3A" }}>
                      Includes {yardTier?.label} yard upcharge (+${yardUpcharge}/mo)
                    </div>
                  )}
                  {yardIsXL && (
                    <div style={{ marginTop: "8px", fontSize: "12.5px", color: "#7c8891" }}>
                      Yard upcharge to be confirmed for properties over 3/4 acre.
                    </div>
                  )}
                  {monthlyAddons.length > 0 && (
                    <div style={{ marginTop: "10px", fontSize: "12.5px", color: "#6f7686", borderTop: "1px dashed #ddd9cc", paddingTop: "10px" }}>
                      Base {money(baseMonthly)}/mo
                      {monthlyAddons.map((a) => <span key={a.id}>{" + "}{money(a.price)} {a.name.toLowerCase()}</span>)}
                    </div>
                  )}
                  {base.initialRange && (
                    <div style={{ marginTop: "10px", fontSize: "12.5px", color: "#6f7686" }}>
                      Plus a one-time initial cleanup, est. <strong>{rngStr(base.initialRange)}</strong> (first visit only).
                    </div>
                  )}
                  {otherAddons.length > 0 && (
                    <div style={{ marginTop: "8px", fontSize: "12.5px", color: "#6f7686" }}>
                      Added at checkout: {otherAddons.map((a) => `${a.name} (${money(a.price)}${CHARGE_LABEL[a.charge]})`).join(", ")}.
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Phone + consent */}
          <div style={{ marginBottom: "20px" }}>
            <label style={lbl}>Cell Phone Number {req}</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="(419) 000-0000" style={inp} />
          </div>
          <label style={{ display: "flex", gap: "10px", alignItems: "flex-start", fontSize: "12px", lineHeight: 1.5, color: "#7c8891", marginBottom: "22px", cursor: "pointer" }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: "2px", width: "16px", height: "16px", accentColor: "#4F9E3A" }} />
            <span>I consent to receive marketing and service messages from Ohio Pet Waste Pros at the phone number provided. Message frequency may vary; message &amp; data rates may apply. Reply STOP to opt out.</span>
          </label>

          {/* CTA */}
          <button
            type="button"
            onClick={() => { if (canContinue) { window.scrollTo(0, 0); setStep(2); } }}
            style={{
              display: "block", width: "100%", textAlign: "center",
              background: canContinue ? "#4F9E3A" : "#bcd3b1", color: "#fff",
              border: "none", borderRadius: "12px", padding: "17px",
              fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "18px",
              cursor: canContinue ? "pointer" : "not-allowed",
              boxShadow: canContinue ? "0 14px 28px -12px rgba(79,158,58,.7)" : "none",
            }}
          >
            {!zipReady          ? "Enter your ZIP to start →"
            : !inArea           ? "Enter a ZIP in our service area"
            : !phone.replace(/\D/g,"").length ? "Enter your phone number to continue"
            : !consent          ? "Check the box to continue"
            : !yardSizeSelected ? "Select your yard size to continue"
            : notOffered        ? "Try Weekly or 2×/week"
            :                     "See your quote & sign up →"}
          </button>
          <div style={{ textAlign: "center", fontSize: "12px", color: "#9aa6ae", marginTop: "12px" }}>
            🔒 No payment on this step
          </div>
        </>
      )}
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════
  // STEP 2 — Complete Signup
  // ══════════════════════════════════════════════════════════════════════
  return (
    <div style={{ background: "#fff", borderRadius: "22px", padding: "34px", boxShadow: "0 30px 60px -28px rgba(0,0,0,.5)" }}>
      <StepBar />

      <button type="button" onClick={() => setStep(1)} style={{
        background: "none", border: "none", color: "#4F9E3A", fontWeight: 700,
        fontSize: "13px", cursor: "pointer", padding: 0, marginBottom: "18px", fontFamily: "inherit",
      }}>
        ← Back to your quote
      </button>

      {/* Quote summary */}
      {monthlyTotal != null && frequency !== "one_time" && (
        <div style={{ background: "#f3f9f0", border: "1.5px solid #c8e0be", borderRadius: "12px", padding: "14px 16px", marginBottom: "22px", fontSize: "13.5px", color: "#36424b" }}>
          <strong style={{ color: "#1A3C5A" }}>Your plan: </strong>
          {PRICING.frequencies.find((f) => f.id === frequency)?.name} · {dogs} dog{dogs > 1 ? "s" : ""}{" "}
          · <strong>{money(monthlyTotal)}/mo</strong>
          {base.initialRange && <span> + initial cleanup est. {rngStr(base.initialRange)}</span>}
        </div>
      )}

      {/* ── Contact ── */}
      <div style={secHead(true)}>Contact Information</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
        <div>
          <label style={lbl}>First Name {req}</label>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inp} />
        </div>
        <div>
          <label style={lbl}>Last Name {req}</label>
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} style={inp} />
        </div>
      </div>
      <div style={{ marginBottom: "14px" }}>
        <label style={lbl}>Email Address {req}</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com" style={inp} />
      </div>
      <div style={{ marginBottom: "14px" }}>
        <label style={lbl}>Home Address {req}</label>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St" style={inp} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: "14px", marginBottom: "22px" }}>
        <div>
          <label style={lbl}>City {req}</label>
          <input value={city} onChange={(e) => setCity(e.target.value)} style={inp} />
        </div>
        <div>
          <label style={lbl}>State {req}</label>
          <input value={usState} onChange={(e) => setUsState(e.target.value.toUpperCase())} maxLength={2} style={{ ...inp, textTransform: "uppercase" }} />
        </div>
      </div>

      {/* ── Dog info ── */}
      <div style={secHead()}>About Your Dog{dogs > 1 ? "s" : ""}</div>
      <div style={{ marginBottom: "14px" }}>
        <label style={lbl}>Dog&apos;s Name {opt}</label>
        <input value={dogName} onChange={(e) => setDogName(e.target.value)} placeholder="Buddy" style={inp} />
      </div>
      <div style={{ marginBottom: "14px" }}>
        <label style={lbl}>Is it safe for our team to be in the yard with your dog? {req}</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "8px" }}>
          {[
            ["yes",      "Yes — completely safe"],
            ["indoors",  "No — keep indoors during service"],
          ].map(([val, label]) => (
            <Btn key={val} active={safeDog === val} onClick={() => setSafeDog(val)}>{label}</Btn>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: "22px" }}>
        <label style={lbl}>Additional dog notes {opt}</label>
        <input value={dogComment} onChange={(e) => setDogComment(e.target.value)} placeholder="e.g. Barks but is friendly, anxious around strangers…" style={inp} />
      </div>

      {/* ── Property access ── */}
      <div style={secHead()}>Property Access</div>
      <div style={{ marginBottom: "14px" }}>
        <label style={lbl}>Where is your gate located? {req}</label>
        <input value={gateLocation} onChange={(e) => setGateLocation(e.target.value)} placeholder="e.g. Left side of house" style={inp} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
        <div>
          <label style={lbl}>Gated community code {opt}</label>
          <input value={gateCode} onChange={(e) => setGateCode(e.target.value)} placeholder="e.g. #1234" style={inp} />
        </div>
        <div>
          <label style={lbl}>Does your home have a doggie door?</label>
          <div style={{ display: "flex", gap: "8px" }}>
            {[["yes","Yes"],["no","No"]].map(([val, label]) => (
              <Btn key={val} active={doggieDoor === val} onClick={() => setDoggieDoor(val)} style={{ flex: 1 }}>{label}</Btn>
            ))}
          </div>
        </div>
      </div>
      <div style={{ marginBottom: "14px" }}>
        <label style={lbl}>Where is the garbage can located? {req}</label>
        <input value={garbageCan} onChange={(e) => setGarbageCan(e.target.value)} placeholder="e.g. Right side of house" style={inp} />
      </div>
      <div style={{ marginBottom: "22px", position: "relative" }}>
        <label style={{ ...lbl, marginBottom: "10px" }}>Which areas should we clean? {opt}</label>
        <div
          onClick={() => setAreasOpen((o) => !o)}
          style={{ ...inp, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}
        >
          <span style={{ color: areasToClean.length ? "#1A3C5A" : "#9aa6ae", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {areasToClean.length ? areasToClean.join(", ") : "Select all that apply…"}
          </span>
          <span style={{ color: "#9aa6ae", fontSize: "11px", flexShrink: 0 }}>{areasOpen ? "▲" : "▼"}</span>
        </div>
        {areasOpen && (
          <div style={{ position: "absolute", zIndex: 20, left: 0, right: 0, marginTop: "4px", background: "#fff", border: "1.5px solid #dfe2da", borderRadius: "10px", boxShadow: "0 14px 30px -14px rgba(0,0,0,.4)", padding: "6px", maxHeight: "252px", overflowY: "auto" }}>
            {AREA_OPTIONS.map((label) => {
              const on = areasToClean.includes(label);
              return (
                <div
                  key={label}
                  onClick={() => toggleArea(label)}
                  style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 10px", borderRadius: "8px", cursor: "pointer", background: on ? "#f3f9f0" : "transparent" }}
                >
                  <span style={{ width: "18px", height: "18px", flexShrink: 0, borderRadius: "5px", border: on ? "1.5px solid #4F9E3A" : "1.5px solid #cfd6cf", background: on ? "#4F9E3A" : "#fff", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700 }}>
                    {on ? "✓" : ""}
                  </span>
                  <span style={{ fontSize: "14px", color: on ? "#1A3C5A" : "#31424c", fontWeight: on ? 700 : 400 }}>{label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── How heard + comments ── */}
      <div style={{ marginBottom: "14px" }}>
        <label style={lbl}>How did you hear about us? {req}</label>
        <select value={heardAbout} onChange={(e) => setHeardAbout(e.target.value)} style={inp}>
          <option value="">Select…</option>
          {HEARD_ABOUT.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: "22px" }}>
        <label style={lbl}>Additional comments {opt}</label>
        <textarea
          value={additionalComments} onChange={(e) => setAdditionalComments(e.target.value)}
          placeholder="Anything else we should know about your property or preferences?"
          style={{ ...inp, resize: "vertical", minHeight: "80px" }}
        />
      </div>

      {/* Terms */}
      <label style={{ display: "flex", gap: "10px", alignItems: "flex-start", fontSize: "12px", lineHeight: 1.5, color: "#7c8891", marginBottom: "22px", cursor: "pointer" }}>
        <input type="checkbox" checked={termsAgreed} onChange={(e) => setTermsAgreed(e.target.checked)} style={{ marginTop: "2px", width: "16px", height: "16px", accentColor: "#4F9E3A" }} />
        <span>
          I agree to the{" "}
          <a href="/terms-of-service/" style={{ color: "#4F9E3A", fontWeight: 700 }}>Terms of Service</a>
          {" "}and authorize Ohio Pet Waste Pros to begin service at the address provided.
        </span>
      </label>

      {/* Error */}
      {submitError && (
        <div style={{ background: "#fff5f4", border: "1.5px solid #f1c9c5", borderRadius: "12px", padding: "14px 16px", marginBottom: "18px", fontSize: "13.5px", color: "#8a3b36", lineHeight: 1.5 }}>
          {submitError}
        </div>
      )}

      {/* Submit */}
      <button
        type="button"
        onClick={() => { if (step2Valid && !submitting) handleSubmit(); }}
        disabled={!step2Valid || submitting}
        style={{
          display: "block", width: "100%", textAlign: "center",
          background: step2Valid ? "#4F9E3A" : "#bcd3b1", color: "#fff",
          border: "none", borderRadius: "12px", padding: "17px",
          fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "18px",
          cursor: step2Valid ? "pointer" : "not-allowed",
          boxShadow: step2Valid ? "0 14px 28px -12px rgba(79,158,58,.7)" : "none",
        }}
      >
        {submitting ? "Setting up your account…" : "Confirm & Start My Service →"}
      </button>
      <div style={{ textAlign: "center", fontSize: "12px", color: "#9aa6ae", marginTop: "12px" }}>
        Next step: payment setup on Sweep &amp; Go · 🔒 Secure
      </div>
    </div>
  );
}
