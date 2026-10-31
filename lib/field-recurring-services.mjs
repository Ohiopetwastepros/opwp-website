import { FieldError } from "./field-policy.mjs";
import { serviceTask } from "./field-service-catalog.mjs";

// Stable source property IDs only. A name, street address or job ID is not a recurring identity.
export function recurringPropertyKey(identity) {
  if (!identity?.organization_id || !identity?.client_location_id) return null;
  const values = [
    "organization_id",
    "client_id",
    "client_location_id",
    "commercial_client_id",
    "commercial_location_id",
    "commercial",
  ].map((k) => String(identity[k] || ""));
  if (values.some((v) => v.length > 160)) return null;
  return JSON.stringify(["sweep_and_go", ...values]);
}
export function validateRecurring(input, date) {
  if (
    !Number.isInteger(input.quantity) ||
    input.quantity < 1 ||
    input.quantity > 50 ||
    typeof input.active !== "boolean" ||
    ![1, 2, 4].includes(input.everyWeeks) ||
    !Array.isArray(input.weekdays) ||
    !input.weekdays.length ||
    input.weekdays.length > 7 ||
    new Set(input.weekdays).size !== input.weekdays.length ||
    input.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  )
    throw new FieldError(
      "Choose quantity, weekdays and a weekly, biweekly or four-week interval.",
    );
  const start = input.startDate;
  if (
    typeof start !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !Number.isFinite(Date.parse(`${start}T12:00:00Z`)) ||
    new Date(`${start}T12:00:00Z`).toISOString().slice(0, 10) !== start ||
    Math.abs(Date.parse(start) - Date.parse(date)) > 366 * 86400000
  )
    throw new FieldError(
      "Choose a valid recurring start date within one year of this workday.",
    );
  if (input.billingReviewed !== true)
    throw new FieldError(
      "Confirm the customer authorization and existing billing arrangement before scheduling recurring service.",
    );
  return {
    quantity: input.quantity,
    active: input.active,
    everyWeeks: input.everyWeeks,
    weekdays: [...input.weekdays].sort(),
    startDate: start,
  };
}
export function recurringDue(rule, date) {
  const target = new Date(`${date}T12:00:00Z`),
    anchor = new Date(`${rule.start_date}T12:00:00Z`);
  const days = Math.round((target - anchor) / 86400000),
    anchorWeekday = anchor.getUTCDay();
  return (
    days >= 0 &&
    JSON.parse(rule.weekdays).includes(target.getUTCDay()) &&
    Math.floor((days + anchorWeekday) / 7) % rule.every_weeks === 0
  );
}
export async function recurringTasks(
  db,
  org,
  identity,
  date,
  services,
  makeId,
) {
  const key = recurringPropertyKey(identity);
  if (!key) return { key: null, tasks: [] };
  const rows = await db
    .prepare(
      "SELECT * FROM field_property_services WHERE organization_id=? AND property_key=? AND active=1 ORDER BY service_id LIMIT 20",
    )
    .bind(org, key)
    .all();
  const tasks = [];
  for (const rule of rows.results) {
    const service = services.get(rule.service_id);
    if (!service?.active || !recurringDue(rule, date)) continue;
    tasks.push({
      ...serviceTask(service, {
        id: await makeId(rule.id),
        quantity: rule.quantity,
        notes: rule.instructions,
        source: {
          provider: "opwp",
          jobId: null,
          customerId: identity.client_id || null,
        },
      }),
      recurringRuleId: rule.id,
    });
  }
  return { key, tasks };
}
