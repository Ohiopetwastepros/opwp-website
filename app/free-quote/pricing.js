// Website quote pricing mirrors Sweep & Go Pricing Setup. Recurring prices are
// prepaid fixed monthly totals. Unlisted cleanup ranges require a custom quote.
export const PRICING_VERSION = "sng-2026-11-18";
export const CLEANUP_RANGE_EXPLANATION = "We provide a range which is based on how much waste is in the yard and how long it takes the technician.";

const wholeDollars = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

export function formatCleanupRange([low, high]) {
  return `${wholeDollars.format(low)} to ${wholeDollars.format(high)}`;
}

export const PRICING = {
  monthly: {
    twice_a_week:     { 1: 175, 2: 190, 3: 225, 4: 245, 5: 275, 6: 305, 7: 335 },
    once_a_week:      { 1: 95, 2: 110, 3: 125, 4: 140, 5: 155, 6: 170, 7: 185 },
    every_other_week: { 1: 72, 2: 80, 3: 92, 4: null, 5: null, 6: null, 7: null },
    once_a_month:     { 1: 55, 2: 65, 3: null, 4: null, 5: null, 6: null, 7: null },
  },

  visitsPerMonth: { twice_a_week: 8, once_a_week: 4, every_other_week: 2, once_a_month: 1 },

  frequencies: [
    { id: "twice_a_week", name: "2x / week", sub: "For heavy-use yards", maxDogs: 7 },
    { id: "once_a_week", name: "Weekly", sub: "Best fit for most yards", popular: true, maxDogs: 7 },
    { id: "every_other_week", name: "Bi-weekly", sub: "Lower-maintenance option", maxDogs: 3 },
    { id: "once_a_month", name: "Monthly", sub: "Light-duty / small dogs", maxDogs: 2 },
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
    one_week:    { 1: [20, 26], 2: [23, 30], 3: [25, 33], 4: [28, 36], 5: [29, 37] },
    two_weeks:   { 1: [27, 34], 2: [32, 39], 3: [36, 43], 4: [40, 47], 5: [42, 49] },
    three_weeks: { 1: [37, 45], 2: [45, 52], 3: [51, 58], 4: [57, 65], 5: [60, 70] },
    one_month:   { 1: [48, 58], 2: [58, 70], 3: [65, 75], 4: [75, 85], 5: [90, 105] },
    two_months:  { 1: [65, 75], 2: [75, 85], 3: [90, 100], 4: [105, 125], 5: [140, 160] },
    "3_4_months": { 1: [85, 95], 2: [90, 100], 3: [100, 110], 4: [115, 135], 5: [160, 185] },
  },

  oneTimeCleanup: {
    one_week:    { 1: [30, 41], 2: [36, 46], 3: [38, 50], 4: [42, 53], 5: [44, 55] },
    two_weeks:   { 1: [42, 53], 2: [50, 60], 3: [53, 65], 4: [60, 70], 5: [65, 75] },
    three_weeks: { 1: [58, 70], 2: [70, 80], 3: [75, 85], 4: [85, 95], 5: [90, 105] },
    one_month:   { 1: [65, 80], 2: [80, 110], 3: [95, 120], 4: [120, 150], 5: [145, 170] },
    two_months:  { 1: [80, 110], 2: [105, 130], 3: [115, 145], 4: [145, 170], 5: [165, 195] },
    "3_4_months": { 1: [105, 130], 2: [125, 155], 3: [140, 165], 4: [165, 195], 5: [190, 220] },
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

  // Authoritative service-area ZIPs (41). Out-of-area -> waitlist lead, no account.
  serviceZips: [
    "43402", "43403", "43412", "43414", "43460", "43465", "43504",
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
  { id: "small",  label: "1/8 to 1/4 acre",   sub: "5,446 to 10,890 sq ft", upcharge: 10 },
  { id: "medium", label: "1/4 to 1/2 acre",   sub: "10,891 to 21,780 sq ft", upcharge: 20 },
  { id: "large",  label: "1/2 to 3/4 acre",   sub: "21,781 to 32,670 sq ft", upcharge: 30 },
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
  const addon = PRICING.addons.find(({ id }) => id === "haul_away");
  return dogs >= 3 ? addon.price3Plus : addon.price;
}

export function isFrequencyOffered(frequency, dogs) {
  const plan = PRICING.frequencies.find(({ id }) => id === frequency);
  const count = Number(dogs);
  return Number.isInteger(count) && count >= 1 && count <= (plan?.maxDogs ?? 0);
}

// Local (offline) quote calculation. Used immediately and as a fallback when the
// live SNG proxy at /api/quote is not configured.
export function calcLocalQuote({ dogs, frequency, lastCleaned }) {
  const d = Number(dogs);
  if (frequency === "one_time") {
    const grid = PRICING.oneTimeCleanup[lastCleaned];
    const range = grid && grid[d];
    return { type: "one_time", oneTimeRange: range || null, monthly: null };
  }
  const monthly = isFrequencyOffered(frequency, d) ? PRICING.monthly[frequency]?.[d] ?? null : null;
  const visits = PRICING.visitsPerMonth[frequency];
  const perVisit = monthly && visits ? monthly / visits : null;
  const initialRange = monthly == null ? null : PRICING.initialCleanup[lastCleaned]?.[d] ?? null;
  return { type: "recurring", monthly, perVisit, visits, initialRange };
}
