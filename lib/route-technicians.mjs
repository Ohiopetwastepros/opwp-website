export function technicianStatus(name, roster) {
  const normalize = value => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const matches = (roster?.records || []).filter(record => normalize(record.name) === normalize(name));
  const statuses = new Set(matches.map(record => record.status));
  return statuses.size === 1 && ["active", "inactive"].includes(matches[0]?.status)
    ? matches[0].status === "active" ? "Active" : "Inactive" : "Status unknown";
}
