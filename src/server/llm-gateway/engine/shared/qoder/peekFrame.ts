import "server-only";

/**
 * Billing-block detection and first-frame peek for the qoder SSE envelope.
 *
 * Extracted from `executors/qoder.ts`, which the 600-line architecture gate
 * had grown past. Nothing here touches executor state.
 */

/**
 * Check if a qoder error message indicates a billing/quota block.
 * Signatures: code 112 (quota exhausted), code 10605 (queue throttle), pricingUrl field.
 */
function isBillingBlock(inner: string) {
  if (!inner || typeof inner !== "string") return false;
  const lowerMsg = inner.toLowerCase();
  // Match: {"code":"112",...}, {"code":"10605",...}, or pricingUrl field
  return /\"code\"\s*:\s*\"(112|10605)\"/.test(inner) || lowerMsg.includes("pricingurl");
}

/** Stop peeking once this much has been buffered without a usable frame. */
const QODER_PEEK_MAX_BYTES = 256 * 1024;

/**
 * Peek the first SSE frame to detect billing errors before piping.
 * Returns { isBilling, statusVal, message, consumed } — `consumed` is every
 * byte read so far (including the peeked line) so the caller can re-process
 * it and nothing is dropped from the stream.
 */
export async function peekFirstQoderFrame(reader: ReadableStreamDefaultReader<Uint8Array>, decoder: TextDecoder) {
  let consumed = "";
  // Where the next unexamined line starts. Without it the newline search kept
  // returning the same first newline, so a leading `: ping` or `event:` line
  // made the scan read until the upstream closed — the whole response buffered
  // before the client saw a byte. `consumed` is still returned intact: the
  // caller replays it through the real transform.
  let scanned = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return { isBilling: false, consumed, upstreamDone: true };

    consumed += decoder.decode(value, { stream: true });

    for (;;) {
      const nl = consumed.indexOf("\n", scanned);
      if (nl === -1) break;
      const line = consumed.slice(scanned, nl).replace(/\r$/, "").trim();
      scanned = nl + 1;
      if (!line.startsWith("data:")) continue;

      const data = line.slice(5).trimStart();
      if (data === "[DONE]") return { isBilling: false, consumed };

      let envelope;
      try { envelope = JSON.parse(data); } catch { return { isBilling: false, consumed }; }

      const statusVal = typeof envelope.statusCodeValue === "number" ? envelope.statusCodeValue : 200;
      const inner = typeof envelope.body === "string" ? envelope.body : "";

      if (statusVal !== 200 && isBillingBlock(inner)) {
        return { isBilling: true, statusVal, message: inner || `qoder billing block (${statusVal})` };
      }
      return { isBilling: false, consumed };
    }

    // A 200 carrying HTML (WAF, captive portal) has no `data:` line at all.
    if (consumed.length > QODER_PEEK_MAX_BYTES) return { isBilling: false, consumed };
  }
}
