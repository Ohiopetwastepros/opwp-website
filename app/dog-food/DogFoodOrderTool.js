"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./dog-food.module.css";

import { FORMULAS } from '@/lib/dog-food-catalog.mjs';


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

export default function DogFoodOrderTool({ paymentConfigured = false }) {
  const [step,setStep] = useState(2), [dogs,setDogs] = useState([newDog(1,true)]), [error,setError] = useState("");
  const [expandedFormula,setExpandedFormula] = useState(null), [formulaDetailTab,setFormulaDetailTab] = useState("overview");
  const toolRef = useRef(null), activePanelRef = useRef(null);
  const recommendations = useMemo(() => {
    const found = new Map();
    return dogs.map((dog,index) => {
      const copied = dog.matchMode === "same_food" ? found.get(Number(dog.sameAsDogId)) : null;
      const match = copied || recommendationFor(dog), monthlyPounds = copied?.monthlyPounds ?? estimatedMonthlyPounds(dog);
      const result = {dog:index+1,dogId:dog.id,formula:match.formula,reasons:copied ? ["Same formula as Dog "+copied.dog+"."] : match.reasons,notes:match.notes,monthlyPounds,idealBag:40,sameAsDog:copied?.dog ?? null};
      found.set(dog.id,result);return result;
    });
  },[dogs]);
  const updateDog = (id,field,value) => setDogs(current => current.map(d => d.id === id ? {...d,[field]:value} : d));
  const setDogMatchMode = (id,mode,earlier) => setDogs(current => current.map(d => d.id === id ? {...d,matchMode:mode,sameAsDogId:mode === "same_food" && earlier.length === 1 ? earlier[0].id : null} : d));
  const toggleJointNeed = (id,value) => setDogs(current => current.map(d => d.id !== id ? d : {...d,jointNeeds:value === "none" ? (d.jointNeeds.includes("none") ? [] : ["none"]) : d.jointNeeds.includes(value) ? d.jointNeeds.filter(v => v !== value && v !== "none") : [...d.jointNeeds.filter(v => v !== "none"),value]}));
  function addDog() {if(dogs.length < 10)setDogs(current => [...current,newDog(Math.max(...current.map(d => d.id))+1)]);}
  function removeDog(id) {if(dogs.length > 1)setDogs(current => current.filter(d => d.id !== id).map(d => Number(d.sameAsDogId) === id ? {...d,matchMode:"",sameAsDogId:null} : d));}
  useLayoutEffect(() => {activePanelRef.current?.focus({preventScroll:true});},[step]);
  function saveRecommendation() {
    const items = new Map();
    for (const r of recommendations) {
      const productId = {"22-12":"edf-22-12-pink-40","26-14":"edf-26-14-blue-40","26-18":"edf-26-18-green-40","30-20":"edf-30-20-red-40"}[r.formula.code];
      const line = items.get(productId) || { productId, pounds:0 };
      line.pounds += r.monthlyPounds; items.set(productId,line);
    }
    try {
      localStorage.setItem("opwp-food-recommendation",JSON.stringify({
        expiresAt:Date.now()+86400000,
        items:[...items.values()].map(i => ({productId:i.productId,quantity:Math.min(10,Math.max(1,Math.ceil(i.pounds/40)))})),
      }));
    } catch { /* Account checkout can still select formulas when local storage is unavailable. */ }
  }
  function next() {
    setError("");
    if (!dogProfileCompletion(dogs).every(Boolean)) {
      setError("Answer every questionnaire item for each dog to see their formula match.");
      return;
    }
    setStep(3);
    toolRef.current?.scrollIntoView({behavior:"smooth",block:"start"});
  }
  return <div className={styles.toolShell} ref={toolRef}>
    <div className={styles.stepper} aria-label="Order progress" role="list">{["About your dogs","Your formula match","Create account & order"].map((text,index) => <div key={text} role="listitem" aria-current={step === index+2 ? "step" : undefined} className={`${styles.step} ${step === index+2 ? styles.stepActive : ""} ${step > index+2 ? styles.stepDone : ""}`}><span>{step > index+2 ? "✓" : index+1}</span><b>{text}</b></div>)}</div>
    <div className={`${styles.toolBody} ${step === 2 ? styles.questionnaireToolBody : ""}`}><div className={styles.formPanel} ref={activePanelRef} tabIndex={-1}>
          {step === 2 && (
            <section>
              <div className={`${styles.panelHeading} ${styles.questionnaireHeading}`}>
                <span>Step 1 of 3</span>
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
                <span>Step 2 of 3</span>
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


      {error && <div className={styles.errorMessage} role="alert">{error}</div>}
      <div className={styles.formActions}>
        {step === 2 ? <button className={styles.nextButton} onClick={next}>See my formula match →</button> : <>
          <button className={styles.backButton} onClick={() => {setStep(2);setError("");}}>Edit answers</button>
          <a className={styles.heroCta} href="/dog-food/account/?start=signup&from=finder" onClick={saveRecommendation}>Create account & continue →</a>
        </>}
      </div>
      {step === 3 && <p className={styles.signupHint}>Your recommended formulas carry into your account. Choose one-time or monthly delivery and review quantities before paying with Stripe. Already have a dog-food account? <a href="/dog-food/account/?from=finder" onClick={saveRecommendation}>Sign in to continue.</a> Your Sweep & Go login is separate.{!paymentConfigured && " Checkout is currently unavailable; no payment will be taken."}</p>}
      <details className={styles.moreBlends}><summary>Want to look closer? Meet the four blends</summary><p>Optional: explore ingredients and analysis. You don’t need to read this to get your match or order.</p>              <div className={styles.quoteBlendGrid}>
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
</details>
    </div></div>
  </div>;
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
