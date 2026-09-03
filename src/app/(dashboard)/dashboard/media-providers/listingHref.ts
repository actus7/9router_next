/**
 * The listing page that owns a media-provider kind.
 *
 * webSearch and webFetch share one combined listing at /web, so their own
 * `/[kind]` routes are only redirect stubs. Detail pages must link back to the
 * page that actually exists, not to the stub.
 */
const COMBINED_WEB_KINDS = new Set(["webSearch", "webFetch"]);

export function isCombinedWebKind(kind: string): boolean {
  return COMBINED_WEB_KINDS.has(kind);
}

export function mediaProviderListingHref(kind: string): string {
  return isCombinedWebKind(kind)
    ? "/dashboard/media-providers/web"
    : `/dashboard/media-providers/${kind}`;
}
