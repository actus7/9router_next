import { makeKv } from "../helpers/kvStore";
import { decryptSecret, encryptSecret } from "../helpers/credentialCipher";

// Keys for the decision engine that are not a provider connection: a Jev key
// issued by TypeSafe itself (console.typesafe.ai) has no provider page to live
// on. Per account, like every row, and encrypted at rest with the same cipher
// as provider credentials (CREDENTIAL_KEY).
const keysKv = makeKv("decisionKeys");
const TYPESAFE = "typesafe";

export async function getTypesafeKey(): Promise<string | null> {
  const stored = await keysKv.get<string>(TYPESAFE);
  if (typeof stored !== "string" || !stored) return null;
  return decryptSecret(stored) ?? null;
}

export async function hasTypesafeKey(): Promise<boolean> {
  return (await getTypesafeKey()) !== null;
}

export async function saveTypesafeKey(apiKey: string): Promise<void> {
  await keysKv.set(TYPESAFE, encryptSecret(apiKey));
}

export async function removeTypesafeKey(): Promise<void> {
  await keysKv.remove(TYPESAFE);
}
