import { conversationPrefixKey } from "../host/modelStats";
import { getStickyModel, rememberStickyModel } from "./modelPenalty";

// A large prompt is mostly cache on the model that read it last: moving the
// conversation to another model pays the whole prompt again, cold and slower.
// The warm model rides the sticky store under its own namespace, so it never
// mixes with the adaptive "rescued by" sticky.
const namespace = (comboName: string): string => `${comboName}#warm`;

/** Who "this conversation" is: the client's session id, else its prompt prefix. */
export function cacheAffinityKey(body: Record<string, unknown>, sessionKey: string | undefined): string | undefined {
  return sessionKey ?? conversationPrefixKey(body);
}

/** The model holding the conversation's cache first, when it is still a candidate. */
export function preferWarmModel(models: string[], comboName: string, key: string): string[] {
  const warm = getStickyModel(key, namespace(comboName));
  if (!warm || models[0] === warm || !models.includes(warm)) return models;
  return [warm, ...models.filter((m) => m !== warm)];
}

export function rememberWarmModel(key: string, comboName: string, model: string): void {
  rememberStickyModel(key, namespace(comboName), model);
}
