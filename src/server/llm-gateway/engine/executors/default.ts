import { BaseExecutor } from "./base";
import { PROVIDERS, PROVIDER_OAUTH } from "../config/providers";
import { ANTHROPIC_API_VERSION, OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE, selectAnthropicBeta } from "../providers/shared";
import { resolveOpenAICompatibleApiType } from "../services/provider";
import { OAUTH_ENDPOINTS, buildKimiHeaders } from "../config/appConstants";
import { buildClineHeaders } from "../shared/clineAuth";
import { proxyAwareFetch } from "../utils/proxyFetch";
import { injectReasoningContent } from "../utils/reasoningContentInjector";
import { stripUnsupportedParams } from "../translator/concerns/paramSupport";
import type { Credentials, Logger, RefreshResult } from "../services/types";

// Auth header descriptors — derived from registry transport.auth, fallback to hardcoded defaults.
const BEARER = { combined: true, header: "Authorization", scheme: "bearer" } as const;
const XAPIKEY = { combined: true, header: "x-api-key", scheme: "raw" } as const;
const AUTH_DESCRIPTORS: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(PROVIDERS)
    .filter(([, t]) => t.auth)
    .map(([id, t]) => [id, t.auth])
) as Record<string, Record<string, unknown>>;

// Apply a token to a header per scheme (matches legacy: combined always sets, even when undefined).
function setAuth(headers: Record<string, string>, spec: Record<string, unknown>, token: string | undefined) {
  headers[spec.header as string] = spec.scheme === "bearer" ? `Bearer ${token}` : (token ?? "");
}

// Synthetic credential injected by accountSelection for noAuth/free providers.
// It marks "no credentials needed" — never a real bearer token upstream
// (OVH 403s and Pollinations 400s when it is sent as `Authorization: Bearer public`).
const SYNTHETIC_NOAUTH_TOKEN = "public";

// Resolve auth onto headers from a descriptor.
function applyAuth(headers: Record<string, string>, desc: Record<string, unknown>, credentials: Credentials) {
  const token = (credentials.apiKey || credentials.accessToken) as string | undefined;
  const isSyntheticNoAuth = token === SYNTHETIC_NOAUTH_TOKEN;
  if (!isSyntheticNoAuth) {
    if (desc.combined) {
      // combined providers always set the header (legacy behavior, incl. noAuth → "Bearer undefined")
      setAuth(headers, desc, token);
    } else {
      // split apiKey/oauth: set only the matching branch (legacy: anthropic-compatible skips when both absent)
      if (credentials.apiKey) setAuth(headers, desc.apiKey as Record<string, unknown>, credentials.apiKey);
      else if (credentials.accessToken) setAuth(headers, desc.oauth as Record<string, unknown>, credentials.accessToken);
    }
  }
  if (desc.anthropicVersion && !headers["anthropic-version"]) headers["anthropic-version"] = ANTHROPIC_API_VERSION;
}

// Provider-specific header quirks kept as small hooks (not pure auth).
const HEADER_HOOKS: Record<string, (h: Record<string, string>, c: Credentials) => void> = {
  // Stable device_id from OAuth connection (CLIProxyAPI KimiTokenStorage.DeviceID)
  kimiHeaders: (h, c) => Object.assign(h, buildKimiHeaders((c?.providerSpecificData?.deviceId as string) || "")),
  clineHeaders: (h, c) => Object.assign(h, buildClineHeaders(c.apiKey || c.accessToken)),
  kilocodeOrg: (h, c) => { if (c.providerSpecificData?.orgId) h["X-Kilocode-OrganizationID"] = c.providerSpecificData.orgId as string; },
};

// Config-driven OAuth refresh grants — derived from registry oauth.refresh.
const REFRESH_GRANTS: Record<string, { encoding: string; url: () => string; params: (ex: DefaultExecutor) => Record<string, unknown> }> = Object.fromEntries(
  Object.entries(PROVIDER_OAUTH)
    .filter(([, o]) => o.refresh)
    .map(([id, o]) => {
      const tokenUrl = o.tokenUrl as string;
      const refresh = o.refresh as Record<string, unknown>;
      const encoding = refresh.encoding as string;
      const extraParams = refresh.scope ? { scope: refresh.scope } : {};
      return [id, {
        encoding,
        url: () => tokenUrl,
        params: (ex: DefaultExecutor) => id === "gemini"
          ? { client_id: ex.config.clientId, client_secret: ex.config.clientSecret, ...extraParams }
          : { client_id: o.clientId, ...extraParams },
      }];
    })
);

export class DefaultExecutor extends BaseExecutor {
  constructor(provider: string) {
    super(provider, PROVIDERS[provider] || PROVIDERS.openai);
  }

  transformRequest(model: string, body: Record<string, unknown>, _stream?: boolean, _credentials?: Credentials) {
    const transformed = this.applyJsonSchemaFallback(body) as Record<string, unknown>;

    if (transformed && typeof transformed === "object") {
      // quirk: some openai-compatible providers reject Anthropic's client_metadata field
      if ((this.config.quirks as Record<string, unknown>)?.dropClientMetadata) {
        delete transformed.client_metadata;
      }
      stripUnsupportedParams(this.provider, model, transformed);
    }

    return injectReasoningContent({ provider: this.provider, model, body: transformed });
  }

  // Fallback json_schema → json_object for openai-compatible providers without native Structured Output.
  applyJsonSchemaFallback(body: Record<string, unknown>): Record<string, unknown> {
    if (!this.provider?.startsWith?.("openai-compatible-")) return body;
    const rf = body?.response_format as Record<string, unknown> | undefined;
    const jsonSchema = rf?.json_schema as Record<string, unknown> | undefined;
    if (rf?.type !== "json_schema" || !jsonSchema?.schema) return body;

    const schemaJson = JSON.stringify(jsonSchema.schema, null, 2);
    const prompt = `You must respond with valid JSON that strictly follows this JSON schema:\n\`\`\`json\n${schemaJson}\n\`\`\`\nRespond ONLY with the JSON object, no other text.`;

    const messages = Array.isArray(body.messages) ? (body.messages as Record<string, unknown>[]).map(m => ({ ...m })) : [];
    const sys = messages.find(m => m.role === "system");
    if (sys) {
      if (typeof sys.content === "string") sys.content = `${sys.content}\n\n${prompt}`;
      else if (Array.isArray(sys.content)) sys.content.push({ type: "text", text: `\n\n${prompt}` });
    } else {
      messages.unshift({ role: "system", content: prompt });
    }
    return { ...body, messages, response_format: { type: "json_object" } };
  }

  buildUrl(model: string, stream: boolean, urlIndex = 0, credentials: Credentials | null = null) {
    // Runtime transport (multi-endpoint providers): use the sourceFormat-matched endpoint
    const rt = credentials?.runtimeTransport as Record<string, unknown> | undefined;
    if (rt?.baseUrl) {
      return rt.urlSuffix ? `${rt.baseUrl}${rt.urlSuffix}` : rt.baseUrl as string;
    }
    if (this.provider?.startsWith?.("openai-compatible-")) {
      const baseUrl = (credentials?.providerSpecificData?.baseUrl as string | undefined) || OPENAI_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      const path = resolveOpenAICompatibleApiType(this.provider, credentials) === "responses" ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = (credentials?.providerSpecificData?.baseUrl as string | undefined) || ANTHROPIC_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}/messages`;
    }
    // gemini-format: build :streamGenerateContent / :generateContent path
    if (this.config.format === "gemini") {
      return `${this.config.baseUrl}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
    }
    // urlSuffix (e.g. ?beta=true) declared per-provider in registry
    if (this.config.urlSuffix) {
      return `${this.config.baseUrl}${this.config.urlSuffix}`;
    }
    const url = this.config.baseUrl as string | undefined;
    if (url?.includes("{accountId}")) {
      const accountId = credentials?.providerSpecificData?.accountId as string | undefined;
      if (!accountId) throw new Error(`${this.provider} requires accountId in providerSpecificData`);
      return url.replace("{accountId}", accountId);
    }
    return url || "";
  }

  // Fallback descriptor for providers without an explicit entry in AUTH_DESCRIPTORS.
  resolveAuthDescriptor(): Record<string, unknown> {
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      return { apiKey: { header: "x-api-key", scheme: "raw" }, oauth: { header: "Authorization", scheme: "bearer" }, anthropicVersion: true };
    }
    if (this.config?.format === "claude") {
      return { ...XAPIKEY, anthropicVersion: true };
    }
    return { ...BEARER };
  }

  buildHeaders(credentials: Credentials, stream = true, _url?: string, model?: string) {
    const rt = credentials?.runtimeTransport as Record<string, unknown> | undefined;
    const headers: Record<string, string> = { "Content-Type": "application/json", ...((rt ? rt.headers : this.config.headers) as Record<string, string> | undefined) };
    const desc = (rt?.auth as Record<string, unknown>) || AUTH_DESCRIPTORS[this.provider] || this.resolveAuthDescriptor();
    // Hooks run BEFORE auth so dynamic overlays can't clobber the token.
    for (const hook of (desc.hooks as string[]) || []) HEADER_HOOKS[hook]?.(headers, credentials);
    applyAuth(headers, desc, credentials);

    if (this.provider === "claude" && model) {
      headers["Anthropic-Beta"] = selectAnthropicBeta(model);
    }

    // Strip first-party Claude Code identity headers for non-Anthropic anthropic-compatible upstreams
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = (credentials?.providerSpecificData?.baseUrl as string) || "";
      const isOfficialAnthropic = baseUrl === "" || baseUrl.includes("api.anthropic.com");
      if (!isOfficialAnthropic) {
        // Some third-party Anthropic-compatible gateways require Bearer auth in
        // addition to x-api-key. Send both (x-api-key already set above) so
        // gateways that read either header succeed.
        if (credentials.apiKey && !headers["Authorization"]) {
          headers["Authorization"] = `Bearer ${credentials.apiKey}`;
        }
        delete headers["anthropic-dangerous-direct-browser-access"];
        delete headers["Anthropic-Dangerous-Direct-Browser-Access"];
        delete headers["x-app"];
        delete headers["X-App"];
        // Strip claude-code-20250219 from Anthropic-Beta / anthropic-beta
        for (const betaKey of ["anthropic-beta", "Anthropic-Beta"]) {
          if (headers[betaKey]) {
            const filtered = headers[betaKey]
              .split(",")
              .map(s => s.trim())
              .filter(f => f && f !== "claude-code-20250219")
              .join(",");
            if (filtered) {
              headers[betaKey] = filtered;
            } else {
              delete headers[betaKey];
            }
          }
        }
      }
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  // Generic OAuth refresh for the common {grant_type, refresh_token, client_id[, ...]} shape.
  // grant = REFRESH_GRANTS[provider]; client creds resolved from PROVIDERS or this.config.
  refreshFromGrant(credentials: Credentials, proxyOptions: unknown) {
    const grant = REFRESH_GRANTS[this.provider];
    const params: Record<string, unknown> = { grant_type: "refresh_token", refresh_token: credentials.refreshToken, ...grant.params(this) };
    return grant.encoding === "json"
      ? this.refreshWithJSON(grant.url(), params, proxyOptions)
      : this.refreshWithForm(grant.url(), params, proxyOptions);
  }

  async refreshCredentials(credentials: Credentials, log?: Logger, proxyOptions: unknown = null): Promise<RefreshResult | null> {
    if (!credentials.refreshToken) return null;

    const refreshers: Record<string, () => Promise<RefreshResult | null>> = {
      claude: () => this.refreshFromGrant(credentials, proxyOptions),
      codex: () => this.refreshFromGrant(credentials, proxyOptions),
      iflow: () => this.refreshIflow(credentials.refreshToken as string, proxyOptions),
      gemini: () => this.refreshFromGrant(credentials, proxyOptions),
      kiro: () => this.refreshKiro(credentials.refreshToken as string, proxyOptions),
      cline: () => this.refreshCline(credentials.refreshToken as string, proxyOptions),
      clinepass: () => this.refreshCline(credentials.refreshToken as string, proxyOptions),
      kimi: () => this.refreshKimi(credentials, proxyOptions),
      "kimi-coding": () => this.refreshKimi(credentials, proxyOptions),
      kilocode: () => this.refreshKilocode(credentials.refreshToken as string, proxyOptions)
    };

    const refresher = refreshers[this.provider];
    if (!refresher) return null;

    try {
      const result = await refresher();
      if (result) log?.info?.("TOKEN", `${this.provider} refreshed`);
      return result;
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log?.error?.("TOKEN", `${this.provider} refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshWithJSON(url: string, body: Record<string, unknown>, proxyOptions: unknown = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body)
    }, proxyOptions as null);
    if (!response.ok) return null;
    const tokens = await response.json() as Record<string, unknown>;
    return { accessToken: tokens.access_token as string, refreshToken: (tokens.refresh_token as string) || (body.refresh_token as string), expiresIn: tokens.expires_in as number };
  }

  async refreshWithForm(url: string, params: Record<string, unknown>, proxyOptions: unknown = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: new URLSearchParams(params as Record<string, string>)
    }, proxyOptions as null);
    if (!response.ok) return null;
    const tokens = await response.json() as Record<string, unknown>;
    return { accessToken: tokens.access_token as string, refreshToken: (tokens.refresh_token as string) || (params.refresh_token as string), expiresIn: tokens.expires_in as number };
  }

  async refreshIflow(refreshToken: string, proxyOptions: unknown = null) {
    const basicAuth = btoa(`${PROVIDERS.iflow.clientId}:${PROVIDERS.iflow.clientSecret}`);
    const response = await proxyAwareFetch(OAUTH_ENDPOINTS.iflow.token as string, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "Authorization": `Basic ${basicAuth}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: PROVIDERS.iflow.clientId as string, client_secret: PROVIDERS.iflow.clientSecret as string })
    }, proxyOptions as null);
    if (!response.ok) return null;
    const tokens = await response.json() as Record<string, unknown>;
    return { accessToken: tokens.access_token as string, refreshToken: (tokens.refresh_token as string) || refreshToken, expiresIn: tokens.expires_in as number };
  }

  async refreshKiro(refreshToken: string, proxyOptions: unknown = null) {
    const response = await proxyAwareFetch(PROVIDERS.kiro.tokenUrl as string, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "kiro-cli/1.0.0" },
      body: JSON.stringify({ refreshToken })
    }, proxyOptions as null);
    if (!response.ok) return null;
    const tokens = await response.json() as Record<string, unknown>;
    return { accessToken: tokens.accessToken as string, refreshToken: (tokens.refreshToken as string) || refreshToken, expiresIn: tokens.expiresIn as number };
  }

  async refreshCline(refreshToken: string, proxyOptions: unknown = null) {
    const response = await proxyAwareFetch(PROVIDERS.cline.refreshUrl as string, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ refreshToken, grantType: "refresh_token", clientType: "extension" })
    }, proxyOptions as null);
    if (!response.ok) return null;
    const payload = await response.json() as Record<string, unknown>;
    const data = (payload?.data as Record<string, unknown>) || payload;
    const expiresAtIso = data?.expiresAt as string | undefined;
    const expiresIn = expiresAtIso ? Math.max(1, Math.floor((new Date(expiresAtIso).getTime() - Date.now()) / 1000)) : undefined;
    let accessToken = data?.accessToken as string | undefined;
    if (accessToken && !accessToken.startsWith("workos:")) {
      accessToken = `workos:${accessToken}`;
    }
    return { accessToken, refreshToken: (data?.refreshToken as string) || refreshToken, expiresIn };
  }

  // CLIProxyAPI DeviceFlowClient.RefreshToken — form body + X-Msh-* headers + stable device_id
  async refreshKimi(credentials: Credentials, proxyOptions: unknown = null) {
    const refreshToken = credentials.refreshToken as string;
    const cfg = PROVIDERS.kimi || PROVIDERS["kimi-coding"];
    if (!cfg?.refreshUrl || !cfg?.clientId) return null;
    const kimiHeaders = buildKimiHeaders((credentials?.providerSpecificData?.deviceId as string) || "");
    const response = await proxyAwareFetch(cfg.refreshUrl as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        ...kimiHeaders
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId as string })
    }, proxyOptions as null);
    if (!response.ok) return null;
    const tokens = await response.json() as Record<string, unknown>;
    return { accessToken: tokens.access_token as string, refreshToken: (tokens.refresh_token as string) || refreshToken, expiresIn: tokens.expires_in as number };
  }

  async refreshKilocode(_refreshToken: string, _proxyOptions: unknown = null) {
    // Kilocode uses device code flow, no refresh token support
    return null;
  }
}

export default DefaultExecutor;
