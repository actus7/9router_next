// Locale display metadata shared across UI components.
//
// Flags are served as SVG files from `public/flags/`, not as emoji: Windows
// ships no glyph for the regional-indicator pairs, so Chrome and Edge there
// render 🇧🇷 as the bare letters "BR" — which is what the header used to show.

export const LOCALE_COUNTRIES = {
  "en": "us",
  "vi": "vn",
  "zh-CN": "cn",
  "zh-TW": "tw",
  "ja": "jp",
  "pt-BR": "br",
  "pt-PT": "pt",
  "ko": "kr",
  "es": "es",
  "de": "de",
  "fr": "fr",
  "he": "il",
  "ar": "sa",
  "ru": "ru",
  "pl": "pl",
  "cs": "cz",
  "nl": "nl",
  "tr": "tr",
  "uk": "ua",
  "tl": "ph",
  "id": "id",
  "th": "th",
  "km": "kh",
  "hi": "in",
  "bn": "bd",
  "ur": "pk",
  "ro": "ro",
  "sv": "se",
  "it": "it",
  "el": "gr",
  "hu": "hu",
  "fi": "fi",
  "da": "dk",
  "no": "no",
  "fa": "ir",
} as const;

export type LocaleKey = keyof typeof LOCALE_COUNTRIES;

export const LOCALE_NAMES: Record<string, string> = {
  "en": "English",
  "vi": "Tiếng Việt",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  "ja": "日本語",
  "pt-BR": "Português (Brasil)",
  "pt-PT": "Português (Portugal)",
  "ko": "한국어",
  "es": "Español",
  "de": "Deutsch",
  "fr": "Français",
  "he": "עברית",
  "ar": "العربية",
  "ru": "Русский",
  "pl": "Polski",
  "cs": "Čeština",
  "nl": "Nederlands",
  "tr": "Türkçe",
  "uk": "Українська",
  "tl": "Tagalog",
  "id": "Indonesia",
  "th": "ไทย",
  "km": "ខ្មែរ",
  "hi": "हिन्दी",
  "bn": "বাংলা",
  "ur": "اردو",
  "ro": "Română",
  "sv": "Svenska",
  "it": "Italiano",
  "el": "Ελληνικά",
  "hu": "Magyar",
  "fi": "Suomi",
  "da": "Dansk",
  "no": "Norsk",
  "fa": "فارسی",
};

/** Latin transliteration, so a search for "japanese" or "russo" still finds it. */
export const LOCALE_SEARCH_ALIASES: Record<string, string> = {
  "en": "english ingles inglês",
  "vi": "vietnamese vietnamita tieng viet",
  "zh-CN": "chinese simplified chines simplificado mandarin",
  "zh-TW": "chinese traditional chines tradicional taiwan",
  "ja": "japanese japones japonês nihongo",
  "pt-BR": "portuguese brazil portugues brasil brasileiro",
  "pt-PT": "portuguese portugal portugues europeu",
  "ko": "korean coreano hangul",
  "es": "spanish espanhol castellano",
  "de": "german alemao alemão deutsch",
  "fr": "french frances francês",
  "he": "hebrew hebraico ivrit",
  "ar": "arabic arabe árabe",
  "ru": "russian russo russkiy",
  "pl": "polish polones polonês",
  "cs": "czech tcheco cestina",
  "nl": "dutch holandes holandês neerlandes",
  "tr": "turkish turco turkce",
  "uk": "ukrainian ucraniano",
  "tl": "tagalog filipino filipinas",
  "id": "indonesian indonesio indonésio bahasa",
  "th": "thai tailandes tailandês",
  "km": "khmer cambojano camboja",
  "hi": "hindi indiano india índia",
  "bn": "bengali bengala bangladesh",
  "ur": "urdu paquistao paquistão pakistan",
  "ro": "romanian romeno",
  "sv": "swedish sueco svenska",
  "it": "italian italiano",
  "el": "greek grego ellinika",
  "hu": "hungarian hungaro húngaro magyar",
  "fi": "finnish finlandes finlandês suomi",
  "da": "danish dinamarques dinamarquês dansk",
  "no": "norwegian noruegues norueguês norsk",
  "fa": "persian persa farsi ira irã iran",
};

export function getLocaleName(locale: string): string {
  return LOCALE_NAMES[locale] ?? locale;
}

export function getLocaleFlagSrc(locale: string): string | null {
  const country = LOCALE_COUNTRIES[locale as LocaleKey];
  return country ? `/flags/${country}.svg` : null;
}
