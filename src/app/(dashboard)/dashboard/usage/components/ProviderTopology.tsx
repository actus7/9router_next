"use client";

import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
  ReactFlow,
  Controls,
  type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { translate } from "@/i18n/runtime";
import { FE_ACTIVE_TICK_MS, FE_ACTIVE_TIMEOUT_MS } from "./provider-topology/constants";
import { edgeTypes, nodeTypes } from "./provider-topology/nodeTypes";
import { buildLayout } from "./provider-topology/topologyLayout";

interface ProviderTopologyProps {
  providers?: Array<{ id?: string; provider: string; name?: string; nodeName?: string }>;
  activeRequests?: Array<{ provider?: string; model?: string; account?: string }>;
  lastProvider?: string;
  errorProvider?: string;
}

export default function ProviderTopology({ providers = [], activeRequests = [], lastProvider = "", errorProvider = "" }: ProviderTopologyProps) {
  const activeKey = useMemo(
    () => activeRequests.map((r) => r.provider?.toLowerCase()).filter(Boolean).sort().join(","),
    [activeRequests],
  );
  const lastKey = lastProvider?.toLowerCase() || "";
  const errorKey = errorProvider?.toLowerCase() || "";

  const rawActiveSet = useMemo(() => new Set(activeKey ? activeKey.split(",") : []), [activeKey]);
  const lastSet = useMemo(() => new Set(lastKey ? [lastKey] : []), [lastKey]);
  const errorSet = useMemo(() => new Set(errorKey ? [errorKey] : []), [errorKey]);

  const firstSeenRef = useRef<Record<string, number>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const seen = firstSeenRef.current;
    const now = Date.now();
    for (const p of rawActiveSet) {
      if (!seen[p]) seen[p] = now;
    }
    for (const p of Object.keys(seen)) {
      if (!rawActiveSet.has(p)) delete seen[p];
    }
  }, [rawActiveSet]);

  useEffect(() => {
    if (rawActiveSet.size === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), FE_ACTIVE_TICK_MS);
    return () => clearInterval(id);
  }, [rawActiveSet]);

  const activeSet = useMemo(() => {
    void tick;
    const now = Date.now();
    const filtered = new Set<string>();
    for (const p of rawActiveSet) {
      const ts = firstSeenRef.current[p];
      if (!ts || now - ts < FE_ACTIVE_TIMEOUT_MS) filtered.add(p);
    }
    return filtered;
  }, [rawActiveSet, tick]);

  const { nodes, edges } = useMemo(
    () => buildLayout(providers, activeSet, lastSet, errorSet),
    [providers, activeSet, lastSet, errorSet],
  );

  const providersKey = useMemo(
    () => providers.map((p) => p.provider).sort().join(","),
    [providers],
  );

  const rfInstance = useRef<{ fitView: (opts?: Record<string, unknown>) => void } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fitOpts = useMemo(() => ({ padding: 0.2, duration: 200 }), []);
  const onInit = useCallback((instance: { fitView: (opts?: Record<string, unknown>) => void }) => {
    rfInstance.current = instance;
    setTimeout(() => instance.fitView(fitOpts as unknown as Record<string, unknown>), 50);
  }, [fitOpts]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (rfInstance.current) rfInstance.current.fitView(fitOpts as unknown as Record<string, unknown>);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitOpts]);

  useEffect(() => {
    if (rfInstance.current) {
      const id = setTimeout(() => rfInstance.current?.fitView(fitOpts as unknown as Record<string, unknown>), 50);
      return () => clearTimeout(id);
    }
  }, [fitOpts, nodes.length]);

  return (
    <div ref={containerRef} className="h-[320px] w-full min-w-0 rounded-lg border border-border bg-bg-subtle/30 sm:h-[480px]">
      {providers.length === 0 ? (
        <div className="h-full flex items-center justify-center text-text-muted text-sm">
          {translate("No providers connected")}
        </div>
      ) : (
        <ReactFlow
          key={providersKey}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes as EdgeTypes}
          fitView
          fitViewOptions={fitOpts}
          minZoom={0.1}
          maxZoom={2}
          onInit={onInit}
          proOptions={{ hideAttribution: true }}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick
          preventScrolling={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Controls showInteractive={false} className="react-flow-controls-custom" />
        </ReactFlow>
      )}
    </div>
  );
}
