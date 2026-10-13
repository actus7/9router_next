import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { getProviderAlias } from "@/shared/constants/providers";
import { filterAllowed, layersAllow, layersRestrict, type AccessField, type AccessPolicy } from "@/shared/access/accessPolicy";
import { buildErrorBody } from "@/server/llm-gateway/engine/utils/error";
import { HTTP_STATUS } from "@/server/llm-gateway/engine/config/runtimeConfig";
import { getModelInfo } from "./modelResolution";

/**
 * The access layers the current request runs under, set by whoever knows where
 * it came from — the same rule as the gateway profile, never the body:
 * - `gatewayRoute`: organization + the key owner's member policy + the key's;
 * - the chat worker: organization + the member who sent the turn;
 * - a dashboard route: organization + the signed-in member.
 *
 * No scope means an internal caller, and no restriction.
 */
interface AccessScope {
  layers: readonly AccessPolicy[];
  /**
   * Set while a request that already passed the model check routes internally:
   * an allowed combo hands its own members to the same handler, and those are
   * the organization's routing decision, not the caller's request.
   */
  modelAuthorized: boolean;
}

const accessStorage: AsyncLocalStorage<AccessScope> = new AsyncLocalStorage<AccessScope>();

export function withAccessLayers<T>(layers: readonly AccessPolicy[], fn: () => T): T {
  return accessStorage.run({ layers, modelAuthorized: false }, fn);
}

export function currentAccessLayers(): readonly AccessPolicy[] {
  return accessStorage.getStore()?.layers ?? [];
}

/** `ids` minus what the current scope forbids (plugins, skills). */
export function filterByAccess(field: AccessField, ids: readonly string[]): string[] {
  return filterAllowed(currentAccessLayers(), field, ids);
}

export function isAllowedByAccess(field: AccessField, id: string): boolean {
  return layersAllow(currentAccessLayers(), field, [id]);
}

/** Every spelling of a requested model a policy may have been written in. */
async function modelSpellings(modelStr: string): Promise<string[]> {
  const spellings = [modelStr];
  const info = await getModelInfo(modelStr).catch(() => null);
  if (info?.provider) {
    spellings.push(`${info.provider}/${info.model}`);
    const alias = getProviderAlias(info.provider);
    if (alias && alias !== info.provider) spellings.push(`${alias}/${info.model}`);
  }
  return spellings;
}

/** Whether the current scope lets the caller ask for `modelStr`. */
export async function isModelAllowed(modelStr: string): Promise<boolean> {
  const layers = currentAccessLayers();
  if (!layersRestrict(layers, "models")) return true;
  // The cheap check first: most policies are written the way clients call.
  if (layersAllow(layers, "models", [modelStr])) return true;
  return layersAllow(layers, "models", await modelSpellings(modelStr));
}

/**
 * Guard for a handler's entry: a 403 naming the model when the caller may not
 * ask for it, else null. Fails closed — it is a permission, not a preference
 * like `assertModelEnabled`.
 */
export async function assertModelAllowed(modelStr: string): Promise<Response | null> {
  const scope = accessStorage.getStore();
  if (!scope || scope.modelAuthorized) return null;
  if (await isModelAllowed(modelStr)) return null;
  // Its own code: the generic 403 body says `insufficient_quota`, which a client
  // reads as "top up" — the opposite of "ask an admin for this model".
  const body = buildErrorBody(HTTP_STATUS.FORBIDDEN, `Model ${modelStr} is not allowed for this key or user`);
  return Response.json(
    { error: { ...body.error, code: "model_not_allowed" } },
    { status: HTTP_STATUS.FORBIDDEN, headers: { "Access-Control-Allow-Origin": "*" } },
  );
}

/**
 * Runs an internal re-entry of a handler (an allowed combo routing to one of
 * its members) without checking the member against the caller's policy.
 */
export function runModelAuthorized<T>(fn: () => T): T {
  const scope = accessStorage.getStore();
  if (!scope) return fn();
  return accessStorage.run({ ...scope, modelAuthorized: true }, fn);
}
