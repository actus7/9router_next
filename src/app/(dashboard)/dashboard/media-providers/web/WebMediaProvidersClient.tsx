"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { AI_PROVIDERS, getProvidersByKind } from "@/shared/constants/providers";
import { ChevronRight, Globe, Layers, Plus, Search } from "lucide-react";
import { useNotificationStore } from "@/store/notificationStore";

interface Connection {
  provider: string;
  isActive?: boolean;
  testStatus?: string;
  [key: string]: unknown;
}

interface Provider {
  id: string;
  name: string;
  color?: string;
  textIcon?: string;
  noAuth?: boolean;
}

interface Combo {
  id: string;
  name: string;
  kind?: string;
  models: string[];
}

function getEffectiveStatus(conn: Connection) { return conn.testStatus; }

function ProviderCard({ provider, kind, connections }: { provider: Provider; kind: string; connections: Connection[] }) {
  const providerInfo = AI_PROVIDERS[provider.id];
  const isNoAuth = !!providerInfo?.noAuth;
  const providerConns = connections.filter((c) => c.provider === provider.id);
  const connected = providerConns.filter((c) => { const s = getEffectiveStatus(c); return s === "active" || s === "success"; }).length;
  const error = providerConns.filter((c) => { const s = getEffectiveStatus(c); return s === "error" || s === "expired" || s === "unavailable"; }).length;
  const total = providerConns.length;
  const allDisabled = total > 0 && providerConns.every((c) => c.isActive === false);

  const renderStatus = () => {
    if (isNoAuth) return <Badge variant="success">Ready</Badge>;
    if (allDisabled) return <Badge variant="secondary" >Disabled</Badge>;
    if (total === 0) return <span className="text-xs text-text-muted">No connections</span>;
    return (
      <>
        {connected > 0 && <Badge variant="success">{connected} Connected</Badge>}
        {error > 0 && <Badge variant="destructive">{error} Error</Badge>}
        {connected === 0 && error === 0 && <Badge variant="secondary" >{total} Added</Badge>}
      </>
    );
  };

  return (
    <Link href={`/dashboard/media-providers/${kind}/${provider.id}`} className="group">
      <Card padding="xs" className={`h-full hover:bg-black/[0.01] dark:hover:bg-white/[0.01] transition-colors cursor-pointer ${allDisabled ? "opacity-50" : ""}`}>
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="size-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${(provider.color?.length ?? 0) > 7 ? provider.color : (provider.color ?? "#888") + "15"}` }}
          >
            <ProviderIcon
              src={`/providers/${provider.id}.png`}
              alt={provider.name}
              size={30}
              className="object-contain rounded-lg max-w-[30px] max-h-[30px]"
              fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
              fallbackColor={provider.color}
            />
          </div>
          <div>
            <h3 className="font-semibold text-sm">{provider.name}</h3>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">{renderStatus()}</div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function ComboList({ combos }: { combos: Combo[] }) {
  if (combos.length === 0) {
    return <p className="text-xs text-text-muted italic">No combos yet.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {combos.map((combo) => (
        <Link key={combo.id} href={`/dashboard/media-providers/combo/${combo.id}`}>
          <Card padding="xs" className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer">
            <div className="flex min-w-0 items-center gap-3">
              <Layers className="size-5" />
              <code className="text-sm font-mono font-medium flex-1 truncate">{combo.name}</code>
              {/* Provider icons preview */}
              <div className="flex flex-wrap items-center gap-1 sm:shrink-0">
                {combo.models.slice(0, 6).map((entry, i) => {
                  const pid = typeof entry === "string" ? entry.split("/")[0] : "";
                  const p = AI_PROVIDERS[pid] as { name?: string; color?: string; textIcon?: string } | undefined;
                  return (
                    <div key={`${entry}-${i}`} title={p?.name || entry} className="size-5 rounded flex items-center justify-center" style={{ backgroundColor: `${(p?.color ?? "#888")}15` }}>
                      <ProviderIcon
                        src={`/providers/${pid}.png`}
                        alt={p?.name || pid}
                        size={18}
                        className="object-contain rounded max-w-[18px] max-h-[18px]"
                        fallbackText={p?.textIcon || pid.slice(0, 2).toUpperCase()}
                        fallbackColor={p?.color}
                      />
                    </div>
                  );
                })}
                {combo.models.length > 6 && (
                  <span className="text-[10px] text-text-muted ml-1">+{combo.models.length - 6}</span>
                )}
              </div>
              <span className="text-[11px] text-text-muted shrink-0">{combo.models.length}</span>
              <ChevronRight className="size-4" />
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function Section({ title, icon, kind, providers, connections, combos, onCreateCombo }: {
  title: string;
  icon: React.ReactNode;
  kind: string;
  providers: Provider[];
  connections: Connection[];
  combos: Combo[];
  onCreateCombo: () => void;
}) {
  return (
    <div>
      {/* Header — title left, Create Combo right */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-primary">{icon}</span>
          <h2 className="text-base font-semibold">{title}</h2>
          <span className="text-xs text-text-muted">({providers.length} providers · {combos.length} combos)</span>
        </div>
        <Button icon={<Plus className="size-4" />} onClick={onCreateCombo}>Create Combo</Button>
      </div>

      {/* Combos — top */}
      {combos.length > 0 && (
        <div className="mb-4">
          <ComboList combos={combos} />
        </div>
      )}

      {/* Providers grid — bottom */}
      {providers.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-border rounded-xl text-text-muted text-sm">
          No providers.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {providers.map((p) => (
            <ProviderCard key={p.id} provider={p} kind={kind} connections={connections} />
          ))}
        </div>
      )}
    </div>
  );
}

interface WebMediaProvidersClientProps {
  initialConnections: Connection[];
  initialCombos: Combo[];
}

export default function WebMediaProvidersClient({ initialConnections, initialCombos }: WebMediaProvidersClientProps) {
  const notify = useNotificationStore();
  const router = useRouter();
  const [connections, ] = useState<Connection[]>(initialConnections);
  const [combos, ] = useState<Combo[]>(initialCombos);

  const searchProviders = getProvidersByKind("webSearch") as unknown as Provider[];
  const fetchProviders = getProvidersByKind("webFetch") as unknown as Provider[];
  const searchCombos = combos.filter((c) => c.kind === "webSearch");
  const fetchCombos = combos.filter((c) => c.kind === "webFetch");

  const handleCreateCombo = async (kind: string) => {
    // Generate unique default name
    const base = kind === "webSearch" ? "search-combo" : "fetch-combo";
    let name = base;
    let i = 1;
    const existing = new Set(combos.map((c) => c.name));
    while (existing.has(name)) { name = `${base}-${i++}`; }
    const res = await fetch("/api/combos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, models: [], kind }),
    });
    if (res.ok) {
      const created = await res.json();
      router.push(`/dashboard/media-providers/combo/${created.id}`);
    } else {
      const err = await res.json();
      notify.error(err.error || "Failed to create combo");
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Web Search" icon={<Search className="size-4" />} kind="webSearch"
        providers={searchProviders} connections={connections} combos={searchCombos}
        onCreateCombo={() => handleCreateCombo("webSearch")}
      />

      {/* Divider between sections */}
      <div className="border-t border-border" />

      <Section
        title="Web Fetch" icon={<Globe className="size-4" />} kind="webFetch"
        providers={fetchProviders} connections={connections} combos={fetchCombos}
        onCreateCombo={() => handleCreateCombo("webFetch")}
      />
    </div>
  );
}
