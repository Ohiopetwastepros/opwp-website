export const OFFICE_ACCESS_ROLES = Object.freeze(["owner", "manager", "dispatcher"]);

export const OFFICE_ACCESS_ROLE_SQL = OFFICE_ACCESS_ROLES
  .map((role) => `'${role}'`)
  .join(",");

export function hasOfficeAccess(role, isPlatformOwner = false) {
  return isPlatformOwner === true || isPlatformOwner === 1 || OFFICE_ACCESS_ROLES.includes(String(role || ""));
}

export function officeRoleForAccount(existingRole, isPlatformOwner = false) {
  if (existingRole == null) return "dispatcher";
  return hasOfficeAccess(existingRole, isPlatformOwner) ? existingRole : null;
}
