// Explicit adapters. The popup requests only the selected adapter's origins.
export const PROVIDERS = {
  "zai-web": { name: "Z.ai Web", url: "https://chat.z.ai", mode: "zai" },
  "kimi-web": { name: "Kimi Web", url: "https://www.kimi.ai", mode: "storage", key: "access_token" },
  "blackbox-web": { name: "Blackbox Web", url: "https://app.blackbox.ai", mode: "cookies", names: ["next-auth.session-token", "__Secure-next-auth.session-token"], any: true },
  "conol-web": { name: "Conol Web", url: "https://conol.ai", mode: "cookies", names: ["__Secure-better-auth.session_token"] },
  "poe-web": { name: "Poe Web", url: "https://poe.com", mode: "cookies", names: ["p-b"] },
  "inner-ai": { name: "Inner AI", url: "https://app.innerai.com", mode: "cookies", names: ["token"] },
  "t3-web": { name: "T3 Web", url: "https://t3.chat", mode: "cookies", names: ["convex-session-id"], full: true },
  "yuanbao-web": { name: "Yuanbao Web", url: "https://yuanbao.tencent.com", mode: "cookies", names: ["hy_user", "hy_token"] },
  "zenmux-free": { name: "ZenMux Free", url: "https://zenmux.ai", mode: "cookies", names: ["ctoken"], full: true },
};

export function permissionOrigin(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

export function isDashboardUrl(value) {
  try {
    const url = new URL(value);
    const secure = url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
    return secure && !url.username && !url.password && url.pathname.startsWith("/dashboard/");
  } catch { return false; }
}

export function cookieCredential(config, cookies) {
  const found = config.names.filter((name) => cookies.some((cookie) => cookie.name === name && cookie.value));
  if (config.any ? found.length === 0 : found.length !== config.names.length) return null;
  const selected = config.full ? cookies : cookies.filter((cookie) => config.names.includes(cookie.name));
  return selected.filter((cookie) => cookie.value).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

export function zaiCaptcha(requestBody) {
  try {
    const raw = requestBody?.raw;
    if (!Array.isArray(raw) || raw.some((part) => !part.bytes)) return null;
    const size = raw.reduce((sum, part) => sum + part.bytes.byteLength, 0);
    if (size > 1048576) return null;
    const decoder = new TextDecoder();
    const body = raw.map((part) => decoder.decode(part.bytes, { stream: true })).join("") + decoder.decode();
    const value = JSON.parse(body).captcha_verify_param;
    return typeof value === "string" && value.length > 0 && value.length < 32768 ? value : null;
  } catch { return null; }
}

export function isZaiCompletion(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://chat.z.ai" && /^\/api\/(?:v2\/)?chat\/completions$/.test(parsed.pathname);
  } catch { return false; }
}

export function ownsJob(job, sender, requestId) {
  return !!job && job.requestId === requestId && job.dashboardTab === sender.tab?.id &&
    job.documentId === sender.documentId && sender.frameId === 0 &&
    isDashboardUrl(sender.url) && new URL(sender.url).origin === job.origin;
}
