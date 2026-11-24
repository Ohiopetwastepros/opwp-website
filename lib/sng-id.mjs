export function normalizeSngId(value) {
  if (typeof value !== "number" && typeof value !== "string") return "";
  const id = String(value).trim();
  return /^\d+(?:\.0+)?$/.test(id) ? id.replace(/\.0+$/, "").replace(/^0+(?=\d)/, "") : id;
}
