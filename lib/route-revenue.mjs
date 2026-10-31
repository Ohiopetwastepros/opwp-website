export const ROUTE_REVENUE_CATEGORIES = Object.freeze({
  recurring: "Subscription scooping", initial: "Initial cleanups", one_time: "One-time scooping",
  addon_recurring: "Subscription add-ons", addon: "One-time add-ons",
  dog_food_recurring: "Subscription dog food", dog_food: "One-time dog food", other: "Needs classification",
});
export const ROUTE_REVENUE_VERSION = 7;
const normalized = value => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const validRevenueCategory = value => Object.hasOwn(ROUTE_REVENUE_CATEGORIES, value);
export function routeRevenueCategory(fields = {}) {
  if (validRevenueCategory(fields["Route Revenue Category"])) return fields["Route Revenue Category"];
  const type = normalized(fields["Service Type"]);
  const sourceType = normalized(fields["Source Service Type"] || fields["Service Type"]);
  const label = String(fields["Source Service Label"] || "");
  const plan = normalized(fields["Source Service Plan"]);
  const recurringPlan = /^\d+d(?:\d+x?)?(?:bw|w|m)$/.test(plan) || /^(?:\d+x[wm]|bw)$/.test(plan);
  const subscription = !["onetime", "initial", "reclean"].includes(sourceType) && (sourceType === "recurring" || recurringPlan);
  if (/dog.?food|extreme dog fuel|food delivery/i.test(label)) return subscription ? "dog_food_recurring" : "dog_food";
  if (/saniti|deodor|haul.?away|front yard/i.test(label)) return subscription ? "addon_recurring" : "addon";
  if (["custom", "recurring"].includes(sourceType) && recurringPlan && /cleanup|scoop|waste/i.test(label)) return "recurring";
  const description = String(fields["Service Type"] || "");
  if (/saniti|deodor|haul.?away|front yard/i.test(description)) {
    if (/monthly|\/mo\b|per month|subscription/i.test(description)) return "addon_recurring";
    if (/one[ _-]?time/i.test(description)) return "addon";
  }
  if (/dogfood|extremedogfuel|fooddelivery/.test(type)) return "dog_food";
  if (/^(addon|sanitization|sanitizing|deodorizing|yarddeodorizing|yardsanitizing|onetimesanitization)$/.test(type)) return "addon";
  if (/^(initial|initialcleanup|initialservice)$/.test(type)) return "initial";
  if (/^(onetime|onetimecleanup|singlecleanup)$/.test(type)) return "one_time";
  if (/^(recurring|weekly|biweekly|monthly|twiceweekly|onceaweek|twiceaweek|everyotherweek|onceamonth)$/.test(type)
    || /^\d+d(?:\d+x?)?(?:bw|w|m)$/.test(type) || /^(?:\d+x[wm]|bw)$/.test(type) || /^\d+w\d+d$/.test(type)) return "recurring";
  return "other";
}
export function emptyRevenueMix() {
  return Object.fromEntries(Object.keys(ROUTE_REVENUE_CATEGORIES).map(category => [category, { revenue: 0, jobs: 0, missingValues: 0, estimatedJobs: 0 }]));
}

export function routeServiceValue(fields, customer) {
  const category = routeRevenueCategory(fields);
  const rawRevenue = Number(fields["Revenue ($)"]);
  const reported = Number.isFinite(rawRevenue) ? rawRevenue : 0;
  const verified = fields["Route Revenue Verified"] === true && fields["Revenue ($)"] !== null && fields["Revenue ($)"] !== "" && Number.isFinite(rawRevenue) && reported >= 0;
  // A customer's current subscription cannot establish a historical visit price.
  // Keep source zero/missing values visible until there is dated price evidence.
  const estimated = false;
  const revenue = verified ? reported : reported > 0 ? reported : 0;
  const missing = !verified && (!(revenue > 0) || (!fields["Source Price Confirmed"] && (reported > 500 || (normalized(fields["Service Type"]) === "recurring" && reported > 100))));
  return { category, revenue, verified, estimated, missing,
    valueSource: verified ? "Verified correction" : estimated ? "Subscription estimate" : reported > 0 ? "Recorded job value" : "Price missing",
    components: fields["Route Revenue Components"] || [{ category, revenue }],
    classificationReason: fields["Route Revenue Reason"] || (fields["Source Service Label"] && category !== "other" ? `Sweep & Go completed job: ${fields["Source Service Label"]}; plan ${fields["Source Service Plan"] || fields["Source Service Type"]}.` : category === "other" ? `Source service type “${String(fields["Service Type"] || "blank").slice(0,80)}” does not identify a service category. Automatic source checks are pending.` : `Classified from source service type “${String(fields["Service Type"]).slice(0,80)}”.`),
  };
}
export function mergeRevenueMix(target, row) {
  // An older cached fact has unknown classification, never assumed recurring.
  const source = row.revenueMix || { other: row };
  for (const category of Object.keys(ROUTE_REVENUE_CATEGORIES)) {
    for (const field of ["revenue", "jobs", "missingValues", "estimatedJobs"]) target[category][field] += Number(source[category]?.[field]) || 0;
  }
  return target;
}
export function summarizeRevenueMix(rows) { return rows.reduce(mergeRevenueMix, emptyRevenueMix()); }
export function subscriptionAsOf(snapshots = [], through) {
  return snapshots.filter(row => row.snapshot_date <= through).sort((a,b) => b.snapshot_date.localeCompare(a.snapshot_date))[0] || null;
}
