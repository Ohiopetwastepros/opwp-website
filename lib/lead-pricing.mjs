import { PRICING, YARD_TIERS, PRICING_VERSION } from "../app/free-quote/pricing.js";

// The website and playbook deliberately share the same objects and version.
export { PRICING, YARD_TIERS, PRICING_VERSION };
export const PLAYBOOK_PRICING_VERSION = PRICING_VERSION;
export const FREQUENCY_IDS = { Weekly: "once_a_week", Biweekly: "every_other_week", "Twice Weekly": "twice_a_week", Monthly: "once_a_month", "One Time": "one_time", weekly: "once_a_week", biweekly: "every_other_week", "bi-weekly": "every_other_week", "twice weekly": "twice_a_week", monthly: "once_a_month" };
export function frequencyId(value) { return FREQUENCY_IDS[value] || value; }
export function initialRange(dogs, lastCleaned) { return Number.isInteger(Number(dogs)) && Number(dogs) >= 1 ? PRICING.initialCleanup[lastCleaned]?.[Number(dogs)] ?? null : null; }
export function oneTimeRange(dogs, lastCleaned) { return Number.isInteger(Number(dogs)) && Number(dogs) >= 1 ? PRICING.oneTimeCleanup[lastCleaned]?.[Number(dogs)] ?? null : null; }
export function monthly(frequency, dogs) { return Number.isInteger(Number(dogs)) && Number(dogs) >= 1 ? PRICING.monthly[frequencyId(frequency)]?.[Number(dogs)] ?? null : null; }
export function yardTierId(value) { return ({ A: "tiny", B: "small", C: "medium", D: "large", E: "xlarge", larger: "xlarge" })[value] || value; }
export function yardUpcharge(tier) { return YARD_TIERS.find(({ id }) => id === yardTierId(tier))?.upcharge ?? null; }
