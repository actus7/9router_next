import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Gateway architecture contract:
 * the engine consumes host capabilities ONLY through engine/host/* adapters.
 * Host modules (@/lib, @/shared, @/app, gateway barrels) are forbidden
 * elsewhere under engine/. This is the testable version of the ESLint rule
 * with the same scope.
 */

const ENGINE_ROOT = join(__dirname, "..", "..", "src", "server", "llm-gateway", "engine");
void (`${join("engine", "host")}`);
const FORBIDDEN = ["@/lib/", "@/shared/", "@/app/", "@/server/llm-gateway/"];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("engine/host seam", () => {
  it("engine modules import host code only via engine/host/* adapters", () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(ENGINE_ROOT)) {
      const rel = relative(ENGINE_ROOT, file).replace(/\\/g, "/");
      if (rel.startsWith("host/")) continue;
      const content = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        if (content.includes(`"${pattern}`) || content.includes(`'${pattern}`) || content.includes(`(${JSON.stringify(pattern)}`) === false && content.includes(`("${pattern}`)) {
          offenders.push(`${rel} -> ${pattern}`);
        }
      }
    }
    expect(offenders, `direct host imports outside host/:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("host adapters are the enumerated, documented surface", () => {
    const hostDir = join(ENGINE_ROOT, "host");
    const adapters = readdirSync(hostDir)
      .filter((f) => f.endsWith(".ts"))
      .sort();
    expect(adapters).toEqual(["catalog.ts", "oauth.ts", "routingTrace.ts", "ssrf.ts", "store.ts", "usage.ts"]);
  });

  it("engine is self-contained: no imports of removed legacy namespaces", () => {
    for (const file of listTsFiles(ENGINE_ROOT)) {
      const content = readFileSync(file, "utf8");
      expect(content, `${file} references legacy namespace`).not.toContain("@/lib/open-sse");
      expect(content, `${file} references legacy namespace`).not.toContain("@/sse/");
    }
  });
});
