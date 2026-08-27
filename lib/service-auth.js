import { getRuntimeEnv } from "./cloudflare";

function bytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function verifyFinancialOsRequest(request) {
  const expected = getRuntimeEnv().FINANCIAL_OS_SYNC_TOKEN;
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!expected || !supplied) return false;
  return bytesEqual(await digest(supplied), await digest(expected));
}
