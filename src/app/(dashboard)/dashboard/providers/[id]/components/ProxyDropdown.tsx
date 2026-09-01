"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Network } from "lucide-react";

interface ProxyPool {
  id: string;
  name: string;
  isActive?: boolean;
}

interface ProxyDropdownProps {
  proxyPools: ProxyPool[];
  boundProxyPoolId: string | null;
  hasAnyProxy: boolean;
  onUpdateProxy?: (proxyPoolId: string | null) => Promise<void>;
}

export default function ProxyDropdown({
  proxyPools,
  boundProxyPoolId,
  hasAnyProxy,
  onUpdateProxy,
}: ProxyDropdownProps) {
  const [showProxyDropdown, setShowProxyDropdown] = useState<boolean>(false);
  const [updatingProxy, setUpdatingProxy] = useState<boolean>(false);
  const proxyDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showProxyDropdown) return;
    const handler = (e: MouseEvent) => {
      if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target as Node)) {
        setShowProxyDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown]);

  const handleSelectProxy = async (poolId: string) => {
    setUpdatingProxy(true);
    try {
      await onUpdateProxy?.(poolId === "__none__" ? null : poolId);
    } finally {
      setUpdatingProxy(false);
      setShowProxyDropdown(false);
    }
  };

  if (proxyPools.length === 0) return null;

  return (
    <div className="relative" ref={proxyDropdownRef}>
      <Button
        variant="ghost"
        onClick={() => setShowProxyDropdown((v) => !v)}
        className={`w-full flex-col ${hasAnyProxy ? "text-primary" : ""}`}
        disabled={updatingProxy}
      >
        <span className="text-[18px]">
          {updatingProxy ? <Loader2 className="size-[18px] animate-spin" /> : <Network className="size-[18px]" />}
        </span>
        <span className="text-[10px] leading-tight">Proxy</span>
      </Button>
      {showProxyDropdown && (
        <div className="absolute right-0 top-full z-50 mt-1 max-w-[78vw] min-w-[160px] rounded-lg border border-border bg-bg py-1 shadow-lg">
          <Button
            variant="ghost"
            onClick={() => handleSelectProxy("__none__")}
            className={`w-full justify-start ${!boundProxyPoolId ? "text-primary font-medium" : ""}`}
          >
            None
          </Button>
          {proxyPools.map((pool) => (
            <Button
              key={pool.id}
              variant="ghost"
              onClick={() => handleSelectProxy(pool.id)}
              className={`w-full justify-start ${boundProxyPoolId === pool.id ? "text-primary font-medium" : ""}`}
            >
              {pool.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
