import { describe, expect, it } from "vitest";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { AI_PROVIDERS } from "@/shared/constants/providers";

describe("normalizeProviderId", () => {
  it("resolves a public provider alias to its persisted registry ID", () => {
    expect(normalizeProviderId("naga")).toBe("naga-ac");
  });

  it("keeps a canonical provider ID unchanged", () => {
    expect(normalizeProviderId("naga-ac")).toBe("naga-ac");
  });

  it("resolves every unambiguous public alias to its canonical provider ID", () => {
    const aliasOwners = new Map<string, Set<string>>();
    for (const provider of Object.values(AI_PROVIDERS)) {
      const id = String(provider.id || "");
      const aliases = [provider.alias, ...(Array.isArray(provider.aliases) ? provider.aliases : [])]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
      for (const alias of aliases) {
        const key = alias.toLowerCase();
        const owners = aliasOwners.get(key) || new Set<string>();
        owners.add(id);
        aliasOwners.set(key, owners);
      }
    }

    for (const [alias, owners] of aliasOwners) {
      if (owners.size !== 1 || AI_PROVIDERS[alias]) continue;
      const [id] = owners;
      expect(normalizeProviderId(alias), `alias ${alias}`).toBe(id);
      expect(normalizeProviderId(alias.toUpperCase()), `case-insensitive alias ${alias}`).toBe(id);
    }
  });

  it("resolves unique provider display names and rejects ambiguous ones", () => {
    const nameOwners = new Map<string, Set<string>>();
    for (const provider of Object.values(AI_PROVIDERS)) {
      const id = String(provider.id || "");
      const name = typeof provider.name === "string" ? provider.name.trim() : "";
      if (!id || !name) continue;
      const owners = nameOwners.get(name.toLowerCase()) || new Set<string>();
      owners.add(id);
      nameOwners.set(name.toLowerCase(), owners);
    }

    for (const [name, owners] of nameOwners) {
      const [id] = owners;
      if (owners.size === 1) expect(normalizeProviderId(name), `name ${name}`).toBe(id);
      else expect(normalizeProviderId(name), `ambiguous name ${name}`).toBe(name);
    }
  });
});
