"use client";

import Image from "next/image";
import { Handle, Position } from "@xyflow/react";

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

      {/* The app icon, same asset the sidebar uses. It was `/favicon.png`
          through DynamicMedia, which is the raw-<img> escape hatch for runtime
          URLs — its own docs say static assets go through next/image. That
          path is also not excluded by the proxy matcher (only `favicon.ico`
          is), so the request went through auth middleware instead of being
          served as a file, and rendered as a broken image. */}
      <Image
        src="/icons/icon-192.png"
        alt="ModelHub"
        width={24}
        height={24}
        className={`w-6 h-6 mr-2 object-contain ${powering ? "topology-router-icon" : ""}`}
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
