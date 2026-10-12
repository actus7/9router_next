/**
 * The Codex CLI version the gateway presents to chatgpt.com.
 *
 * `/codex/models` silently drops every model whose `minimal_client_version` is
 * above this, so a stale value hides new models instead of failing. Keep it at
 * the CLI's current release (`codex --version`, or `client_version` in
 * `~/.codex/models_cache.json`).
 */
export const CODEX_CLIENT_VERSION = "0.162.1";
