/**
 * What the gateway does to one request on top of routing it: the "abilities"
 * (the savers that used to live on the Token Saver page) and, for the public
 * API, which Agent Skills ride along in the system prompt.
 *
 * Scoped by where the request came from, never globally:
 * - an API key carries its own profile (`apiKeys.profile`);
 * - a chat conversation builds one from its own plugins.
 *
 * `settings` keeps the old flags as the template a new key starts from and as
 * the answer for a key whose profile was never written — which is how existing
 * keys behave exactly as before until someone edits them.
 */

export const CAVEMAN_LEVEL_IDS = ["lite", "full", "ultra", "wenyan-lite", "wenyan", "wenyan-ultra"] as const;
export const PONYTAIL_LEVEL_IDS = ["lite", "full", "ultra"] as const;
export const NEUTRALITY_LEVEL_IDS = ["lite", "full", "ultra"] as const;
export const SYNAPSE_LEVEL_IDS = ["lite", "full"] as const;

export interface LeveledAbility {
  enabled: boolean;
  level: string;
}

export interface GatewayAbilities {
  rtk: boolean;
  caveman: LeveledAbility;
  ponytail: LeveledAbility;
  neutrality: LeveledAbility;
  synapse: LeveledAbility & { learning: boolean };
  pxpipe: boolean;
  metaBreak: boolean;
}

export interface GatewayProfile {
  abilities: GatewayAbilities;
  /** Skill ids injected with their full body. Only the API uses this. */
  skillIds: string[];
  /**
   * Scans this key's user input for prompt injection before any model is
   * spent (adds latency). Absent means off — the account-wide
   * `settings.guardrailsPublicApi` is read live and needs no per-key copy.
   */
  guardrails?: boolean;
}

export type AbilityId = keyof GatewayAbilities;

/** The flags `settings` has always held, as the gateway reads them. */
export interface LegacySaverSettings {
  rtkEnabled?: unknown;
  cavemanEnabled?: unknown;
  cavemanLevel?: unknown;
  ponytailEnabled?: unknown;
  ponytailLevel?: unknown;
  neutralityEnabled?: unknown;
  neutralityLevel?: unknown;
  synapseEnabled?: unknown;
  synapseLevel?: unknown;
  synapseLearningEnabled?: unknown;
  pxpipeEnabled?: unknown;
  metaBreakEnabled?: unknown;
}

const MAX_SKILLS = 50;
const SKILL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function pickLevel(value: unknown, allowed: readonly string[], fallback: string): string {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

export const DEFAULT_ABILITIES: GatewayAbilities = {
  rtk: true,
  caveman: { enabled: false, level: "full" },
  ponytail: { enabled: false, level: "full" },
  neutrality: { enabled: false, level: "full" },
  synapse: { enabled: false, level: "lite", learning: false },
  pxpipe: false,
  metaBreak: false,
};

export function profileFromSettings(settings: LegacySaverSettings): GatewayProfile {
  return {
    abilities: {
      // rtk has always defaulted on; only an explicit false turns it off.
      rtk: settings.rtkEnabled !== false,
      caveman: {
        enabled: settings.cavemanEnabled === true,
        level: pickLevel(settings.cavemanLevel, CAVEMAN_LEVEL_IDS, "full"),
      },
      ponytail: {
        enabled: settings.ponytailEnabled === true,
        level: pickLevel(settings.ponytailLevel, PONYTAIL_LEVEL_IDS, "full"),
      },
      neutrality: {
        enabled: settings.neutralityEnabled === true,
        level: pickLevel(settings.neutralityLevel, NEUTRALITY_LEVEL_IDS, "full"),
      },
      synapse: {
        enabled: settings.synapseEnabled === true,
        level: pickLevel(settings.synapseLevel, SYNAPSE_LEVEL_IDS, "lite"),
        learning: settings.synapseLearningEnabled === true,
      },
      pxpipe: settings.pxpipeEnabled === true,
      metaBreak: settings.metaBreakEnabled === true,
    },
    skillIds: [],
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function leveled(value: unknown, allowed: readonly string[], fallback: LeveledAbility): LeveledAbility {
  const raw = record(value);
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
    level: pickLevel(raw.level, allowed, fallback.level),
  };
}

/**
 * Normalizes an untrusted profile (a stored JSON column or a request body).
 * Anything missing or malformed takes the value from `fallback`, so a partial
 * update never silently turns an ability off.
 */
export function normalizeGatewayProfile(input: unknown, fallback: GatewayProfile = { abilities: DEFAULT_ABILITIES, skillIds: [] }): GatewayProfile {
  const raw = record(input);
  const abilities = record(raw.abilities);
  const base = fallback.abilities;
  const synapse = record(abilities.synapse);
  const skillIds = Array.isArray(raw.skillIds)
    ? [...new Set(raw.skillIds.filter((id): id is string => typeof id === "string" && SKILL_ID.test(id)))].slice(0, MAX_SKILLS)
    : fallback.skillIds;
  return {
    abilities: {
      rtk: typeof abilities.rtk === "boolean" ? abilities.rtk : base.rtk,
      caveman: leveled(abilities.caveman, CAVEMAN_LEVEL_IDS, base.caveman),
      ponytail: leveled(abilities.ponytail, PONYTAIL_LEVEL_IDS, base.ponytail),
      neutrality: leveled(abilities.neutrality, NEUTRALITY_LEVEL_IDS, base.neutrality),
      synapse: {
        ...leveled(abilities.synapse, SYNAPSE_LEVEL_IDS, base.synapse),
        learning: typeof synapse.learning === "boolean" ? synapse.learning : base.synapse.learning,
      },
      pxpipe: typeof abilities.pxpipe === "boolean" ? abilities.pxpipe : base.pxpipe,
      metaBreak: typeof abilities.metaBreak === "boolean" ? abilities.metaBreak : base.metaBreak,
    },
    skillIds,
    guardrails: typeof raw.guardrails === "boolean" ? raw.guardrails : fallback.guardrails,
  };
}

/** Parses the `apiKeys.profile` column; null when it was never written. */
export function parseStoredProfile(raw: unknown, fallback: GatewayProfile): GatewayProfile | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    return normalizeGatewayProfile(typeof raw === "string" ? JSON.parse(raw) : raw, fallback);
  } catch {
    return null;
  }
}
