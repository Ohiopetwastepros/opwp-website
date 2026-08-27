import assert from "node:assert/strict";
import {
  hasOfficeAccess,
  OFFICE_ACCESS_ROLE_SQL,
  officeRoleForAccount,
} from "../lib/office-access-roles.mjs";

for (const role of ["owner", "manager", "dispatcher"]) {
  assert.equal(hasOfficeAccess(role), true, `${role} should have office access`);
  assert.equal(officeRoleForAccount(role), role, `${role} should be preserved when its PIN is reset`);
}

for (const role of ["technician", "viewer", "", null, undefined]) {
  assert.equal(hasOfficeAccess(role), false, `${String(role)} should not have office access`);
}

assert.equal(hasOfficeAccess("technician", true), true, "a platform owner may retain the technician role");
assert.equal(officeRoleForAccount("technician", 1), "technician", "owner PIN resets should preserve the technician role");
assert.equal(officeRoleForAccount(null), "dispatcher", "new office accounts should default to dispatcher");
assert.equal(officeRoleForAccount("technician"), null, "field-only accounts should not be silently converted");
assert.equal(OFFICE_ACCESS_ROLE_SQL, "'owner','manager','dispatcher'");

console.log("Office access role tests passed.");
