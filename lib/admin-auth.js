import { createRemoteJWKSet, jwtVerify } from "jose";
import { getRuntimeEnv } from "./cloudflare";

export async function verifyAdminRequest(headers) {
  const env = getRuntimeEnv();
  const host = headers.get("host") ?? "";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (isLocal && env.ADMIN_DEV_BYPASS === "true") {
    return { authorized: true, email: "local-admin@opwp" };
  }

  const teamDomain = String(env.CF_ACCESS_TEAM_DOMAIN ?? "").replace(/\/$/, "");
  const audience = env.CF_ACCESS_AUD;
  const assertion = headers.get("cf-access-jwt-assertion");
  if (!teamDomain || !audience || !assertion) return { authorized: false };

  try {
    const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(assertion, jwks, {
      issuer: teamDomain,
      audience,
    });
    return { authorized: true, email: payload.email ?? payload.sub ?? "admin" };
  } catch {
    return { authorized: false };
  }
}
