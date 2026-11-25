const technicianKey = value => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

export function technicianStatus(name, roster) {
  const matches = (roster?.records || []).filter(record => technicianKey(record.name) === technicianKey(name));
  const statuses = new Set(matches.map(record => record.status));
  return statuses.size === 1 && ["active", "inactive"].includes(matches[0]?.status)
    ? matches[0].status === "active" ? "Active" : "Inactive" : "Status unknown";
}

export function technicianHourlyTarget(name, technicians = []) {
  const normalized = technicianKey(name);
  if (!normalized) return null;
  const matches = technicians.filter(technician => technicianKey(technician.name) === normalized);
  const target = matches[0]?.hourlyTarget;
  return matches.length === 1 && Number.isFinite(target) && target >= 0 ? target : null;
}
