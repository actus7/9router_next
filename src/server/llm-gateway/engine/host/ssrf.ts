// Host adapter — SSRF guard for user-supplied / config-supplied URLs.
//
// Semantics: throws on non-public targets (private/link-local/metadata
// ranges). Callers in search/fetch providers must let it propagate.
export { assertPublicUrl } from "@/shared/utils/ssrfGuard";
