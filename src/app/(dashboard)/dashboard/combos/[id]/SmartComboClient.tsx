"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BrainCircuit, Check, ChevronRight, Plus, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import { Button, Card, Input, Modal, ModelSelectModal, Select } from "@/shared/components";
import type { ActiveProvider } from "@/shared/components/ModelSelectModal";
import ComplexityRoutingBoard from "./ComplexityRoutingBoard";
import { buttonVariants } from "@/components/ui/button";
import { Input as RawInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Connection } from "@/lib/data-access";
import { useNotificationStore } from "@/store/notificationStore";
import { translate } from "@/i18n/runtime";
import {
  DEFAULT_SMART_ROUTING_CONFIG,
  ROUTE_NEEDS,
  ROUTING_TIERS,
  type RouteNeed,
  type RoutingTier,
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

const ALL_TIERS: RoutingTierOrDefault[] = ["default", ...ROUTING_TIERS];
const MAX_SUGGESTIONS_PER_TIER = 10;

function capProfilesPerTier(profiles: SmartModelProfile[]): SmartModelProfile[] {
  return ROUTING_TIERS.flatMap((tier) =>
    profiles
      .filter((profile) => profile.recommendedTier === tier)
      .sort((a, b) => b.quality - a.quality)
      .slice(0, MAX_SUGGESTIONS_PER_TIER),
  );
}

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

  const NEED_LABELS: Record<RouteNeed, string> = {
    general: translate("General") || "General",
    vision: translate("Vision") || "Vision",
    tool_use: translate("Tool use") || "Tool use",
    coding: translate("Coding") || "Coding",
    data_analysis: translate("Data analysis") || "Data analysis",
    web_search: translate("Web search") || "Web search",
    web_fetch: translate("Web fetch") || "Web fetch",
    image_generation: translate("Image generation") || "Image generation",
    video_generation: translate("Video generation") || "Video generation",
    tts: translate("Text-to-Speech") || "Text-to-Speech",
    stt: translate("Transcription") || "Transcription",
    embeddings: translate("Embeddings") || "Embeddings",
    email_management: translate("Email") || "Email",
    calendar_management: translate("Calendar") || "Calendar",
    social_media: translate("Social media") || "Social media",
    trading: "Trading",
  };

  const TIER_LABELS: Record<RoutingTierOrDefault, string> = {
    default: translate("Task default") || "Task default",
    simple: translate("Simple") || "Simple",
    standard: translate("Standard") || "Standard",
    complex: translate("Complex") || "Complex",
    reasoning: translate("Reasoning") || "Reasoning",
  };

  const NEED_OPTIONS = ROUTE_NEEDS.map((need) => ({ value: need, label: NEED_LABELS[need] }));
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
  const tierOptionsForNeed: RoutingTierOrDefault[] = selectedNeed === "general" ? ["default"] : ALL_TIERS;
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
      if (!response.ok) throw new Error(data.error || translate("Failed to save") || "Failed to save");
      notify.success(translate("Smart routing saved") || "Smart routing saved");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : translate("Failed to save") || "Failed to save");
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
      if (!response.ok) throw new Error(data.error || translate("Failed to update inventory") || "Failed to update inventory");
      setProfiles(data.profiles || []);
      notify.success(translate("Inventory updated") || "Inventory updated");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : translate("Failed to update inventory") || "Failed to update inventory");
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
      if (!response.ok) throw new Error(data.error || translate("Failed to suggest profiles") || "Failed to suggest profiles");
      setPreview(data);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : translate("Failed to suggest profiles") || "Failed to suggest profiles");
    } finally {
      setSuggesting(false);
    }
  };

  const cappedPreviewProfiles = useMemo(() => (preview ? capProfilesPerTier(preview.profiles) : []), [preview]);

  const handleConfirmProfiles = async () => {
    if (!preview) return;
    setConfirming(true);
    try {
      const response = await fetch("/api/smart-routing/profiles/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profiles: cappedPreviewProfiles, classifierModel: preview.classifierModel, researchedAt: preview.researchedAt, source: "llm" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || translate("Failed to confirm profiles") || "Failed to confirm profiles");
      setProfiles((current) => {
        const merged = new Map(current.map((profile) => [profile.modelKey, profile]));
        for (const profile of data.profiles as SmartModelProfile[]) merged.set(profile.modelKey, profile);
        return [...merged.values()];
      });
      // Confirming a suggestion is expected to populate the "Roteamento padrão" board directly —
      // otherwise the preview modal feels disconnected from the board it was suggesting for.
      setConfig((current) => {
        const general = { ...current.overrides.general };
        for (const tier of ROUTING_TIERS) {
          const tierModels = cappedPreviewProfiles.filter((profile) => profile.recommendedTier === tier).map((profile) => profile.modelKey);
          if (tierModels.length > 0) general[tier] = tierModels;
        }
        return { ...current, overrides: { ...current.overrides, general } };
      });
      setPreview(null);
      notify.success(`${data.saved} ${translate("profiles confirmed and applied to board") || "profiles confirmed and applied to board"}`);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : translate("Failed to confirm profiles") || "Failed to confirm profiles");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link href="/dashboard/combos" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 mb-2")}>
            <ArrowLeft /> {translate("Back to combos")}
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><BrainCircuit /></div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-text-main">{translate("Smart routing")}</h1>
              <p className="mt-0.5 text-sm text-text-muted">{translate("Automatically selects the best model for each request, and uses fallback models if the primary fails.")}</p>
            </div>
          </div>
        </div>
        <Button onClick={handleSave} loading={saving} size="lg" className="min-h-11 w-full sm:w-auto">
          <Save data-icon="inline-start" /> {translate("Save")}
        </Button>
      </div>

      <Card>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
          <div>
            <Input label={translate("Combo Name") || "Combo Name"} value={name} onChange={(event) => setName(event.target.value)} />
            <p className="mt-2 text-xs text-text-muted">{translate("Use this name in the")} <code className="font-mono">model</code> {translate("field. The")} <code className="font-mono">x-router-tier</code> {translate("header can pin a tier per request.")}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <Label className="flex min-h-12 items-center justify-between gap-3 rounded-lg bg-muted px-3">
              <span><span className="block text-sm font-medium">{translate("Detect request topic")}</span><span className="block text-xs text-text-muted">{translate("Beyond complexity, tries to identify if it is code, image, search, etc. and prioritizes models good at it")}</span></span>
              <Switch aria-label={translate("Enable task-based routing") || "Enable task-based routing"} checked={config.task.enabled} onCheckedChange={(enabled) => setConfig((current) => ({ ...current, task: { ...current.task, enabled } }))} />
            </Label>
          </div>
        </div>
      </Card>

      <ComplexityRoutingBoard
        overrides={config.overrides.general || {}}
        onOverridesChange={(tier: RoutingTier, models: string[]) => setConfig((current) => ({
          ...current,
          overrides: { ...current.overrides, general: { ...current.overrides.general, [tier]: models } },
        }))}
        enabled={config.complexity.enabled}
        onEnabledChange={(enabled: boolean) => setConfig((current) => ({ ...current, complexity: { enabled } }))}
        profiles={profiles}
        activeProviders={activeProviders as unknown as ActiveProvider[]}
        modelAliases={modelAliases}
        onSuggest={handleSuggest}
        suggesting={suggesting}
      />

      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-text-main">{translate("Always available models")}</h2>
              <p className="mt-1 text-sm text-text-muted">{translate("These models are added as options for any request type, in addition to the specific priorities defined below. Leave empty to keep selection 100% automatic.")}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowGlobalModelSelect(true)}><Plus data-icon="inline-start" /> {translate("Add Model")}</Button>
          </div>
          {globalModels.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-text-muted">{translate("No fixed models; selection remains 100% automatic.")}</p>
          ) : (
            <ul className="grid gap-2 lg:grid-cols-2">
              {globalModels.map((model, index) => (
                <li key={model} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2">
                  <span className="text-xs text-text-muted">{index + 1}</span>
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">{model}</code>
                  <Button variant="ghost" size="icon-sm" onClick={() => setGlobalModels(globalModels.filter((item) => item !== model))} aria-label={`${translate("Remove") || "Remove"} ${model}`}><Trash2 /></Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="text-base font-semibold text-text-main">{translate("AI tiebreaker")}</h2>
            <p className="mt-1 text-sm text-text-muted">{translate("When the system is unsure which tier to use (simple, standard, complex or reasoning), it asks an AI model to decide quickly. If it takes too long, it falls back to the automatic decision.")}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Label className="flex min-h-11 items-center justify-between rounded-lg bg-muted px-3 text-sm">
              {translate("Enabled")}
              <Switch aria-label={translate("Enable AI tiebreaker") || "Enable AI tiebreaker"} checked={config.classifier.enabled} onCheckedChange={(enabled) => setConfig((current) => ({ ...current, classifier: { ...current.classifier, enabled } }))} />
            </Label>
            <div>
              <Label className="mb-1.5 block text-xs text-text-muted">{translate("Confidence threshold (0 to 1)")}</Label>
              <RawInput type="number" min="0" max="1" step="0.05" value={config.classifier.confidenceThreshold} onChange={(event) => setConfig((current) => ({ ...current, classifier: { ...current.classifier, confidenceThreshold: Number(event.target.value) } }))} />
              <p className="mt-1 text-[11px] text-text-muted">{translate("Below this threshold, asks AI for help instead of deciding on its own")}</p>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-text-muted">{translate("Maximum wait time")} (ms)</Label>
              <RawInput type="number" min="250" max="30000" step="250" value={config.classifier.timeoutMs} onChange={(event) => setConfig((current) => ({ ...current, classifier: { ...current.classifier, timeoutMs: Number(event.target.value) } }))} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-text-muted">{translate("Decision model")}</Label>
              <RawInput value={config.classifier.model} placeholder={translate("auto") || "auto"} onChange={(event) => setConfig((current) => ({ ...current, classifier: { ...current.classifier, model: event.target.value || "auto" } }))} />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="text-base font-semibold text-text-main">{translate("Priorities by request type")}</h2>
            <p className="mt-1 text-sm text-text-muted">{translate("For special requests (image, voice, web search...), choose which models to use first. Automatic selection remains the base — this only gives priority when the model is compatible.")}</p>
          </div>
          <p className="text-xs text-text-muted">{translate("For general text requests, the complexity tiers (Simple/Standard/Complex/Reasoning) are already edited in the \"Default routing\" board above — no need to repeat here.")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-xs text-text-muted">{translate("Request type")}</Label>
              <Select
                options={NEED_OPTIONS}
                value={selectedNeed}
                onChange={(value) => {
                  const need = value as RouteNeed;
                  setSelectedNeed(need);
                  if (need === "general") setSelectedTier("default");
                }}
                ariaLabel={translate("Request type") || "Request type"}
              />
            </div>
            <div><Label className="mb-1.5 block text-xs text-text-muted">{translate("Complexity level")}</Label><Select options={tierOptionsForNeed.map((tier) => ({ value: tier, label: TIER_LABELS[tier] }))} value={selectedTier} onChange={(value) => setSelectedTier(value as RoutingTierOrDefault)} ariaLabel={translate("Complexity level") || "Complexity level"} /></div>
          </div>
          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-sm font-medium text-text-main">{NEED_LABELS[selectedNeed]} <ChevronRight className="inline size-3" /> {TIER_LABELS[selectedTier]}</p><p className="text-xs text-text-muted">{translate("Priority order chosen by you")}</p></div>
              <Button variant="outline" size="sm" onClick={() => setShowModelSelect(true)}><Plus data-icon="inline-start" /> {translate("Add Model")}</Button>
            </div>
            {currentModels.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-text-muted">{translate("No priority set; selection remains 100% automatic.")}</p>
            ) : (
              <ul className="grid gap-2 lg:grid-cols-2">
                {currentModels.map((model, index) => (
                  <li key={model} className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2">
                    <span className="text-xs text-text-muted">{index + 1}</span>
                    <code className="min-w-0 flex-1 truncate font-mono text-xs">{model}</code>
                    <Button variant="ghost" size="icon-sm" onClick={() => patchModels(currentModels.filter((item) => item !== model))} aria-label={`${translate("Remove") || "Remove"} ${model}`}><Trash2 /></Button>
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
              <h2 className="text-base font-semibold text-text-main">{translate("All available models")}</h2>
              <p className="mt-1 text-sm text-text-muted">{profileSummary.total} {translate("active models from your connected providers")} · {profileSummary.llm} {translate("are chat/text")} · {profileSummary.enriched} {translate("have had quality assessed (by AI or manually).")}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="outline" onClick={handleRefresh} loading={loadingProfiles}><RefreshCw data-icon="inline-start" /> {translate("Reload list")}</Button>
              <Button onClick={handleSuggest} loading={suggesting}><Sparkles data-icon="inline-start" /> {translate("Assess quality with AI")}</Button>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="hidden grid-cols-[minmax(0,1.5fr)_110px_90px_100px] gap-3 bg-muted px-3 py-2 text-xs font-medium text-text-muted md:grid">
              <span>{translate("Model")}</span><span>{translate("Tier")}</span><span>{translate("Quality")}</span><span>{translate("Source")}</span>
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
          title={translate("Add global override") || "Add global override"}
          addedModelValues={globalModels}
          closeOnSelect={false}
        />
      )}

      <Modal
        isOpen={!!preview}
        onClose={() => setPreview(null)}
        title={translate("AI-assessed models") || "AI-assessed models"}
        size="full"
        footer={
          <>
            <Button variant="ghost" fullWidth onClick={() => setPreview(null)}>{translate("Cancel")}</Button>
            <Button fullWidth onClick={handleConfirmProfiles} loading={confirming}><Check data-icon="inline-start" /> {translate("Apply to routing board")}</Button>
          </>
        }
      >
        {preview && (
          <div className="flex min-w-0 flex-col gap-4">
            <div className="rounded-lg bg-muted p-3 text-sm text-text-muted">
              <p className="truncate"><span className="font-medium text-text-main">{translate("Assessed by:")}</span> {preview.classifierModel}</p>
              <p className="mt-1"><span className="font-medium text-text-main">{translate("Web research:")}</span> {preview.webResearchUsed ? `${translate("yes, via")} ${preview.researchProvider}` : translate("unavailable; used a conservative estimate")}</p>
              {preview.truncated && <p className="mt-1 text-amber-600">{translate("There were more models than this round's limit; the rest were not reassessed now.")}</p>}
            </div>
            <p className="text-xs text-text-muted">{translate("Organized by complexity level")} ({translate("up to")} {MAX_SUGGESTIONS_PER_TIER} {translate("models per tier")}). {translate("On confirm, this list replaces what is in the \"Default routing\" board above.")}</p>
            <div className="grid max-h-[55vh] gap-3 overflow-y-auto custom-scrollbar sm:grid-cols-2 lg:grid-cols-4">
              {ROUTING_TIERS.map((tier) => {
                const tierProfiles = cappedPreviewProfiles.filter((profile) => profile.recommendedTier === tier);
                return (
                  <div key={tier} className="min-w-0 rounded-lg border border-border bg-muted/20 p-2">
                    <p className="mb-2 truncate text-xs font-semibold text-text-main">{TIER_LABELS[tier]} <span className="font-normal text-text-muted">({tierProfiles.length})</span></p>
                    <div className="flex flex-col gap-1.5">
                      {tierProfiles.length === 0 ? (
                        <p className="text-xs text-text-muted">{translate("No models suggested.")}</p>
                      ) : tierProfiles.map((profile) => (
                        <div key={profile.modelKey} className="flex min-w-0 items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5">
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-main" title={profile.modelKey}>{profile.displayName || profile.modelKey}</span>
                          <span className="shrink-0 text-[11px] text-text-muted">{Math.round(profile.quality * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
