export class ProviderRequestError extends Error {
  constructor(provider, operation, classification, status = 0) {
    super(`${provider} ${operation} failed (${classification}${status ? `:${status}` : ""}).`);
    this.name = "ProviderRequestError";
    this.provider = provider;
    this.operation = operation;
    this.classification = classification;
    this.status = status;
  }
}

export async function outboundFetch(url, options = {}, context = {}) {
  const { provider = "external", operation = "request", timeoutMs = 10000, retries = 0, retryable = false } = context;
  const maxAttempts = retryable ? Math.min(Math.max(Number(retries) || 0, 0), 2) + 1 : 1;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(timeoutMs, 1000), 30000));
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (retryable && [429, 502, 503, 504].includes(response.status) && attempt < maxAttempts) continue;
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        const classification = error?.name === "AbortError" ? "timeout" : "network";
        console.error(JSON.stringify({ event: "outbound_request_failed", provider, operation, classification, attempt }));
        throw new ProviderRequestError(provider, operation, classification);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}
