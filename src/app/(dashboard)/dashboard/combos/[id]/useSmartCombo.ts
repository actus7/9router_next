"use client";
import { useEffect, useMemo, useState } from "react";
import { notify } from "@/store/notificationStore";
import { translate } from "@/i18n/runtime";
import { DEFAULT_SMART_ROUTING_CONFIG, ROUTE_NEEDS, ROUTING_TIERS, type RouteNeed, type RoutingTierOrDefault, type SmartModelProfile, type SmartRoutingConfig } from "@/shared/llm-catalog";
import { getStoredModelTestLatencies } from "@/shared/utils/modelTestLatency";
import { ALL_TIERS, activeScopesFromConfig, capProfilesPerTier, foldGeneralDefaultIntoGlobals, normalizeConfig, type ComboData, type ModelLatencyMap, type SuggestionPreset, type SuggestionPreview } from "./smartComboHelpers";

export function useSmartCombo(initialCombo: ComboData, initialProfiles: SmartModelProfile[]) {
  // The fold runs once, before any state exists: a config saved by the old
  // screen can hold models in overrides.general.default, a bucket the grid no
  // longer offers. Moving them into the global list only widens where they
  // apply, so it is not a change the user has to approve.
  const initial = useMemo(() => {
    const folded = foldGeneralDefaultIntoGlobals(normalizeConfig(initialCombo.routing), initialCombo.models || []);
    return { name: initialCombo.name, config: folded.config, globalModels: folded.models };
  }, [initialCombo]);

  const [name, setName] = useState(initial.name);
  const [config, setConfig] = useState<SmartRoutingConfig>(initial.config);
  const [globalModels, setGlobalModels] = useState<string[]>(initial.globalModels);
  // `general` is not selectable here: the complexity board renders its tiers
  // and the global list covers its default bucket.
  const [selectedNeed, setSelectedNeed] = useState<RouteNeed>("vision");
  const [selectedTier, setSelectedTier] = useState<RoutingTierOrDefault>("default");
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [showGlobalModelSelect, setShowGlobalModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState<SmartModelProfile[]>(initialProfiles);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [preview, setPreview] = useState<SuggestionPreview | null>(null);
  const [suggestionPreset, setSuggestionPreset] = useState<SuggestionPreset>("balanced");
  const [modelTestLatencies, setModelTestLatencies] = useState<ModelLatencyMap>({});
  const [confirming, setConfirming] = useState(false);
  const currentModels = config.overrides[selectedNeed]?.[selectedTier] || [];
  useEffect(() => setModelTestLatencies(getStoredModelTestLatencies()), []);
  const tierOptions: RoutingTierOrDefault[] = ALL_TIERS;
  const activeScopes = useMemo(() => activeScopesFromConfig(config), [config]);
  const isDirty = useMemo(() => (
    name !== initial.name
    || JSON.stringify(globalModels) !== JSON.stringify(initial.globalModels)
    || JSON.stringify(config) !== JSON.stringify(initial.config)
  ), [name, config, globalModels, initial]);
  const profileSummary = useMemo(() => {
    const llm = profiles.filter((p) => p.capabilities.serviceKinds.includes("llm"));
    return {
      total: profiles.length,
      llm: llm.length,
      // Contado sobre os llm, nao sobre o total: numa rota de chat o resto nem
      // chega a ser candidato.
      llmEnriched: llm.filter((p) => p.source !== "deterministic").length,
    };
  }, [profiles]);
  const NEED_LABELS: Record<RouteNeed, string> = {
    general: translate("General") || "General", vision: translate("Vision") || "Vision",
    tool_use: translate("Tool use") || "Tool use", coding: translate("Coding") || "Coding",
    data_analysis: translate("Data analysis") || "Data analysis", web_search: translate("Web search") || "Web search",
    web_fetch: translate("Web fetch") || "Web fetch", image_generation: translate("Image generation") || "Image generation",
    video_generation: translate("Video generation") || "Video generation", tts: translate("Text-to-Speech") || "Text-to-Speech",
    stt: translate("Transcription") || "Transcription", embeddings: translate("Embeddings") || "Embeddings",
    email_management: translate("Email") || "Email", calendar_management: translate("Calendar") || "Calendar",
    social_media: translate("Social media") || "Social media", trading: "Trading",
  };
  const TIER_LABELS: Record<RoutingTierOrDefault, string> = {
    default: translate("Task default") || "Task default", simple: translate("Simple") || "Simple",
    standard: translate("Standard") || "Standard", complex: translate("Complex") || "Complex",
    reasoning: translate("Reasoning") || "Reasoning",
  };
  const NEED_OPTIONS = ROUTE_NEEDS.filter((need) => need !== "general").map((need) => ({ value: need, label: NEED_LABELS[need] }));
  const selectScope = (need: RouteNeed, tier: RoutingTierOrDefault) => { setSelectedNeed(need); setSelectedTier(tier); };
  // Kept visible because the values persist and still take effect; only the
  // inputs left the screen.
  const classifierTunedNote = (() => {
    const base = DEFAULT_SMART_ROUTING_CONFIG.classifier;
    const diffs: string[] = [];
    if (config.classifier.confidenceThreshold !== base.confidenceThreshold) diffs.push(`confidence ${config.classifier.confidenceThreshold}`);
    if (config.classifier.timeoutMs !== base.timeoutMs) diffs.push(`timeout ${config.classifier.timeoutMs}ms`);
    if (config.classifier.model !== base.model) diffs.push(`model ${config.classifier.model}`);
    if (diffs.length === 0) return null;
    return `${translate("Tuned via API") || "Tuned via API"}: ${diffs.join(" · ")}`;
  })();
  const patchModels = (models: string[]) => setConfig((c) => ({
    ...c, overrides: { ...c.overrides, [selectedNeed]: { ...c.overrides[selectedNeed], [selectedTier]: models } },
  }));
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/combos/${initialCombo.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim(), kind: "smart", models: globalModels, routing: config }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || translate("Failed to save") || "Failed to save");
      notify.success(translate("Smart routing saved") || "Smart routing saved");
    } catch (e) { notify.error(e instanceof Error ? e.message : translate("Failed to save") || "Failed to save"); }
    finally { setSaving(false); }
  };
  const handleRefresh = async () => {
    setLoadingProfiles(true);
    try {
      const res = await fetch("/api/smart-routing/profiles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "refresh" }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || translate("Failed to update inventory") || "Failed to update inventory");
      setProfiles(data.profiles || []);
      notify.success(translate("Inventory updated") || "Inventory updated");
    } catch (e) { notify.error(e instanceof Error ? e.message : translate("Failed to update inventory") || "Failed to update inventory"); }
    finally { setLoadingProfiles(false); }
  };
  const handleSuggest = async () => {
    setSuggesting(true);
    try {
      const res = await fetch("/api/smart-routing/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ webResearch: true, classifierModel: config.classifier.model === "auto" ? undefined : config.classifier.model }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || translate("Failed to suggest profiles") || "Failed to suggest profiles");
      setSuggestionPreset("balanced");
      setModelTestLatencies(getStoredModelTestLatencies());
      setPreview(data);
    } catch (e) { notify.error(e instanceof Error ? e.message : translate("Failed to suggest profiles") || "Failed to suggest profiles"); }
    finally { setSuggesting(false); }
  };
  const cappedPreviewProfiles = useMemo(() => (
    preview ? capProfilesPerTier(preview.profiles, suggestionPreset, modelTestLatencies) : []
  ), [preview, suggestionPreset, modelTestLatencies]);
  const handleConfirmProfiles = async () => {
    if (!preview) return;
    setConfirming(true);
    try {
      const res = await fetch("/api/smart-routing/profiles/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profiles: cappedPreviewProfiles, classifierModel: preview.classifierModel, researchedAt: preview.researchedAt, source: "llm" }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || translate("Failed to confirm profiles") || "Failed to confirm profiles");
      setProfiles((cur) => {
        const m = new Map(cur.map((p) => [p.modelKey, p]));
        for (const p of data.profiles as SmartModelProfile[]) m.set(p.modelKey, p);
        return [...m.values()];
      });
      setConfig((cur) => {
        const general = { ...cur.overrides.general };
        for (const tier of ROUTING_TIERS) {
          const tms = cappedPreviewProfiles.filter((p) => p.recommendedTier === tier).map((p) => p.modelKey);
          if (tms.length > 0) general[tier] = tms;
        }
        return { ...cur, overrides: { ...cur.overrides, general } };
      });
      setPreview(null);
      notify.success(`${data.saved} ${translate("profiles confirmed and applied to board") || "profiles confirmed and applied to board"}`);
    } catch (e) { notify.error(e instanceof Error ? e.message : translate("Failed to confirm profiles") || "Failed to confirm profiles"); }
    finally { setConfirming(false); }
  };
  return {
    name, setName, config, setConfig, globalModels, setGlobalModels,
    selectedNeed, setSelectedNeed, selectedTier, setSelectedTier,
    showModelSelect, setShowModelSelect, showGlobalModelSelect, setShowGlobalModelSelect,
    saving, profiles, loadingProfiles, suggesting, preview, setPreview, confirming,
    suggestionPreset, setSuggestionPreset, modelTestLatencies,
    currentModels, tierOptions, activeScopes, isDirty, selectScope, classifierTunedNote,
    profileSummary, cappedPreviewProfiles,
    patchModels, handleSave, handleRefresh, handleSuggest, handleConfirmProfiles,
    NEED_LABELS, TIER_LABELS, NEED_OPTIONS,
  };
}
