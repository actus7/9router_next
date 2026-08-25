import { ProxyAgent, fetch as undiciFetch } from "undici";

const DEFAULT_TEST_URL: string = "https://google.com/";
const DEFAULT_TIMEOUT_MS: number = 8000;

function getErrorMessage(err: unknown): string {
  if (!err) return "Unknown error";
  const e = err as Error & { cause?: { code?: string; message?: string }; code?: string };
  const base: string = e?.message || String(err);
  const causeCode: string | undefined = e?.cause?.code || e?.code;
  const causeMessage: string | undefined = e?.cause?.message;

  if (causeMessage && causeMessage !== base) {
    return causeCode ? `${base}: ${causeMessage} (${causeCode})` : `${base}: ${causeMessage}`;
  }

  if (causeCode && !base.includes(causeCode)) {
    return `${base} (${causeCode})`;
  }

  return base;
}

function normalizeString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

interface ProxyTestResult {
  ok: boolean;
  status: number;
  statusText?: string;
  url?: string;
  elapsedMs?: number;
  error?: string;
}

interface ProxyTestOptions {
  proxyUrl?: string;
  testUrl?: string;
  timeoutMs?: number;
}

export async function testProxyUrl({ proxyUrl, testUrl, timeoutMs }: ProxyTestOptions = {}): Promise<ProxyTestResult> {
  const normalizedProxyUrl: string = normalizeString(proxyUrl);
  if (!normalizedProxyUrl) {
    return { ok: false, status: 400, error: "proxyUrl is required" };
  }

  const normalizedTestUrl: string = normalizeString(testUrl) || DEFAULT_TEST_URL;
  const timeoutMsRaw: number = Number(timeoutMs);
  const normalizedTimeoutMs: number =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? Math.min(timeoutMsRaw, 30000)
      : DEFAULT_TIMEOUT_MS;

  let dispatcher: InstanceType<typeof ProxyAgent> | undefined;

  try {
    try {
      dispatcher = new ProxyAgent({ uri: normalizedProxyUrl });
    } catch (err: unknown) {
      return {
        ok: false,
        status: 400,
        error: `Invalid proxy URL: ${(err as Error)?.message || String(err)}`,
      };
    }

    const controller: AbortController = new AbortController();
    const startedAt: number = Date.now();
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), normalizedTimeoutMs);

    try {
      const res = await undiciFetch(normalizedTestUrl, {
        method: "HEAD",
        dispatcher,
        signal: controller.signal,
        headers: {
          "User-Agent": "9Router",
        },
      });

      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        url: normalizedTestUrl,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (err: unknown) {
      const e = err as Error & { name?: string };
      const message: string =
        e?.name === "AbortError"
          ? "Proxy test timed out"
          : getErrorMessage(err);
      return { ok: false, status: 500, error: message };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    try {
      await dispatcher?.close?.();
    } catch {
      // ignore
    }
  }
}
