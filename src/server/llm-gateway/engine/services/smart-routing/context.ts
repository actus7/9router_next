import type { RoutingDecisionMeta } from "./types";

const SMART_ROUTING_META = Symbol.for("routerx.smart-routing.meta");

type RoutingBody = Record<string | symbol, unknown>;

export function attachRoutingDecision<T extends Record<string, unknown>>(body: T, meta: RoutingDecisionMeta): T {
  (body as RoutingBody)[SMART_ROUTING_META] = meta;
  return body;
}

export function getRoutingDecision(body: Record<string, unknown> | null | undefined): RoutingDecisionMeta | null {
  if (!body) return null;
  return ((body as RoutingBody)[SMART_ROUTING_META] as RoutingDecisionMeta | undefined) || null;
}

