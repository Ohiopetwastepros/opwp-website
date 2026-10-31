export async function readBoundedBytes(message, maxBytes) {
  if (Number(message.headers.get("content-length") || 0) > maxBytes) throw new RangeError("Body too large");
  if (!message.body) return new Uint8Array();
  const reader = message.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new RangeError("Body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readBoundedProviderJson(response, maxBytes = 128 * 1024) {
  return JSON.parse(new TextDecoder().decode(await readBoundedBytes(response, maxBytes)));
}
