import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() =>
  vi.fn((_sql: string, _params?: unknown[]) => ({ changes: 1 })),
);
const get = vi.hoisted(() =>
  vi.fn((_sql: string, _params?: unknown[]) => ({ value: "3" }) as Record<string, unknown> | undefined),
);
const transaction = vi.hoisted(() => vi.fn((fn: () => void) => fn()));

vi.mock("@/lib/db/driver", () => ({
  getAdapter: vi.fn(async () => ({ run, get, transaction })),
}));

import { deleteAgentSkillWithFiles } from "@/lib/db/repos/agentSkillsRepo";

/**
 * Deleting a skill used to be two sequential awaits in the route handler, each
 * opening its own transaction: files first, then the row. A failure between
 * them left a skill whose files had vanished — the row still listed, but
 * `load_skill_file` finding nothing.
 *
 * Both tables have to go in one transaction, so there is no window where one
 * is gone and the other is not.
 */
describe("deleteAgentSkillWithFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockReturnValue({ value: "3" });
  });

  it("removes the files and the row inside a single transaction", async () => {
    await deleteAgentSkillWithFiles("skill-1");

    expect(transaction).toHaveBeenCalledTimes(1);

    const statements = run.mock.calls.map(([sql]) => String(sql));
    const files = statements.findIndex((sql) => sql.includes("DELETE FROM agentSkillFiles"));
    const row = statements.findIndex((sql) => sql.includes("DELETE FROM agentSkills "));
    expect(files).toBeGreaterThanOrEqual(0);
    expect(row).toBeGreaterThanOrEqual(0);

    expect(run.mock.calls[files]![1]).toEqual(["skill-1"]);
    expect(run.mock.calls[row]![1]).toEqual(["skill-1"]);
  });

  it("bumps the skill revision so readers invalidate their cache", async () => {
    await deleteAgentSkillWithFiles("skill-1");

    const bump = run.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO _meta"));
    expect(bump).toBeDefined();
    expect(bump![1]).toEqual(["agentSkillsRevision", "4"]);
  });
});
