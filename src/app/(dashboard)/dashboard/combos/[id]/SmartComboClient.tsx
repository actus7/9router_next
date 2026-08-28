"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BrainCircuit, Check, ChevronRight, Plus, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import { Button, Card, Input, Modal, ModelSelectModal, Select } from "@/shared/components";
import type { ActiveProvider } from "@/shared/components/ModelSelectModal";
import { buttonVariants } from "@/components/ui/button";
import { Input as RawInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Connection } from "@/lib/data-access";
import { useNotificationStore } from "@/store/notificationStore";
import {
  DEFAULT_SMART_ROUTING_CONFIG,
  ROUTE_NEEDS,
  ROUTING_TIERS,
  type RouteNeed,
  type RoutingTierOrDefault,
  type SmartModelProfile,
  type SmartRoutingConfig,
} from "@/shared/llm-catalog";

interface ComboData {
  id: string;
  name: string;
  kind: string | null;
  models: string[];
  routing: Record<string, unknown> | null;
}

interface SuggestionPreview {
  profiles: SmartModelProfile[];
  classifierModel: string;
  researchedAt: string;
  researchProvider: string | null;
  webResearchUsed: boolean;
  truncated: boolean;
}

const NEED_LABELS: Record<RouteNeed, string> = {
  general: "Geral",
  vision: "Visão",
  tool_use: "Uso de ferramentas",
  coding: "Código",
  data_analysis: "Análise de dados",
  web_search: "Busca web",
  web_fetch: "Leitura de URL",
  image_generation: "Geração de imagem",
  video_generation: "Geração de vídeo",
  tts: "Texto para voz",
  stt: "Transcrição",
  embeddings: "Embeddings",
  email_management: "E-mail",
  calendar_management: "Calendário",
  social_media: "Redes sociais",
  trading: "Trading",
};

const TIER_LABELS: Record<RoutingTierOrDefault, string> = {
  default: "Padrão da tarefa",
  simple: "Simples",
  standard: "Padrão",
  complex: "Complexo",
  reasoning: "Raciocínio",
};

const NEED_OPTIONS = ROUTE_NEEDS.map((need) => ({ value: need, label: NEED_LABELS[need] }));
const ALL_TIERS: RoutingTierOrDefault[] = ["default", ...ROUTING_TIERS];

function normalizeConfig(value: Record<string, unknown> | null): SmartRoutingConfig {
  const input = value || {};
  const complexity = input.complexity as Partial<SmartRoutingConfig["complexity"]> | undefined;
  const task = input.task as Partial<SmartRoutingConfig["task"]> | undefined;
  const classifier = input.classifier as Partial<SmartRoutingConfig["classifier"]> | undefined;
  return {
    ...DEFAULT_SMART_ROUTING_CONFIG,
    complexity: { ...DEFAULT_SMART_ROUTING_CONFIG.complexity, ...complexity },
    task: { ...DEFAULT_SMART_ROUTING_CONFIG.task, ...task },
    classifier: { ...DEFAULT_SMART_ROUTING_CONFIG.classifier, ...classifier },
    overrides: (input.overrides as SmartRoutingConfig["overrides"] | undefined) || {},
  };
}

export default function SmartComboClient({ initialCombo, activeProviders, modelAliases, initialProfiles }: {
  initialCombo: ComboData;
  activeProviders: Connection[];
  modelAliases: Record<string, string>;
  initialProfiles: SmartModelProfile[];
}) {
  const notify = useNotificationStore();
  const [name, setName] = useState(initialCombo.name);
  const [config, setConfig] = useState<SmartRoutingConfig>(() => normalizeConfig(initialCombo.routing));
  const [globalModels, setGlobalModels] = useState<string[]>(initialCombo.models || []);
  const [selectedNeed, setSelectedNeed] = useState<RouteNeed>("general");
  const [selectedTier, setSelectedTier] = useState<RoutingTierOrDefault>("default");
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [showGlobalModelSelect, setShowGlobalModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState<SmartModelProfile[]>(initialProfiles);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [preview, setPreview] = useState<SuggestionPreview | null>(null);
  const [confirming, setConfirming] = useState(false);

  const currentModels = config.overrides[selectedNeed]?.[selectedTier] || [];
  const profileSummary = useMemo(() => ({
    total: profiles.length,
    llm: profiles.filter((profile) => profile.capabilities.serviceKinds.includes("llm")).length,
    enriched: profiles.filter((profile) => profile.source !== "deterministic").length,
  }), [profiles]);

  const patchModels = (models: string[]) => {
    setConfig((current) => ({
      ...current,
      overrides: {
        ...current.overrides,
        [selectedNeed]: {
          ...current.overrides[selectedNeed],
          [selectedTier]: models,
        },
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/combos/${initialCombo.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), kind: "smart", models: globalModels, routing: config }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao salvar");
      notify.success("Roteamento inteligente salvo");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    setLoadingProfiles(true);
    try {
      const response = await fetch("/api/smart-routing/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao atualizar inventário");
      setProfiles(data.profiles || []);
      notify.success("Inventário atualizado");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "Falha ao atualizar inventário");
    } finally {
      setLoadingProfiles(false);
    }
  };

  const handleSuggest = async () => {
    setSuggesting(true);
    try {
      const response = await fetch("/api/smart-routing/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ webResearch: true, classifierModel: config.classifier.model === "auto" ? undefined : config.classifier.model }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao sugerir perfis");
      setPreview(data);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "Falha ao sugerir perfis");
    } finally {
      setSuggesting(false);
    }
  };

  const handleConfirmProfiles = async () => {
    if (!preview) return;
    setConfirming(true);
    try {
      const response = await fetch("/api/smart-routing/profiles/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profiles: preview.profiles, classifierModel: preview.classifierModel, researchedAt: preview.researchedAt, source: "llm" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao confirmar perfis");
      setProfiles((current) => {
        const saved = new Map((data.profiles as SmartModelProfile[]).map((profile) => [profile.modelKey, profile]));
        return current.map((profile) => saved.get(profile.modelKey) || profile);
      });
      setPreview(null);
      notify.success(`${data.saved} perfis confirmados`);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "Falha ao confirmar perfis");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link href="/dashboard/combos" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 mb-2")}>
            <ArrowLeft /> Voltar aos combos
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><BrainCircuit /></div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-text-main">Roteamento inteligente</h1>
              <p className="mt-0.5 text-sm text-text-muted">Classificação local, decisão assistida e fallback por capacidade.</p>
            </div>
          </div>
        </div>
        <Button onClick={handleSave} loading={saving} size="lg" className="min-h-11 w-full sm:w-auto">
          <Save data-icon="inline-start" /> Salvar
        </Button>
      </div>

      <Card>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
          <div>
            <Input label="Nome do combo" value={name} onChange={(event) => setName(event.target.value)} />
            <p className="mt-2 text-xs text-text-muted">Use este nome no campo <code className="font-mono">model</code>. O header <code className="font-mono">x-router-tier</code> pode fixar um tier por requisição.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <Label className="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-muted px-3">
              <span><span className="block text-sm font-medium">Complexidade</span><span className="block text-xs text-text-muted">Simples até raciocínio</span></span>
              <Switch aria-label="Ativar roteamento por complexidade" checked={config.complexity.enabled} onCheckedChange={(enabled) => setConfig((current) => ({ ...current, complexity: { enabled } }))} />
            </Label>
            <Label className="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-muted px-3">
              <span><span className="block text-sm font-medium">Tipo de tarefa</span><span className="block text-xs text-text-muted">Código, mídia, busca e mais</span></span>
              <Switch aria-label="Ativar roteamento por tipo de tarefa" checked={config.task.enabled} onCheckedChange={(enabled) => setConfig((current) => ({ ...current, task: { ...current.task, enabled } }))} />
            </Label>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-text-main">Overrides globais</h2>
              <p className="mt-1 text-sm text-text-muted">Modelos aqui entram como candidatos para qualquer tarefa/tier, além dos overrides específicos abaixo. Deixe vazio para usar só o inventário ativo.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowGlobalModelSelect(true)}><Plus data-icon="inline-start" /> Adicionar modelo</Button>
          </div>
          {globalModels.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-text-muted">Nenhum override global; o ranking será totalmente dinâmico.</p>
          ) : (
            <ul className="grid gap-2 lg:grid-cols-2">
              {globalModels.map((model, index) => (
                <li key={model} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2">
                  <span className="text-xs text-text-muted">{index + 1}</span>
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">{model}</code>
                  <Button variant="ghost" size="icon-sm" onClick={() => setGlobalModels(globalModels.filter((item) => item !== model))} aria-label={`Remover ${model}`}><Trash2 /></Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="text-base font-semibold text-text-main">Classificador de ambiguidade</h2>
            <p className="mt-1 text-sm text-text-muted">Quando a confiança local fica abaixo do limite, um LLM decide em até 5 segundos; falhas voltam ao resultado local.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Label className="flex min-h-11 items-center justify-between rounded-lg bg-muted px-3 text-sm">
              Habilitado
              <Switch aria-label="Ativar classificador de ambiguidade" checked={config.classifier.enabled} onCheckedChange={(enabled) => setConfig((current) => ({ ...current, classifier: { ...current.classifier, enabled } }))} />
            </Label>
            <div>
              <Label className="mb-1.5 block text-xs text-text-muted">Confiança mínima</Label>
              <RawInput type="number" min="0" max="1" step="0.05" value={config.classifier.confidenceThreshold} onChange={(event) => setConfig((current) => ({ ...current, classifier: { ...current.classifier, confidenceThreshold: Number(event.target.value) } }))} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-text-muted">Timeout (ms)</Label>
              <RawInput type="number" min="250" max="30000" step="250" value={config.classifier.timeoutMs} onChange={(event) => setConfig((current) => ({ ...current, classifier: { ...current.classifier, timeoutMs: Number(event.target.value) } }))} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-text-muted">Modelo decisor</Label>
              <RawInput value={config.classifier.model} placeholder="auto" onChange={(event) => setConfig((current) => ({ ...current, classifier: { ...current.classifier, model: event.target.value || "auto" } }))} />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="text-base font-semibold text-text-main">Overrides manuais</h2>
            <p className="mt-1 text-sm text-text-muted">O ranking dinâmico continua sendo a fonte principal. Modelos aqui ganham prioridade quando forem compatíveis.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label className="mb-1.5 block text-xs text-text-muted">Tarefa</Label><Select options={NEED_OPTIONS} value={selectedNeed} onChange={(value) => setSelectedNeed(value as RouteNeed)} ariaLabel="Tarefa" /></div>
            <div><Label className="mb-1.5 block text-xs text-text-muted">Tier</Label><Select options={ALL_TIERS.map((tier) => ({ value: tier, label: TIER_LABELS[tier] }))} value={selectedTier} onChange={(value) => setSelectedTier(value as RoutingTierOrDefault)} ariaLabel="Tier" /></div>
          </div>
          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-sm font-medium text-text-main">{NEED_LABELS[selectedNeed]} <ChevronRight className="inline size-3" /> {TIER_LABELS[selectedTier]}</p><p className="text-xs text-text-muted">Ordem de prioridade manual</p></div>
              <Button variant="outline" size="sm" onClick={() => setShowModelSelect(true)}><Plus data-icon="inline-start" /> Adicionar modelo</Button>
            </div>
            {currentModels.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-text-muted">Sem override; o ranking será totalmente dinâmico.</p>
            ) : (
              <ul className="grid gap-2 lg:grid-cols-2">
                {currentModels.map((model, index) => (
                  <li key={model} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2">
                    <span className="text-xs text-text-muted">{index + 1}</span>
                    <code className="min-w-0 flex-1 truncate font-mono text-xs">{model}</code>
                    <Button variant="ghost" size="icon-sm" onClick={() => patchModels(currentModels.filter((item) => item !== model))} aria-label={`Remover ${model}`}><Trash2 /></Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-text-main">Perfis do inventário</h2>
              <p className="mt-1 text-sm text-text-muted">{profileSummary.total} ativos · {profileSummary.llm} LLMs · {profileSummary.enriched} perfis confirmados por LLM ou manualmente.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="outline" onClick={handleRefresh} loading={loadingProfiles}><RefreshCw data-icon="inline-start" /> Atualizar inventário</Button>
              <Button onClick={handleSuggest} loading={suggesting}><Sparkles data-icon="inline-start" /> Sugerir com LLM</Button>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="hidden grid-cols-[minmax(0,1.5fr)_110px_90px_100px] gap-3 bg-muted px-3 py-2 text-xs font-medium text-text-muted md:grid">
              <span>Modelo</span><span>Tier</span><span>Qualidade</span><span>Fonte</span>
            </div>
            <ul className="max-h-[480px] divide-y divide-border overflow-y-auto">
              {profiles.slice(0, 250).map((profile) => (
                <li key={profile.modelKey} className="grid gap-2 px-3 py-3 text-sm md:grid-cols-[minmax(0,1.5fr)_110px_90px_100px] md:items-center md:gap-3">
                  <div className="min-w-0"><code className="block truncate font-mono text-xs text-text-main">{profile.modelKey}</code><span className="mt-0.5 block text-[11px] text-text-muted">{profile.capabilities.serviceKinds.join(", ")}</span></div>
                  <span className="text-xs text-text-muted">{TIER_LABELS[profile.recommendedTier]}</span>
                  <span className="text-xs text-text-muted">{Math.round(profile.quality * 100)}%</span>
                  <span className={cn("w-fit rounded-full px-2 py-0.5 text-[11px]", profile.source === "deterministic" ? "bg-muted text-text-muted" : "bg-primary/10 text-primary")}>{profile.source}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      {showModelSelect && (
        <ModelSelectModal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={(model: { value: string }) => { if (!currentModels.includes(model.value)) patchModels([...currentModels, model.value]); }}
          onDeselect={(model: { value: string }) => patchModels(currentModels.filter((item) => item !== model.value))}
          activeProviders={activeProviders as unknown as ActiveProvider[]}
          modelAliases={modelAliases}
          title={`Override: ${NEED_LABELS[selectedNeed]} / ${TIER_LABELS[selectedTier]}`}
          addedModelValues={currentModels}
          closeOnSelect={false}
        />
      )}

      {showGlobalModelSelect && (
        <ModelSelectModal
          isOpen={showGlobalModelSelect}
          onClose={() => setShowGlobalModelSelect(false)}
          onSelect={(model: { value: string }) => { if (!globalModels.includes(model.value)) setGlobalModels([...globalModels, model.value]); }}
          onDeselect={(model: { value: string }) => setGlobalModels(globalModels.filter((item) => item !== model.value))}
          activeProviders={activeProviders as unknown as ActiveProvider[]}
          modelAliases={modelAliases}
          title="Adicionar override global"
          addedModelValues={globalModels}
          closeOnSelect={false}
        />
      )}

      <Modal isOpen={!!preview} onClose={() => setPreview(null)} title="Pré-visualizar perfis sugeridos">
        {preview && (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg bg-muted p-3 text-sm text-text-muted">
              <p><span className="font-medium text-text-main">Decisor:</span> {preview.classifierModel}</p>
              <p className="mt-1"><span className="font-medium text-text-main">Pesquisa web:</span> {preview.webResearchUsed ? `sim, via ${preview.researchProvider}` : "indisponível; sugestão conservadora"}</p>
              {preview.truncated && <p className="mt-1 text-amber-600">O inventário excedeu o limite desta rodada; os demais perfis ficaram inalterados.</p>}
            </div>
            <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border">
              {preview.profiles.map((profile) => (
                <div key={profile.modelKey} className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-0">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">{profile.modelKey}</code>
                  <span className="text-xs text-text-muted">{TIER_LABELS[profile.recommendedTier]}</span>
                  <span className="text-xs text-text-muted">{Math.round(profile.quality * 100)}%</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="ghost" fullWidth onClick={() => setPreview(null)}>Cancelar</Button>
              <Button fullWidth onClick={handleConfirmProfiles} loading={confirming}><Check data-icon="inline-start" /> Confirmar perfis</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
