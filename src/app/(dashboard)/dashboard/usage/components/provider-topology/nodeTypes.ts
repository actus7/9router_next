import type { ComponentType } from "react";
import { ProviderNode } from "./sections/ProviderNode";
import { RouterNode } from "./sections/RouterNode";
import { TopologyEdge } from "./sections/TopologyEdge";

export const nodeTypes = { provider: ProviderNode, router: RouterNode };
export const edgeTypes = { topology: TopologyEdge } as Record<string, ComponentType<Record<string, unknown>>>;
