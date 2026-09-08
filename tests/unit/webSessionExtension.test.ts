import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import innerAi from "@/server/llm-gateway/engine/providers/registry/inner-ai";
import { PROVIDERS, cookieCredential, isDashboardUrl, isZaiCompletion, ownsJob, permissionOrigin, zaiCaptcha } from "../../packages/modelhub-web-sessions/providers.js";

describe("Web Session extension capture boundary", () => {
  it("opens Inner AI on its application origin so host-scoped session cookies can be captured", () => {
    expect(PROVIDERS["inner-ai"].url).toBe(innerAi.display.website);
  });
  it("allows HTTPS dashboards and exact loopback HTTP hosts only", () => {
    expect(isDashboardUrl("https://hub.example/dashboard/web-providers")).toBe(true);
    expect(isDashboardUrl("http://localhost:3000/dashboard/providers/zai-web")).toBe(true);
    for (const url of ["http://hub.example/dashboard/providers", "https://hub.example/", "https://user:pass@hub.example/dashboard/providers", "http://localhost.evil/dashboard/providers", "javascript:alert(1)"]) expect(isDashboardUrl(url)).toBe(false);
    expect(permissionOrigin("http://localhost:3000/dashboard/providers")).toBe("http://localhost/*");
  });
  it("binds jobs to document, origin including port, top frame, tab and request", () => {
    const job = { requestId: "request", dashboardTab: 4, documentId: "doc", origin: "http://localhost:3000" };
    const sender = { tab: { id: 4 }, documentId: "doc", frameId: 0, url: "http://localhost:3000/dashboard/providers/zai-web" };
    expect(ownsJob(job, sender, "request")).toBe(true);
    for (const change of [{ documentId: "new-document" }, { frameId: 1 }, { tab: { id: 5 } }, { url: "http://localhost:4000/dashboard/providers" }, { url: "https://evil.example/dashboard/providers" }]) expect(ownsJob(job, { ...sender, ...change }, "request")).toBe(false);
    expect(ownsJob(job, sender, "old-request")).toBe(false);
  });
  it("requires the full provider credential and omits unrelated cookies", () => {
    const config = PROVIDERS["yuanbao-web"];
    expect(cookieCredential(config, [{ name: "hy_user", value: "user" }])).toBeNull();
    expect(cookieCredential(config, [{ name: "hy_user", value: "user" }, { name: "hy_token", value: "token" }, { name: "analytics", value: "private" }])).toBe("hy_user=user; hy_token=token");
    expect(cookieCredential(PROVIDERS["blackbox-web"], [{ name: "__Secure-next-auth.session-token", value: "session" }])).toContain("session");
  });
  it("extracts only the Z.ai verification from a bounded JSON request", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ messages: [{ content: "private message" }], captcha_verify_param: "captcha" })).buffer;
    expect(zaiCaptcha({ raw: [{ bytes }] })).toBe("captcha");
    expect(zaiCaptcha({ raw: [{ bytes: new TextEncoder().encode("invalid").buffer }] })).toBeNull();
    expect(zaiCaptcha({ raw: [{ bytes: new ArrayBuffer(1048577) }] })).toBeNull();
    expect(zaiCaptcha({ raw: [{ file: "/private/file" }] })).toBeNull();
    expect(isZaiCompletion("https://chat.z.ai/api/v2/chat/completions?x=1")).toBe(true);
    expect(isZaiCompletion("https://chat.z.ai.evil/api/v2/chat/completions")).toBe(false);
    expect(isZaiCompletion("https://chat.z.ai/api/auth")).toBe(false);
  });
  it("ships no mandatory host or cookie access", () => {
    const manifest = JSON.parse(readFileSync("packages/modelhub-web-sessions/manifest.json", "utf8"));
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.permissions).not.toContain("cookies");
    expect(manifest.permissions).not.toContain("debugger");
    expect(manifest.optional_permissions).toContain("cookies");
  });
  it("serves a ZIP containing the current extension sources, with no extra files", () => {
    const zip = readFileSync("public/extensions/modelhub-web-sessions.zip");
    const names: string[] = [];
    let offset = 0;
    while (zip.readUInt32LE(offset) === 0x04034b50) {
      const length = zip.readUInt32LE(offset + 18);
      const nameLength = zip.readUInt16LE(offset + 26);
      const extraLength = zip.readUInt16LE(offset + 28);
      const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString();
      const start = offset + 30 + nameLength + extraLength;
      expect(name.startsWith("modelhub-web-sessions/")).toBe(true);
      expect(zip.subarray(start, start + length)).toEqual(readFileSync(`packages/${name}`));
      names.push(name);
      offset = start + length;
    }
    expect(names).toHaveLength(10);
    expect(names).toContain("modelhub-web-sessions/manifest.json");
    expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
  });
});
