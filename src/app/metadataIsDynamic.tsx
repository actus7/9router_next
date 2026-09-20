import { Suspense } from "react";
import { connection } from "next/server";

async function RequestBoundMetadata() {
  await connection();
  return null;
}

/**
 * Declares that this route's `<title>` is resolved at request time.
 *
 * `generateMetadata` translates the title from the locale cookie, because the
 * runtime translator only rewrites text under `document.body` — the head is not
 * there, so the browser tab stayed English. Cache Components refuses to infer
 * that a route whose *metadata alone* defers is intentional, since that is
 * usually a mistake, and asks for the intent to be rendered into the tree.
 *
 * It has to be here, in the page. A marker in a layout does not satisfy the
 * check — verified against 16.3.2, where the insight survives it unchanged.
 * Inside `<Suspense>` it renders nothing and costs the shell nothing; awaited
 * at the top of a page instead, it would keep that page's whole body out of it.
 *
 * A page that forgets it is not silently broken: the dev overlay names the
 * route on the next client navigation to it.
 *
 * The two pages without it say why: `app/page.tsx` only redirects, and
 * `app/callback/page.tsx` is a Client Component reached by an external redirect.
 */
export function MetadataIsDynamic() {
  return (
    <Suspense>
      <RequestBoundMetadata />
    </Suspense>
  );
}
