function normalizeString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

const ALLOWED_PROXY_SCHEMES: string[] = ["http:", "https:", "socks5:", "socks4:", "socks5h:", "socks4a:"];

function validateProxyUrl(url: string): string | null {
  if (!url) return null;
  if (/[\n\r`$]/.test(url)) return null;
  try {
    const parsed: URL = new URL(url);
    if (!ALLOWED_PROXY_SCHEMES.includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

interface OutboundProxyConfig {
  outboundProxyEnabled?: boolean;
  outboundProxyUrl?: string;
  outboundNoProxy?: string;
}

export function applyOutboundProxyEnv(
  { outboundProxyEnabled, outboundProxyUrl, outboundNoProxy }: OutboundProxyConfig = {}
): void {
  if (typeof process === "undefined" || !process.env) return;
  const enabled: boolean = Boolean(outboundProxyEnabled);
  const proxyUrl: string = normalizeString(outboundProxyUrl);
  const noProxy: string = normalizeString(outboundNoProxy);

  // If disabled, only clear env vars we previously managed.
  if (!enabled) {
    if (process.env.NINE_ROUTER_PROXY_MANAGED === "1") {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
      delete process.env.NO_PROXY;
      delete process.env.NINE_ROUTER_PROXY_MANAGED;
      delete process.env.NINE_ROUTER_PROXY_URL;
      delete process.env.NINE_ROUTER_NO_PROXY;
    }
    return;
  }

  const wasManaged: boolean = process.env.NINE_ROUTER_PROXY_MANAGED === "1";
  let managed: boolean = false;

  if (wasManaged) {
    if (!proxyUrl) {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
      delete process.env.NINE_ROUTER_PROXY_URL;
    }
    if (!noProxy) {
      delete process.env.NO_PROXY;
      delete process.env.NINE_ROUTER_NO_PROXY;
    }
  }

  if (proxyUrl) {
    const validated: string | null = validateProxyUrl(proxyUrl);
    if (validated) {
      process.env.HTTP_PROXY = validated;
      process.env.HTTPS_PROXY = validated;
      process.env.ALL_PROXY = validated;
      process.env.NINE_ROUTER_PROXY_URL = validated;
      managed = true;
    }
  }

  if (noProxy) {
    process.env.NO_PROXY = noProxy;
    process.env.NINE_ROUTER_NO_PROXY = noProxy;
    managed = true;
  }

  if (managed) {
    process.env.NINE_ROUTER_PROXY_MANAGED = "1";
  } else if (wasManaged) {
    delete process.env.NINE_ROUTER_PROXY_MANAGED;
  }
}
