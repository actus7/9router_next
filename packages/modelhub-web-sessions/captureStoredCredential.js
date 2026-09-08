import { cookieCredential } from "./providers.js";

export async function captureStoredCredential(job, config) {
  if (config.mode === "cookies") {
    return cookieCredential(config, await chrome.cookies.getAll({ url: config.url }));
  }
  if (config.mode === "storage") {
    const result = await chrome.scripting.executeScript({
      target: { tabId: job.providerTab },
      func: (key, origin) => location.origin === origin ? localStorage.getItem(key) : null, args: [config.key, new URL(config.url).origin],
    });
    const value = result[0]?.result;
    if (typeof value !== "string" || !value || value.length > 32768) return null;
    try { const decoded = JSON.parse(value); return typeof decoded === "string" ? decoded : null; }
    catch { return value; }
  }
  return null;
}
