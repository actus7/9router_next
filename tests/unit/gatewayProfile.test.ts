import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => settings.value) }));
const skillRows = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("@/lib/db/repos/agentSkillsRepo", () => ({ listAgentSkillRows: vi.fn(async () => skillRows.value) }));

import {
  DEFAULT_ABILITIES,
  normalizeGatewayProfile,
  profileFromSettings,
} from "@/shared/gateway/gatewayProfile";
import {
  currentGatewayProfile,
  withGatewayProfile,
  withStoredKeyProfile,
} from "@/server/llm-gateway/application/gatewayProfile";
import { buildGatewaySkillsPrompt } from "@/server/llm-gateway/application/gatewaySkills";
import { runTokenSavers } from "@/server/llm-gateway/engine/handlers/chatCore/phases";
import { FORMATS } from "@/server/llm-gateway/engine/translator/formats";

beforeEach(() => {
  settings.value = {};
  skillRows.value = [];
});

describe("GatewayProfile normalization", () => {
  it("reads the legacy settings flags, rtk on unless explicitly off", () => {
    const profile = profileFromSettings({ cavemanEnabled: true, cavemanLevel: "ultra", synapseEnabled: true, synapseLearningEnabled: true });
    expect(profile.abilities.rtk).toBe(true);
    expect(profile.abilities.caveman).toEqual({ enabled: true, level: "ultra" });
    expect(profile.abilities.synapse).toEqual({ enabled: true, level: "lite", learning: true });
    expect(profileFromSettings({ rtkEnabled: false }).abilities.rtk).toBe(false);
  });

  it("a partial patch keeps everything it does not mention", () => {
    const base = { abilities: { ...DEFAULT_ABILITIES, ponytail: { enabled: true, level: "ultra" } }, skillIds: ["tdd"] };
    const next = normalizeGatewayProfile({ abilities: { caveman: { enabled: true } } }, base);
    expect(next.abilities.caveman).toEqual({ enabled: true, level: "full" });
    expect(next.abilities.ponytail).toEqual({ enabled: true, level: "ultra" });
    expect(next.skillIds).toEqual(["tdd"]);
  });

  it("drops unknown levels and invalid or duplicated skill ids", () => {
    const next = normalizeGatewayProfile({
      abilities: { caveman: { enabled: true, level: "extreme" } },
      skillIds: ["tdd", "tdd", "../etc", 7, "Bad Id"],
    });
    expect(next.abilities.caveman.level).toBe("full");
    expect(next.skillIds).toEqual(["tdd"]);
  });

  it("reads neutrality flags and normalizes its level like ponytail", () => {
    const profile = profileFromSettings({ neutralityEnabled: true, neutralityLevel: "ultra" });
    expect(profile.abilities.neutrality).toEqual({ enabled: true, level: "ultra" });
    expect(profileFromSettings({ neutralityLevel: "extreme" }).abilities.neutrality).toEqual({ enabled: false, level: "full" });
    const base = { abilities: { ...DEFAULT_ABILITIES, neutrality: { enabled: true, level: "lite" } }, skillIds: [] };
    const next = normalizeGatewayProfile({ abilities: { neutrality: { level: "ultra" } } }, base);
    expect(next.abilities.neutrality).toEqual({ enabled: true, level: "ultra" });
  });
});

describe("profile scope", () => {
  it("outside any scope, the account's settings answer", async () => {
    settings.value = { cavemanEnabled: true };
    expect((await currentGatewayProfile()).abilities.caveman.enabled).toBe(true);
  });

  it("a key never edited (NULL) reads as settings; an edited key reads as itself", async () => {
    settings.value = { cavemanEnabled: true };
    const legacy = await withStoredKeyProfile(null, () => currentGatewayProfile());
    expect(legacy.abilities.caveman.enabled).toBe(true);

    const stored = JSON.stringify({ abilities: { caveman: { enabled: false } }, skillIds: ["pdf"] });
    const edited = await withStoredKeyProfile(stored, () => currentGatewayProfile());
    expect(edited.abilities.caveman.enabled).toBe(false);
    expect(edited.skillIds).toEqual(["pdf"]);
  });

  it("a resolved scope (the chat's) wins over settings without reading them", async () => {
    settings.value = { cavemanEnabled: true };
    const chat = { abilities: DEFAULT_ABILITIES, skillIds: [] };
    expect((await withGatewayProfile(chat, () => currentGatewayProfile())).abilities.caveman.enabled).toBe(false);
  });
});

describe("skills on the API", () => {
  it("injects the selected skills' full bodies and skips uninstalled ones", async () => {
    skillRows.value = [
      { id: "tdd", name: "TDD", description: "Test first", body: "Write the failing test.", enabled: true, source: "user", origin: null },
    ];
    const prompt = await buildGatewaySkillsPrompt(["tdd", "gone"]);
    expect(prompt).toContain('<skill id="tdd">');
    expect(prompt).toContain("Write the failing test.");
    expect(prompt).not.toContain("gone");
    expect(await buildGatewaySkillsPrompt([])).toBe("");
  });

  it("the skills block survives the token-saver opt-out header and is reported", async () => {
    const result = await runTokenSavers({
      translatedBody: { messages: [{ role: "user", content: "hi" }] },
      finalFormat: FORMATS.OPENAI, upstreamModel: "m", model: "m", provider: "p", reqTag: "t",
      tokenSaverEnabled: false,
      skillsPrompt: "SKILL BODY",
    });
    const messages = result.translatedBody.messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: "system", content: "SKILL BODY" });
    expect(result.applied).toContain("skills");
  });
});
