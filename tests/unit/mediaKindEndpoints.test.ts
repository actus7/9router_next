import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";

const apiRoot = resolve(__dirname, "../../src/app/api");

// Kinds the catalog advertises before the endpoint exists. Keeping the list
// explicit means shipping a route removes an entry here instead of quietly
// making the guard below pass.
const NOT_IMPLEMENTED_KINDS: ReadonlySet<string> = new Set(["music"]);

function routeFileFor(path: string): string {
  // "/v1/audio/speech" is served by src/app/api/v1/audio/speech/route.ts
  return join(apiRoot, ...path.replace(/^\//, "").split("/"), "route.ts");
}

describe("media provider kind endpoints", () => {
  it("advertises only paths that a route actually serves", () => {
    const missing = MEDIA_PROVIDER_KINDS
      .filter((kind) => !NOT_IMPLEMENTED_KINDS.has(kind.id))
      .filter((kind) => !existsSync(routeFileFor(kind.endpoint.path)))
      .map((kind) => `${kind.id} → ${kind.endpoint.path}`);

    expect(missing).toEqual([]);
  });

  it("keeps every unimplemented kind in the catalog, so the list stays honest", () => {
    const declared = new Set(MEDIA_PROVIDER_KINDS.map((kind) => kind.id));
    for (const kind of NOT_IMPLEMENTED_KINDS) {
      expect(declared.has(kind), `${kind} is allowlisted but not declared`).toBe(true);
    }
  });

  it("declares POST for every kind", () => {
    for (const kind of MEDIA_PROVIDER_KINDS) {
      expect(kind.endpoint.method).toBe("POST");
    }
  });
});
