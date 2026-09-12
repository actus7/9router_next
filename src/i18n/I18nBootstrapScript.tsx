import type { Locale } from "./config";

interface I18nBootstrapScriptProps {
  locale: Locale;
  translations: Record<string, string>;
  /** The request's CSP nonce. Without it this script is inline-blocked. */
  nonce?: string;
}

/**
 * Runs before React hydrates so the client bundle's translate() matches SSR output.
 */
export function I18nBootstrapScript({ locale, translations, nonce }: I18nBootstrapScriptProps) {
  const payload = JSON.stringify({ locale, translations }).replace(/</g, "\\u003c");
  return (
    <script
      nonce={nonce}
      dangerouslySetInnerHTML={{
        __html: `(function(){var p=${payload};globalThis.__I18N_LOCALE__=p.locale;globalThis.__I18N_TRANSLATIONS__=p.translations;})();`,
      }}
    />
  );
}
