export function offlineAccessUntil(expiresAt, now = Date.now()) {
  const value = String(expiresAt || ""),
    expiry = Date.parse(
      /(?:Z|[+-]\d\d:\d\d)$/.test(value)
        ? value
        : `${value.replace(" ", "T")}Z`,
    );
  if (!Number.isFinite(expiry) || expiry <= now)
    throw new Error("The verified field session expiry is unavailable.");
  return new Date(Math.min(expiry, now + 12 * 3600000)).toISOString();
}
