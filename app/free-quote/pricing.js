// OPWP quote pricing config — mirrors Sweep & Go "Pricing Setup".
// Source of truth: Onboarding System/quote-widget.html ("EDIT PRICING HERE") +
// Onboarding System/Pricing-Structure.md. Recurring prices are MONTHLY totals
// (Prepaid Fixed Monthly). null = "not offered" for that dog/frequency combo.

export const PRICING = {
  monthly: {
    twice_a_week:     { 1: 162, 2: 180, 3: 207, 4: 234, 5: 252, 6: 270, 7: 288 },
    once_a_week:      { 1: 90, 2: 100, 3: 115, 4: 130, 5: 140, 6: 150, 7: 160 },
    every_other_week: { 1: 68, 2: 75, 3: 87, 4: null, 5: null, 6: null, 7: null },
    once_a_month:     { 1: 50, 2: 55, 3: null, 4: null, 5: null, 6: null, 7: null },
  },

  visitsPerMonth: { twice_a_week: 8, once_a_week: 4, every_other_week: 2, once_a_month: 1 },

  frequencies: [
    { id: "twice_a_week", name: "2x / week", sub: "For heavy-use yards", maxDogs: 7 },
    { id: "once_a_week", name: "Weekly", sub: "Best fit for most yards", popular: true, maxDogs: 7 },
    { id: "every_other_week", name: "Bi-weekly", sub: "Lower-maintenance option", maxDogs: 3 },
    { id: "once_a_month", name: "Monthly", sub: "Light-duty / small dogs", maxDogs: 1 },
    { id: "one_time", name: "One-time clean", sub: "Reset & catch-up clean", maxDogs: 7 },
  ],

  lastCleanedOptions: [
    { id: "one_week", label: "Within a week" },
    { id: "two_weeks", label: "About 2 weeks" },
    { id: "three_weeks", label: "About 3 weeks" },
    { id: "one_month", label: "About 1 month", default: true },
    { id: "two_months", label: "About 2 months" },
    { id: "3_4_months", label: "3-4 months" },
    { id: "5_6_months", label: "5-6 months" },
    { id: "7_9_months", label: "7-9 months" },
    { id: "10_plus", label: "10+ months / never" },
  ],

  initialCleanup: {
    one_week: { 1: [18.48, 25], 2: [21.93, 28], 3: [23.09, 30], 4: [24.25, 31], 5: [25.4, 32] },
    two_weeks: { 1: [25.4, 32], 2: [30.02, 37], 3: [32.33, 39], 4: [34.64, 41], 5: [36.95, 43] },
    three_weeks: { 1: [35.2, 42], 2: [42.51, 49], 3: [46.17, 53], 4: [49.82, 56], 5: [53.48, 60] },
    one_month: { 1: [45, 55], 2: [55, 65], 3: [60, 70], 4: [65, 75], 5: [80, 90] },
    two_months: { 1: [60, 70], 2: [70, 80], 3: [80, 90], 4: [90, 110], 5: [120, 140] },
    "3_4_months": { 1: [79, 89], 2: [85, 95], 3: [89, 99], 4: [99, 119], 5: [140, 160] },
  },

  oneTimeCleanup: {
    one_week: { 1: [27.72, 37.5], 2: [32.9, 42], 3: [34.64, 45], 4: [36.39, 46.5], 5: [38.1, 48] },
    two_weeks: { 1: [38.1, 48], 2: [45.03, 55.5], 3: [48.5, 58.5], 4: [51.96, 61.5], 5: [55.43, 64.5] },
    three_weeks: { 1: [52.8, 63], 2: [63.77, 73.5], 3: [69.26, 79.5], 4: [74.73, 84], 5: [80.22, 90] },
    one_month: { 1: [60, 75], 2: [75, 100], 3: [85, 110], 4: [105, 130], 5: [125, 150] },
    two_months: { 1: [75, 100], 2: [95, 120], 3: [105, 130], 4: [125, 150], 5: [145, 170] },
    "3_4_months": { 1: [95, 120], 2: [115, 140], 3: [125, 150], 4: [145, 170], 5: [165, 190] },
  },

  addons: [
    { id: "front_yard", name: "Add Front Yard Scooping", price: 21, charge: "monthly", desc: "Extend cleanup to your front yard." },
    { id: "deodorize", name: "Deodorization", price: 25, charge: "per_treatment", desc: "Pet-safe enzyme spray that breaks down odor-causing bacteria." },
    { id: "haul_away", name: "Haul Away Service", price: 21, charge: "monthly", price3Plus: 31, desc: "We haul the waste away and dispose of it. (+$10/mo for 3+ dogs.)" },
    { id: "sani_monthly", name: "Sanitization - monthly", price: 30, charge: "monthly", desc: "Wysiwash eco-friendly sanitizing spray." },
    { id: "sani_onetime", name: "Sanitization - one time", price: 35, charge: "one_time", desc: "One-time Wysiwash sanitizing treatment." },
    { id: "food_blue", name: "Dog Food - Blue Bag (40 lb)", price: 59, charge: "product", desc: "Balanced everyday nutrition." },
    { id: "food_green", name: "Dog Food - Green Bag (40 lb)", price: 59, charge: "product", desc: "Active dogs needing more energy + joint support." },
    { id: "food_pink", name: "Dog Food - Pink Bag (40 lb)", price: 59, charge: "product", desc: "Lower-calorie formula / weight management." },
    { id: "food_red", name: "Dog Food - Red Bag (40 lb)", price: 59, charge: "product", desc: "High-performance formula for very active dogs." },
  ],

  // Authoritative service-area ZIPs (42). Out-of-area -> waitlist lead, no account.
  serviceZips: [
    "43402", "43403", "43412", "43414", "43416", "43460", "43465", "43504",
    "43515", "43525", "43528", "43537", "43542", "43547", "43551", "43552",
    "43558", "43560", "43565", "43566", "43571", "43601", "43604", "43605",
    "43606", "43607", "43608", "43609", "43610", "43611", "43612", "43613",
    "43614", "43615", "43616", "43617", "43619", "43620", "43623", "48144",
    "48182", "49267",
  ],
};

// Yard-size upcharge tiers (monthly, added to subscription rate)
// upcharge: null = custom quote (over 3/4 acre)
export const YARD_TIERS = [
  { id: "tiny",   label: "Up to 1/8 acre",   sub: "≤ 5,445 sq ft",        upcharge: 0  },
  { id: "small",  label: "1/8 – 1/4 acre",   sub: "5,446 – 10,890 sq ft", upcharge: 10 },
  { id: "medium", label: "1/4 – 1/2 acre",   sub: "10,891 – 21,780 sq ft",upcharge: 20 },
  { id: "large",  label: "1/2 – 3/4 acre",   sub: "21,781 – 32,670 sq ft",upcharge: 30 },
  { id: "xlarge", label: "Over 3/4 acre",     sub: "32,671+ sq ft",        upcharge: null },
  { id: "unsure", label: "Not sure",          sub: "We'll confirm at first visit", upcharge: 0 },
];

export const CHARGE_LABEL = {
  monthly: "/mo",
  one_time: " one-time",
  per_treatment: "/treatment",
  product: "/bag",
};

export function isInArea(zip) {
  return PRICING.serviceZips.includes(String(zip || "").trim().slice(0, 5));
}

export function haulAwayPrice(dogs) {
  return dogs >= 3 ? 31 : 21;
}

// Local (offline) quote calculation. Used immediately and as a fallback when the
// live SNG proxy at /api/quote is not configured.
export function calcLocalQuote({ dogs, frequency, lastCleaned }) {
  const d = Math.max(1, Math.min(7, Number(dogs) || 1));
  if (frequency === "one_time") {
    const grid = PRICING.oneTimeCleanup[lastCleaned];
    const range = grid && grid[d];
    return { type: "one_time", oneTimeRange: range || null, monthly: null };
  }
  const monthly = PRICING.monthly[frequency]?.[d] ?? null;
  const visits = PRICING.visitsPerMonth[frequency];
  const perVisit = monthly && visits ? monthly / visits : null;
  const initGrid = PRICING.initialCleanup[lastCleaned];
  const initialRange = initGrid && initGrid[d] ? initGrid[d] : null;
  return { type: "recurring", monthly, perVisit, visits, initialRange };
}
