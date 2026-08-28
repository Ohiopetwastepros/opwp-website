const HOW_HEARD_MAP = {
  google_search: "search_engine",
  google_maps: "directory_listing",
  facebook: "social_media",
  nextdoor: "social_media",
  friend_referral: "referred_by_family_or_friend",
  door_hanger: "flier_from_business",
  yard_sign: "vehicle_signage",
  other: "other",
};

export function normalizeHowHeard(value) {
  return HOW_HEARD_MAP[value] || "other";
}

export const validSngHowHeardValues = new Set(Object.values(HOW_HEARD_MAP));
