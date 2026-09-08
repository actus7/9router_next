import { PROVIDERS, isDashboardUrl, ownsJob, permissionOrigin, zaiCaptcha, isZaiCompletion } from "./providers.js";
import { captureStoredCredential } from "./captureStoredCredential.js";

// Serialize events so concurrent tab/network events cannot replace or consume a job twice.
let work = Promise.resolve();
const queue = (fn) => { const result = work.then(fn); work = result.catch(() => {}); return result; };
const bodies = new Map();

async function clearJob() {
  bodies.clear();
  await chrome.storage.session.remove("job");
  await chrome.alarms.clear("capture-expiry");
  await chrome.action.setBadgeText({ text: "" });
}

async function jobNow() {
  const { job } = await chrome.storage.session.get("job");
  if (job && job.expiresAt <= Date.now()) { await clearJob(); return null; }
  return job;
}

async function deliver(job, result) {
  await clearJob();
  const tab = await chrome.tabs.get(job.dashboardTab).catch(() => null);
  const { trustedOrigins = [] } = await chrome.storage.local.get("trustedOrigins");
  if (!tab?.url || !isDashboardUrl(tab.url) || new URL(tab.url).origin !== job.origin || !trustedOrigins.includes(job.origin)) return;
  // documentId binds the handoff to the initiating document, including across navigations.
  await chrome.tabs.sendMessage(job.dashboardTab, { ...result, requestId: job.requestId }, { documentId: job.documentId }).catch(() => {});
}

async function authorize(tabId, expectedOrigin) {
  const tab = await chrome.tabs.get(tabId);
  if (!isDashboardUrl(tab.url) || new URL(tab.url).origin !== expectedOrigin) throw new Error("Abra o dashboard do ModelHub antes de autorizar.");
  const pattern = permissionOrigin(tab.url);
  if (!await chrome.permissions.contains({ origins: [pattern] })) throw new Error("Permissão do site não concedida.");
  const { trustedOrigins = [] } = await chrome.storage.local.get("trustedOrigins");
  const origins = [...new Set([...trustedOrigins, expectedOrigin])];
  await chrome.storage.local.set({ trustedOrigins: origins });
  const scripts = await chrome.scripting.getRegisteredContentScripts();
  if (scripts.length) await chrome.scripting.unregisterContentScripts({ ids: scripts.map((script) => script.id) });
  await chrome.scripting.registerContentScripts([{
    // Next can enter the dashboard from /auth without loading a new document.
    // The bridge and worker still accept requests only from dashboard paths.
    id: "modelhub-bridge", matches: [...new Set(origins.map(permissionOrigin))],
    js: ["bridge.js"], runAt: "document_start", allFrames: false,
  }]);
  await chrome.scripting.executeScript({ target: { tabId }, files: ["bridge.js"] });
  return { ok: true };
}

async function handlePopup(msg) {
  if (msg.type === "authorize") return authorize(msg.tabId, msg.origin);
  if (msg.type === "popup-state") return { job: await jobNow() };
  if (msg.type === "revoke") {
    const job = await jobNow();
    if (job) await deliver(job, { type: "error", error: "A autorização da extensão foi removida." });
    await chrome.storage.local.remove("trustedOrigins");
    await chrome.scripting.unregisterContentScripts();
    const granted = await chrome.permissions.getAll();
    if (granted.origins?.length) await chrome.permissions.remove({ origins: granted.origins });
    return { ok: true };
  }
  const job = await jobNow();
  if (!job || job.requestId !== msg.requestId) throw new Error("A solicitação expirou. Conecte novamente pelo ModelHub.");
  if (msg.type === "reject") { await deliver(job, { type: "error", error: "Conexão cancelada na extensão." }); return { ok: true }; }
  if (msg.type !== "approve" || job.providerTab) throw new Error("Solicitação inválida.");
  const config = PROVIDERS[job.provider];
  const permissions = { origins: [permissionOrigin(config.url)], ...(config.mode === "cookies" ? { permissions: ["cookies"] } : {}) };
  if (!await chrome.permissions.contains(permissions)) throw new Error("Autorize o acesso ao provider para continuar.");
  await syncWebRequestListeners();
  const tab = await chrome.tabs.create({ url: "about:blank" });
  await chrome.storage.session.set({ job: { ...job, providerTab: tab.id } });
  await chrome.tabs.update(tab.id, { url: config.url });
  return { ok: true };
}

async function handle(msg, sender) {
  if (sender.id !== chrome.runtime.id) return;
  if (sender.url === chrome.runtime.getURL("popup.html")) return handlePopup(msg);
  if (msg.type === "capture-tick") {
    const job = await jobNow();
    if (!job || sender.tab?.id !== job.providerTab || sender.frameId !== 0 || new URL(sender.url).origin !== new URL(PROVIDERS[job.provider].url).origin) return { active: false };
    const credential = await captureStoredCredential(job, PROVIDERS[job.provider]);
    if (credential) await deliver(job, { type: "captured", credential });
    return { active: !credential };
  }
  const { trustedOrigins = [] } = await chrome.storage.local.get("trustedOrigins");
  if (sender.frameId !== 0 || !sender.documentId || !sender.tab?.id) return;
  const dashboard = await chrome.tabs.get(sender.tab.id).catch(() => null);
  // sender.url can remain the login URL after Next's same-document navigation.
  // Trust the browser's current tab URL only when its origin still matches.
  if (!isDashboardUrl(dashboard?.url) || !sender.url ||
      new URL(sender.url).origin !== new URL(dashboard.url).origin ||
      !trustedOrigins.includes(new URL(dashboard.url).origin)) return;
  sender = { ...sender, url: dashboard.url };
  if (typeof msg.requestId !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(msg.requestId)) return;
  if (msg.type === "hello") return { type: "hello", protocol: 1, version: chrome.runtime.getManifest().version, providers: Object.keys(PROVIDERS) };
  const job = await jobNow();
  if (msg.type === "cancel") { if (ownsJob(job, sender, msg.requestId)) await clearJob(); return; }
  if (msg.type !== "connect") return;
  if (!Object.hasOwn(PROVIDERS, msg.provider)) throw new Error("Este provider requer entrada manual.");
  if (job) throw new Error("Já existe uma conexão em andamento. Cancele ou conclua essa conexão primeiro.");
  const next = { requestId: msg.requestId, provider: msg.provider, dashboardTab: sender.tab.id, documentId: sender.documentId, origin: new URL(sender.url).origin, expiresAt: Date.now() + 180000 };
  await chrome.storage.session.set({ job: next });
  await chrome.alarms.create("capture-expiry", { when: next.expiresAt });
  await chrome.action.setBadgeText({ text: "1" });
  // Older/unsupported popup behavior has a visible toolbar fallback in the dashboard.
  void chrome.action.openPopup().catch(() => {});
  return { type: "pending" };
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  queue(() => handle(msg, sender)).then(respond).catch(() => respond({ type: "error", error: "Não foi possível conectar. Verifique as permissões da extensão e tente novamente." }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== "complete") return;
  void queue(async () => {
    const job = await jobNow();
    if (!job || job.providerTab !== tabId) return;
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || new URL(tab.url).origin !== new URL(PROVIDERS[job.provider].url).origin) return;
    await chrome.scripting.executeScript({ target: { tabId }, files: ["capture.js"] }).catch(() => {});
  });
});
chrome.tabs.onRemoved.addListener((tabId) => { void queue(async () => {
  const job = await jobNow();
  if (job?.dashboardTab === tabId) await clearJob();
  else if (job?.providerTab === tabId) await deliver(job, { type: "error", error: "A aba do provider foi fechada. Conecte novamente para tentar outra vez." });
}); });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "capture-expiry") void queue(async () => {
  const { job } = await chrome.storage.session.get("job");
  if (job) await deliver(job, { type: "error", error: "O tempo de conexão terminou. Tente novamente." });
}); });

const captureRequestBody = (details) => { void queue(async () => {
  const job = await jobNow();
  if (job?.provider !== "zai-web" || job.providerTab !== details.tabId || !isZaiCompletion(details.url)) return;
  const captcha = zaiCaptcha(details.requestBody);
  if (captcha) bodies.set(details.requestId, { captcha, requestId: job.requestId });
}); };

const captureRequestHeaders = (details) => { void queue(async () => {
  const captured = bodies.get(details.requestId);
  bodies.delete(details.requestId);
  const job = await jobNow();
  if (!captured || !job || captured.requestId !== job.requestId || job.providerTab !== details.tabId || !isZaiCompletion(details.url)) return;
  const token = details.requestHeaders?.find((header) => header.name.toLowerCase() === "authorization")?.value?.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.length > 32768) return;
  await deliver(job, { type: "captured", credential: JSON.stringify({ token, captcha_verify_param: captured.captcha }) });
}); };

const forgetBody = (details) => { void queue(() => { bodies.delete(details.requestId); }); };
let observingRequests = false;
async function syncWebRequestListeners() {
  const granted = await chrome.permissions.contains({ origins: ["https://chat.z.ai/*"] });
  if (granted === observingRequests) return;
  if (granted) {
    const filter = { urls: ["https://chat.z.ai/*"] };
    chrome.webRequest.onBeforeRequest.addListener(captureRequestBody, filter, ["requestBody"]);
    chrome.webRequest.onBeforeSendHeaders.addListener(captureRequestHeaders, filter, ["requestHeaders"]);
    chrome.webRequest.onCompleted.addListener(forgetBody, filter);
    chrome.webRequest.onErrorOccurred.addListener(forgetBody, filter);
  } else {
    chrome.webRequest.onBeforeRequest.removeListener(captureRequestBody);
    chrome.webRequest.onBeforeSendHeaders.removeListener(captureRequestHeaders);
    chrome.webRequest.onCompleted.removeListener(forgetBody);
    chrome.webRequest.onErrorOccurred.removeListener(forgetBody);
    bodies.clear();
  }
  observingRequests = granted;
}

// Optional manifest hosts are not grants. Register only after checking access,
// including on worker restart and when the user grants or revokes permissions.
const syncPermissions = () => { void queue(syncWebRequestListeners); };
chrome.permissions.onAdded.addListener(syncPermissions);
chrome.permissions.onRemoved.addListener(syncPermissions);
syncPermissions();
