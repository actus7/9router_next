"use client";

import { Handle, Position } from "@xyflow/react";
import { DynamicMedia } from "@/shared/components/DynamicMedia";

export interface RouterNodeData {
  activeCount?: number;
}

export function RouterNode({ data }: { data: RouterNodeData }) {
  const powering = (data.activeCount || 0) > 0;
  return (
    <div
      className={`relative z-[1] flex items-center justify-center px-5 py-3 rounded-xl border-2 min-w-[130px] ${
        powering
          ? "topology-router-core border-warning-border bg-gradient-to-br from-primary/30 via-warning/20 to-primary/25"
          : "border-primary bg-primary/5 shadow-md"
      }`}
    >
      <Handle type="source" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />

      <DynamicMedia
        src="/favicon.png"
        alt="ModelHub"
        className={`w-6 h-6 mr-2 ${powering ? "topology-router-icon" : ""}`}
        loading="lazy"
        decoding="async"
      />
      <span className={`text-sm font-bold ${powering ? "topology-router-label text-warning" : "text-primary"}`}>
        ModelHub
      </span>
      {data.activeCount !== undefined && data.activeCount > 0 && (
        <span className="ml-2 px-1.5 py-0.5 rounded-full bg-warning text-warning-foreground text-xs font-bold topology-router-badge">
          {data.activeCount}
        </span>
      )}
    </div>
  );
}
