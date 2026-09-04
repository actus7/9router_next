import { describe, expect, it } from "vitest";

import { TABLES } from "@/lib/db/schema";

/**
 * The schema declares no FOREIGN KEY anywhere, even though `foreign_keys = ON`
 * is set. That is deliberate: the correct behaviour differs per relation, and a
 * single constraint cannot express it. `usageHistory` and `requestDetails` hold
 * accounting that must OUTLIVE the connection it came from — CASCADE would
 * erase billing history when an account is removed, and RESTRICT would forbid
 * removing any account that was ever used. Both are wrong.
 *
 * So the policy lives here instead, as data. Every column in TABLES that looks
 * like a reference has to be classified, which means adding a child table
 * without deciding what happens to its rows fails this test rather than
 * silently leaking them.
 */

type Policy =
  /** The parent's delete path removes these rows in the same transaction. */
  | "cleans"
  /** Kept on purpose — historical record whose value is surviving the parent. */
  | "preserves"
  /** Parent deletion is refused while children exist. */
  | "blocked"
  /** Not a reference to another table at all. */
  | "not-a-reference";

interface Declared {
  policy: Policy;
  parent?: string;
  why: string;
}

const POLICY: Record<string, Declared> = {
  "modelAvailability.connectionId": {
    policy: "cleans",
    parent: "providerConnections",
    why:
      "deleteProviderConnection removes these in its transaction. The periodic " +
      "sweep only drops rows whose `until` has passed, so a cooldown written " +
      "with `until IS NULL` would outlive its connection forever.",
  },
  "usageHistory.connectionId": {
    policy: "preserves",
    parent: "providerConnections",
    why: "Consumption history is the product. Deleting an account must not erase what it spent.",
  },
  "usageHistory.apiKey": {
    policy: "preserves",
    parent: "apiKeys",
    why: "Per-key usage has to survive key revocation, otherwise revoking a key rewrites the past.",
  },
  "requestDetails.connectionId": {
    policy: "preserves",
    parent: "providerConnections",
    why: "Same as usageHistory; this table has its own pruning via observabilityMaxRecords.",
  },
  "cloudDeployments.connectionId": {
    policy: "blocked",
    parent: "cloudConnections",
    why:
      "DELETE /api/cloud/connections/[provider] answers 409 while any deployment " +
      "references the connection. Cascading would drop the local record while the " +
      "remote container keeps running and billing, with a live gateway key in its env.",
  },
  "harnessEvents.sessionId": {
    policy: "cleans",
    parent: "harnessConversations",
    why: "replaceHarnessConversations cascades events plus the search index and FTS rows.",
  },
  "harnessMessageIndex.sessionId": {
    policy: "cleans",
    parent: "harnessConversations",
    why: "Same cascade as harnessEvents — it is a search shadow of those rows.",
  },
  "agentSkillFiles.skillId": {
    policy: "cleans",
    parent: "agentSkills",
    why: "deleteAgentSkillWithFiles removes both tables in one transaction.",
  },

  // Columns that merely look like references.
  "apiKeys.machineId": {
    policy: "not-a-reference",
    why: "Host fingerprint, not a row id.",
  },
  "modelAvailability.modelId": {
    policy: "not-a-reference",
    why: "An upstream model string, or the sentinel '__all'. Models are registry entries, not rows.",
  },
  "cloudDeployments.toolId": {
    policy: "not-a-reference",
    why: "Identifies a bundled tool in code, not a database row.",
  },
  "harnessConversations.projectId": {
    policy: "not-a-reference",
    why: "Free-form grouping label; there is no projects table.",
  },
  "harnessConversations.providerId": {
    policy: "not-a-reference",
    why: "Provider registry id, not a row.",
  },
  "harnessConversations.modelId": {
    policy: "not-a-reference",
    why: "Model string, not a row.",
  },
  "harnessMessageIndex.messageId": {
    policy: "not-a-reference",
    why: "Client-generated id inside the session payload; no messages table exists.",
  },
};

/** Columns whose name suggests they point at another row. */
function referenceLookingColumns(): string[] {
  const found: string[] = [];
  for (const [table, def] of Object.entries(TABLES)) {
    for (const column of Object.keys(def.columns)) {
      if (/Id$/.test(column) || column === "apiKey") found.push(`${table}.${column}`);
    }
  }
  return found.sort();
}

describe("child-row delete policy", () => {
  it("classifies every reference-looking column in the schema", () => {
    const undeclared = referenceLookingColumns().filter((key) => !POLICY[key]);

    // A new child column with no policy is exactly how modelAvailability
    // started leaking rows, so this must fail rather than warn.
    expect(undeclared).toEqual([]);
  });

  it("carries no stale entry for a column the schema dropped", () => {
    const live = new Set(referenceLookingColumns());
    expect(Object.keys(POLICY).filter((key) => !live.has(key))).toEqual([]);
  });

  it("names an existing parent table for every real reference", () => {
    const tables = new Set(Object.keys(TABLES));
    for (const [key, declared] of Object.entries(POLICY)) {
      if (declared.policy === "not-a-reference") {
        expect(declared.parent, `${key} should not name a parent`).toBeUndefined();
        continue;
      }
      expect(declared.parent, `${key} must name its parent`).toBeDefined();
      expect(tables.has(declared.parent!), `${key} parent ${declared.parent} is not a table`).toBe(true);
    }
  });

  it("explains every decision", () => {
    for (const [key, declared] of Object.entries(POLICY)) {
      expect(declared.why.length, `${key} needs a reason`).toBeGreaterThan(20);
    }
  });
});
