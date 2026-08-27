export const TONY_MINIMUM_WEEKLY_HOURS = 40;
export const TONY_WEEKLY_HOURS_CUTOFF = 45;
export const PRIMARY_FIELD_TECHNICIAN = "Tony Bridgman";
export const RELIEF_FIELD_TECHNICIAN = "Craig Bridgman";
export const INACTIVE_FIELD_TECHNICIANS = Object.freeze(["Bria Mahaney"]);

function normalizedName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isInactiveFieldTechnician(value) {
  const name = normalizedName(value);
  return INACTIVE_FIELD_TECHNICIANS.some((technician) => normalizedName(technician) === name);
}

export function onboardingRouteTechnician() {
  return PRIMARY_FIELD_TECHNICIAN;
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function enforceTonyMinimumWeeklyHours(value) {
  return Math.max(finiteNumber(value, TONY_MINIMUM_WEEKLY_HOURS), TONY_MINIMUM_WEEKLY_HOURS);
}

export function validateTonyMinimumWeeklyHours(value) {
  const hours = finiteNumber(value, -1);
  if (hours < TONY_MINIMUM_WEEKLY_HOURS) {
    throw new Error(`Tony's guaranteed weekly hours cannot be below ${TONY_MINIMUM_WEEKLY_HOURS}.`);
  }
  return hours;
}

export function calculateTonyWeeklyStaffing(routeMinutes) {
  const routeHours = Math.max(finiteNumber(routeMinutes), 0) / 60;
  const projectedPaidHours = Math.max(routeHours, TONY_MINIMUM_WEEKLY_HOURS);
  return {
    technician: PRIMARY_FIELD_TECHNICIAN,
    minimumPaidHours: TONY_MINIMUM_WEEKLY_HOURS,
    weeklyHoursCutoff: TONY_WEEKLY_HOURS_CUTOFF,
    modeledRouteHours: Math.round(routeHours * 100) / 100,
    paidOperationalHoursToMinimum: Math.round(Math.max(TONY_MINIMUM_WEEKLY_HOURS - routeHours, 0) * 100) / 100,
    hoursBeforeCutoff: Math.round(Math.max(TONY_WEEKLY_HOURS_CUTOFF - projectedPaidHours, 0) * 100) / 100,
    cutoffExceeded: projectedPaidHours > TONY_WEEKLY_HOURS_CUTOFF,
  };
}
