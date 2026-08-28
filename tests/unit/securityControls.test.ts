import { describe, expect, it } from "vitest";
import { assertPublicUrl } from "@/shared/utils/ssrfGuard";
import { maskKey } from "@/server/llm-gateway/utils/logger";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * FASE 6 (PLANOMIGRACAOOPENSSE.md) — security controls pinned by tests:
 * SSRF guard behavior, secret masking, and client-safe catalog purity.
 */

describe("SSRF guard (assertPublicUrl)", () => {
  it("allows public hosts and IPs", () => {
    expect(() => assertPublicUrl("https://example.com/path")).not.toThrow();
    expect(() => assertPublicUrl("http://8.8.8.8:443/x")).not.toThrow();
    expect(() => assertPublicUrl("https://api.openai.com/v1")).not.toThrow();
  });

  it("blocks localhost-style hostnames", () => {
    expect(() => assertPublicUrl("http://localhost:3000/api")).toThrow(/internal host/);
    expect(() => assertPublicUrl("http://ip6-loopback/x")).toThrow(/internal host/);
  });

  it("blocks internal-use suffixes", () => {
    expect(() => assertPublicUrl("http://db.internal/x")).toThrow(/internal host/);
    expect(() => assertPublicUrl("http://nas.local/x")).toThrow(/internal host/);
    expect(() => assertPublicUrl("http://svc.localhost/x")).toThrow(/internal host/);
  });

  it("blocks private/reserved IPv4 ranges", () => {
    for (const ip of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.16.1.1", "172.31.255.255", "192.168.0.10", "0.0.0.0"]) {
      expect(() => assertPublicUrl(`http://${ip}/x`), ip).toThrow(/private IP/);
    }
  });

  it("does not block public IPv4 near range boundaries", () => {
    expect(() => assertPublicUrl("http://172.32.0.1/x")).not.toThrow();
    expect(() => assertPublicUrl("http://8.8.4.4/x")).not.toThrow();
  });

  it("blocks IPv6 loopback/link-local/ULA (including v4-mapped)", () => {
    expect(() => assertPublicUrl("http://[::1]/x")).toThrow(/private IP/);
    expect(() => assertPublicUrl("http://[fe80::1]/x")).toThrow(/private IP/);
    expect(() => assertPublicUrl("http://[fd00::1]/x")).toThrow(/private IP/);
    expect(() => assertPublicUrl("http://[::ffff:127.0.0.1]/x")).toThrow(/private IP/);
  });
});

describe("secret masking (maskKey)", () => {
  it("masks keys keeping only 4+4 chars", () => {
    expect(maskKey("sk-1234567890abcdef")).toBe("sk-1...cdef");
  });

  it("fully masks short/empty/absent keys", () => {
    expect(maskKey("short")).toBe("***");
    expect(maskKey("1234567")).toBe("***");
    expect(maskKey("")).toBe("***");
    expect(maskKey(null)).toBe("***");
    expect(maskKey(undefined)).toBe("***");
  });
});

describe("client-safe catalog purity", () => {
  const CATALOG = join(__dirname, "..", "..", "src", "shared", "llm-catalog");
  const FORBIDDEN_TOKENS = [
    '"server-only"',
    '"node:',
    '"@/lib/localDb"',
    '"@/lib/usageDb"',
    '"@/lib/db',
    '"child_process"',
  ];

  function listFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...listFiles(full));
      else if (entry.endsWith(".ts")) out.push(full);
    }
    return out;
  }

  it("llm-catalog contains no server-only / node / database imports", () => {
    const offenders: string[] = [];
    for (const file of listFiles(CATALOG)) {
      const content = readFileSync(file, "utf8");
      for (const token of FORBIDDEN_TOKENS) {
        if (content.includes(token)) offenders.push(`${file} -> ${token}`);
      }
    }
    expect(offenders.join("\n")).toBe("");
  });
});
