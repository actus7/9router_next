import type { Locale } from "./config";

interface I18nBootstrapScriptProps {
  locale: Locale;
  translations: Record<string, string>;
}

/**
 * Runs before React hydrates so the client bundle's translate() matches SSR output.
 */
export function I18nBootstrapScript({ locale, translations }: I18nBootstrapScriptProps) {
  const payload = JSON.stringify({ locale, translations }).replace(/</g, "\\u003c");
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `(function(){var p=${payload};globalThis.__I18N_LOCALE__=p.locale;globalThis.__I18N_TRANSLATIONS__=p.translations;})();`,
      }}
    />
  );
}
