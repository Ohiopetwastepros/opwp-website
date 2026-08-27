"use client";

import { useEffect, useMemo, useState } from "react";
import { PRICING } from "@/app/free-quote/pricing";
import { calculateJobPrice } from "@/lib/pricing-economics.mjs";
import styles from "./pricing-calculator.module.css";

const STORAGE_KEY = "opwp_pricing_calculator_v3";
const defaults = {
  wages: [30], jobMinutes: 30, additionalMinutes: 0, burdenPercent: 12,
  fixedOverheadPerCrewHour: 0, targetRevenuePerCrewHour: 200, targetMarginPercent: 60,
  roundingIncrement: 5, actualPrice: "",
};

const money = (value, digits = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value) || 0);
const number = (value, digits = 0) => new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Number(value) || 0);
const percent = (value) => `${number(value, 1)}%`;
const inputNumber = (value) => value === "" ? 0 : Number(value);

function NumericField({ label, hint, value, onChange, prefix, suffix, min = 0, max, step = 1 }) {
  return <label className={styles.field}><span>{label}{hint ? <small>{hint}</small> : null}</span><div className={styles.inputWrap}>{prefix ? <i>{prefix}</i> : null}<input type="number" inputMode="decimal" min={min} max={max} step={step} value={value} onChange={(event) => onChange(event.target.value)} />{suffix ? <b>{suffix}</b> : null}</div></label>;
}

function Metric({ label, value, note, tone = "" }) {
  return <div className={`${styles.metric} ${tone ? styles[tone] : ""}`}><span>{label}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}</div>;
}

function PriceBook() {
  const [type, setType] = useState("initialCleanup");
  const grid = PRICING[type];
  return <section className={styles.priceBook}>
    <div className={styles.bookHead}><div><span>Current website source of truth</span><h2>Cleanup price book</h2></div><div className={styles.segmented}><button className={type === "initialCleanup" ? styles.selected : ""} onClick={() => setType("initialCleanup")}>Initial cleanup</button><button className={type === "oneTimeCleanup" ? styles.selected : ""} onClick={() => setType("oneTimeCleanup")}>One-time service</button></div></div>
    <div className={styles.tableWrap}><table><thead><tr><th>Last cleaned</th>{[1,2,3,4,5,6,7].map((dogs) => <th key={dogs}>{dogs} dog{dogs > 1 ? "s" : ""}</th>)}</tr></thead><tbody>{PRICING.lastCleanedOptions.map((option) => <tr key={option.id}><th>{option.label}</th>{[1,2,3,4,5,6,7].map((dogs) => { const range = grid[option.id]?.[dogs]; return <td key={dogs} className={!range ? styles.custom : ""}>{range ? `${money(range[0], range[0] % 1 ? 2 : 0)}–${money(range[1], range[1] % 1 ? 2 : 0)}` : "Custom"}</td>; })}</tr>)}</tbody></table></div>
    <p>These values load directly from the same pricing configuration used by the website quote flow, preventing a second stale copy.</p>
  </section>;
}

export default function PricingCalculator({ pricingInputs }) {
  const [values, setValues] = useState({
    ...defaults,
    wages: [pricingInputs.tonyWage],
    burdenPercent: pricingInputs.burdenPercent,
    fixedOverheadPerCrewHour: pricingInputs.fixedOverheadPerCrewHour,
  });
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("calculator");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (stored && typeof stored === "object" && Array.isArray(stored.wages) && stored.wages.length >= 1 && stored.wages.length <= 3) {
        setValues((current) => ({
          ...current,
          ...stored,
          wages: [pricingInputs.tonyWage, ...stored.wages.slice(1, 3)],
          burdenPercent: pricingInputs.burdenPercent,
          fixedOverheadPerCrewHour: pricingInputs.fixedOverheadPerCrewHour,
          actualPrice: "",
          jobMinutes: current.jobMinutes,
          additionalMinutes: 0,
        }));
      }
    } catch {}
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const { actualPrice: ignoredActual, jobMinutes: ignoredJob, additionalMinutes: ignoredAdditional, ...preferences } = values;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch {}
  }, [ready, values]);

  const result = useMemo(() => calculateJobPrice({
    technicianWages: values.wages.map(inputNumber), jobMinutes: inputNumber(values.jobMinutes),
    additionalMinutes: inputNumber(values.additionalMinutes), burdenPercent: inputNumber(values.burdenPercent),
    fixedOverheadPerCrewHour: inputNumber(values.fixedOverheadPerCrewHour), burdenedTechnicianIndex: 0,
    targetRevenuePerCrewHour: inputNumber(values.targetRevenuePerCrewHour),
    targetMarginPercent: inputNumber(values.targetMarginPercent), roundingIncrement: inputNumber(values.roundingIncrement),
    actualPrice: inputNumber(values.actualPrice),
  }), [values]);

  const update = (key) => (value) => setValues((current) => ({ ...current, [key]: value }));
  const setTechCount = (count) => setValues((current) => ({ ...current, wages: Array.from({ length: count }, (_, index) => current.wages[index] ?? current.wages[0] ?? pricingInputs.tonyWage) }));
  const updateWage = (index, value) => setValues((current) => ({ ...current, wages: current.wages.map((wage, wageIndex) => wageIndex === index ? value : wage) }));
  const resetJob = () => setValues((current) => ({ ...current, jobMinutes: 30, additionalMinutes: 0, actualPrice: "" }));
  const status = {
    empty: ["Enter the job time", "neutral"], missing_wage: ["Add every technician wage", "warning"],
    loss: ["Quote produces a loss", "danger"], on_target: ["Both targets met", "success"],
    near_target: ["Close to target", "warning"], below_target: ["Below target", "danger"],
  }[result.status];
  const booksVerified = pricingInputs.booksStatus === "verified";

  async function copySummary() {
    const text = `OPWP job quote: ${money(result.recommendedPrice)} recommended | ${result.totalMinutes} paid min | ${result.technicianCount} tech${result.technicianCount === 1 ? "" : "s"} | ${money(result.estimatedCost, 2)} estimated cost | ${percent((result.recommendedPrice - result.estimatedCost) / Math.max(result.recommendedPrice, 1) * 100)} contribution margin`;
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); }
  }

  return <div className={styles.workspace}>
    <div className={styles.tabs} role="tablist" aria-label="Pricing tool views"><button role="tab" aria-selected={view === "calculator"} onClick={() => setView("calculator")}>Job calculator</button><button role="tab" aria-selected={view === "pricebook"} onClick={() => setView("pricebook")}>Cleanup price book</button></div>
    {view === "pricebook" ? <PriceBook /> : <>
      <section className={styles.hero}>
        <div><span>Recommended minimum</span><strong>{result.totalMinutes ? money(result.recommendedPrice) : "—"}</strong><small>{result.totalMinutes ? `Exact floor ${money(result.recommendedExact, 2)} · rounded up to the next ${money(values.roundingIncrement)}` : "Enter a duration to calculate the price"}</small></div>
        <div className={`${styles.status} ${styles[status[1]]}`}><i />{status[0]}</div>
        <div className={styles.heroActions}><button onClick={copySummary} disabled={!result.totalMinutes}>{copied ? "Copied" : "Copy summary"}</button><button onClick={resetJob}>New job</button></div>
      </section>

      <div className={styles.mainGrid}>
        <section className={styles.formCard}>
          <div className={styles.sectionTitle}><div><span>01</span><h2>Crew and time</h2></div><small>Elapsed time applies to every technician.</small></div>
          <div className={styles.segmented}><button className={values.wages.length === 1 ? styles.selected : ""} onClick={() => setTechCount(1)}>1 technician</button><button className={values.wages.length === 2 ? styles.selected : ""} onClick={() => setTechCount(2)}>2 technicians</button><button className={values.wages.length === 3 ? styles.selected : ""} onClick={() => setTechCount(3)}>3 technicians</button></div>
          <div className={styles.fieldGrid}>{values.wages.map((wage, index) => <NumericField key={index} label={index === 0 ? "Tony wage" : `Technician ${index + 1} wage`} hint={index === 0 ? "QuickBooks burden applies to Tony only" : "no payroll burden applied"} prefix="$" value={wage} onChange={(value) => updateWage(index, value)} max={250} step="0.25" />)}</div>
          <NumericField label="On-site job time" hint="crew elapsed minutes" value={values.jobMinutes} onChange={update("jobMinutes")} suffix="min" max={1440} />
          <div className={styles.quickTimes}>{[15,30,45,60,90,120].map((minutes) => <button key={minutes} onClick={() => update("jobMinutes")(minutes)}>{minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}</button>)}</div>
          <NumericField label="Additional paid time" hint="travel, loading, disposal, or admin" value={values.additionalMinutes} onChange={update("additionalMinutes")} suffix="min" max={480} />

          <div className={styles.sectionTitle}><div><span>02</span><h2>Cost and targets</h2></div><small>QuickBooks actuals refresh when this page loads.</small></div>
          <div className={`${styles.sourceCard} ${pricingInputs.status === "current" && booksVerified ? styles.sourceCurrent : styles.sourceWarning}`}><strong>{pricingInputs.status === "current" ? `QuickBooks actuals applied${booksVerified ? "" : " · books provisional"}` : "QuickBooks actuals unavailable"}</strong><span>{pricingInputs.status === "current" ? `${pricingInputs.companyName} · ${pricingInputs.periodStart} through ${pricingInputs.periodEnd} · ${pricingInputs.accountingMethod}` : "Using the management payroll setting and no estimated fixed overhead. Reconnect QuickBooks before relying on a final quote."}</span>{pricingInputs.status === "current" ? <small>{money(pricingInputs.burdenCost, 2)} payroll taxes/benefits ÷ {money(pricingInputs.directPayroll, 2)} direct payroll. {money(pricingInputs.fixedOperatingCosts, 2)} non-payroll cost allocated across Tony’s {number(pricingInputs.tonyWeeklyHours, 1)}-hour weekly capacity.</small> : <a href="/admin/quickbooks/connect/">Reconnect QuickBooks</a>}</div>
          <div className={styles.fieldGrid}><NumericField label="Tony payroll burden" hint="actual taxes, workers’ comp, benefits" value={values.burdenPercent} onChange={update("burdenPercent")} suffix="%" max={100} step="0.1" /><NumericField label="Fixed overhead rate" hint="actual non-payroll cost per Tony capacity hour" prefix="$" value={values.fixedOverheadPerCrewHour} onChange={update("fixedOverheadPerCrewHour")} suffix="/hr" max={10000} step="0.01" /><NumericField label="Revenue target" hint="per crew clock hour" prefix="$" value={values.targetRevenuePerCrewHour} onChange={update("targetRevenuePerCrewHour")} suffix="/hr" max={5000} step="5" /><NumericField label="Contribution margin target" hint="after loaded labor + allocated overhead" value={values.targetMarginPercent} onChange={update("targetMarginPercent")} suffix="%" max={95} step="1" /></div>
          <div className={styles.smallRow}><NumericField label="Round price up to" prefix="$" value={values.roundingIncrement} onChange={update("roundingIncrement")} max={100} /><NumericField label="Actual quote" hint="optional comparison" prefix="$" value={values.actualPrice} onChange={update("actualPrice")} max={100000} step="1" /></div>
        </section>

        <aside className={styles.results}>
          <div className={styles.resultHead}><span>{result.hasActualPrice ? "Actual quote analysis" : "Recommended-price analysis"}</span><strong>{result.totalMinutes ? money(result.priceUsed) : "—"}</strong></div>
          <div className={styles.metrics}>
            <Metric label="Revenue / crew hour" value={result.totalMinutes ? `${money(result.crewRevenuePerHour)} /hr` : "—"} note={`Target ${money(values.targetRevenuePerCrewHour)} /hr`} tone={result.totalMinutes ? (result.meetsHourlyTarget ? "good" : "bad") : ""} />
            <Metric label="Contribution margin" value={result.totalMinutes ? percent(result.contributionMarginPercent) : "—"} note={`Target ${values.targetMarginPercent}%`} tone={result.totalMinutes ? (result.meetsMarginTarget ? "good" : "bad") : ""} />
            <Metric label="Estimated job cost" value={result.totalMinutes ? money(result.estimatedCost, 2) : "—"} note={`${money(result.directLabor, 2)} wages + ${money(result.payrollBurdenCost, 2)} Tony burden + ${money(result.fixedJobCosts, 2)} allocated overhead`} />
            <Metric label="Contribution dollars" value={result.totalMinutes ? money(result.contributionDollars, 2) : "—"} note="Before tax and unmodeled costs" tone={result.contributionDollars < 0 ? "bad" : ""} />
            <Metric label="Total labor hours" value={result.totalMinutes ? number(result.laborHours, 2) : "—"} note={`${result.technicianCount} tech${result.technicianCount === 1 ? "" : "s"} × ${number(result.paidHoursPerTechnician, 2)} paid hr`} />
            <Metric label="Revenue / labor hour" value={result.totalMinutes ? `${money(result.laborRevenuePerHour)} /hr` : "—"} note="Useful for comparing crew sizes" />
          </div>
          <div className={styles.floors}><h3>How the recommendation is set</h3><div><span>Revenue-rate floor</span><strong>{result.totalMinutes ? money(result.hourlyFloor, 2) : "—"}</strong></div><div><span>Margin floor</span><strong>{result.totalMinutes ? money(result.marginFloor, 2) : "—"}</strong></div><p>The higher floor wins, then the result rounds upward. This prevents rounding from quietly putting a quote below target.</p></div>
          {result.status === "missing_wage" ? <div className={styles.alert}>A zero or blank wage understates labor cost. Enter every technician’s actual hourly wage before using the recommendation.</div> : null}
        </aside>
      </div>
    </>}
  </div>;
}
