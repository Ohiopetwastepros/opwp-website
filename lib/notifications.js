import { getRuntimeEnv } from "./cloudflare";

export function notificationProvider() {
  const env = getRuntimeEnv();
  const name = String(env.SMS_PROVIDER || "unconfigured").toLowerCase();
  if (name === "quo") {
    return {
      name,
      configured: false,
      credentialsPresent: Boolean(env.QUO_API_BASE_URL && env.QUO_API_TOKEN && env.QUO_SENDER_ID),
      async send() {
        throw new Error("Quo delivery is not enabled until the provider API contract and credentials are configured.");
      },
    };
  }
  return {
    name: "unconfigured",
    configured: false,
    async send() { throw new Error("No production notification provider is configured."); },
  };
}

export async function sendNotification(provider, message) {
  if (!provider?.configured) return { ok: false, status: "queued", error: "provider_unconfigured" };
  try {
    const result = await provider.send(message);
    if (!result?.providerMessageId) throw new Error("Provider did not confirm delivery acceptance.");
    return { ok: true, status: "sent", providerMessageId: result.providerMessageId };
  } catch (error) {
    return { ok: false, status: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "provider_failed" };
  }
}
