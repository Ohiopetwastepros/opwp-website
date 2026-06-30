"use client";

import { useEffect, useMemo, useState } from "react";
import { PRICING, CHARGE_LABEL, isInArea, haulAwayPrice, calcLocalQuote } from "./pricing";

const SNG_ONBOARDING_URL =
  process.env.NEXT_PUBLIC_SNG_ONBOARDING_URL ||
  "https://ohiopetwastepros.com/sng/ohio-pet-waste-pros-qkr3c-client-onboarding/";

const inputStyle = {
  width: "100%",
  padding: "13px 14px",
  border: "1.5px solid #dfe2da",
  borderRadius: "10px",
  fontSize: "15px",
  fontFamily: "inherit",
  background: "#fff",
};
const labelStyle = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#46545d",
  display: "block",
  marginBottom: "7px",
};

const money = (n) =>
  "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const range = ([lo, hi]) => `${money(lo)}–${money(hi)}`;

export default function QuoteForm() {
  const [zip, setZip] = useState("");
  const [dogs, setDogs] = useState(1);
  const [frequency, setFrequency] = useState("once_a_week");
  const [lastCleaned, setLastCleaned] = useState("one_month");
  const [coupon, setCoupon] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [selected, setSelected] = useState({});
  const [showExtras, setShowExtras] = useState(false);
  const [livePrice, setLivePrice] = useState(null);

  const zipClean = zip.trim().slice(0, 5);
  const zipReady = zipClean.length === 5;
  const inArea = zipReady && isInArea(zipClean);

  const base = useMemo(
    () => calcLocalQuote({ dogs, frequency, lastCleaned }),
    [dogs, frequency, lastCleaned]
  );

  // Live SNG pricing (server proxy). Falls back to local when not configured.
  useEffect(() => {
    let cancelled = false;
    setLivePrice(null);
    if (!inArea || frequency === "one_time") return;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/quote?zip=${zipClean}&dogs=${dogs}&frequency=${frequency}`
        );
        const j = await r.json();
        if (!cancelled && j.configured && j.ok && typeof j.monthly === "number") {
          setLivePrice(j.monthly);
        }
      } catch {
        /* ignore -> local pricing */
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [inArea, zipClean, dogs, frequency]);

  const monthly = livePrice ?? base.monthly;

  const monthlyAddons = useMemo(() => {
    return PRICING.addons
      .filter((a) => a.charge === "monthly" && selected[a.id])
      .map((a) => ({ ...a, price: a.id === "haul_away" ? haulAwayPrice(dogs) : a.price }));
  }, [selected, dogs]);

  const otherAddons = useMemo(
    () => PRICING.addons.filter((a) => a.charge !== "monthly" && selected[a.id]),
    [selected]
  );

  const monthlyAddonTotal = monthlyAddons.reduce((s, a) => s + a.price, 0);
  const monthlyTotal = monthly != null ? monthly + monthlyAddonTotal : null;

  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));

  const freqMax = PRICING.frequencies.find((f) => f.id === frequency)?.maxDogs ?? 7;
  const overMax = frequency !== "one_time" && dogs > freqMax;
  const notOffered = frequency !== "one_time" && monthly == null;

  const signupHref = useMemo(() => {
    const p = new URLSearchParams({
      zip: zipClean,
      dogs: String(dogs),
      frequency,
      last_cleaned: lastCleaned,
    });
    if (phone) p.set("cell_phone_number", phone);
    if (coupon) p.set("coupon", coupon);
    const sep = SNG_ONBOARDING_URL.includes("?") ? "&" : "?";
    return `${SNG_ONBOARDING_URL}${sep}${p.toString()}`;
  }, [zipClean, dogs, frequency, lastCleaned, phone, coupon]);

  const canSignup = inArea && consent && (frequency === "one_time" || !notOffered);

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "22px",
        padding: "34px",
        boxShadow: "0 30px 60px -28px rgba(0,0,0,.5)",
      }}
    >
      <style>{`
        input[type=range].opwp-range{-webkit-appearance:none;appearance:none;width:100%;height:8px;border-radius:99px;background:#dfe5dc;outline:none;}
        input[type=range].opwp-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:30px;height:30px;border-radius:50%;background:#4F9E3A;border:4px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;}
        input[type=range].opwp-range::-moz-range-thumb{width:30px;height:30px;border-radius:50%;background:#4F9E3A;border:4px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;}
      `}</style>

      {/* ZIP + coupon */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px", marginBottom: "22px" }}>
        <div>
          <label style={labelStyle}>Zip Code</label>
          <input
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            maxLength={5}
            placeholder="43560"
            style={{
              ...inputStyle,
              borderColor: zipReady ? (inArea ? "#4F9E3A" : "#d9534f") : "#dfe2da",
            }}
          />
        </div>
        <div>
          <label style={labelStyle}>Coupon Code</label>
          <input value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="Optional" style={inputStyle} />
        </div>
      </div>

      {zipReady && !inArea && (
        <div
          style={{
            background: "#fff5f4",
            border: "1.5px solid #f1c9c5",
            borderRadius: "12px",
            padding: "16px 18px",
            marginBottom: "22px",
            fontSize: "14px",
            color: "#8a3b36",
            lineHeight: 1.5,
          }}
        >
          We&apos;re not in <strong>{zipClean}</strong> just yet &mdash; but we&apos;re expanding fast.
          Leave your cell below and we&apos;ll text you the moment we reach your area.
        </div>
      )}

      {/* Dogs */}
      <div style={{ marginBottom: "26px" }}>
        <label style={{ ...labelStyle, marginBottom: "14px" }}>
          Number of dogs:{" "}
          <span style={{ color: "#4F9E3A", fontFamily: "'Bricolage Grotesque'", fontSize: "16px" }}>
            {dogs}
            {dogs === 7 ? "+" : ""}
          </span>
        </label>
        <input
          type="range"
          min="1"
          max="7"
          value={dogs}
          onChange={(e) => setDogs(Number(e.target.value))}
          className="opwp-range"
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "12px",
            fontWeight: 600,
            color: "#8a96a0",
            marginTop: "8px",
            padding: "0 2px",
          }}
        >
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <span key={n}>{n === 7 ? "7+" : n}</span>
          ))}
        </div>
      </div>

      {/* Frequency */}
      <div style={{ marginBottom: "22px" }}>
        <label style={{ ...labelStyle, marginBottom: "12px" }}>Cleanup frequency</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px" }}>
          {PRICING.frequencies.map((f) => {
            const active = f.id === frequency;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFrequency(f.id)}
                style={{
                  border: `1.5px solid ${active ? "#4F9E3A" : "#dfe2da"}`,
                  background: active ? "#4F9E3A" : "#fff",
                  color: active ? "#fff" : "#46545d",
                  borderRadius: "10px",
                  padding: "11px 6px",
                  fontWeight: 700,
                  fontSize: "12.5px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  lineHeight: 1.25,
                }}
              >
                {f.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Last cleaned */}
      <div style={{ marginBottom: "22px" }}>
        <label style={labelStyle}>When was your yard last thoroughly cleaned?</label>
        <select value={lastCleaned} onChange={(e) => setLastCleaned(e.target.value)} style={inputStyle}>
          {PRICING.lastCleanedOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Extras */}
      <button
        type="button"
        onClick={() => setShowExtras((v) => !v)}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          color: "#4F9E3A",
          fontWeight: 700,
          fontSize: "14px",
          cursor: "pointer",
          marginBottom: showExtras ? "14px" : "22px",
          fontFamily: "inherit",
        }}
      >
        {showExtras ? "− Hide extras" : "+ Add extras (front yard, deodorize, sanitize, dog food)"}
      </button>
      {showExtras && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "22px" }}>
          {PRICING.addons.map((a) => {
            const price = a.id === "haul_away" ? haulAwayPrice(dogs) : a.price;
            const on = !!selected[a.id];
            return (
              <label
                key={a.id}
                style={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "flex-start",
                  border: `1.5px solid ${on ? "#4F9E3A" : "#e6e9e2"}`,
                  background: on ? "#f3f9f0" : "#fbfbf9",
                  borderRadius: "10px",
                  padding: "11px 13px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(a.id)}
                  style={{ marginTop: "3px", width: "16px", height: "16px", accentColor: "#4F9E3A" }}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "13.5px", fontWeight: 700, color: "#36424b" }}>
                    <span>{a.name}</span>
                    <span style={{ color: "#4F9E3A", whiteSpace: "nowrap" }}>
                      +{money(price)}
                      {CHARGE_LABEL[a.charge]}
                    </span>
                  </span>
                  <span style={{ fontSize: "12px", color: "#8a96a0", lineHeight: 1.4 }}>{a.desc}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}

      {/* PRICE PANEL */}
      {inArea && (
        <div
          style={{
            background: "#F6F5EF",
            border: "1.5px solid #e9e6da",
            borderRadius: "16px",
            padding: "20px 22px",
            marginBottom: "22px",
          }}
        >
          {frequency === "one_time" ? (
            <>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#7c8891", marginBottom: "4px" }}>
                One-time cleanup estimate
              </div>
              <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "34px", color: "#1A3C5A", lineHeight: 1.05 }}>
                {base.oneTimeRange ? range(base.oneTimeRange) : "Custom quote"}
              </div>
              <div style={{ fontSize: "12.5px", color: "#8a96a0", marginTop: "6px" }}>
                {base.oneTimeRange
                  ? "Estimate based on dogs + time since last cleaned. Exact price confirmed after a tech sees the yard."
                  : "We'll give you an exact price for this one — we'll reach out."}
              </div>
            </>
          ) : notOffered ? (
            <>
              <div style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "24px", color: "#1A3C5A" }}>
                Custom quote
              </div>
              <div style={{ fontSize: "13px", color: "#8a96a0", marginTop: "6px", lineHeight: 1.5 }}>
                {overMax ? PRICING.frequencies.find((f) => f.id === frequency)?.name : "This plan"} isn&apos;t offered for {dogs}
                {dogs === 7 ? "+" : ""} dog{dogs > 1 ? "s" : ""}. Sign up and we&apos;ll tailor a plan, or try Weekly / 2x a week.
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px" }}>
                <div>
                  <span style={{ fontFamily: "'Bricolage Grotesque'", fontWeight: 800, fontSize: "38px", color: "#1A3C5A", lineHeight: 1 }}>
                    {money(monthlyTotal)}
                  </span>
                  <span style={{ fontSize: "15px", color: "#7c8891", fontWeight: 700 }}>/mo</span>
                </div>
                {base.perVisit != null && (
                  <div style={{ fontSize: "13px", color: "#7c8891", textAlign: "right" }}>
                    {money(base.perVisit)}/visit
                    <br />
                    <span style={{ fontSize: "12px" }}>{base.visits} visits/mo</span>
                  </div>
                )}
              </div>

              {monthlyAddons.length > 0 && (
                <div style={{ marginTop: "10px", fontSize: "12.5px", color: "#6f7686", borderTop: "1px dashed #ddd9cc", paddingTop: "10px" }}>
                  Base {money(monthly)}/mo
                  {monthlyAddons.map((a) => (
                    <span key={a.id}>
                      {" + "}
                      {money(a.price)} {a.name.toLowerCase()}
                    </span>
                  ))}
                </div>
              )}

              {base.initialRange && (
                <div style={{ marginTop: "10px", fontSize: "12.5px", color: "#6f7686" }}>
                  Plus a one-time initial cleanup, est. <strong>{range(base.initialRange)}</strong> (first visit only).
                </div>
              )}

              {otherAddons.length > 0 && (
                <div style={{ marginTop: "8px", fontSize: "12.5px", color: "#6f7686" }}>
                  Added at checkout:{" "}
                  {otherAddons
                    .map((a) => `${a.name} (${money(a.price)}${CHARGE_LABEL[a.charge]})`)
                    .join(", ")}
                  .
                </div>
              )}

              <div style={{ marginTop: "10px", fontSize: "11.5px", color: "#9aa6ae", lineHeight: 1.4 }}>
                Final monthly price confirmed at scheduling based on yard size.
              </div>
            </>
          )}
        </div>
      )}

      {/* Phone + consent */}
      <div style={{ marginBottom: "20px" }}>
        <label style={labelStyle}>Cell Phone Number</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          placeholder="(419) 000-0000"
          style={inputStyle}
        />
      </div>

      <label
        style={{
          display: "flex",
          gap: "10px",
          alignItems: "flex-start",
          fontSize: "12px",
          lineHeight: 1.5,
          color: "#7c8891",
          marginBottom: "22px",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          style={{ marginTop: "2px", width: "16px", height: "16px", accentColor: "#4F9E3A" }}
        />
        <span>
          I consent to receive marketing and service messages from Ohio Pet Waste Pros at the phone
          number provided. Message frequency may vary; message &amp; data rates may apply. Reply STOP
          to opt out.
        </span>
      </label>

      <a
        href={canSignup ? signupHref : undefined}
        aria-disabled={!canSignup}
        className={canSignup ? "hov-cta" : undefined}
        onClick={(e) => {
          if (!canSignup) e.preventDefault();
        }}
        style={{
          display: "block",
          textAlign: "center",
          width: "100%",
          background: canSignup ? "#4F9E3A" : "#bcd3b1",
          color: "#fff",
          textDecoration: "none",
          borderRadius: "12px",
          padding: "17px",
          fontFamily: "'Bricolage Grotesque'",
          fontWeight: 800,
          fontSize: "18px",
          cursor: canSignup ? "pointer" : "not-allowed",
          boxShadow: canSignup ? "0 14px 28px -12px rgba(79,158,58,.7)" : "none",
        }}
      >
        {!zipReady
          ? "Enter your ZIP to start →"
          : !inArea
          ? "Join the waitlist →"
          : !consent
          ? "Check the box to continue"
          : "Confirm & Sign Up →"}
      </a>
      <div style={{ textAlign: "center", fontSize: "12px", color: "#9aa6ae", marginTop: "12px" }}>
        🔒 Secure signup powered by Sweep&amp;Go
      </div>
    </div>
  );
}
