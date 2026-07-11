import { getCloudflareContext } from "@opennextjs/cloudflare";

export function getRuntimeEnv() {
  try {
    return getCloudflareContext().env;
  } catch {
    return process.env;
  }
}
