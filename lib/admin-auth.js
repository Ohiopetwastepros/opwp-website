import { getRuntimeEnv } from "./cloudflare";

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function basicCredentials(headers) {
  const authorization = headers.get("authorization") ?? "";
  if (!authorization.startsWith("Basic ")) return null;
  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

export async function verifyAdminRequest(headers) {
  const env = getRuntimeEnv();
  const host = headers.get("host") ?? "";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (isLocal && env.ADMIN_DEV_BYPASS === "true") {
    return { authorized: true, email: "local-admin@opwp", method: "development" };
  }

  const credentials = basicCredentials(headers);
  if (!credentials || !env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) return { authorized: false };
  const [actualUser, expectedUser, actualPassword, expectedPassword] = await Promise.all([
    digest(credentials.username), digest(env.ADMIN_USERNAME), digest(credentials.password), digest(env.ADMIN_PASSWORD),
  ]);
  const authorized = constantTimeEqual(actualUser, expectedUser) && constantTimeEqual(actualPassword, expectedPassword);
  return authorized
    ? { authorized: true, email: credentials.username, method: "basic" }
    : { authorized: false };
}
