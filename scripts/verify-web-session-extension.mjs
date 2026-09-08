// Browser integration using synthetic accounts only. Pass an installed Playwright module
// and Chromium executable; production dependencies are not changed by this script.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [playwrightPath, executablePath] = process.argv.slice(2);
if (!playwrightPath || !executablePath) throw new Error("Usage: node scripts/verify-web-session-extension.mjs <playwright/index.mjs> <chromium executable>");
const { chromium } = await import(pathToFileURL(resolve(playwrightPath)).href);
const source = resolve("packages/modelhub-web-sessions");
const output = mkdtempSync(resolve(tmpdir(), "modelhub-extension-qa-"));
const launch = (extension) => chromium.launchPersistentContext("", {
  executablePath, headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const workerFor = async (context) => context.serviceWorkers()[0] || context.waitForEvent("serviceworker");

// Load the exact distributed manifest first, with no pre-granted host access.
const smoke = await launch(source);
try {
  const worker = await workerFor(smoke);
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.version, "1.0.1");
  assert.equal(manifest.host_permissions, undefined);
  const networkAccess = await worker.evaluate(async () => ({
    granted: await chrome.permissions.contains({ origins: ["https://chat.z.ai/*"] }),
    listeners: ["onBeforeRequest", "onBeforeSendHeaders", "onCompleted", "onErrorOccurred"]
      .map((name) => chrome.webRequest[name].hasListeners()),
  }));
  assert.equal(networkAccess.granted, false);
  assert.deepEqual(networkAccess.listeners, [false, false, false, false]);
  console.log("PASS: original Manifest V3 loads without host access and registers no unauthorized webRequest listeners.");
  const page = await smoke.newPage();
  await page.goto("http://localhost:3000/dashboard/web-providers", { timeout: 30000 }).catch(() => {});
  await page.screenshot({ path: resolve(output, "dashboard.png"), fullPage: true });
  console.log(`Dashboard observed at: ${page.url()}`);
} finally { await smoke.close(); }

// Optional host permission dialogs need a human in a normal browser. Pre-grant only
// fixture hosts in this temporary copy to exercise the actual MV3 network/bridge APIs.
const fixture = resolve(output, "extension");
cpSync(source, fixture, { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(fixture, "manifest.json"), "utf8"));
manifest.host_permissions = ["http://localhost/*", "https://chat.z.ai/*", "https://app.blackbox.ai/*", "https://www.kimi.ai/*"];
manifest.permissions.push("cookies");
writeFileSync(resolve(fixture, "manifest.json"), JSON.stringify(manifest));
const context = await launch(fixture);
try {
  const worker = await workerFor(context);
  const extensionId = new URL(worker.url()).hostname;
  const origin = "http://localhost:19087";
  // Route every destination to a fixture; no real provider/account traffic is sent.
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "chrome-extension:") return route.continue();
    if (url.origin === origin) return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>ModelHub fixture</title><h1>ModelHub fixture</h1>" });
    if (url.origin === "https://chat.z.ai") return route.fulfill({ contentType: url.pathname.startsWith("/api/") ? "application/json" : "text/html", body: url.pathname.startsWith("/api/") ? "{}" : "<!doctype html><title>Z.ai fixture</title><h1>Account fixture</h1>" });
    if (["https://app.blackbox.ai", "https://www.kimi.ai"].includes(url.origin)) return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Session fixture</title>" });
    return route.abort();
  });
  const dashboard = await context.newPage();
  await dashboard.goto(`${origin}/dashboard/providers/zai-web`);
  const dashboardTab = await worker.evaluate(async (origin) => (await chrome.tabs.query({})).find((tab) => tab.url?.startsWith(origin)).id, origin);
  const authorization = await context.newPage();
  await authorization.goto(`chrome-extension://${extensionId}/popup.html`);
  const authorized = await authorization.evaluate(({ origin, tabId }) =>
    chrome.runtime.sendMessage({ type: "authorize", origin, tabId }), { origin, tabId: dashboardTab });
  assert.equal(authorized.ok, true);
  await authorization.close();
  // Next's login returns through client navigation without replacing the document.
  await dashboard.goto(`${origin}/auth/sign-in`);
  await dashboard.evaluate(() => history.pushState({}, "", "/dashboard/providers/zai-web"));
  await dashboard.evaluate(() => {
    window.fixtureReplies = [];
    window.addEventListener("message", (event) => { if (event.data?.direction === "extension") window.fixtureReplies.push(event.data); });
    window.postMessage({ channel: "modelhub-web-session-v1", direction: "dashboard", requestId: "hello-000000000000001", type: "hello" }, location.origin);
  });
  await dashboard.waitForFunction(() => window.fixtureReplies.some((reply) => reply.type === "hello"), undefined, { timeout: 5000 });
  console.log("PASS: actual content script and service worker complete detection after client-side login navigation.");
  await dashboard.evaluate(() => window.postMessage({ channel: "modelhub-web-session-v1", direction: "dashboard", requestId: "capture-000000000001", type: "connect", provider: "zai-web" }, location.origin));
  await dashboard.waitForFunction(() => window.fixtureReplies.some((reply) => reply.type === "pending"));
  const popup = await context.newPage();
  popup.on("pageerror", (error) => console.error("Popup error:", error.message));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole("button", { name: "Autorizar e abrir Z.ai Web" }).waitFor({ timeout: 10000 }).catch(async (error) => {
    console.error("Popup state:", await popup.locator("body").innerText());
    throw error;
  });
  await popup.screenshot({ path: resolve(output, "confirmation.png") });
  const providerPromise = context.waitForEvent("page");
  await popup.getByRole("button", { name: "Autorizar e abrir Z.ai Web" }).click();
  const provider = await providerPromise;
  await provider.waitForURL("https://chat.z.ai/");
  await provider.evaluate(async () => {
    await fetch("/api/v2/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer browser-fixture-token" }, body: JSON.stringify({ captcha_verify_param: "browser-fixture-captcha", messages: [{ content: "fixture only" }] }) });
  });
  await dashboard.waitForFunction(() => window.fixtureReplies.some((reply) => reply.type === "captured"), undefined, { timeout: 10000 });
  const captured = await dashboard.evaluate(() => window.fixtureReplies.find((reply) => reply.type === "captured"));
  assert.deepEqual(JSON.parse(captured.credential), { token: "browser-fixture-token", captcha_verify_param: "browser-fixture-captcha" });
  assert.equal(await worker.evaluate(async () => !!(await chrome.storage.session.get("job")).job), false);
  console.log("PASS: confirmation -> provider tab -> real webRequest events -> paired token/captcha -> initiating dashboard document; job cleared.");
  await context.addCookies([{ name: "__Secure-next-auth.session-token", value: "cookie-fixture", url: "https://app.blackbox.ai", httpOnly: true, secure: true }]);
  await context.addInitScript(() => {
    if (location.origin === "https://www.kimi.ai") localStorage.setItem("access_token", JSON.stringify("storage-fixture"));
  });
  for (const fixture of [
    { provider: "blackbox-web", name: "Blackbox Web", url: "https://app.blackbox.ai/", credential: "__Secure-next-auth.session-token=cookie-fixture" },
    { provider: "kimi-web", name: "Kimi Web", url: "https://www.kimi.ai/", credential: "storage-fixture" },
  ]) {
    const requestId = `capture-${fixture.provider}-00000001`;
    await dashboard.evaluate(({ provider, requestId }) => window.postMessage({ channel: "modelhub-web-session-v1", direction: "dashboard", requestId, type: "connect", provider }, location.origin), { provider: fixture.provider, requestId });
    await dashboard.waitForFunction((requestId) => window.fixtureReplies.some((reply) => reply.type === "pending" && reply.requestId === requestId), requestId);
    const confirmation = await context.newPage();
    await confirmation.goto(`chrome-extension://${extensionId}/popup.html`);
    const opened = context.waitForEvent("page");
    await confirmation.getByRole("button", { name: `Autorizar e abrir ${fixture.name}` }).click();
    const account = await opened;
    await account.waitForURL(fixture.url);
    await dashboard.waitForFunction((requestId) => window.fixtureReplies.some((reply) => reply.type === "captured" && reply.requestId === requestId), requestId, { timeout: 10000 });
    const result = await dashboard.evaluate((requestId) => window.fixtureReplies.find((reply) => reply.type === "captured" && reply.requestId === requestId), requestId);
    assert.equal(result.credential, fixture.credential);
    assert.equal(await worker.evaluate(async () => !!(await chrome.storage.session.get("job")).job), false);
    console.log(`PASS: ${fixture.name} captures its fixture session and clears the job.`);
    await account.close();
  }
  console.log(`Screenshots: ${output}`);
} finally { await context.close(); }
