// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CloudPageClient from "@/app/(dashboard)/dashboard/cloud/CloudPageClient";

// The failure this covers: actionError was rendered inside the
// `deployments.length > 0` block, so the one case that always has zero
// deployments — a deploy or disconnect that failed before any existed —
// showed nothing at all. The user saw a click that did nothing.
function mockFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (method === "DELETE" && url.includes("/api/cloud/connections/")) {
      return new Response(JSON.stringify({ error: "Falha proposital do teste" }), { status: 400 });
    }
    if (url.includes("/api/cloud/connections")) {
      return new Response(JSON.stringify({
        connections: [{ id: "c1", provider: "render", externalUserEmail: "a@b.com", externalOrgName: null }],
      }));
    }
    if (url.includes("/api/cloud/deployments")) return new Response(JSON.stringify({ deployments: [] }));
    if (url.includes("/api/keys")) return new Response(JSON.stringify({ keys: [{ id: "k1", key: "sk-1" }] }));
    if (url.includes("/api/providers")) return new Response(JSON.stringify({ connections: [] }));
    if (url.includes("/api/models/free")) return new Response(JSON.stringify({ groups: [] }));
    if (url.includes("/api/settings")) return new Response(JSON.stringify({ cloudEnabled: true }));
    return new Response(JSON.stringify(overrides));
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Cloud page action errors", () => {
  it("shows a failed action even when the account has no deployments", async () => {
    render(<CloudPageClient />);

    const disconnect = await screen.findByRole("button", { name: /desconectar/i });
    fireEvent.click(disconnect);

    await waitFor(() => {
      expect(screen.getByText("Falha proposital do teste")).toBeTruthy();
    });
  });
});
