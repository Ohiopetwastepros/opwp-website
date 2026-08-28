import { getRuntimeEnv } from "./cloudflare";

export function notificationProvider() {
  const env = getRuntimeEnv();
  const name = String(env.SMS_PROVIDER || "unconfigured").toLowerCase();
  if (name === "quo") {
    return {
      name,
      configured: Boolean(env.QUO_API_KEY && env.QUO_FROM_NUMBER),
      credentialsPresent: Boolean(env.QUO_API_KEY && env.QUO_FROM_NUMBER),
      async send(message) {
        const response = await fetch(new URL("/v1/messages", env.QUO_API_BASE_URL || "https://api.openphone.com"), {
          method: "POST",
          headers: { Authorization: env.QUO_API_KEY, Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ content: message.text, from: env.QUO_FROM_NUMBER, to: [message.to] }),
        });
        const data = await response.json().catch(() => ({}));
        const providerMessageId = data?.data?.id || data?.id;
        if (!response.ok || !providerMessageId) throw new Error(`Quo did not accept the message (${response.status}).`);
        return { providerMessageId };
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
