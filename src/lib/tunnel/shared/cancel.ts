import type { CancelToken } from "./types";

export function throwIfCancelled(token: CancelToken, label = "cancelled"): void {
  if (token.cancelled) throw new Error(label);
}
