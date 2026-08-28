"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import Drawer from "@/shared/components/Drawer";
import Pagination from "@/shared/components/Pagination";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ArrowLeftFromLine, ArrowRightToLine, Brain, ChevronRight, Code2, Image as ImageIcon, Languages, Loader2 } from "lucide-react";

interface TokenUsage {
  cached_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  prompt_tokens?: number;
  input_tokens?: number;
  completion_tokens?: number;
}

interface PxPipeInfo {
  applied?: boolean;
  tokensBeforeEst?: number;
  tokensAfterEst?: number;
  savedPct?: number;
  imageCount?: number;
  durationMs?: number;
  reason?: string;
  detail?: string;
}

interface RoutingInfo {
  need?: string;
  tier?: string;
  confidence?: number;
  reason?: string;
  candidates?: string[];
  degraded?: boolean;
}

interface RequestDetail {
  id: string;
  timestamp: string;
  model: string;
  provider: string;
  tokens?: TokenUsage;
  latency?: { ttft?: number; total?: number };
  status?: string;
  pxpipe?: PxPipeInfo;
  request?: { routing?: RoutingInfo; [key: string]: unknown };
  providerRequest?: unknown;
  providerResponse?: string | Record<string, unknown>;
  response?: { thinking?: string; content?: string };
}

let providerNameCache: Record<string, string | { name?: string }> | null = null;
let providerNodesCache: Record<string, string> | null = null;

async function fetchProviderNames() {
  if (providerNameCache && providerNodesCache) {
    return { providerNameCache, providerNodesCache };
  }

  const nodesRes = await fetch("/api/provider-nodes");
  const nodesData = await nodesRes.json();
  const nodes = nodesData.nodes || [];
  providerNodesCache = {};

  for (const node of nodes) {
    providerNodesCache[node.id] = node.name;
  }

  providerNameCache = {
    ...AI_PROVIDERS,
    ...providerNodesCache
  };

  return { providerNameCache, providerNodesCache };
}

function getProviderName(providerId: string, cache: Record<string, string | { name?: string }> | null): string {
  if (!providerId) return providerId;
  if (!cache) return providerId;

  const cached = cache[providerId];

  if (typeof cached === 'string') {
    return cached;
  }

  if (cached?.name) {
    return cached.name;
  }

  const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
  const name = providerConfig?.name;
  return (typeof name === 'string' ? name : null) || providerId;
}

function CollapsibleSection({ title, children, defaultOpen = false, icon = null }: { title: string; children: React.ReactNode; defaultOpen?: boolean; icon?: string | null }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border border-black/5 dark:border-white/5 rounded-lg overflow-hidden">
      <CollapsibleTrigger
        className="w-full flex items-center justify-between p-3 bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] cursor-pointer"
      >
        <div className="flex items-center gap-2">
          {icon && <span className="text-text-muted">{(() => {
            const iconMap: Record<string, React.ElementType> = {
              input: ArrowRightToLine,
              translate: Languages,
              data_object: Code2,
              output: ArrowLeftFromLine,
            };
            const IconComp = iconMap[icon] || Code2;
            return <IconComp className="size-[18px]" />;
          })()}</span>}
          <span className="font-semibold text-sm text-text-main">{title}</span>
        </div>
        <ChevronRight className="size-5 text-text-muted transition-transform duration-200 [[data-open]>&]:rotate-90" />
      </CollapsibleTrigger>
      
      <CollapsibleContent className="p-4 border-t border-black/5 dark:border-white/5">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function getCachedTokens(tokens: TokenUsage | null | undefined): number {
  return tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0;
}

function getCacheCreationTokens(tokens: TokenUsage | null | undefined): number {
  return tokens?.cache_creation_input_tokens || 0;
}

function getInputTokens(tokens: TokenUsage | null | undefined): number {
  const prompt = tokens?.prompt_tokens || tokens?.input_tokens || 0;
  // Canonical storage keeps prompt cache-inclusive. Legacy Claude rows may have
  // stored prompt cache-exclusive; fall back to cache when it's larger so old
  // rows don't under-report input.
  const cache = getCachedTokens(tokens);
  return prompt < cache ? cache : prompt;
}

export default function RequestDetailsTab() {
  const [details, setDetails] = useState<RequestDetail[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0
  });
  const [loading, setLoading] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<RequestDetail | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([]);
  const [providerNameCache, setProviderNameCache] = useState<Record<string, string | { name?: string }> | null>(null);
  const [filters, setFilters] = useState({
    provider: "",
    startDate: "",
    endDate: ""
  });

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/providers");
      const data = await res.json();
      setProviders(data.providers || []);

      const cache = await fetchProviderNames();
      setProviderNameCache(cache.providerNameCache);
    } catch (error) {
      console.error("Failed to fetch providers:", error);
    }
  }, []);

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        pageSize: pagination.pageSize.toString()
      });
      if (filters.provider) params.append("provider", filters.provider);
      if (filters.startDate) params.append("startDate", filters.startDate);
      if (filters.endDate) params.append("endDate", filters.endDate);

      const res = await fetch(`/api/usage/request-details?${params}`);
      const data = await res.json();

      setDetails(data.details || []);
      setPagination(prev => ({ ...prev, ...data.pagination }));
    } catch (error) {
      console.error("Failed to fetch request details:", error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, filters]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const handleViewDetail = (detail: RequestDetail) => {
    setSelectedDetail(detail);
    setIsDrawerOpen(true);
  };

  const handlePageChange = (newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPagination(prev => ({ ...prev, pageSize: newPageSize, page: 1 }));
  };

  const handleClearFilters = () => {
    setFilters({ provider: "", startDate: "", endDate: "" });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card padding="md">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="provider-filter" className="text-text-main">Provedor</Label>
            <Select
              value={filters.provider || "__all__"}
              onValueChange={(val) => setFilters({ ...filters, provider: val === "__all__" ? "" : (val ?? "") })}
            >
              <SelectTrigger id="provider-filter" className="w-full h-9">
                <SelectValue placeholder="Todos os Provedores">
                  {(val) => val === "__all__" ? "Todos os Provedores" : (providers.find((p) => p.id === val)?.name || val)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os Provedores</SelectItem>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="start-date-filter" className="text-text-main">Data Inicial</Label>
            <Input
              id="start-date-filter"
              type="datetime-local"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className="h-9 px-3 w-full min-w-0 text-sm text-text-main"
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="end-date-filter" className="text-text-main">Data Final</Label>
            <Input
              id="end-date-filter"
              type="datetime-local"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className="h-9 px-3 w-full min-w-0 text-sm text-text-main"
            />
          </div>
          
          <div className="flex min-w-0 flex-col gap-2 sm:col-span-2 lg:col-span-1">
            <span className="hidden text-sm font-medium text-text-main opacity-0 lg:block" aria-hidden="true">Clear</span>
            <Button 
              variant="ghost" 
              onClick={handleClearFilters}
              disabled={!filters.provider && !filters.startDate && !filters.endDate}
              className="w-full"
            >
              Limpar Filtros
            </Button>
          </div>
        </div>
      </Card>

      <Card padding="none">
          <Table className="min-w-[880px]">
            <TableHeader>
              <TableRow>
                <TableHead className="p-4 text-sm font-semibold text-text-main">Data/Hora</TableHead>
                <TableHead className="p-4 text-sm font-semibold text-text-main">Modelo</TableHead>
                <TableHead className="p-4 text-sm font-semibold text-text-main">Provedor</TableHead>
                <TableHead className="p-4 text-right text-sm font-semibold text-text-main">Tokens de Entrada</TableHead>
                <TableHead className="p-4 text-right text-sm font-semibold text-text-main">Cache</TableHead>
                <TableHead className="p-4 text-right text-sm font-semibold text-text-main">Criação de Cache</TableHead>
                <TableHead className="p-4 text-right text-sm font-semibold text-text-main">Tokens de Saída</TableHead>
                <TableHead className="p-4 text-sm font-semibold text-text-main">Latência</TableHead>
                <TableHead className="p-4 text-center text-sm font-semibold text-text-main">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-8 text-center text-text-muted">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="size-5" />
                      Carregando...
                    </div>
                  </TableCell>
                </TableRow>
              ) : details.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-8 text-center text-text-muted">
                    Nenhum detalhe de requisição encontrado
                  </TableCell>
                </TableRow>
              ) : (
                details.map((detail, index) => (
                  <TableRow
                    key={`${detail.id}-${index}`}
                    className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
                  >
                    <TableCell className="p-4 text-sm text-text-main">
                      {new Date(detail.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate p-4 font-mono text-sm text-text-main">
                      {detail.model}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate p-4 text-sm text-text-main">
                       <span className="font-medium">
                         {getProviderName(detail.provider, providerNameCache)}
                       </span>
                     </TableCell>
                    <TableCell className="p-4 text-sm text-text-main text-right font-mono">
                      {getInputTokens(detail.tokens).toLocaleString()}
                    </TableCell>
                    <TableCell className="p-4 text-sm text-text-main text-right font-mono">
                      {getCachedTokens(detail.tokens) > 0 ? getCachedTokens(detail.tokens).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="p-4 text-sm text-text-main text-right font-mono">
                      {getCacheCreationTokens(detail.tokens) > 0 ? getCacheCreationTokens(detail.tokens).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="p-4 text-sm text-text-main text-right font-mono">
                      {detail.tokens?.completion_tokens?.toLocaleString() || 0}
                    </TableCell>
                    <TableCell className="p-4 text-sm text-text-muted">
                      <div className="flex flex-col gap-0.5">
                        <div>TTFT: <span className="font-mono">{detail.latency?.ttft || 0}ms</span></div>
                        <div>Total: <span className="font-mono">{detail.latency?.total || 0}ms</span></div>
                      </div>
                    </TableCell>
                    <TableCell className="p-4 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewDetail(detail)}
                      >
                        Detalhes
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

        {!loading && details.length > 0 && (
          <div className="border-t border-black/5 dark:border-white/5">
            <Pagination
              currentPage={pagination.page}
              pageSize={pagination.pageSize}
              totalItems={pagination.totalItems}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          </div>
        )}
      </Card>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Detalhes da Requisição"
        width="lg"
      >
        {selectedDetail && (
          <div className="space-y-6">
            <div className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-text-muted">ID:</span>{" "}
                <span className="break-all font-mono text-text-main">{selectedDetail.id}</span>
              </div>
              <div>
                <span className="text-text-muted">Data/Hora:</span>{" "}
                <span className="text-text-main">{new Date(selectedDetail.timestamp).toLocaleString()}</span>
              </div>
              <div>
                 <span className="text-text-muted">Provedor:</span>{" "}
                 <span className="text-text-main font-medium">{getProviderName(selectedDetail.provider, providerNameCache)}</span>
               </div>
              <div>
                <span className="text-text-muted">Modelo:</span>{" "}
                <span className="text-text-main font-mono">{selectedDetail.model}</span>
              </div>
              <div>
                <span className="text-text-muted">Status:</span>{" "}
                <span className={cn(
                  "font-medium",
                  selectedDetail.status === "success" ? "text-green-600" : "text-red-600"
                )}>
                  {selectedDetail.status}
                </span>
              </div>
              <div>
                <span className="text-text-muted">Latência:</span>{" "}
                <span className="text-text-main font-mono">
                  TTFT {selectedDetail.latency?.ttft || 0}ms / Total {selectedDetail.latency?.total || 0}ms
                </span>
              </div>
              <div>
                <span className="text-text-muted">Tokens de Entrada:</span>{" "}
                <span className="text-text-main font-mono">
                  {getInputTokens(selectedDetail.tokens).toLocaleString()}
                </span>
              </div>
              {getCachedTokens(selectedDetail.tokens) > 0 && (
                <div>
                  <span className="text-text-muted">Tokens em Cache:</span>{" "}
                  <span className="text-text-main font-mono">
                    {getCachedTokens(selectedDetail.tokens).toLocaleString()}
                  </span>
                </div>
              )}
              {getCacheCreationTokens(selectedDetail.tokens) > 0 && (
                <div>
                  <span className="text-text-muted">Criação de Cache:</span>{" "}
                  <span className="text-text-main font-mono">
                    {getCacheCreationTokens(selectedDetail.tokens).toLocaleString()}
                  </span>
                </div>
              )}
              <div>
                <span className="text-text-muted">Tokens de Saída:</span>{" "}
                <span className="text-text-main font-mono">
                  {selectedDetail.tokens?.completion_tokens?.toLocaleString() || 0}
                </span>
              </div>
            </div>

            {selectedDetail.pxpipe && (
              <div className="rounded-lg border border-black/5 dark:border-white/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ImageIcon className="size-5" />
                  <span className="font-semibold text-sm text-text-main">PXPIPE</span>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded",
                    selectedDetail.pxpipe.applied
                      ? "bg-green-500/15 text-green-600"
                      : "bg-amber-500/15 text-amber-600"
                  )}>
                    {selectedDetail.pxpipe.applied ? "Ativado" : "Ignorado"}
                  </span>
                </div>
                {selectedDetail.pxpipe.applied ? (
                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div>
                      <span className="text-text-muted block text-xs">Original (est.)</span>
                      <span className="font-mono">{(selectedDetail.pxpipe.tokensBeforeEst || 0).toLocaleString()} tokens</span>
                    </div>
                    <div>
                      <span className="text-text-muted block text-xs">Comprimido (est.)</span>
                      <span className="font-mono">{(selectedDetail.pxpipe.tokensAfterEst || 0).toLocaleString()} tokens</span>
                    </div>
                    <div>
                      <span className="text-text-muted block text-xs">Economizado</span>
                      <span className="font-mono text-green-600">{selectedDetail.pxpipe.savedPct || 0}%</span>
                    </div>
                    <div>
                      <span className="text-text-muted block text-xs">Imagens</span>
                      <span className="font-mono">{selectedDetail.pxpipe.imageCount || 0} ({selectedDetail.pxpipe.durationMs || 0}ms)</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">
                    Motivo: <span className="font-mono">{selectedDetail.pxpipe.reason}</span>
                    {selectedDetail.pxpipe.detail ? ` — ${selectedDetail.pxpipe.detail}` : ""}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-4">
              {selectedDetail.request?.routing && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-main">
                    <Brain className="size-4 text-primary" /> Decisão de roteamento inteligente
                  </div>
                  <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <div><dt className="text-text-muted">Tarefa</dt><dd className="mt-0.5 font-medium text-text-main">{selectedDetail.request.routing.need}</dd></div>
                    <div><dt className="text-text-muted">Tier</dt><dd className="mt-0.5 font-medium text-text-main">{selectedDetail.request.routing.tier}</dd></div>
                    <div><dt className="text-text-muted">Confiança</dt><dd className="mt-0.5 font-medium text-text-main">{Math.round((selectedDetail.request.routing.confidence || 0) * 100)}%</dd></div>
                    <div><dt className="text-text-muted">Motivo</dt><dd className="mt-0.5 font-medium text-text-main">{selectedDetail.request.routing.reason}</dd></div>
                  </dl>
                  <p className="mt-3 truncate font-mono text-xs text-text-muted" title={selectedDetail.request.routing.candidates?.[0]}>
                    {selectedDetail.request.routing.candidates?.[0] || "Sem candidato registrado"}
                    {selectedDetail.request.routing.degraded ? " · fallback degradado" : ""}
                  </p>
                </div>
              )}
              <CollapsibleSection title="1. Requisição do Cliente (Entrada)" defaultOpen={true} icon="input">
                <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                  {JSON.stringify(selectedDetail.request, null, 2)}
                </pre>
              </CollapsibleSection>

              {selectedDetail.providerRequest !== undefined && selectedDetail.providerRequest !== null && (
                <CollapsibleSection title="2. Requisição ao Provedor (Traduzida)" icon="translate">
                  <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                    {JSON.stringify(selectedDetail.providerRequest, null, 2)}
                  </pre>
                </CollapsibleSection>
              )}

              {selectedDetail.providerResponse && (
                <CollapsibleSection title="3. Resposta do Provedor (Raw)" icon="data_object">
                  <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                    {typeof selectedDetail.providerResponse === 'object'
                      ? JSON.stringify(selectedDetail.providerResponse, null, 2)
                      : selectedDetail.providerResponse
                    }
                  </pre>
                </CollapsibleSection>
              )}
              
              <CollapsibleSection title="4. Resposta ao Cliente (Final)" defaultOpen={true} icon="output">
                {selectedDetail.response?.thinking && (
                  <div className="mb-4">
                    <h4 className="font-semibold text-text-main mb-2 flex items-center gap-2 text-xs uppercase tracking-wide opacity-70">
                      <Brain className="size-4" />
                      Processo de Pensamento
                    </h4>
                    <pre className="max-h-[200px] max-w-full overflow-auto rounded-lg border border-amber-200 bg-amber-50 p-3 font-mono text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 sm:p-4">
                      {selectedDetail.response.thinking}
                    </pre>
                  </div>
                )}
                
                <h4 className="font-semibold text-text-main mb-2 text-xs uppercase tracking-wide opacity-70">
                  Conteúdo
                </h4>
                <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                  {selectedDetail.response?.content || "[Sem conteúdo]"}
                </pre>
              </CollapsibleSection>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
