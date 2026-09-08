import { afterEach, describe, expect, it, vi } from "vitest";

function event() {
  const listeners = new Set<(...args: unknown[]) => unknown>();
  return {
    addListener: vi.fn((callback: (...args: unknown[]) => unknown) => { listeners.add(callback); }),
    removeListener: vi.fn((callback: (...args: unknown[]) => unknown) => { listeners.delete(callback); }),
    emit: (...args: unknown[]) => [...listeners].map((callback) => callback(...args)),
  };
}

async function setup(hasWebHost = true) {
  vi.resetModules();
  const local: Record<string, unknown> = { trustedOrigins: ["http://localhost:3000"] };
  const session: Record<string, unknown> = {};
  const area = (values: Record<string, unknown>) => ({
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
    set: vi.fn(async (update: Record<string, unknown>) => { Object.assign(values, update); }),
    remove: vi.fn(async (key: string) => { delete values[key]; }),
  });
  const chrome = {
    runtime: { id: "extension", getURL: (path: string) => `chrome-extension://extension/${path}`, getManifest: () => ({ version: "1.0.0" }), onMessage: event() },
    storage: { session: area(session), local: area(local) },
    permissions: { contains: vi.fn(async () => hasWebHost), getAll: vi.fn(async () => ({ origins: [] })), remove: vi.fn(), onAdded: event(), onRemoved: event() },
    action: { setBadgeText: vi.fn(), openPopup: vi.fn(async () => {}) },
    alarms: { create: vi.fn(), clear: vi.fn(), onAlarm: event() },
    scripting: { executeScript: vi.fn(async () => []), getRegisteredContentScripts: vi.fn(async () => []), registerContentScripts: vi.fn(), unregisterContentScripts: vi.fn() },
    tabs: {
      get: vi.fn(async () => ({ id: 10, url: "http://localhost:3000/dashboard/providers/zai-web" })),
      create: vi.fn(async () => ({ id: 20 })), update: vi.fn(), sendMessage: vi.fn(async () => ({ received: true })),
      onUpdated: event(), onRemoved: event(),
    },
    webRequest: { onBeforeRequest: event(), onBeforeSendHeaders: event(), onCompleted: event(), onErrorOccurred: event() },
  };
  vi.stubGlobal("chrome", chrome);
  await import("../../packages/modelhub-web-sessions/background.js");
  const sender = { id: "extension", url: "http://localhost:3000/dashboard/providers/zai-web", documentId: "dashboard-document", frameId: 0, tab: { id: 10 } };
  const popup = { id: "extension", url: "chrome-extension://extension/popup.html" };
  const requestId = "request-000000000000001";
  const send = (message: Record<string, unknown>, from = sender) => new Promise<Record<string, unknown> | undefined>((resolve) => chrome.runtime.onMessage.emit(message, from, resolve));
  const drain = () => send({ type: "hello", requestId });
  const connect = () => send({ type: "connect", requestId, provider: "zai-web" });
  const approve = () => send({ type: "approve", requestId }, popup as typeof sender);
  return { chrome, session, sender, popup, requestId, send, drain, connect, approve };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("extension worker session lifecycle", () => {
  it("registers network observers only with host access and removes them when access is revoked", async () => {
    const app = await setup(false);
    await app.drain();
    for (const event of Object.values(app.chrome.webRequest)) expect(event.addListener).not.toHaveBeenCalled();
    app.chrome.permissions.contains.mockResolvedValue(true);
    app.chrome.permissions.onAdded.emit({ origins: ["https://chat.z.ai/*"] });
    await app.drain();
    for (const event of Object.values(app.chrome.webRequest)) expect(event.addListener).toHaveBeenCalledTimes(1);
    app.chrome.permissions.onAdded.emit({ origins: ["http://localhost/*"] });
    await app.drain();
    for (const event of Object.values(app.chrome.webRequest)) expect(event.addListener).toHaveBeenCalledTimes(1);
    app.chrome.permissions.contains.mockResolvedValue(false);
    app.chrome.permissions.onRemoved.emit({ origins: ["https://chat.z.ai/*"] });
    await app.drain();
    for (const event of Object.values(app.chrome.webRequest)) expect(event.removeListener).toHaveBeenCalledTimes(1);
  });
  it("restores observers after worker startup with previously granted host access", async () => {
    const app = await setup();
    await app.drain();
    for (const event of Object.values(app.chrome.webRequest)) expect(event.addListener).toHaveBeenCalledTimes(1);
  });
  it("accepts dashboard navigation from the same login document and still binds cancellation", async () => {
    const app = await setup();
    const loginDocument = { ...app.sender, url: "http://localhost:3000/auth/sign-in" };
    const hello = await app.send({ type: "hello", requestId: app.requestId }, loginDocument);
    expect(hello?.type).toBe("hello");
    await app.send({ type: "connect", requestId: app.requestId, provider: "zai-web" }, loginDocument);
    expect(app.session.job).toBeDefined();
    await app.send({ type: "cancel", requestId: app.requestId }, loginDocument);
    expect(app.session.job).toBeUndefined();
  });
  it("requires popup consent and refuses forged cancellation", async () => {
    const app = await setup();
    await app.connect();
    expect(app.chrome.tabs.create).not.toHaveBeenCalled();
    expect(await app.send({ type: "approve", requestId: app.requestId })).toBeUndefined();
    await app.send({ type: "cancel", requestId: app.requestId }, { ...app.sender, documentId: "other-document" });
    expect(app.session.job).toBeDefined();
    await app.approve();
    expect(app.chrome.tabs.update).toHaveBeenCalledWith(20, { url: "https://chat.z.ai" });
    await app.send({ type: "cancel", requestId: app.requestId });
    expect(app.session.job).toBeUndefined();
  });
  it("hands off the paired Z.ai token and captcha only from the approved tab", async () => {
    const app = await setup();
    await app.connect(); await app.approve();
    const body = { raw: [{ bytes: new TextEncoder().encode('{"captcha_verify_param":"verification","messages":[{"content":"private"}]}').buffer }] };
    const request = { url: "https://chat.z.ai/api/v2/chat/completions", requestId: "network-1", tabId: 99, requestBody: body };
    app.chrome.webRequest.onBeforeRequest.emit(request);
    app.chrome.webRequest.onBeforeSendHeaders.emit({ ...request, requestHeaders: [{ name: "Authorization", value: "Bearer fixture-token" }] });
    await app.drain();
    expect(app.chrome.tabs.sendMessage).not.toHaveBeenCalled();
    app.chrome.webRequest.onBeforeRequest.emit({ ...request, tabId: 20 });
    app.chrome.webRequest.onBeforeSendHeaders.emit({ ...request, tabId: 20, requestHeaders: [{ name: "Authorization", value: "Bearer fixture-token" }] });
    await app.drain();
    expect(app.chrome.tabs.sendMessage).toHaveBeenCalledWith(10, {
      type: "captured", requestId: app.requestId,
      credential: JSON.stringify({ token: "fixture-token", captcha_verify_param: "verification" }),
    }, { documentId: "dashboard-document" });
    expect(app.session.job).toBeUndefined();
    expect(JSON.stringify(app.chrome.storage.session.set.mock.calls)).not.toContain("fixture-token");
  });
  it("cancels when the provider tab closes and expires pending jobs", async () => {
    const app = await setup();
    await app.connect(); await app.approve();
    app.chrome.tabs.onRemoved.emit(20);
    await app.drain();
    expect(app.chrome.tabs.sendMessage).toHaveBeenCalledWith(10, expect.objectContaining({ type: "error" }), { documentId: "dashboard-document" });
    expect(app.session.job).toBeUndefined();
    await app.connect();
    app.chrome.alarms.onAlarm.emit({ name: "capture-expiry" });
    await app.drain();
    expect(app.session.job).toBeUndefined();
  });
  it("does not deliver credentials to a destination that navigated away", async () => {
    const app = await setup();
    await app.connect(); await app.approve();
    app.chrome.tabs.get.mockResolvedValue({ id: 10, url: "https://evil.example/dashboard/providers/zai-web" });
    app.chrome.tabs.onRemoved.emit(20);
    await app.drain();
    expect(app.chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(app.session.job).toBeUndefined();
  });
  it("does not accept untrusted ModelHub origins", async () => {
    const app = await setup();
    await app.send({ type: "connect", provider: "zai-web", requestId: app.requestId }, { ...app.sender, url: "http://localhost:4000/dashboard/providers/zai-web" });
    expect(app.session.job).toBeUndefined();
    expect(app.chrome.action.openPopup).not.toHaveBeenCalled();
  });
});
