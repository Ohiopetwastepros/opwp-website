import staffPrivate from '../lib/staff-private.json' with {type:'json'};
import assert from "node:assert/strict";
import {
  calculateTonyWeeklyStaffing,
  enforceTonyMinimumWeeklyHours,
  INACTIVE_FIELD_TECHNICIANS,
  isInactiveFieldTechnician,
  onboardingRouteTechnician,
  PRIMARY_FIELD_TECHNICIAN,
  RELIEF_FIELD_TECHNICIAN,
  TONY_MINIMUM_WEEKLY_HOURS,
  TONY_WEEKLY_HOURS_CUTOFF,
  validateTonyMinimumWeeklyHours,
} from "../lib/staffing-policy.mjs";

assert.equal(TONY_MINIMUM_WEEKLY_HOURS, 40);
assert.equal(TONY_WEEKLY_HOURS_CUTOFF, 45);
assert.equal(PRIMARY_FIELD_TECHNICIAN, staffPrivate.primaryName);
assert.equal(RELIEF_FIELD_TECHNICIAN, staffPrivate.reliefName);
assert.deepEqual(INACTIVE_FIELD_TECHNICIANS, [staffPrivate.inactiveNames[0]]);
assert.equal(isInactiveFieldTechnician(staffPrivate.inactiveNames[0]), true);
assert.equal(isInactiveFieldTechnician("bria-mahaney"), true);
assert.equal(isInactiveFieldTechnician(staffPrivate.primaryName), false);
assert.equal(onboardingRouteTechnician(), staffPrivate.primaryName);
assert.equal(enforceTonyMinimumWeeklyHours(32), 40);
assert.equal(enforceTonyMinimumWeeklyHours(40), 40);
assert.equal(enforceTonyMinimumWeeklyHours(42), 42);
assert.throws(() => validateTonyMinimumWeeklyHours(39.99), /cannot be below 40/);
assert.equal(validateTonyMinimumWeeklyHours(40), 40);

assert.deepEqual(calculateTonyWeeklyStaffing(35.1 * 60), {
  technician: staffPrivate.primaryName,
  minimumPaidHours: 40,
  weeklyHoursCutoff: 45,
  modeledRouteHours: 35.1,
  paidOperationalHoursToMinimum: 4.9,
  hoursBeforeCutoff: 5,
  cutoffExceeded: false,
});
assert.equal(calculateTonyWeeklyStaffing(42 * 60).paidOperationalHoursToMinimum, 0);
assert.equal(calculateTonyWeeklyStaffing(42 * 60).hoursBeforeCutoff, 3);
assert.equal(calculateTonyWeeklyStaffing(46 * 60).cutoffExceeded, true);

console.log("Configured minimum-hours and cutoff policy is enforced.");
