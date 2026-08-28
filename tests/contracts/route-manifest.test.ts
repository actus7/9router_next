import { describe, it, expect } from "vitest";
import manifest from "../contracts/route-manifest.json";

// ── (a) ≥140 routes ─────────────────────────────────────────────────────────
describe("route manifest", () => {
  it("has ≥140 routes", () => {
    expect(manifest.routes.length).toBeGreaterThanOrEqual(140);
  });

  // ── (b) 16 critical gateway routes with correct methods ───────────────────
  describe("critical gateway routes", () => {
    // Each entry: [path, requiredMethod]
    // All gateway routes also have OPTIONS per the manifest.
    const critical: [string, string][] = [
      ["//api/v1/chat/completions", "POST"],
      ["//api/v1/messages", "POST"],
      ["//api/v1/responses", "POST"],
      ["//api/v1/responses/compact", "POST"],
      ["//api/v1/api/chat", "POST"],
      ["//api/v1/embeddings", "POST"],
      ["//api/v1/search", "POST"],
      ["//api/v1/web/fetch", "POST"],
      ["//api/v1/audio/speech", "POST"],
      ["//api/v1/audio/transcriptions", "POST"],
      ["//api/v1/images/generations", "POST"],
      ["//api/v1/videos/generations", "POST"],
      ["//api/v1/videos/edits", "POST"],
      ["//api/v1/videos/extensions", "POST"],
      ["//api/v1/videos/[id]", "GET"],
      ["//api/v1beta/models/[...path]", "POST"],
    ];

    for (const [path, method] of critical) {
      it(`${path} has ${method}`, () => {
        const route = (manifest.routes as Array<{ path: string; methods: string[] }>).find(
          (r) => r.path === path
        );
        expect(route, `route ${path} not found in manifest`).toBeDefined();
        expect(route!.methods).toContain(method);
      });

      it(`${path} has OPTIONS`, () => {
        const route = (manifest.routes as Array<{ path: string; methods: string[] }>).find(
          (r) => r.path === path
        );
        expect(route).toBeDefined();
        expect(route!.methods).toContain("OPTIONS");
      });
    }
  });

  // ── (c) no duplicate paths ────────────────────────────────────────────────
  it("no duplicate paths", () => {
    const paths = (manifest.routes as Array<{ path: string }>).map((r) => r.path);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });
});
