"use client";

import { useEffect, useMemo, useState } from "react";
import { PRICING, YARD_TIERS, calcLocalQuote, haulAwayPrice } from "@/app/free-quote/pricing";
import PropertyMap from "./PropertyMap";
import styles from "./call-guide.module.css";

const FREQUENCIES = {
  twice_a_week: "twice-weekly",
  once_a_week: "weekly",
  every_other_week: "biweekly",
  once_a_month: "monthly",
  one_time: "one-time",
};

const FREQUENCY_NAMES = Object.fromEntries(PRICING.frequencies.map((item) => [item.id, item.name]));
const LAST_CLEANED_NAMES = Object.fromEntries(PRICING.lastCleanedOptions.map((item) => [item.id, item.label]));
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const AREAS = ["Back yard", "Front yard", "Side yard", "Dog run", "Kids' play area", "Pool area", "Mulch or rock areas"];
const BILLING_VISITS_PER_MONTH = { twice_a_week: 104 / 12, once_a_week: 52 / 12, every_other_week: 26 / 12, once_a_month: 1 };
const STAFFING_GUIDANCE = "Tony is the full-time scooper and primary route technician. Craig provides fill-in coverage only when needed; do not promise Craig as a customer's regular technician.";

const initialForm = {
  firstName: "", lastName: "", phone: "", email: "",
  address: "", city: "", state: "OH", zip: "",
  dogs: "1", frequency: "once_a_week", lastCleaned: "one_month", yardSize: "",
  dogNames: "", dogSafety: "", dogDoor: "", gateLocation: "", gateCode: "",
  wasteLocation: "", notificationType: "", areas: ["Back yard"], notes: "",
  serviceDay: "", startDate: "", startDatePending: false, sender: "Craig",
  termsConfirmed: false, paymentStatus: "pending",
  billingName: "", billingZip: "", cardLastFour: "",
};

function money(value) {
  return value == null ? "--" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function range(value) {
  return value ? `${money(value[0])}-${money(value[1])}` : "Custom review";
}

function formatDate(value) {
  if (!value) return "date pending";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function fullAddress(form) {
  return [form.address, form.city, form.state, form.zip].map((value) => value.trim()).filter(Boolean).join(", ");
}

function technicianLabel(value) {
  const technician = String(value || "").trim();
  if (!technician || /tony|bria/i.test(technician)) return "Tony · full-time scooper";
  if (/craig/i.test(technician)) return "Craig · fill-in coverage only";
  return `${technician} · confirm against current staffing`;
}

function Panel({ eyebrow, title, children, className = "", id }) {
  return <section id={id} className={`${styles.panel} ${className}`}><div className={styles.panelHead}><span>{eyebrow}</span><h2>{title}</h2></div>{children}</section>;
}

function Field({ label, children, wide = false, hint }) {
  return <label className={wide ? styles.wide : ""}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function Script({ children }) {
  return <div className={styles.script}><span>Say this</span><p>{children}</p></div>;
}

function MockInvoice({ form, cleanupRange, addonLines, invoiceRange }) {
  const today = new Date().toLocaleDateString("en-US");
  const suffix = form.phone.replace(/\D/g, "").slice(-4) || "NEW";
  const invoiceNumber = `PREVIEW-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${suffix}`;
  const cleanupLabel = form.frequency === "one_time" ? "One-Time Cleanup" : "Initial Cleanup";
  return <div className={styles.invoice}>
    <div className={styles.invoiceTop}><div><span>Mock invoice · not created in Sweep &amp; Go</span><h3>Invoice #: {invoiceNumber}</h3><b>{form.frequency === "one_time" ? "ONE TIME" : "INITIAL SERVICE"}</b></div><em>DRAFT PREVIEW</em></div>
    <div className={styles.invoiceSummary}>
      <div><span>Client</span><strong>{[form.firstName, form.lastName].filter(Boolean).join(" ") || "Customer name pending"}</strong></div>
      <div><span>Date created</span><strong>{today}</strong></div>
      <div><span>Address</span><strong>{fullAddress(form) || "Service address pending"}</strong></div>
      <div><span>Billing option</span><strong>Variable initial service</strong></div>
      <div><span>Email</span><strong>{form.email || "Email pending"}</strong></div>
      <div><span>Status</span><strong className={styles.draft}>DRAFT</strong></div>
    </div>
    <div className={styles.invoiceItems}>
      <div className={styles.invoiceItemHead}><span>Description</span><span>Quantity</span><span>Rate</span><span>Amount</span></div>
      <div className={styles.invoiceItem}><strong>{cleanupLabel}{form.startDate ? ` · ${formatDate(form.startDate)}` : ""}</strong><span>1.00</span><span>{range(cleanupRange)}</span><b>{range(cleanupRange)}</b></div>
      {addonLines.map((line) => <div className={styles.invoiceItem} key={line.id}><strong>{line.description}</strong><span>1.00</span><span>{money(line.amount)}</span><b>{money(line.amount)}</b></div>)}
    </div>
    <div className={styles.invoiceTotals}><div><span>Subtotal</span><b>{range(invoiceRange)}</b></div><div><span>Tax</span><b>$0.00</b></div><div className={styles.invoiceGrandTotal}><span>Invoice total</span><b>{range(invoiceRange)}</b></div></div>
    <div className={styles.invoiceNote}><strong>What to tell the customer</strong><p>This is the estimated first-service invoice. The cleanup portion stays within the displayed range unless the actual yard condition requires approval for a different amount. Ongoing service is billed separately at the recurring rate shown above.</p></div>
  </div>;
}

export default function NewClientCallGuide({ googleMapsKey }) {
  const [form, setForm] = useState(initialForm);
  const [addons, setAddons] = useState([]);
  const [route, setRoute] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [copied, setCopied] = useState("");
  const [resetKey, setResetKey] = useState(0);

  const update = (name) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [name]: value }));
    if (["address", "city", "state", "zip", "frequency"].includes(name)) setRoute(null);
  };

  const toggleArray = (name, value) => setForm((current) => ({
    ...current,
    [name]: current[name].includes(value) ? current[name].filter((item) => item !== value) : [...current[name], value],
  }));

  const toggleAddon = (id) => setAddons((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const quote = useMemo(() => calcLocalQuote({ dogs: form.dogs, frequency: form.frequency, lastCleaned: form.lastCleaned }), [form.dogs, form.frequency, form.lastCleaned]);
  const yard = YARD_TIERS.find((item) => item.id === form.yardSize);
  const selectedAddons = PRICING.addons.filter((item) => addons.includes(item.id));
  const addonPrice = (item) => item.id === "haul_away" ? haulAwayPrice(Number(form.dogs)) : item.price;
  const monthlyAddonTotal = selectedAddons.filter((item) => item.charge === "monthly").reduce((sum, item) => sum + addonPrice(item), 0);
  const perTreatmentTotal = selectedAddons.filter((item) => item.charge === "per_treatment").reduce((sum, item) => sum + addonPrice(item), 0);
  const billingVisits = BILLING_VISITS_PER_MONTH[form.frequency] || 1;
  const addonPerVisit = (item) => item.charge === "monthly" ? addonPrice(item) / billingVisits : addonPrice(item);
  const monthlyTotal = quote.monthly == null || yard?.upcharge === null ? null : quote.monthly + (yard?.upcharge || 0) + monthlyAddonTotal;
  const recurringPerCleanup = monthlyTotal == null ? null : monthlyTotal / billingVisits;
  const selectedCleanupRate = recurringPerCleanup == null ? null : recurringPerCleanup + perTreatmentTotal;
  const cleanupRange = form.frequency === "one_time" ? quote.oneTimeRange : quote.initialRange;
  const invoiceAddonLines = selectedAddons.map((item) => ({
    id: item.id,
    description: item.charge === "monthly" ? `Initial ${item.name.replace(/^Add /, "")}` : item.name,
    amount: item.charge === "monthly" ? addonPrice(item) / billingVisits : addonPrice(item),
  }));
  const invoiceAddonTotal = invoiceAddonLines.reduce((sum, item) => sum + item.amount, 0);
  const invoiceRange = cleanupRange ? cleanupRange.map((value) => value + invoiceAddonTotal) : null;

  const scheduledDays = form.serviceDay || route?.recommendedPair || route?.recommendedDay || "";
  const missing = useMemo(() => {
    const items = [];
    if (!form.firstName.trim() || !form.lastName.trim()) items.push("Customer's correctly spelled full name");
    if (form.phone.replace(/\D/g, "").length < 10) items.push("Valid phone number");
    if (!/^\S+@\S+\.\S+$/.test(form.email)) items.push("Valid email address");
    if (!form.address.trim() || !form.city.trim() || !/^\d{5}$/.test(form.zip)) items.push("Complete service address and ZIP");
    if (!form.yardSize) items.push("Yard size");
    if (!form.dogNames.trim()) items.push("Dog name(s)");
    if (!form.dogSafety) items.push("Dog safety plan");
    if (!form.dogDoor) items.push("Dog-door status");
    if (!form.gateLocation.trim()) items.push("Gate or yard-access instructions");
    if (!form.wasteLocation.trim()) items.push("Waste-placement location");
    if (!form.areas.length) items.push("Areas to clean");
    if (form.frequency !== "one_time" && !scheduledDays) items.push("Confirmed recurring service day");
    if (!form.notificationType) items.push("Customer notification preference");
    if (!form.startDate && !form.startDatePending) items.push("First-cleanup date or explicit pending decision");
    if (!form.termsConfirmed) items.push("Customer confirmation of service and billing terms");
    if (form.paymentStatus === "pending") items.push("Secure payment status");
    return items;
  }, [form, scheduledDays]);

  const readback = useMemo(() => {
    const customer = form.firstName.trim() || "the customer";
    const dogText = `${form.dogs} dog${form.dogs === "1" ? "" : "s"}${form.dogNames.trim() ? ` (${form.dogNames.trim()})` : ""}`;
    const priceText = form.frequency === "one_time" ? `${range(quote.oneTimeRange)} for the one-time cleanup` : `${money(monthlyTotal)} per month`;
    const firstDate = form.startDatePending ? "with the first date still pending" : `starting ${formatDate(form.startDate)}`;
    const scheduleText = form.frequency === "one_time" ? (form.startDatePending ? "a one-time cleanup with the date still pending" : `a cleanup on ${formatDate(form.startDate)}`) : `${FREQUENCIES[form.frequency]} service on ${scheduledDays || "a day we still need to confirm"}, ${firstDate}`;
    return `Let me read everything back, ${customer}. I have ${fullAddress(form) || "your address still to confirm"}, ${dogText}, and ${scheduleText}. Your price is ${priceText}. We will access the yard through ${form.gateLocation || "the access point we still need to confirm"}, and place the bagged waste ${form.wasteLocation || "where you direct us"}. Is everything correct?`;
  }, [form, monthlyTotal, quote, scheduledDays]);

  const welcome = useMemo(() => {
    const name = form.firstName.trim() || "there";
    const schedule = form.frequency === "one_time"
      ? (form.startDatePending ? "We will confirm your one-time cleanup date shortly." : `Your one-time cleanup is scheduled for ${formatDate(form.startDate)}.`)
      : `You are scheduled for ${FREQUENCIES[form.frequency]} service on ${scheduledDays || "a service day we will confirm shortly"}.${form.startDatePending ? " We will confirm your first cleanup date shortly." : ` Your first cleanup is ${formatDate(form.startDate)}.`}`;
    const price = form.frequency === "one_time"
      ? `The cleanup estimate is ${range(quote.oneTimeRange)}, based on buildup and time required.`
      : `Your ongoing service rate is ${money(monthlyTotal)}/month.${quote.initialRange ? ` Your initial cleanup is estimated at ${range(quote.initialRange)} based on buildup and time required.` : ""}`;
    const notifications = form.notificationType === "both" ? "We will text when we are on the way and when service is complete." : form.notificationType === "on_the_way" ? "We will text when we are on the way." : form.notificationType === "completed" ? "We will text when service is complete." : "";
    const billing = form.frequency === "one_time" ? "" : " Monthly billing runs automatically on the 1st.";
    return `Hi ${name} - welcome to Ohio Pet Waste Pros! ${schedule} ${price}${billing} Please keep ${form.gateLocation || "the yard entrance"} accessible and follow the dog plan we discussed. We will place the bagged waste ${form.wasteLocation || "in the agreed location"}. ${notifications} Questions? Reply here. -${form.sender || "Craig"}`;
  }, [form, monthlyTotal, quote, scheduledDays]);

  async function analyzeRoute({ signal } = {}) {
    setRouteLoading(true);
    setRouteError("");
    try {
      const response = await fetch("/api/office/route-assignment/", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ address: fullAddress(form), frequency: form.frequency, monthly_revenue: monthlyTotal || 0 }),
        signal,
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "The address could not be analyzed.");
      setRoute(data.recommendation);
      const recommended = data.recommendation?.recommendedPair || data.recommendation?.recommendedDay || "";
      if (recommended) setForm((current) => ({ ...current, serviceDay: recommended }));
    } catch (error) { if (error?.name !== "AbortError") setRouteError(error instanceof Error ? error.message : "The route could not be analyzed."); }
    finally { setRouteLoading(false); }
  }

  async function copyText(name, value) {
    await navigator.clipboard.writeText(value);
    setCopied(name);
    window.setTimeout(() => setCopied(""), 1600);
  }

  function resetGuide() {
    if (!window.confirm("Are you sure you want to clear all customer, service, routing, measurement, payment, and message information? This cannot be undone.")) return;
    setForm({ ...initialForm, areas: [...initialForm.areas] });
    setAddons([]);
    setRoute(null);
    setRouteLoading(false);
    setRouteError("");
    setCopied("");
    setResetKey((current) => current + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const phoneDigits = form.phone.replace(/\D/g, "");
  const maxDogs = PRICING.frequencies.find((item) => item.id === form.frequency)?.maxDogs || 7;
  const invalidPlan = Number(form.dogs) > maxDogs || (form.frequency !== "one_time" && quote.monthly == null);

  useEffect(() => {
    if (form.frequency === "one_time" || invalidPlan || !form.address.trim() || !form.city.trim() || !/^\d{5}$/.test(form.zip)) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => analyzeRoute({ signal: controller.signal }), 900);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [form.address, form.city, form.state, form.zip, form.frequency, monthlyTotal, invalidPlan]);

  return <div className={styles.workspace}>
    <div className={styles.testBanner}><strong>Guided call test mode</strong><span>Nothing entered here is saved to Sweep &amp; Go, no customer is created, and no message is sent automatically.</span></div>
    <div className={styles.staffingNote}><strong>Current field staffing</strong><span>{STAFFING_GUIDANCE}</span></div>

    <div className={styles.titleRow}><div><span>New client call guide</span><h1>One conversation. Nothing missed.</h1><p>Follow the prompts, confirm the route, then use the final read-back and welcome text.</p></div><div className={styles.titleActions}><div className={styles.progress}><strong>{missing.length ? `${missing.length} items left` : "Ready to finish"}</strong><span>{Math.max(0, 100 - missing.length * 6)}% complete</span></div><button type="button" className={styles.resetButton} onClick={resetGuide}>Reset call guide</button></div></div>

    <nav className={styles.sectionNav} aria-label="Call guide sections">
      <a href="#call-service"><span>01 Service</span><small>Choose service and quote the price</small></a>
      <a href="#call-customer"><span>02 Customer</span><small>Contact, address, and automatic route day</small></a>
      <a href="#call-property"><span>03 Property</span><small>Dogs, access, and waste location</small></a>
      <a href="#call-schedule"><span>04 Schedule</span><small>Route day and first cleanup</small></a>
      <a href="#call-invoice"><span>05 Invoice</span><small>Walk through the estimated first invoice</small></a>
      <a href="#call-finish"><span>06 Finish</span><small>Read-back, payment, and confirmation</small></a>
      <a href="#call-pricing"><span>Price</span><small>Live recurring and per-cleanup totals</small></a>
    </nav>

    <div className={styles.layout}>
      <div className={styles.formColumn}>
        <Panel id="call-service" eyebrow="Step 1" title="Select the service and quote the price">
          <Script>First, let me find the right service. How many dogs use the yard, how often would you like us to visit, and when was it last thoroughly cleaned?</Script>
          <div className={styles.formGrid}>
            <Field label="Number of dogs"><select value={form.dogs} onChange={update("dogs")}>{[1,2,3,4,5,6,7].map((dog) => <option key={dog} value={dog}>{dog}</option>)}</select></Field>
            <Field label="Frequency"><select value={form.frequency} onChange={update("frequency")}>{PRICING.frequencies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <Field label="Last thorough cleanup"><select value={form.lastCleaned} onChange={update("lastCleaned")}>{PRICING.lastCleanedOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
            <Field label="Yard size"><select value={form.yardSize} onChange={update("yardSize")}><option value="">Select size</option>{YARD_TIERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
          </div>
          {invalidPlan ? <div className={styles.alert}>That frequency is not offered for this dog count. Select another plan before quoting the customer.</div> : null}
          <div className={styles.inlineQuote}>
            <div><span>Monthly rate</span><strong>{form.frequency === "one_time" ? "Not recurring" : money(monthlyTotal)}</strong></div>
            <div><span>Effective rate per cleanup</span><strong>{form.frequency === "one_time" ? range(quote.oneTimeRange) : money(selectedCleanupRate)}</strong></div>
            <div><span>Initial cleanup estimate</span><strong>{range(cleanupRange)}</strong></div>
          </div>
          {!form.yardSize && form.frequency !== "one_time" ? <small className={styles.quoteCaveat}>Select the yard size to finalize the displayed recurring price. The current amount uses no yard-size adjustment.</small> : null}
          <div className={styles.addons}><span>Optional add-ons · selections update every total immediately</span>{PRICING.addons.filter((item) => !item.id.startsWith("food_")).map((item) => <label key={item.id}><input type="checkbox" checked={addons.includes(item.id)} onChange={() => toggleAddon(item.id)} /><span><strong>{item.name}</strong><small>{money(addonPrice(item))} {item.charge === "monthly" ? "/ month" : item.charge === "per_treatment" ? "/ treatment" : "one time"}</small><small className={styles.addonVisitRate}>{item.charge === "monthly" ? `${money(addonPerVisit(item))} per visit at ${FREQUENCY_NAMES[form.frequency] || "selected"} frequency` : item.charge === "per_treatment" ? `${money(addonPerVisit(item))} on each treated visit` : `${money(addonPerVisit(item))} on the one-time visit`}</small></span></label>)}</div>
        </Panel>

        <Panel id="call-customer" eyebrow="Step 2" title="Identify the customer and place the route">
          <Script>Great. Now I will get your contact information and service address. Once the full address is entered, I can see the best current route day for your area.</Script>
          <div className={styles.formGrid}>
            <Field label="First name"><input value={form.firstName} onChange={update("firstName")} autoComplete="given-name" /></Field>
            <Field label="Last name - confirm spelling"><input value={form.lastName} onChange={update("lastName")} autoComplete="family-name" /></Field>
            <Field label="Cell phone"><input value={form.phone} onChange={update("phone")} inputMode="tel" autoComplete="tel" /></Field>
            <Field label="Email"><input value={form.email} onChange={update("email")} type="email" autoComplete="email" /></Field>
            <Field label="Street address" wide><input value={form.address} onChange={update("address")} autoComplete="street-address" /></Field>
            <Field label="City"><input value={form.city} onChange={update("city")} autoComplete="address-level2" /></Field>
            <Field label="State"><input value={form.state} onChange={update("state")} maxLength="2" autoComplete="address-level1" /></Field>
            <Field label="ZIP"><input value={form.zip} onChange={update("zip")} inputMode="numeric" maxLength="5" autoComplete="postal-code" /></Field>
          </div>
          {form.frequency !== "one_time" ? <div className={styles.autoRouteStatus}>{routeLoading ? <><i />Checking the newest Airtable route data…</> : route?.eligible ? <><span>Recommended route day</span><strong>{route.recommendedPair || route.recommendedDay || "Review required"}</strong><small>{technicianLabel(route.recommendedTechnician)} · {route.region} · {route.confidence} confidence</small></> : <><span>Automatic route check</span><small>Complete the street, city, and five-digit ZIP. The recommendation will appear automatically.</small></>}</div> : null}
          {routeError ? <div className={styles.alert}>{routeError}</div> : null}
          <PropertyMap key={resetKey} address={fullAddress(form)} ready={Boolean(form.address.trim() && form.city.trim() && /^\d{5}$/.test(form.zip))} selectedTier={form.yardSize} onTierSelected={(yardSize) => setForm((current) => ({ ...current, yardSize }))} googleMapsKey={googleMapsKey} />
        </Panel>

        <Panel id="call-property" eyebrow="Step 3" title="Property access and dog safety">
          <Script>Now I need a few property details so the technician knows exactly how to enter, work safely, and leave everything when finished.</Script>
          <div className={styles.formGrid}>
            <Field label="Dog name(s)"><input value={form.dogNames} onChange={update("dogNames")} placeholder="Rex and Luna" /></Field>
            <Field label="Dogs during service"><select value={form.dogSafety} onChange={update("dogSafety")}><option value="">Select plan</option><option value="inside">Kept inside</option><option value="secured">Secured away from work area</option><option value="friendly_outside">Friendly and may be outside</option><option value="call_first">Call before entering</option><option value="needs_review">Needs safety review</option></select></Field>
            <Field label="Dog door"><select value={form.dogDoor} onChange={update("dogDoor")}><option value="">Select</option><option value="none">No dog door</option><option value="locked">Dog door will be locked</option><option value="active">Active dog door - use caution</option></select></Field>
            <Field label="Gate or access location"><input value={form.gateLocation} onChange={update("gateLocation")} placeholder="Left side of house" /></Field>
            <Field label="Gate code" hint="Leave blank when no code is required"><input value={form.gateCode} onChange={update("gateCode")} /></Field>
            <Field label="Where to place bagged waste"><input value={form.wasteLocation} onChange={update("wasteLocation")} placeholder="Trash can beside garage" /></Field>
            <Field label="Service notifications"><select value={form.notificationType} onChange={update("notificationType")}><option value="">Confirm preference</option><option value="both">On the way and completed</option><option value="on_the_way">On the way only</option><option value="completed">Completed only</option><option value="none">No service texts</option></select></Field>
            <Field label="Special instructions" wide><textarea value={form.notes} onChange={update("notes")} placeholder="Only enter through the side gate; avoid the garden bed..." /></Field>
          </div>
          <div className={styles.choiceGroup}><span>Areas to clean</span><div>{AREAS.map((area) => <button type="button" key={area} className={form.areas.includes(area) ? styles.selected : ""} onClick={() => toggleArray("areas", area)}>{form.areas.includes(area) ? "✓ " : ""}{area}</button>)}</div></div>
        </Panel>

        <Panel id="call-schedule" eyebrow="Step 4" title="Confirm the route and first visit">
          {form.frequency === "one_time" ? <Script>This is a one-time cleanup, so we only need to confirm the cleanup date rather than a recurring route day.</Script> : <>
            <Script>The current route data recommends {route?.recommendedPair || route?.recommendedDay || "a day that is still being checked"}. I will confirm that day with you before finishing the account.</Script>
            <button type="button" className={styles.routeButton} disabled={routeLoading || !form.address || !form.city || !form.zip || invalidPlan} onClick={() => analyzeRoute()}>{routeLoading ? "Checking newest Airtable data..." : "Refresh route recommendation"}</button>
            {routeError ? <div className={styles.alert}>{routeError}</div> : null}
            {route?.eligible ? <div className={styles.routeResult}><span>Recommended assignment · newest available Airtable snapshot</span><strong>{route.recommendedPair || route.recommendedDay || "Review required"}</strong><p>{technicianLabel(route.recommendedTechnician)} · {route.region} · {route.confidence} confidence</p></div> : null}
          </>}
          <div className={styles.formGrid}>
            {form.frequency !== "one_time" ? <Field label="Customer-confirmed service day" wide><select value={form.serviceDay} onChange={update("serviceDay")}><option value="">Not confirmed</option>{DAYS.map((day) => <option key={day}>{day}</option>)}{route?.recommendedPair ? <option value={route.recommendedPair}>{route.recommendedPair}</option> : null}</select></Field> : null}
            <Field label="First-cleanup date"><input type="date" value={form.startDate} disabled={form.startDatePending} onChange={update("startDate")} /></Field>
            <label className={styles.pendingChoice}><input type="checkbox" checked={form.startDatePending} onChange={update("startDatePending")} /><span>First date is pending and will be confirmed in the welcome text</span></label>
          </div>
          {form.frequency !== "one_time" && scheduledDays ? <Script>{scheduledDays} is the best fit for your area and our current route. Would you like {scheduledDays} to be your regular service day?</Script> : null}
        </Panel>

        <Panel id="call-invoice" eyebrow="Step 5" title="Walk through the initial invoice">
          <Script>Before we finish, let me show you what the first invoice is expected to look like. Your regular recurring rate is {form.frequency === "one_time" ? "not recurring" : `${money(monthlyTotal)} per month`}, and this first invoice covers the initial cleanup and selected first-visit add-ons.</Script>
          {cleanupRange ? <MockInvoice form={form} cleanupRange={cleanupRange} addonLines={invoiceAddonLines} invoiceRange={invoiceRange} /> : <div className={styles.alert}>Choose the dog count and last-cleaned condition to build the initial invoice preview.</div>}
        </Panel>

        <Panel id="call-finish" eyebrow="Step 6" title="Read back, payment, and finish">
          <Script>{readback}</Script>
          <div className={styles.confirmations}>
            <label><input type="checkbox" checked={form.termsConfirmed} onChange={update("termsConfirmed")} /><span><strong>Customer confirmed the setup and billing terms</strong><small>Complete only after reading the service summary aloud.</small></span></label>
            <Field label="Secure payment status"><select value={form.paymentStatus} onChange={update("paymentStatus")}><option value="pending">Not handled yet</option><option value="link_sent">Secure SNG payment link sent</option><option value="confirmed">Payment method confirmed in SNG</option><option value="not_required">No payment required yet</option></select></Field>
          </div>
          <div className={styles.cardHandoff}>
            <div className={styles.cardHandoffHead}><div><span>Session-only payment handoff</span><strong>Prepare the details needed beside Sweep &amp; Go</strong></div><button type="button" onClick={() => setForm((current) => ({ ...current, billingName: [current.firstName, current.lastName].filter(Boolean).join(" "), billingZip: current.zip }))}>Use customer details</button></div>
            <div className={styles.cardHandoffGrid}>
              <Field label="Name on card"><input value={form.billingName} onChange={update("billingName")} autoComplete="off" /></Field>
              <Field label="Billing ZIP"><input value={form.billingZip} onChange={update("billingZip")} inputMode="numeric" maxLength="5" autoComplete="off" /></Field>
              <Field label="Last four after entry in SNG" hint="Confirmation only—never enter the full number here"><input value={form.cardLastFour} onChange={(event) => setForm((current) => ({ ...current, cardLastFour: event.target.value.replace(/\D/g, "").slice(0, 4) }))} inputMode="numeric" maxLength="4" autoComplete="off" /></Field>
            </div>
            <div className={styles.cardSafety}><strong>Enter the full card number, expiration, and CVV directly in Sweep &amp; Go.</strong><span>These temporary handoff fields stay only in this open call-guide session and are cleared by the Reset button or a page refresh.</span><a href="https://client.sweepandgo.com/login" target="_blank" rel="noreferrer">Open Sweep &amp; Go securely ↗</a></div>
          </div>
        </Panel>
      </div>

      <aside className={styles.sideColumn}>
        <Panel id="call-pricing" eyebrow="Live quote" title="Pricing at a glance" className={styles.stickyPanel}>
          <div className={styles.priceHero}><span>{FREQUENCY_NAMES[form.frequency]}</span><strong>{form.frequency === "one_time" ? range(quote.oneTimeRange) : `${money(monthlyTotal)}/mo`}</strong><small>{form.dogs} dog{form.dogs === "1" ? "" : "s"} · {yard?.label || "yard size pending"}</small></div>
          <div className={styles.priceRows}>
            {form.frequency !== "one_time" ? <>
              <div><span>Base monthly service</span><b>{money(quote.monthly)}</b></div>
              <div><span>Yard adjustment</span><b>{yard?.upcharge == null ? (yard ? "Custom" : "Pending") : money(yard.upcharge)}</b></div>
              {selectedAddons.map((item) => <div key={item.id}><span>{item.name}{item.charge === "monthly" ? " / month" : " / treatment"}</span><b>{money(addonPrice(item))}</b></div>)}
              <div className={styles.total}><span>Ongoing monthly total</span><b>{money(monthlyTotal)}</b></div>
              <div className={styles.perCleanup}><span>Effective rate per cleanup</span><b>{money(selectedCleanupRate)}</b></div>
              {perTreatmentTotal ? <div><span>Includes selected treatment(s)</span><b>{money(perTreatmentTotal)}</b></div> : null}
              <div><span>Initial cleanup estimate</span><b>{range(quote.initialRange)}</b></div>
              <div><span>Mock initial invoice total</span><b>{range(invoiceRange)}</b></div>
            </> : <><div className={styles.total}><span>One-time cleanup estimate</span><b>{range(quote.oneTimeRange)}</b></div>{selectedAddons.map((item) => <div key={item.id}><span>{item.name}</span><b>{money(addonPrice(item))}</b></div>)}<div><span>Mock invoice total</span><b>{range(invoiceRange)}</b></div></>}
          </div>
          <Script>{form.frequency === "one_time" ? `Based on ${form.dogs} dog${form.dogs === "1" ? "" : "s"} and the current buildup, the one-time cleanup estimate is ${range(invoiceRange)} with the selected add-ons.` : `For ${form.dogs} dog${form.dogs === "1" ? "" : "s"} with ${FREQUENCIES[form.frequency]} service, the ongoing rate is ${money(monthlyTotal)} per month. That works out to ${money(selectedCleanupRate)} per cleanup with the selected add-ons. The estimated first invoice is ${range(invoiceRange)}.`}</Script>
          <details className={styles.priceTable}><summary>View current pricing tables</summary>{Object.entries(PRICING.monthly).map(([frequency, rows]) => <div key={frequency}><strong>{FREQUENCY_NAMES[frequency]}</strong><p>{Object.entries(rows).filter(([,value]) => value != null).map(([dogs, value]) => `${dogs} dog${dogs === "1" ? "" : "s"}: ${money(value)}`).join(" · ")}</p></div>)}<div><strong>Selected buildup</strong><p>{LAST_CLEANED_NAMES[form.lastCleaned]} · initial {range(PRICING.initialCleanup[form.lastCleaned]?.[Number(form.dogs)])} · one-time {range(calcLocalQuote({ dogs: form.dogs, frequency: "one_time", lastCleaned: form.lastCleaned }).oneTimeRange)}</p></div></details>
        </Panel>

        <Panel eyebrow="Completion check" title={missing.length ? "Still needed" : "Ready to finish"}>
          {missing.length ? <ul className={styles.missing}>{missing.map((item) => <li key={item}>{item}</li>)}</ul> : <div className={styles.ready}>All required information has been confirmed. Review SNG before sending the welcome message.</div>}
        </Panel>

        <Panel eyebrow="Customer message" title="Welcome text">
          <div className={styles.message}>{welcome}</div>
          <div className={styles.messageActions}><button type="button" onClick={() => copyText("welcome", welcome)}>{copied === "welcome" ? "Copied" : "Copy welcome text"}</button><a className={!phoneDigits ? styles.disabled : ""} href={phoneDigits ? `sms:${phoneDigits}?body=${encodeURIComponent(welcome)}` : undefined}>Open SMS</a></div>
          <small className={styles.messageNote}>Preview only. Confirm the service day, first date, price, notification settings, and payment status in SNG before sending.</small>
        </Panel>
      </aside>
    </div>
  </div>;
}
