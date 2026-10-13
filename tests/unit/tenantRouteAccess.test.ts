import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a member may reach through the dashboard API. Reads are closed by
 * default — the database export, the provider list and the CLI settings all
 * hand back credentials — and a member's access policy is a ceiling over the
 * dashboard routes too, not only over the gateway and the chat worker.
 */

const context = vi.hoisted(() => ({ value: { tenantId: "org-1", actorUserId: "member-b", role: "member" } as const }));
const layers = vi.hoisted(() => ({ value: [] as unknown[], fail: false }));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("@/lib/auth/server", () => ({
  auth: { getSession: async () => ({ data: { user: { id: "member-b" }, session: { activeOrganizationId: "org-1" } }, error: null }) },
}));
vi.mock("@/lib/auth/organizations", () => ({
  resolveTenantContext: async () => context.value,
}));
vi.mock("@/lib/db/repos/accessPoliciesRepo", () => ({
  accessLayersForActor: async () => {
    if (layers.fail) throw new Error("db down");
    return layers.value;
  },
}));

import { tenantRoute } from "@/server/application/http/tenantRoute";
import { isAllowedByAccess } from "@/server/llm-gateway/application/accessScope";

const get = () => new Request("http://localhost/api/x", { method: "GET" });

beforeEach(() => {
  layers.value = [];
  layers.fail = false;
});

describe("tenantRoute for a member", () => {
  it("closes a read that did not say a member may make it", async () => {
    const handler = vi.fn(async (_request: Request) => Response.json({ secret: "x" }));
    const response = await tenantRoute(handler)(get());
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("opens a read that says so", async () => {
    const response = await tenantRoute(async (_request: Request) => Response.json({ ok: true }), { minRole: "member" })(get());
    expect(response.status).toBe(200);
  });

  it("runs the handler under the member's access policy", async () => {
    layers.value = [{ plugins: ["tool-search"] }];
    const seen: boolean[] = [];
    await tenantRoute(async (_request: Request) => {
      seen.push(isAllowedByAccess("plugins", "tool-search"), isAllowedByAccess("plugins", "tool-memory"));
      return Response.json({});
    }, { minRole: "member" })(get());
    expect(seen).toEqual([true, false]);
  });

  it("answers 503 when the policy cannot be read, never runs the handler", async () => {
    layers.fail = true;
    const handler = vi.fn(async (_request: Request) => Response.json({}));
    const response = await tenantRoute(handler, { minRole: "member" })(get());
    expect(response.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
  });
});
