import { FieldError } from "./field-policy.mjs";
export const SERVICE_DEFAULTS = Object.freeze([
  {
    id: "scoop",
    name: "Yard cleanup",
    unitLabel: "visit",
    minutesPerUnit: 10,
    timed: true,
    entryRequired: true,
    proofKind: "gate",
  },
  {
    id: "sanitize",
    name: "Yard sanitization",
    unitLabel: "visit",
    minutesPerUnit: 5,
    timed: true,
    entryRequired: true,
    proofKind: "gate",
  },
  {
    id: "deodorize",
    name: "Yard deodorization",
    unitLabel: "visit",
    minutesPerUnit: 4,
    timed: true,
    entryRequired: true,
    proofKind: "gate",
  },
  {
    id: "litter",
    name: "Kitty litter box service",
    unitLabel: "box",
    minutesPerUnit: 6,
    timed: true,
    entryRequired: true,
    proofKind: "service",
  },
  {
    id: "haul",
    name: "Waste haul-away",
    unitLabel: "unit",
    minutesPerUnit: 0,
    timed: false,
    entryRequired: false,
    proofKind: "none",
  },
  {
    id: "food",
    name: "Dog food delivery",
    unitLabel: "delivery",
    minutesPerUnit: 4,
    timed: true,
    entryRequired: false,
    proofKind: "delivery",
  },
]);
export function validateService(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new FieldError("Provide a service definition.");
  const allowed = [
    "id",
    "name",
    "unitLabel",
    "minutesPerUnit",
    "timed",
    "entryRequired",
    "proofKind",
    "active",
    "instructions",
  ];
  if (
    Object.keys(input).some((k) => !allowed.includes(k)) ||
    !/^[a-z][a-z0-9_-]{1,39}$/.test(input.id || "")
  )
    throw new FieldError(
      "Use a stable service ID with lowercase letters, digits, underscores or hyphens.",
    );
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 100 ||
    typeof input.unitLabel !== "string" ||
    !input.unitLabel.trim() ||
    input.unitLabel.length > 30
  )
    throw new FieldError("Enter a service name and quantity unit.");
  if (
    !Number.isFinite(input.minutesPerUnit) ||
    input.minutesPerUnit < 0 ||
    input.minutesPerUnit > 240 ||
    ["timed", "entryRequired", "active"].some(
      (k) => typeof input[k] !== "boolean",
    ) ||
    !["gate", "service", "delivery", "none"].includes(input.proofKind)
  )
    throw new FieldError("Provide valid timing, access and proof rules.");
  if (
    input.id === "food" &&
    (!input.timed || input.entryRequired || input.proofKind !== "delivery")
  )
    throw new FieldError(
      "Food deliveries must retain delivery proof and their payment/inventory workflow.",
    );
  if (input.id !== "food" && input.proofKind === "delivery")
    throw new FieldError(
      "Use service or gate proof for an add-on. Delivery proof belongs to the protected food workflow.",
    );
  if (
    typeof input.instructions !== "string" ||
    input.instructions.length > 2000
  )
    throw new FieldError("Instructions must be at most 2,000 characters.");
  return {
    ...input,
    name: input.name.trim(),
    unitLabel: input.unitLabel.trim(),
  };
}
export const catalogRow = (r) => ({
  id: r.id,
  name: r.name,
  unitLabel: r.unit_label,
  minutesPerUnit: Number(r.minutes_per_unit),
  timed: Boolean(r.timed),
  entryRequired: Boolean(r.entry_required),
  proofKind: r.proof_kind,
  active: Boolean(r.active),
  instructions: r.instructions,
});
export function serviceTask(
  service,
  {
    id,
    quantity = 1,
    notes = "",
    source = null,
    estimate = null,
    title = null,
    deliveryItems = [],
  } = {},
) {
  if (!service || !Number.isInteger(quantity) || quantity < 1 || quantity > 50)
    throw new FieldError(
      "Choose an active service and a quantity from 1 to 50.",
    );
  return {
    id,
    serviceId: service.id,
    title: title || service.name,
    quantity,
    unitLabel: service.unitLabel,
    timed: service.timed,
    entryRequired: service.entryRequired,
    proofKind: service.proofKind,
    instructions: service.instructions || "",
    estimatedMinutes: service.timed
      ? Number.isFinite(estimate) && estimate > 0
        ? estimate
        : service.minutesPerUnit * quantity
      : 0,
    estimateSource:
      Number.isFinite(estimate) && estimate > 0
        ? "source"
        : "configured allowance",
    status: "pending",
    startedAt: null,
    completedAt: null,
    notes,
    photos: [],
    source,
    deliveryItems,
  };
}
