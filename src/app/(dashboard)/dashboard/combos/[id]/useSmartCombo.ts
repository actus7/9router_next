"use client";
import { useMemo, useState } from "react";
import { useNotificationStore } from "@/store/notificationStore";
import { translate } from "@/i18n/runtime";
import { ROUTE_NEEDS, ROUTING_TIERS, type RouteNeed, type RoutingTierOrDefault, type SmartModelProfile, type SmartRoutingConfig } from "@/shared/llm-catalog";
import { ALL_TIERS, capProfilesPerTier, normalizeConfig, type ComboData, type SuggestionPreview } from "./smartComboHelpers";

export function useSmartCombo(initialCombo: ComboData, initialProfiles: SmartModelProfile[]) {
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
  const tierOptionsForNeed: RoutingTierOrDefault[] = selectedNeed === "general" ? ["default"] : ALL_TIERS;
  const profileSummary = useMemo(() => ({
    total: profiles.length,
    llm: profiles.filter((p) => p.capabilities.serviceKinds.includes("llm")).length,
    enriched: profiles.filter((p) => p.source !== "deterministic").length,
  }), [profiles]);
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
  const NEED_OPTIONS = ROUTE_NEEDS.map((need) => ({ value: need, label: NEED_LABELS[need] }));
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
      setPreview(data);
    } catch (e) { notify.error(e instanceof Error ? e.message : translate("Failed to suggest profiles") || "Failed to suggest profiles"); }
    finally { setSuggesting(false); }
  };
  const cappedPreviewProfiles = useMemo(() => (preview ? capProfilesPerTier(preview.profiles) : []), [preview]);
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
    currentModels, tierOptionsForNeed, profileSummary, cappedPreviewProfiles,
    patchModels, handleSave, handleRefresh, handleSuggest, handleConfirmProfiles,
    NEED_LABELS, TIER_LABELS, NEED_OPTIONS,
  };
}
