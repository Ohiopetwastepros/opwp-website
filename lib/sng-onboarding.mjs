export const OPWP_SNG_FORM_OPTIONS = Object.freeze({
  frequencies: ["twice_a_week", "once_a_week", "every_other_week", "once_a_month", "one_time"],
  lastCleaned: ["one_week", "two_weeks", "three_weeks", "one_month", "two_months", "3_4_months", "5_6_months", "7_9_months", "10_plus"],
  safeDog: ["yes", "no"],
  gateLocations: ["left", "right", "alley", "no_gate", "other"],
  doggieDoor: ["yes", "no"],
  garbageCanLocations: ["left", "right", "alley", "other"],
  areasToClean: ["Back Yard", "Behind Shed", "Kids Play Area", "Area with Mulch", "Area with Rocks", "Pool Area", "Area With Pine Straw"],
  howHeard: ["search_engine", "previous_client", "referred_by_family_or_friend", "social_media", "vehicle_signage", "gift_certificate", "other"],
  selectedAddons: ["front_yard", "deodorize", "haul_away", "sani_monthly", "sani_onetime", "food_blue", "food_green", "food_pink", "food_red"],
});

const HOW_HEARD_MAP = {
  search_engine: "search_engine",
  previous_client: "previous_client",
  referred_by_family_or_friend: "referred_by_family_or_friend",
  social_media: "social_media",
  vehicle_signage: "vehicle_signage",
  gift_certificate: "gift_certificate",
  other: "other",
  // Backward-compatible values from quotes started before this audit.
  google_search: "search_engine",
  google_maps: "search_engine",
  facebook: "social_media",
  nextdoor: "social_media",
  friend_referral: "referred_by_family_or_friend",
  door_hanger: "other",
  yard_sign: "vehicle_signage",
};

const CROSS_SELLS = {
  front_yard: { id: 2851, name: "Add Front Yard Scooping" },
  deodorize: { id: 5014, name: "Deodorization" },
  haul_away: { id: 3200, name: "Haul Away Service" },
  sani_monthly: { id: 3211, name: "Sanitization Treatments- Once per month" },
  sani_onetime: { id: 6124, name: "Sanitization Treatments- One Time" },
};

export function normalizeHowHeard(value) {
  return HOW_HEARD_MAP[value] || "other";
}

export function repeatDogValue(value, count, { firstOnly = false } = {}) {
  const size = Math.min(Math.max(Number(count) || 1, 1), 7);
  const first = Array.isArray(value) ? String(value[0] || "") : String(value || "");
  return Array.from({ length: size }, (_, index) => firstOnly && index > 0 ? "" : first);
}

export function selectedSngCrossSells(selected = []) {
  const items = selected.map((key) => CROSS_SELLS[key]).filter(Boolean);
  return { ids: items.map((item) => item.id), names: items.map((item) => item.name).join(",") };
}

export const validSngHowHeardValues = new Set(OPWP_SNG_FORM_OPTIONS.howHeard);
export const acceptedHowHeardInputs = new Set(Object.keys(HOW_HEARD_MAP));
