/** Level choices shown for each leveled ability, shared by every editor. */
export interface AbilityLevelOption {
  id: string;
  label: string;
  desc: string;
  wenyan?: boolean;
}

export const WENYAN_LOCALES = ["zh-CN", "zh-TW"];

export const CAVEMAN_LEVELS: readonly AbilityLevelOption[] = [
  { id: "lite", label: "Lite", desc: "Drop filler, keep grammar" },
  { id: "full", label: "Full", desc: "Drop articles, fragments OK" },
  { id: "ultra", label: "Ultra", desc: "Telegraphic, max compression" },
  { id: "wenyan-lite", label: "文 Lite", desc: "Classical Chinese, light compression", wenyan: true },
  { id: "wenyan", label: "文 Full", desc: "Maximum 文言文, 80-90% reduction", wenyan: true },
  { id: "wenyan-ultra", label: "文 Ultra", desc: "Extreme classical compression", wenyan: true },
];

export const PONYTAIL_LEVELS: readonly AbilityLevelOption[] = [
  { id: "lite", label: "Lite", desc: "Build asked, name lazier option" },
  { id: "full", label: "Full", desc: "Ladder enforced: stdlib/native first" },
  { id: "ultra", label: "Ultra", desc: "YAGNI extremist, deletion first" },
];

export const SYNAPSE_LEVELS: readonly AbilityLevelOption[] = [
  { id: "lite", label: "Lite", desc: "Answer only unambiguous social patterns: greetings, thanks and goodbyes" },
  { id: "full", label: "Full", desc: "Adds identity, ping and short confirmations — more coverage, still conservative" },
];
