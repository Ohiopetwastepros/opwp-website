"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./dog-food.module.css";

const FORMULAS = {
  pink: {
    code: "22-12", color: "Pink", title: "Chicken & Brown Rice", image: "/assets/edf/22-12.png",
    description: "A lean, highly digestible all-life-stage formula for less active dogs, senior dogs, and dogs that gain weight easily.",
    bestFor: ["Lower activity", "Weight control", "Senior friendly"], calories: "3,432 kcal/kg · 419 kcal/cup",
    ingredients: "Chicken Meal, Whole Brown Rice, Sorghum, Rice Bran, Chicken Fat (preserved with mixed tocopherols), Pork Meal, Dried Beet Pulp, Dried Green Peas, Brewers Dried Yeast, Flaxseed, Fish Meal, Chicken By-Product Meal, Natural Chicken Liver Flavor, Canola Oil, Dried Egg Product, Sunflower Oil, Potassium Chloride, Calcium Carbonate, Hydrated Sodium Calcium Aluminosilicate, Choline Chloride, Calcium Iodate, Zinc Amino Acid Chelate, Iron Amino Acid Chelate, Ferrous Sulfate, Vitamin E Supplement, Zinc Sulfate, Zinc Oxide, Manganese Amino Acid Chelate, Manganese Sulfate, Copper Amino Acid Chelate, Copper Sulfate, Sodium Selenite, Niacin, Biotin, Calcium Pantothenate, Vitamin A Supplement, Riboflavin, Thiamine Mononitrate, Vitamin B12 Supplement, Pyridoxine Hydrochloride, Vitamin D3 Supplement, Ascorbic Acid, Cobalt Carbonate, Folic Acid, Dried Lactobacillus Acidophilus Fermentation Product, Dried Lactobacillus Casei Fermentation Product, Dried Bifidobacterium Thermophilum Fermentation Product, Dried Enterococcus Faecium Fermentation Product.",
    analysis: [["Crude protein", "22% min"], ["Crude fat", "12% min"], ["Crude fiber", "3.5% max"], ["Moisture", "10% max"], ["Linoleic acid", "2.5% min"], ["Calcium", "1% min"], ["Phosphorus", "0.8% min"], ["Zinc", "200 mg/kg min"], ["Vitamin A", "8,500 IU/kg min"], ["Vitamin E", "350 IU/kg min"], ["Vitamin C", "98 IU/kg min"], ["Vitamin B12", "0.045 mg/kg min"], ["Folic acid", "0.40 mg/kg min"], ["Omega-6", "2% min"], ["Omega-3", "0.4% min"], ["Glucosamine", "350 ppm min"], ["Chondroitin", "200 ppm min"]],
  },
  blue: {
    code: "26-14", color: "Blue", title: "Puppies & Active Dogs", image: "/assets/edf/26-14.png",
    description: "A balanced all-life-stage formula built to support growing puppies, healthy weight gain, lean muscle, and active adult dogs.",
    bestFor: ["Puppies", "Active adults", "Healthy growth"], calories: "3,549 kcal/kg · 421 kcal/cup",
    ingredients: "Chicken Meal, Whole Brown Rice, Sorghum, Chicken Fat (preserved with mixed tocopherols), Rice Bran, Pork Meal, Fish Meal, Dried Beet Pulp, Dried Green Peas, Chicken By-Product Meal, Brewers Dried Yeast, Flaxseed, Natural Chicken Liver Flavor, Canola Oil, Dried Egg Product, Sunflower Oil, Potassium Chloride, Calcium Carbonate, Hydrated Sodium Calcium Aluminosilicate, Choline Chloride, Calcium Iodate, Zinc Amino Acid Chelate, Iron Amino Acid Chelate, Ferrous Sulfate, Vitamin E Supplement, Zinc Sulfate, Zinc Oxide, Manganese Amino Acid Chelate, Manganese Sulfate, Copper Amino Acid Chelate, Copper Sulfate, Sodium Selenite, Niacin, Biotin, Calcium Pantothenate, Vitamin A Supplement, Riboflavin, Thiamine Mononitrate, Vitamin B12 Supplement, Pyridoxine Hydrochloride, Vitamin D3 Supplement, Ascorbic Acid, Cobalt Carbonate, Folic Acid, Dried Lactobacillus Acidophilus Fermentation Product, Dried Lactobacillus Casei Fermentation Product, Dried Bifidobacterium Thermophilum Fermentation Product, Dried Enterococcus Faecium Fermentation Product.",
    analysis: [["Crude protein", "26% min"], ["Crude fat", "14% min"], ["Crude fiber", "3.5% max"], ["Moisture", "10% max"], ["Linoleic acid", "3% min"], ["Calcium", "1% min"], ["Phosphorus", "0.8% min"], ["Zinc", "200 mg/kg min"], ["Vitamin A", "9,000 IU/kg min"], ["Vitamin E", "350 IU/kg min"], ["Vitamin C", "98 IU/kg min"], ["Vitamin B12", "0.035 mg/kg min"], ["Folic acid", "0.30 mg/kg min"], ["Omega-6", "2.5% min"], ["Omega-3", "0.5% min"], ["Glucosamine", "400 ppm min"], ["Chondroitin", "200 ppm min"]],
  },
  green: {
    code: "26-18", color: "Green", title: "Active Dogs", image: "/assets/edf/26-18.png",
    description: "Sustained energy and muscle support for active and working dogs, with balanced omegas plus glucosamine and chondroitin for joint support.",
    bestFor: ["Active dogs", "Working dogs", "Joint support"], calories: "3,767 kcal/kg · 459 kcal/cup",
    ingredients: "Chicken Meal, Whole Brown Rice, Chicken Fat (preserved with mixed tocopherols), Sorghum, Rice Bran, Pork Meal, Fish Meal, Chicken By-Product Meal, Dried Beet Pulp, Dried Green Peas, Brewers Dried Yeast, Flaxseed, Natural Chicken Liver Flavor, Canola Oil, Dried Egg Product, Sunflower Oil, Potassium Chloride, Calcium Carbonate, Hydrated Sodium Calcium Aluminosilicate, Choline Chloride, Calcium Iodate, Zinc Amino Acid Chelate, Iron Amino Acid Chelate, Ferrous Sulfate, Vitamin E Supplement, Zinc Sulfate, Zinc Oxide, Manganese Amino Acid Chelate, Manganese Sulfate, Copper Amino Acid Chelate, Copper Sulfate, Sodium Selenite, Niacin, Biotin, Calcium Pantothenate, Vitamin A Supplement, Riboflavin, Thiamine Mononitrate, Vitamin B12 Supplement, Pyridoxine Hydrochloride, Vitamin D3 Supplement, Ascorbic Acid, Cobalt Carbonate, Folic Acid, Dried Lactobacillus Acidophilus Fermentation Product, Dried Lactobacillus Casei Fermentation Product, Dried Bifidobacterium Thermophilum Fermentation Product, Dried Enterococcus Faecium Fermentation Product.",
    analysis: [["Crude protein", "26% min"], ["Crude fat", "18% min"], ["Crude fiber", "3.5% max"], ["Moisture", "10% max"], ["Linoleic acid", "3% min"], ["Calcium", "1% min"], ["Phosphorus", "0.8% min"], ["Zinc", "200 mg/kg min"], ["Vitamin A", "8,500 IU/kg min"], ["Vitamin E", "350 IU/kg min"], ["Vitamin C", "98 IU/kg min"], ["Vitamin B12", "0.035 mg/kg min"], ["Folic acid", "0.35 mg/kg min"], ["Omega-6", "2.5% min"], ["Omega-3", "0.5% min"], ["Glucosamine", "600 ppm min"], ["Chondroitin", "400 ppm min"]],
  },
  red: {
    code: "30-20", color: "Red", title: "Pro Athlete", image: "/assets/edf/30-20.png",
    description: "The most energy-dense blend for hard-working and athletic dogs that need maximum performance fuel, recovery support, and calorie density.",
    bestFor: ["Pro athletes", "High performance", "Maximum energy"], calories: "3,989 kcal/kg · 485 kcal/cup",
    ingredients: "Chicken Meal, Whole Brown Rice, Chicken Fat (preserved with mixed tocopherols), Pork Meal, Sorghum, Rice Bran, Fish Meal, Chicken By-Product Meal, Dried Beet Pulp, Dried Green Peas, Brewers Dried Yeast, Flaxseed, Natural Chicken Liver Flavor, Canola Oil, Dried Egg Product, Sunflower Oil, Potassium Chloride, Calcium Carbonate, Hydrated Sodium Calcium Aluminosilicate, Choline Chloride, Calcium Iodate, Zinc Amino Acid Chelate, Iron Amino Acid Chelate, Ferrous Sulfate, Vitamin E Supplement, Zinc Sulfate, Zinc Oxide, Manganese Amino Acid Chelate, Manganese Sulfate, Copper Amino Acid Chelate, Copper Sulfate, Sodium Selenite, Niacin, Biotin, Calcium Pantothenate, Vitamin A Supplement, Riboflavin, Thiamine Mononitrate, Vitamin B12 Supplement, Pyridoxine Hydrochloride, Vitamin D3 Supplement, Ascorbic Acid, Cobalt Carbonate, Folic Acid, Dried Lactobacillus Acidophilus Fermentation Product, Dried Lactobacillus Casei Fermentation Product, Dried Bifidobacterium Thermophilum Fermentation Product, Dried Enterococcus Faecium Fermentation Product.",
    analysis: [["Crude protein", "30% min"], ["Crude fat", "20% min"], ["Crude fiber", "3.5% max"], ["Moisture", "10% max"], ["Linoleic acid", "3% min"], ["Calcium", "1% min"], ["Phosphorus", "0.8% min"], ["Zinc", "200 mg/kg min"], ["Vitamin A", "8,500 IU/kg min"], ["Vitamin E", "350 IU/kg min"], ["Vitamin C", "98 IU/kg min"], ["Vitamin B12", "0.03 mg/kg min"], ["Folic acid", "0.30 mg/kg min"], ["Omega-6", "2.5% min"], ["Omega-3", "0.5% min"], ["Glucosamine", "400 ppm min"], ["Chondroitin", "200 ppm min"]],
  },
};

const DELIVERY = {
  route_day: { name: "My free route day", detail: "Delivered when OPWP is already in your area", fee: 0 },
  next_day: { name: "Next-day delivery", detail: "$5 delivery fee", fee: 5 },
  same_day: { name: "Same-day delivery", detail: "$10 before noon, when available", fee: 10 },
};

const initialCustomer = {
  firstName: "", lastName: "", email: "", phone: "", address: "", city: "",
  state: "OH", zip: "", customerType: "scoop", placement: "Front porch",
  placementOther: "", consent: false,
};

function newDog(id, firstDog = false) {
  return {
    id, matchMode: firstDog ? "individual" : "", sameAsDogId: null,
    lifeStage: "", breedSize: "", activity: "", metabolism: "",
    bodyCondition: "", goal: "", jointNeeds: [], digestion: "", skinCoat: "", priority: "",
  };
}

function recommendationFor(dog) {
  const reasons = [];
  const notes = [];
  let level = 1;

  if (dog.activity === "low") { level = 0; reasons.push("Lower daily activity favors a leaner calorie profile."); }
  if (dog.activity === "moderate") { level = 1; reasons.push("Moderate activity fits a balanced maintenance formula."); }
  if (dog.activity === "high") { level = 2; reasons.push("High activity needs more energy and protein support."); }
  if (dog.lifeStage === "puppy") { level = Math.max(level, 1); reasons.push("Puppies need a growth-supporting formula."); }
  if (dog.lifeStage === "senior" && dog.activity !== "high") { level = Math.min(level, 0); reasons.push("Senior dogs often benefit from a gentler calorie profile."); }
  if (dog.metabolism === "slow") { level -= 1; reasons.push("A slower metabolism usually needs fewer calories."); }
  if (dog.metabolism === "fast") { level += 1; reasons.push("A faster metabolism often needs a calorie-dense formula."); }
  if (dog.goal === "gain") { level += 1; reasons.push("The weight-gain goal moves the recommendation to a denser formula."); }
  if (dog.goal === "lose") { level -= 1; reasons.push("The weight-loss goal moves the recommendation to a leaner formula."); }
  if (dog.bodyCondition === "underweight") { level += 1; reasons.push("Current body condition suggests more calories are needed."); }
  if (dog.bodyCondition === "overweight") { level -= 1; reasons.push("Current body condition suggests a leaner formula."); }

  const selectedJointNeeds = dog.jointNeeds.filter((value) => value !== "none");
  const needsJointSupport = selectedJointNeeds.some((value) => ["largeBreed", "senior", "stiffness", "working"].includes(value));
  if (needsJointSupport && level < 2 && dog.goal !== "lose") {
    level = 2;
    reasons.push("Joint-support needs favor a formula with glucosamine and chondroitin.");
  }
  if (dog.activity === "high" && dog.metabolism === "fast") {
    level = 3;
    reasons.push("High activity plus fast metabolism is the clearest performance-formula fit.");
  }
  if (dog.priority === "performance" && level < 3 && dog.activity !== "low") {
    level += 1;
    notes.push("Performance was prioritized, so the recommendation leans more energy-dense.");
  }

  level = Math.max(0, Math.min(3, level));
  const key = ["pink", "blue", "green", "red"][level];
  if (needsJointSupport) notes.push("Green and Red formulas include glucosamine and chondroitin.");
  if (dog.digestion === "yes") notes.push("Digestive sensitivity noted; transition foods gradually.");
  if (dog.skinCoat === "yes") notes.push("Skin and coat concerns were included in the recommendation.");
  return { formula: FORMULAS[key], reasons, notes };
}

function estimatedMonthlyPounds(dog) {
  const estimatedWeightBySize = { small: 20, medium: 45, large: 80 };
  const estimatedWeight = estimatedWeightBySize[dog.breedSize] || 45;
  const activityFactor = dog.activity === "high" ? 1.15 : dog.activity === "low" ? 0.85 : 1;
  const lifeFactor = dog.lifeStage === "puppy" ? 1.2 : dog.lifeStage === "senior" ? 0.9 : 1;
  const estimatedCupsPerDay = Math.max(0.75, estimatedWeight / 20) * activityFactor * lifeFactor;
  return estimatedCupsPerDay * 7;
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function dogProfileCompletion(dogs) {
  const earlierDogIds = new Set();
  return dogs.map((dog, index) => {
    const complete = index > 0 && dog.matchMode === "same_food"
      ? earlierDogIds.has(Number(dog.sameAsDogId))
      : dog.matchMode === "individual" && dog.lifeStage && dog.breedSize && dog.activity && dog.metabolism && dog.bodyCondition &&
        dog.goal && dog.jointNeeds.length > 0 && dog.digestion && dog.skinCoat && dog.priority;
    earlierDogIds.add(dog.id);
    return Boolean(complete);
  });
}

export default function DogFoodOrderTool() {
  const [step, setStep] = useState(1);
  const [customer, setCustomer] = useState(initialCustomer);
  const [dogs, setDogs] = useState([newDog(1, true)]);
  const [plan, setPlan] = useState("subscription");
  const [delivery, setDelivery] = useState("route_day");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [partialSubmissionId, setPartialSubmissionId] = useState(null);
  const [expandedFormula, setExpandedFormula] = useState(null);
  const [formulaDetailTab, setFormulaDetailTab] = useState("overview");
  const [sameDayAvailable, setSameDayAvailable] = useState(false);
  const leadSentRef = useRef(false);
  const toolRef = useRef(null);
  const activePanelRef = useRef(null);
  const previousStepRef = useRef(step);
  const completedProfiles = useMemo(() => dogProfileCompletion(dogs), [dogs]);
  const completedProfileCount = completedProfiles.filter(Boolean).length;

  const recommendations = useMemo(() => {
    const recommendationsByDogId = new Map();
    return dogs.map((dog, index) => {
      const copiedRecommendation = dog.matchMode === "same_food"
        ? recommendationsByDogId.get(Number(dog.sameAsDogId))
        : null;
      const recommendation = copiedRecommendation || recommendationFor(dog);
      const monthlyPounds = copiedRecommendation?.monthlyPounds ?? estimatedMonthlyPounds(dog);
      const result = {
        dog: index + 1,
        dogId: dog.id,
        formula: recommendation.formula,
        reasons: copiedRecommendation
          ? [`Same food selected as Dog ${copiedRecommendation.dog}.`]
          : recommendation.reasons,
        notes: recommendation.notes,
        idealBag: copiedRecommendation?.idealBag ?? (monthlyPounds <= 20 ? 20 : 40),
        monthlyPounds,
        sameAsDog: copiedRecommendation?.dog ?? null,
      };
      recommendationsByDogId.set(dog.id, result);
      return result;
    });
  }, [dogs]);

  const orderLines = useMemo(() => {
    const grouped = new Map();
    for (const recommendation of recommendations) {
      const current = grouped.get(recommendation.formula.code) || { formula: recommendation.formula, pounds: 0, dogs: [] };
      current.pounds += recommendation.monthlyPounds;
      current.dogs.push(recommendation.dog);
      grouped.set(recommendation.formula.code, current);
    }
    return [...grouped.values()].map((line) => ({
      ...line, bagWeight: 40, quantity: Math.max(1, Math.ceil(line.pounds / 40)), unitPrice: 59,
    }));
  }, [recommendations]);

  const totals = useMemo(() => {
    const subtotal = orderLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const fee = DELIVERY[delivery].fee;
    const foodTax = orderLines.reduce((sum, line) => sum + Math.round(line.unitPrice * 0.0775 * 100) / 100 * line.quantity, 0);
    const tax = foodTax + Math.round(fee * 0.0775 * 100) / 100;
    return { subtotal, fee, tax, total: subtotal + fee + tax };
  }, [orderLines, delivery]);

  const updateCustomer = (field, value) => setCustomer((current) => ({ ...current, [field]: value }));
  const selectCustomerType = (customerType) => {
    updateCustomer("customerType", customerType);
    if (customerType === "on_demand") setPlan("on_demand");
    if (customerType === "route_partner") {
      setPlan("subscription");
      setDelivery("route_day");
    }
  };
  const selectMonthlyPlan = () => {
    if (customer.customerType === "on_demand") updateCustomer("customerType", "route_partner");
    setPlan("subscription");
    setDelivery("route_day");
  };
  const updateDog = (id, field, value) => setDogs((current) => current.map((dog) => dog.id === id ? { ...dog, [field]: value } : dog));
  const setDogMatchMode = (id, mode, earlierDogs) => setDogs((current) => current.map((dog) => {
    if (dog.id !== id) return dog;
    return {
      ...dog,
      matchMode: mode,
      sameAsDogId: mode === "same_food" && earlierDogs.length === 1 ? earlierDogs[0].id : null,
    };
  }));
  const toggleJointNeed = (id, value) => setDogs((current) => current.map((dog) => {
    if (dog.id !== id) return dog;
    if (value === "none") return { ...dog, jointNeeds: dog.jointNeeds.includes("none") ? [] : ["none"] };
    const withoutNone = dog.jointNeeds.filter((item) => item !== "none");
    return { ...dog, jointNeeds: withoutNone.includes(value) ? withoutNone.filter((item) => item !== value) : [...withoutNone, value] };
  }));

  function addDog() {
    if (dogs.length >= 10) return;
    setDogs((current) => [...current, newDog(Math.max(...current.map((dog) => dog.id)) + 1)]);
  }

  function removeDog(id) {
    if (dogs.length === 1) return;
    setDogs((current) => current
      .filter((dog) => dog.id !== id)
      .map((dog) => Number(dog.sameAsDogId) === id
        ? { ...dog, matchMode: "", sameAsDogId: null }
        : dog));
  }

  function quoteContactIsValid() {
    return Boolean(customer.firstName.trim() && customer.lastName.trim() && customer.email.includes("@") &&
      customer.phone.replace(/\D/g, "").length >= 10);
  }

  function quoteIsValid() {
    return quoteContactIsValid() && customer.consent;
  }

  function dogsAreValid() {
    return completedProfiles.every(Boolean);
  }

  function deliveryIsValid() {
    return Boolean(customer.address.trim() && customer.city.trim() && /^\d{5}$/.test(customer.zip) &&
      (customer.placement !== "Other" || customer.placementOther.trim()));
  }

  function goNext() {
    setError("");
    if (step === 1 && !quoteIsValid()) {
      setError("Complete the contact fields and text consent to save your quote and continue.");
      return;
    }
    if (step === 2 && !dogsAreValid()) {
      setError("Complete every required questionnaire item for each dog before continuing.");
      return;
    }
    setStep((current) => Math.min(current + 1, 4));
  }

  function goBack() {
    setError("");
    setStep((current) => Math.max(current - 1, 1));
  }

  async function submitOrder() {
    setError("");
    if (!deliveryIsValid()) {
      setError("Please complete the delivery address before ordering.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/dog-food/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer, dogs, recommendations, orderLines, plan, delivery, totals, partialSubmissionId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "We could not submit your order.");
      toolRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
      setResult(data);
    } catch (submissionError) {
      setError(submissionError.message || "We could not submit your order. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const quoteReady = quoteIsValid();

  useLayoutEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    activePanelRef.current?.focus({ preventScroll: true });
    toolRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [step]);

  useEffect(() => {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).find((part) => part.type === "hour")?.value || 24);
    setSameDayAvailable(hour < 12);
  }, []);

  useEffect(() => {
    if (!quoteReady || leadSentRef.current) return;
    leadSentRef.current = true;
    fetch("/api/dog-food/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer, quote: { bagPrice: 59, tax: 4.57, total: 63.57 } }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Partial quote capture failed.");
        setPartialSubmissionId(data.id);
      })
      .catch(() => { leadSentRef.current = false; });
  }, [quoteReady, customer]);

  if (result) {
    return (
      <div className={styles.successCard} role="status">
        <div className={styles.successIcon}>✓</div>
        <span>Order request {result.orderNumber}</span>
        <h3>Thanks, {customer.firstName}. Your order is in.</h3>
        <p>No card has been charged yet. An OPWP team member will confirm your delivery day and securely finish payment while online checkout is being connected.</p>
        <div className={styles.successSummary}>
          <span>{dogs.length} {dogs.length === 1 ? "dog" : "dogs"}</span>
          <span>{orderLines.reduce((sum, line) => sum + line.quantity, 0)} {orderLines.length === 1 ? "bag" : "bags"}</span>
          <strong>{money(totals.total)}</strong>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.toolShell} ref={toolRef}>
      <div className={styles.stepper} aria-label="Order progress" role="list">
        {["Blends & price", "About your dogs", "Recommendations", "Order"].map((label, index) => {
          const number = index + 1;
          return <div key={label} role="listitem" aria-current={step === number ? "step" : undefined} className={`${styles.step} ${step === number ? styles.stepActive : ""} ${step > number ? styles.stepDone : ""}`}><span>{step > number ? "✓" : number}</span><b>{label}</b></div>;
        })}
      </div>

      <div className={`${styles.toolBody} ${step === 2 ? styles.questionnaireToolBody : ""} ${step === 4 ? styles.toolBodyWithSummary : ""}`}>
        <div className={styles.formPanel} ref={activePanelRef} tabIndex={-1}>
          {step === 1 && (
            <section>
              <div className={styles.panelHeading}>
                <span>Step 1 of 4</span>
                <h3>Meet all four blends and unlock your price.</h3>
                <p>Review the lineup, then enter your contact information to see the exact 40 lb bag price with Lucas County tax.</p>
              </div>
              <div className={styles.quoteBlendGrid}>
                {Object.entries(FORMULAS).map(([formulaKey, formula]) => (
                  <button
                    type="button"
                    key={formula.code}
                    className={`${styles.quoteBlendCard} ${expandedFormula === formulaKey ? styles.quoteBlendCardSelected : ""}`}
                    data-color={formula.color.toLowerCase()}
                    aria-expanded={expandedFormula === formulaKey}
                    aria-controls="blend-detail-panel"
                    onClick={() => {
                      setExpandedFormula((current) => current === formulaKey ? null : formulaKey);
                      setFormulaDetailTab("overview");
                    }}
                  >
                    <img src={formula.image} alt={`${formula.code} ${formula.color} bag`} />
                    <div className={styles.quoteBlendCopy}>
                      <div><strong>{formula.code}</strong><span>{formula.color} bag</span></div>
                      <p>{formula.title}</p>
                      <small>Explore this blend <b aria-hidden="true">{expandedFormula === formulaKey ? "−" : "+"}</b></small>
                    </div>
                  </button>
                ))}
              </div>
              {expandedFormula && (() => {
                const formula = FORMULAS[expandedFormula];
                return (
                  <section id="blend-detail-panel" className={styles.blendDetail} data-color={formula.color.toLowerCase()} aria-live="polite">
                    <button type="button" className={styles.blendDetailClose} onClick={() => setExpandedFormula(null)} aria-label="Close blend details">×</button>
                    <div className={styles.blendDetailHero}>
                      <div className={styles.blendDetailBag}><img src={formula.image} alt={`${formula.code} ${formula.color} Extreme Dog Fuel bag`} /></div>
                      <div className={styles.blendDetailIntro}>
                        <span className={styles.blendEyebrow}>Extreme Dog Fuel · {formula.color} bag</span>
                        <h4>Elite Nutrition {formula.code}</h4>
                        <strong>{formula.title}</strong>
                        <p>{formula.description}</p>
                        <div className={styles.blendPills}>{formula.bestFor.map((item) => <span key={item}>{item}</span>)}</div>
                        <small>{formula.calories}</small>
                      </div>
                    </div>
                    <div className={styles.blendTabs} role="tablist" aria-label={`${formula.code} product details`}>
                      {[['overview', 'Overview'], ['ingredients', 'Ingredients'], ['analysis', 'Guaranteed analysis']].map(([key, label]) => (
                        <button type="button" key={key} role="tab" aria-selected={formulaDetailTab === key} className={formulaDetailTab === key ? styles.blendTabActive : ""} onClick={() => setFormulaDetailTab(key)}>{label}</button>
                      ))}
                    </div>
                    <div className={styles.blendDetailBody} role="tabpanel">
                      {formulaDetailTab === "overview" && (
                        <div className={styles.blendOverview}>
                          <div><span>Complete nutrition</span><strong>Made for all life stages</strong><p>High-quality animal proteins, brown rice, balanced omegas, vitamins, minerals, and digestive-supporting probiotics.</p></div>
                          <div><span>Clear ingredient promise</span><strong>No corn, wheat, soy, or glutens</strong><p>A meat-forward formula made without common low-cost fillers.</p></div>
                        </div>
                      )}
                      {formulaDetailTab === "ingredients" && <div className={styles.ingredientsText}><strong>Ingredient list</strong><p>{formula.ingredients}</p><small>Always check the current bag label before feeding, as manufacturers may update formulations.</small></div>}
                      {formulaDetailTab === "analysis" && <div className={styles.analysisGrid}>{formula.analysis.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}
                    </div>
                  </section>
                );
              })()}
              <div className={styles.contactIntro}><strong>Enter your information and provide text consent to unlock the price.</strong><span>No payment on this step.</span></div>
              <div className={styles.inputGrid}>
                <Field label="First name" required><input required autoComplete="given-name" value={customer.firstName} onChange={(event) => updateCustomer("firstName", event.target.value)} /></Field>
                <Field label="Last name" required><input required autoComplete="family-name" value={customer.lastName} onChange={(event) => updateCustomer("lastName", event.target.value)} /></Field>
                <Field label="Email" required><input required type="email" autoComplete="email" value={customer.email} onChange={(event) => updateCustomer("email", event.target.value)} /></Field>
                <Field label="Mobile phone" required><input required type="tel" autoComplete="tel" value={customer.phone} onChange={(event) => updateCustomer("phone", event.target.value)} /></Field>
              </div>
              {quoteReady ? (
                <div className={styles.perBagPrice} role="status">
                  <div><span>One 40 lb bag</span><strong>{money(59)}</strong></div><b>+</b>
                  <div><span>Lucas County tax (7.75%)</span><strong>{money(4.57)}</strong></div><b>=</b>
                  <div className={styles.perBagTotal}><span>Total per bag</span><strong>{money(63.57)}</strong></div>
                </div>
              ) : (
                <div className={styles.priceGate}>
                  <span>Price locked</span>
                  <strong>Complete your name, email, mobile phone, and text consent to see the total.</strong>
                </div>
              )}
              <label className={styles.consentRow}>
                <input type="checkbox" checked={customer.consent} onChange={(event) => updateCustomer("consent", event.target.checked)} />
                <span>I consent to receive marketing and service messages from Ohio Pet Waste Pros at the phone number provided. Message frequency may vary; message &amp; data rates may apply. Reply STOP to opt out.</span>
              </label>
              {quoteReady && (
                <div className={styles.quoteReveal} role="status">
                  <span>Your quote is saved</span>
                  <strong>{money(63.57)} <small>per 40 lb bag</small></strong>
                  <small>{money(59)} food + {money(4.57)} Lucas County tax • free recurring route-day delivery</small>
                  <p>If you stop here, your saved quote may receive one helpful follow-up text. Finishing the order automatically cancels that reminder.</p>
                </div>
              )}
            </section>
          )}

          {step === 2 && (
            <section>
              <div className={`${styles.panelHeading} ${styles.questionnaireHeading}`}>
                <span>Step 2 of 4</span>
                <h3>Tell us about each dog.</h3>
                <p>Complete the questionnaire once, then give similar dogs the same food with one simple selection. No dog names are needed.</p>
                <div className={styles.questionnaireBenefits} aria-label="What this profile determines">
                  <span>Formula match</span><span>Energy level</span><span>Bag recommendation</span>
                </div>
              </div>
              <div className={styles.questionnaireList}>
                {dogs.map((dog, index) => {
                  const earlierDogs = dogs.slice(0, index);
                  return (
                  <article className={styles.questionnaireDog} key={dog.id}>
                    <div className={styles.dogCardHead}>
                      <div><span className={styles.dogNumber}>{index + 1}</span><strong>Dog {index + 1}</strong><small>No name required</small></div>
                      {dogs.length > 1 && <button type="button" className={styles.removeButton} onClick={() => removeDog(dog.id)}>Remove</button>}
                    </div>
                    {index > 0 && (
                      <div className={styles.matchChoiceSection}>
                        <h4>How should we choose this dog&apos;s food?</h4>
                        <div className={styles.matchModeChoices}>
                          <Choice
                            selected={dog.matchMode === "individual"}
                            onClick={() => setDogMatchMode(dog.id, "individual", earlierDogs)}
                            title="Get a separate recommendation"
                            copy="Answer the questionnaire for this dog"
                          />
                          <Choice
                            selected={dog.matchMode === "same_food"}
                            onClick={() => setDogMatchMode(dog.id, "same_food", earlierDogs)}
                            title="Use the same food"
                            copy="Copy the formula from another dog"
                          />
                        </div>
                        {dog.matchMode === "same_food" && (
                          <div className={styles.copyDogChoices}>
                            <strong>Use the same food as:</strong>
                            <div>
                              {earlierDogs.map((earlierDog, earlierIndex) => (
                                <button
                                  type="button"
                                  key={earlierDog.id}
                                  aria-pressed={Number(dog.sameAsDogId) === earlierDog.id}
                                  className={Number(dog.sameAsDogId) === earlierDog.id ? styles.copyDogSelected : ""}
                                  onClick={() => updateDog(dog.id, "sameAsDogId", earlierDog.id)}
                                >
                                  <span>Dog {earlierIndex + 1}</span>
                                  <small>Same formula and estimated usage</small>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {dog.matchMode === "same_food" && earlierDogs.some((item) => item.id === Number(dog.sameAsDogId)) ? (
                      <div className={styles.copiedDogNotice}>
                        <span>✓</span>
                        <div>
                          <strong>Questionnaire skipped for Dog {index + 1}</strong>
                          <p>This dog will use the same formula and estimated four-week food amount as Dog {earlierDogs.findIndex((item) => item.id === Number(dog.sameAsDogId)) + 1}.</p>
                        </div>
                      </div>
                    ) : dog.matchMode === "individual" ? (
                    <>
                    <div className={`${styles.questionSection} ${styles.questionSectionBasics}`}>
                      <div className={styles.questionSectionHeading}><span>01</span><div><h4>Dog basics</h4><p>Start with size and life stage.</p></div></div>
                      <div className={styles.questionColumnsTwo}>
                        <QuestionGroup label="Life stage" value={dog.lifeStage} onChange={(value) => updateDog(dog.id, "lifeStage", value)} options={[["puppy","Puppy","0–12 months"],["adult","Adult","1–7 years"],["senior","Senior","7+ years"]]} />
                        <QuestionGroup label="Breed size" value={dog.breedSize} onChange={(value) => updateDog(dog.id, "breedSize", value)} options={[["small","Small","Under 25 lb"],["medium","Medium","25–60 lb"],["large","Large","Over 60 lb"]]} />
                      </div>
                    </div>
                    <div className={`${styles.questionSection} ${styles.questionSectionActivity}`}>
                      <div className={styles.questionSectionHeading}><span>02</span><div><h4>Activity and metabolism</h4><p>Help us match the right energy and protein level.</p></div></div>
                      <div className={styles.questionColumnsTwo}>
                        <QuestionGroup label="Daily activity" value={dog.activity} onChange={(value) => updateDog(dog.id, "activity", value)} options={[["low","Low","Mostly indoors and short walks"],["moderate","Moderate","Regular walks and normal play"],["high","High","Runs, works, hunts, or trains"]]} />
                        <QuestionGroup label="Metabolism / body type" value={dog.metabolism} onChange={(value) => updateDog(dog.id, "metabolism", value)} options={[["slow","Slow","Gains weight easily"],["average","Average","Usually maintains weight"],["fast","Fast","Struggles to hold weight"]]} />
                      </div>
                    </div>
                    <div className={`${styles.questionSection} ${styles.questionSectionGoals}`}>
                      <div className={styles.questionSectionHeading}><span>03</span><div><h4>Current condition and goal</h4><p>Tell us where this dog is today and where you want to go.</p></div></div>
                      <div className={styles.questionColumnsTwo}>
                        <QuestionGroup label="Current body condition" value={dog.bodyCondition} onChange={(value) => updateDog(dog.id, "bodyCondition", value)} options={[["underweight","Underweight","Needs to add condition"],["ideal","Ideal","Healthy weight now"],["overweight","Overweight","Needs a leaner plan"]]} />
                        <QuestionGroup label="Primary goal" value={dog.goal} onChange={(value) => updateDog(dog.id, "goal", value)} options={[["gain","Gain weight",""],["maintain","Maintain weight",""],["lose","Lose weight",""]]} />
                      </div>
                    </div>
                    <div className={`${styles.questionSection} ${styles.questionSectionHealth}`}>
                      <div className={styles.questionSectionHeading}><span>04</span><div><h4>Health and feeding priorities</h4><p>Fine-tune the recommendation around everyday needs.</p></div></div>
                      <QuestionGroup multi label="Joint support — select all that apply" value={dog.jointNeeds} onChange={(value) => toggleJointNeed(dog.id, value)} options={[["none","No joint issues",""],["largeBreed","Large breed",""],["senior","Senior dog",""],["stiffness","Stiffness or mobility concerns",""],["working","Working or sporting dog",""]]} />
                      <div className={`${styles.questionColumns} ${styles.healthQuestionColumns}`}>
                        <QuestionGroup label="Digestive sensitivity" value={dog.digestion} onChange={(value) => updateDog(dog.id, "digestion", value)} options={[["yes","Yes","Sensitive stomach or stool"],["no","No",""]]} />
                        <QuestionGroup label="Skin or coat concerns" value={dog.skinCoat} onChange={(value) => updateDog(dog.id, "skinCoat", value)} options={[["yes","Yes","Dry skin, itching, or dull coat"],["no","No",""]]} />
                        <QuestionGroup label="Feeding priority" value={dog.priority} onChange={(value) => updateDog(dog.id, "priority", value)} options={[["balanced","Best overall fit",""],["performance","Highest performance",""]]} />
                      </div>
                    </div>
                    </>
                    ) : (
                      <div className={styles.chooseMatchPrompt}>{dog.matchMode === "same_food" ? "Choose which earlier dog’s food to use." : "Choose one of the two options above to continue."}</div>
                    )}
                  </article>
                  );
                })}
              </div>
              <button type="button" className={styles.addDogButton} onClick={addDog} disabled={dogs.length >= 10}>+ Add another dog {dogs.length >= 10 && "(10 maximum)"}</button>
            </section>
          )}

          {step === 3 && (
            <section>
              <div className={styles.panelHeading}>
                <span>Step 3 of 4</span>
                <h3>Your Extreme Dog Fuel recommendations</h3>
                <p>Each dog gets its own formula match. Always transition foods gradually and confirm feeding amounts on the bag.</p>
              </div>
              <div className={styles.recommendationList}>
                {recommendations.map((recommendation) => (
                  <article className={styles.recommendationCard} key={recommendation.dog}>
                    <div className={styles.recommendationBag} data-color={recommendation.formula.color.toLowerCase()}><img src={recommendation.formula.image} alt="" /></div>
                    <div className={styles.recommendationInfo}>
                      <span>Dog {recommendation.dog} {recommendation.sameAsDog ? `• same food as Dog ${recommendation.sameAsDog}` : "recommendation"}</span>
                      <h4>{recommendation.formula.code} <small>{recommendation.formula.color} bag</small></h4>
                      <strong>{recommendation.formula.title}</strong>
                      <p>{recommendation.reasons[0]}</p>
                      <p>{recommendation.idealBag === 20 ? "A 20 lb bag may fit this dog's monthly needs. Until 20 lb pricing is finalized, the order uses the available 40 lb bag." : "A 40 lb bag best matches the estimated four-week need."}</p>
                    </div>
                  </article>
                ))}
              </div>
              <div className={styles.disclaimer}>This tool provides a practical product match, not veterinary medical advice. Ask your veterinarian about allergies, medical conditions, or prescription diets.</div>
            </section>
          )}

          {step === 4 && (
            <section>
              <div className={styles.panelHeading}>
                <span>Step 4 of 4</span>
                <h3>Choose your delivery plan.</h3>
                <p>Recurring route delivery is the simplest option and has no delivery fee.</p>
              </div>
              <div className={styles.inputGrid}>
                <Field label="Street address" required wide><input required autoComplete="street-address" value={customer.address} onChange={(event) => updateCustomer("address", event.target.value)} /></Field>
                <Field label="City" required><input required autoComplete="address-level2" value={customer.city} onChange={(event) => updateCustomer("city", event.target.value)} /></Field>
                <Field label="State"><input value={customer.state} disabled /></Field>
                <Field label="ZIP code" required><input required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} autoComplete="postal-code" value={customer.zip} onChange={(event) => updateCustomer("zip", event.target.value.replace(/\D/g, ""))} /></Field>
              </div>
              <fieldset className={styles.choiceFieldset}>
                <legend>Which best describes you?</legend>
                <div className={styles.choiceCards}>
                  <Choice selected={customer.customerType === "scoop"} onClick={() => selectCustomerType("scoop")} title="Current scooping customer" copy="Add dog food to my existing service route" />
                  <Choice selected={customer.customerType === "route_partner"} onClick={() => selectCustomerType("route_partner")} title="New route partner customer" copy="I want monthly dog food delivery on an OPWP route" />
                  <Choice selected={customer.customerType === "on_demand"} onClick={() => selectCustomerType("on_demand")} title="One-time delivery only" copy="I only need this order delivered once" />
                </div>
              </fieldset>
              <fieldset className={styles.choiceFieldset}>
                <legend>Order type</legend>
                <div className={styles.twoChoices}>
                  <Choice selected={plan === "subscription"} onClick={selectMonthlyPlan} title="Monthly delivery" copy="Automatic monthly order • free recommended route-day delivery" badge="Recommended" />
                  <Choice selected={plan === "on_demand"} onClick={() => setPlan("on_demand")} title="One-time order" copy="Delivered once with no recurring schedule" />
                </div>
              </fieldset>
              <fieldset className={styles.choiceFieldset}>
                <legend>Delivery timing</legend>
                <div className={styles.deliveryChoices}>
                  {Object.entries(DELIVERY).map(([key, option]) => <Choice key={key} selected={delivery === key} onClick={() => setDelivery(key)} title={option.name} copy={key === "same_day" && !sameDayAvailable ? "Unavailable after 12:00 PM Eastern" : option.detail} disabled={(plan === "subscription" && key !== "route_day") || (key === "same_day" && !sameDayAvailable)} />)}
                </div>
              </fieldset>
              <div className={styles.inputGrid}>
                <Field label="Where should we leave the food?"><select value={customer.placement} onChange={(event) => updateCustomer("placement", event.target.value)}><option>Front porch</option><option>Garage door</option><option>Side door</option><option>Back porch</option><option>Inside gate</option><option>Other</option></select></Field>
                {customer.placement === "Other" && <Field label="Other placement"><input value={customer.placementOther} onChange={(event) => updateCustomer("placementOther", event.target.value)} placeholder="Tell the route professional where to leave it" /></Field>}
              </div>
              <div className={styles.paymentNotice}><strong>Secure online payment is being connected.</strong><span>Submitting this request does not charge a card. OPWP will confirm your order and payment before delivery.</span></div>
            </section>
          )}

          {error && <div className={styles.errorMessage} role="alert">{error}</div>}
          <div className={styles.formActions}>
            {step > 1 && <button type="button" className={styles.backButton} onClick={goBack}>Back</button>}
            {step < 4 ? <button type="button" className={styles.nextButton} onClick={goNext}>Continue <span>→</span></button> : <button type="button" className={styles.orderButton} onClick={submitOrder} disabled={submitting}>{submitting ? "Submitting…" : "Order Now"} <span>→</span></button>}
          </div>
        </div>

        {step === 4 && <aside className={styles.orderAside}>
          <div className={styles.asideBrand}><img src="/assets/edf/logo.png" alt="Extreme Dog Fuel" /><span>Delivered by OPWP</span></div>
          {step === 2 && (
            <div className={styles.profileAside}>
              <span>Profile progress</span>
              <div className={styles.profileCount}><strong>{completedProfileCount}</strong><small>of {dogs.length} complete</small></div>
              <div className={styles.profileProgress} aria-label={`${completedProfileCount} of ${dogs.length} dog profiles complete`}><i style={{ width: `${dogs.length ? (completedProfileCount / dogs.length) * 100 : 0}%` }} /></div>
              <ul>
                <li><b>1</b><span><strong>Build the first profile</strong><small>We use it to recommend the right blend.</small></span></li>
                <li><b>2</b><span><strong>Add every dog</strong><small>Up to ten dogs in one household.</small></span></li>
                <li><b>3</b><span><strong>Skip repeat questions</strong><small>Similar dogs can use the same food.</small></span></li>
              </ul>
            </div>
          )}
          {step !== 2 && <h3>{step === 1 ? (quoteReady ? "Price per bag" : "Unlock your price") : "Your order"}</h3>}
          {step === 1 ? (
            quoteReady ?
              <div className={styles.emptyOrder}><span>Every 40 lb blend</span><strong>{money(63.57)}</strong><p>{money(59)} per bag + {money(4.57)} Lucas County tax. Recurring route-day delivery is free.</p></div> :
              <div className={styles.emptyOrder}><span>Contact information and consent</span><strong>Price locked</strong><p>Complete your name, email, mobile phone, and text consent to reveal the exact price with tax.</p></div>
          ) : step === 2 ? null : (
            <>
              <div className={styles.orderLines}>
                {orderLines.map((line) => (
                  <div className={styles.orderLine} key={line.formula.code}>
                    <img src={line.formula.image} alt="" />
                    <div><strong>{line.formula.code} {line.formula.color}</strong><span>{line.quantity} × 40 lb bag</span><small>For Dog {line.dogs.join(", ")}</small></div>
                    <b>{money(line.quantity * line.unitPrice)}</b>
                  </div>
                ))}
              </div>
              <div className={styles.totals}>
                <div><span>Food</span><b>{money(totals.subtotal)}</b></div>
                <div><span>Delivery</span><b>{totals.fee ? money(totals.fee) : "Free"}</b></div>
                <div><span>Lucas County tax</span><b>{money(totals.tax)}</b></div>
                <div className={styles.totalRow}><span>Estimated total</span><b>{money(totals.total)}</b></div>
              </div>
            </>
          )}
          <div className={styles.asideTrust}><span>✓</span><p><strong>Local route delivery</strong> from the Ohio Pet Waste Pros team you know.</p></div>
        </aside>}
      </div>
    </div>
  );
}

function Field({ label, required = false, wide = false, children }) {
  return <label className={`${styles.field} ${wide ? styles.fieldWide : ""}`}><span>{label}{required && <i>Required</i>}</span>{children}</label>;
}

function Choice({ selected, onClick, title, copy, badge, disabled = false }) {
  return <button type="button" disabled={disabled} className={`${styles.choiceCard} ${selected ? styles.choiceSelected : ""}`} onClick={onClick}><span className={styles.radio}>{selected && <i />}</span><span><strong>{title}{badge && <em>{badge}</em>}</strong><small>{copy}</small></span></button>;
}

function QuestionGroup({ label, options, value, onChange, multi = false }) {
  return (
    <div className={`${styles.questionCard} ${multi ? styles.questionCardMulti : ""}`}>
      <fieldset className={styles.questionGroup}>
        <legend>{label}<i>Required</i></legend>
        <div className={styles.questionOptions}>
          {options.map(([optionValue, title, description]) => {
            const selected = multi ? value.includes(optionValue) : value === optionValue;
            return (
              <button type="button" aria-pressed={selected} key={optionValue} className={`${styles.questionOption} ${selected ? styles.questionOptionSelected : ""}`} onClick={() => onChange(optionValue)}>
                <span>{selected ? "✓" : ""}</span><div><strong>{title}</strong>{description && <small>{description}</small>}</div>
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
