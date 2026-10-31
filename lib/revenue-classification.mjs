// Product and billing cadence are independent. A subscription invoice may also
// contain a one-time cleanup, food order, or treatment.
export function classifyRevenueLine(line, invoice = {}) {
  const text = String(line.description || "");
  const product = /dog.?food|extreme dog fuel|food delivery|\b(?:green|blue|red|black) bag\b/i.test(text) ? "dog_food"
    : /\binitial\s+(?:cleanup|job)\b/i.test(text) ? "scooping"
    : /saniti|deodor|haul.?away|front yard|rush charge|weekend (?:service charge|call)/i.test(text) ? "addon"
      : /clean|scoop|waste|\bdogs?\b|regular plan|regular schedule|\b(?:bi[ -]?)?weekly service\b|(?:initial|one time) job/i.test(text) ? "scooping" : "unknown";
  const dated = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b/.test(text);
  const explicitOneTime = /one[ _-]?time|initial|single cleanup/i.test(text);
  const explicitRecurring = /monthly|subscription|\$\s*\d+(?:\.\d+)?\s*\/\s*mo\b|per month|per week|annually|\b(?:bi[ -]?)?weekly\b|regular plan|additional dog.*month/i.test(text);
  const billing = explicitOneTime ? "one_time" : explicitRecurring ? "subscription"
    : dated ? "one_time" : ["one_time", "onetime", "initial"].includes(invoice.type) || invoice.billingInterval === "one_time" ? "one_time"
      : ["subscription", "recurring"].includes(invoice.type) ? "subscription" : "unknown";
  const category = product === "scooping" ? billing === "subscription" ? "recurring" : /initial/i.test(text) ? "initial" : "one_time"
    : product === "unknown" || billing === "unknown" ? "other" : product === "addon" ? billing === "subscription" ? "addon_recurring" : "addon"
      : billing === "subscription" ? "dog_food_recurring" : "dog_food";
  return { product, billing, category: billing === "unknown" ? "other" : category };
}
