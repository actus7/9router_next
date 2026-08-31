// Meta AI WS "clippy" gateway protocol — conversation/event id generation,
// binary frame builders, and the captured prompt-frame protobuf templates.
// Ported verbatim from OmniRoute's muse-spark-web.ts.
//
// The two base64 templates below are captured protobuf messages from live
// meta.ai WS traffic. Per OmniRoute's audit note (independently verified
// against two accounts), every field baked into them is a Meta *app-level*
// constant (app id, actor id, locale, user agent) — not a per-user secret.
// Per-user auth is the `ecto_1_sess` cookie and `ecto1:...` bearer token the
// user supplies themselves; this module only patches conversation id, prompt
// text, and timestamps into the template before sending it.

import { Buffer } from "node:buffer";
import { findProtoField, parseProtoFields, serializeProtoFields, traverseAndMutate } from "./protoWire";

export const META_WS_APP_ID = "1522763855472543";
const META_WS_APP_VERSION = "1.0.0";
const META_WS_AUTHTYPE = "15:0";
const META_WS_DGW_VERSION = "5";
const META_WS_DGW_UUID = "0";
const META_WS_TIER = "prod";
const META_WS_INTRO_FRAME_TYPE = 0x0f;
const META_WS_PROMPT_FRAME_TYPE = 0x0d;
const META_WS_PROMPT_FRAME_FLAG = 0x80;
export const META_AI_ROOT_BRANCH_PATH = "0";

const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const META_WS_HOME_TEMPLATE_B64 =
  "CrYGCsQDCiBLQURBQlJBX19IT01FX19VTklGSUVEX0lOUFVUX0JBUhIQMTUyMjc2Mzg1NTQ3MjU0MyInNWE1Yi04ZDRlLWYwNTQtOTllZi1iMmRlLWRiMDItMGQwNS01MmM3KigqJgokOGYxMjliMjUtYzNlMC00NzNiLWFlNzktNWViM2YyNGU1NjRjMAU6C0hVTUFOX0FHRU5UQiIKDzg2NzA1MTMxNDc2NzY5NhIPODY3MDUxMzE0NzY3Njk2UgVFQ1RPMVoRQWJyYSBXZWIgTWFpbiBLZXliCRoDCOgHIgIIAWoITWFjIE9TIFhyCnVzZXJfaW5wdXR6dU1vemlsbGEvNS4wIChNYWNpbnRvc2g7IEludGVsIE1hYyBPUyBYIDEwXzE1XzcpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xNDYuMC4wLjAgU2FmYXJpLzUzNy4zNoIBC2Rlc2t0b3Bfd2VimgFHCkBlMmI4OGY5ODQ2Mzc5Y2JjMjY5NjBmYTNhZTFkMjIyMDFkZmIxOWRmNzg5MGFlNmEzYWM4YTI4ODcwYmFjNjgyFQAAAEASFAi4w6XTk4/yARC4w6XTk4/yARgCGgIgASIAKg4Ix6D+ldkzGJ6g/pXZMzIkZWU3YTM1ZWItZGY4Yy00NzkzLWExYzAtMTBhZTQxNGY1ZTZlOgBKBxIFZW4tVVNScgokNTYwN2Y0YzAtYjljZi00ZjZlLWJlYTYtZTc2N2E1OGJhMjhlGiRlMDliN2FhMC1jYzYwLTQyYTktYjk2OS00YzY1YjViZGZlNGIiJDhmMTI5YjI1LWMzZTAtNDczYi1hZTc5LTVlYjNmMjRlNTY0Y3oRIg9BbWVyaWNhL0NoaWNhZ2+CAQOwAQGSAQwKBnN0b2NrcxICCAGSAQ0KB3dlYXRoZXISAggBkgEkCh5tZXRhX2tub3dsZWRnZV9zZWFyY2hfY2Fyb3VzZWwSAggBkgEiChxtZXRhX2NhdGFsb2dfc2VhcmNoX2Nhcm91c2VsEgIIAZIBEwoNbWVkaWFfZ2FsbGVyeRICCAGiAQEDEpIBCmEKJGFiOWRkNzg5LWRlOGQtNDc5MS05ODE1LWI5YjBmMTU1MDdiNBI3CiQ4ZjEyOWIyNS1jM2UwLTQ3M2ItYWU3OS01ZWIzZjI0ZTU2NGMQyKD+ldkzGKbcxozB/KuyZygBEihIZWxsbyB0aGlzIGlzIGFub3RoZXIgdGVzdCBvZiB5b3VyIHBvd2VyIgMKATA=";
export const META_WS_CHAT_TEMPLATE_B64 =
  "CrIGCsADCiBLQURBQlJBX19DSEFUX19VTklGSUVEX0lOUFVUX0JBUhIQMTUyMjc2Mzg1NTQ3MjU0MyInNWE1Yi04ZDRlLWYwNTQtOTllZi1iMmRlLWRiMDItMGQwNS01MmM3KigqJgokYjA4Mzg1YTYtNWE1My00ZjE0LTk2NmUtMzQ3ZjI4MDg4NDU0MAU6C0hVTUFOX0FHRU5UQiIKDzg2NzA1MTMxNDc2NzY5NhIPODY3MDUxMzE0NzY3Njk2UgVFQ1RPMVoRQWJyYSBXZWIgTWFpbiBLZXliBRoDCOgHaghNYWMgT1MgWHIKdXNlcl9pbnB1dHp1TW96aWxsYS81LjAgKE1hY2ludG9zaDsgSW50ZWwgTWFjIE9TIFggMTBfMTVfNykgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzE0Ni4wLjAuMCBTYWZhcmkvNTM3LjM2ggELZGVza3RvcF93ZWKaAUcKQGUyYjg4Zjk4NDYzNzljYmMyNjk2MGZhM2FlMWQyMjIwMWRmYjE5ZGY3ODkwYWU2YTNhYzhhMjg4NzBiYWM2ODIVAAAAQBIUCLjDpdOTj/IBELjDpdOTj/IBGAIaAiABIgAqDgikgvuW2TMYoYL7ltkzMiRjNmI1ZDI2MS02NjI0LTQ5YWYtOTBjNy0wOWI0NWMwYTZiZWY6AEoHEgVlbi1VU1JyCiQxZDNjZGQzYy1jYTFhLTRlMDItODk1My1kZTBiYTM0NzI5ODkaJDcxODNhMzM0LTFiNWEtNGQyNi1iMjcxLWJjY2Y1NDY2NmJiZiIkYjA4Mzg1YTYtNWE1My00ZjE0LTk2NmUtMzQ3ZjI4MDg4NDU0ehEiD0FtZXJpY2EvQ2hpY2Fnb4IBA7ABAZIBDAoGc3RvY2tzEgIIAZIBDQoHd2VhdGhlchICCAGSASQKHm1ldGFfa25vd2xlZGdlX3NlYXJjaF9jYXJvdXNlbBICCAGSASIKHG1ldGFfY2F0YWxvZ19zZWFyY2hfY2Fyb3VzZWwSAggBkgETCg1tZWRpYV9nYWxsZXJ5EgIIAaIBAQMSlgEKfAokMTc4MDVmYjEtOTY3Zi00YmYyLTlmMjctOWRhYmRhMzYyMTJkEjcKJGIwODM4NWE2LTVhNTMtNGYxNC05NjZlLTM0N2YyODA4ODQ1NBCkgvuW2TMYxN23xoT2rbJnIhtlLjAwcHlKMUtxa3BHTmg5Sk9oWElNdnJRWlYSEWZvbGxvdyB1cCBwcm9iZSAyIgMKATI=";

function encodeBase62(value: bigint, padLength: number): string {
  let remaining = value;
  let encoded = "";
  while (remaining > 0n) {
    encoded = BASE62_ALPHABET[Number(remaining % 62n)] + encoded;
    remaining /= 62n;
  }
  return encoded.padStart(padLength, "0");
}

function decodeBase62(value: string): bigint {
  let decoded = 0n;
  for (const char of value) {
    const index = BASE62_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`Invalid base62 character: ${char}`);
    decoded = decoded * 62n + BigInt(index);
  }
  return decoded;
}

function randomBigInt(byteLength: number): bigint {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let result = 0n;
  for (const byte of bytes) result = (result << 8n) | BigInt(byte);
  return result;
}

export function generateMetaConversationId(): string {
  const timestamp = BigInt(Date.now()) & ((1n << 44n) - 1n);
  const random = randomBigInt(8) & ((1n << 64n) - 1n);
  const packed = (timestamp << 64n) | random;
  return `c.${encodeBase62(packed, 19)}`;
}

export function generateMetaEventId(conversationId: string): string | null {
  if (!conversationId.startsWith("c.")) return null;
  try {
    const packedConversation = decodeBase62(conversationId.slice(2));
    const conversationRandom = packedConversation & ((1n << 64n) - 1n);
    const timestamp = BigInt(Date.now()) & ((1n << 44n) - 1n);
    const eventRandom = randomBigInt(4) & ((1n << 32n) - 1n);
    const packedEvent = (timestamp << (64n + 32n)) | (conversationRandom << 32n) | eventRandom;
    return `e.${encodeBase62(packedEvent, 25)}`;
  } catch {
    return null;
  }
}

function writeU24Le(value: number, arr: Uint8Array, offset: number): void {
  arr[offset] = value & 0xff;
  arr[offset + 1] = (value >> 8) & 0xff;
  arr[offset + 2] = (value >> 16) & 0xff;
}

export function buildWsIntroFrame(conversationId: string): Uint8Array {
  const payload = new TextEncoder().encode(
    JSON.stringify({
      "x-dgw-app-x-ecto-conversation-id": conversationId,
      "x-dgw-app-client-payload-type": "PROTO_INSIDE_JSON",
    })
  );
  const header = new Uint8Array(6);
  header[0] = META_WS_INTRO_FRAME_TYPE;
  header[1] = 0;
  header[2] = 0;
  writeU24Le(payload.length, header, 3);
  const result = new Uint8Array(header.length + payload.length);
  result.set(header);
  result.set(payload, header.length);
  return result;
}

export function buildWsPromptFrame(
  prompt: string,
  conversationId: string,
  opts: { templateB64: string; requestId?: string; userMessageId?: string; submittedMs?: number; uniqueMessageId?: number; subSessionIdx?: number; messageSeq?: number }
): Uint8Array {
  const requestId = opts.requestId || crypto.randomUUID();
  const userMessageId = opts.userMessageId || crypto.randomUUID();
  const submittedMs = opts.submittedMs ?? Date.now();
  const uniqueMessageId = opts.uniqueMessageId ?? Number(`${submittedMs}${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`);

  const raw = Buffer.from(opts.templateB64, "base64");
  const protoFields = parseProtoFields(raw);

  traverseAndMutate(protoFields, [1, 1], (f) => {
    const nested = parseProtoFields(f.value instanceof Uint8Array ? f.value : new Uint8Array());
    const field5 = findProtoField(nested, 5);
    if (field5) field5.value = new TextEncoder().encode(conversationId);
    f.value = serializeProtoFields(nested);
  });
  traverseAndMutate(protoFields, [2, 1], (f) => {
    const nested = parseProtoFields(f.value instanceof Uint8Array ? f.value : new Uint8Array());
    const field1 = findProtoField(nested, 1);
    if (field1) field1.value = new TextEncoder().encode(userMessageId);
    f.value = serializeProtoFields(nested);
  });
  traverseAndMutate(protoFields, [2, 1, 2], (f) => {
    const nested = parseProtoFields(f.value instanceof Uint8Array ? f.value : new Uint8Array());
    const f1 = findProtoField(nested, 1);
    const f2 = findProtoField(nested, 2);
    const f3 = findProtoField(nested, 3);
    if (f1) f1.value = new TextEncoder().encode(conversationId);
    if (f2) f2.value = submittedMs;
    if (f3) f3.value = uniqueMessageId;
    f.value = serializeProtoFields(nested);
  });
  traverseAndMutate(protoFields, [2], (f) => {
    const nested = parseProtoFields(f.value instanceof Uint8Array ? f.value : new Uint8Array());
    const field2 = findProtoField(nested, 2);
    if (field2) field2.value = new TextEncoder().encode(prompt);
    f.value = serializeProtoFields(nested);
  });
  traverseAndMutate(protoFields, [1, 5], (f) => {
    const nested = parseProtoFields(f.value instanceof Uint8Array ? f.value : new Uint8Array());
    const f1 = findProtoField(nested, 1);
    const f3 = findProtoField(nested, 3);
    if (f1) f1.value = submittedMs + 1;
    if (f3) f3.value = submittedMs;
    f.value = serializeProtoFields(nested);
  });
  traverseAndMutate(protoFields, [1], (f) => {
    const nested = parseProtoFields(f.value instanceof Uint8Array ? f.value : new Uint8Array());
    const field6 = findProtoField(nested, 6);
    if (field6) field6.value = new TextEncoder().encode(requestId);
    f.value = serializeProtoFields(nested);
  });
  traverseAndMutate(protoFields, [1, 10], (f) => {
    const nested = parseProtoFields(f.value instanceof Uint8Array ? f.value : new Uint8Array());
    const field4 = findProtoField(nested, 4);
    if (field4) field4.value = new TextEncoder().encode(conversationId);
    f.value = serializeProtoFields(nested);
  });

  const updatedB64 = Buffer.from(serializeProtoFields(protoFields)).toString("base64");
  const outer = JSON.stringify({ "req-id": requestId, payload: updatedB64 });
  const inner = new TextEncoder().encode(outer);
  const subSessionIdx = opts.subSessionIdx || 0;
  const messageSeq = opts.messageSeq || 0;

  const msgBody = new Uint8Array(2 + inner.length);
  msgBody[0] = messageSeq;
  msgBody[1] = META_WS_PROMPT_FRAME_FLAG;
  msgBody.set(inner, 2);

  const header = new Uint8Array(6);
  header[0] = META_WS_PROMPT_FRAME_TYPE;
  header[1] = subSessionIdx & 0xff;
  header[2] = (subSessionIdx >> 8) & 0xff;
  writeU24Le(msgBody.length, header, 3);

  const frame = new Uint8Array(header.length + msgBody.length);
  frame.set(header);
  frame.set(msgBody, header.length);
  return frame;
}

export function buildWsUrl(authorization: string, requestId: string): string {
  const params = new URLSearchParams({
    "x-dgw-appid": META_WS_APP_ID,
    "x-dgw-appversion": META_WS_APP_VERSION,
    "x-dgw-authtype": META_WS_AUTHTYPE,
    "x-dgw-version": META_WS_DGW_VERSION,
    "x-dgw-uuid": META_WS_DGW_UUID,
    "x-dgw-tier": META_WS_TIER,
    Authorization: authorization,
    "x-dgw-app-origin": "meta.ai",
    "x-dgw-app-clippy-request-id": requestId,
    "x-dgw-app-clippy-async": "true",
  });
  return `wss://gateway.meta.ai/ws/clippy?${params.toString()}`;
}
