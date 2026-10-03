// Interface (UI) locales: the language Sayfern's own text is shown in, and the language the
// tutor explains in. Separate from the learning language (records.ts `Language`), so any
// pairing works: a Russian interface for learning Japanese, a German one for learning Korean.
// Pure data and functions, shared by core, main and renderer.

export type UiLocale = "en" | "zh-Hans" | "zh-Hant" | "ja" | "ko" | "vi" | "ru" | "fr" | "it" | "es" | "de" | "pt-BR";

export interface UiLocaleInfo {
  id: UiLocale;
  /** The locale's own name, shown in the picker: "Deutsch". */
  nativeName: string;
  /** English name: "German". */
  englishName: string;
  /** How prompts name the language the tutor explains in: "Traditional Chinese". */
  promptName: string;
}

export const UI_LOCALES: readonly UiLocaleInfo[] = [
  { id: "en", nativeName: "English", englishName: "English", promptName: "English" },
  { id: "zh-Hans", nativeName: "简体中文", englishName: "Chinese (Simplified)", promptName: "Simplified Chinese" },
  { id: "zh-Hant", nativeName: "繁體中文", englishName: "Chinese (Traditional)", promptName: "Traditional Chinese" },
  { id: "ja", nativeName: "日本語", englishName: "Japanese", promptName: "Japanese" },
  { id: "ko", nativeName: "한국어", englishName: "Korean", promptName: "Korean" },
  { id: "vi", nativeName: "Tiếng Việt", englishName: "Vietnamese", promptName: "Vietnamese" },
  { id: "ru", nativeName: "Русский", englishName: "Russian", promptName: "Russian" },
  { id: "fr", nativeName: "Français", englishName: "French", promptName: "French" },
  { id: "it", nativeName: "Italiano", englishName: "Italian", promptName: "Italian" },
  { id: "es", nativeName: "Español", englishName: "Spanish", promptName: "Spanish" },
  { id: "de", nativeName: "Deutsch", englishName: "German", promptName: "German" },
  { id: "pt-BR", nativeName: "Português (Brasil)", englishName: "Portuguese (Brazil)", promptName: "Brazilian Portuguese" },
];

export const DEFAULT_UI_LOCALE: UiLocale = "en";

const IDS = new Set<string>(UI_LOCALES.map((l) => l.id));

export function isUiLocale(v: unknown): v is UiLocale {
  return typeof v === "string" && IDS.has(v);
}

export function uiLocaleInfo(id: UiLocale): UiLocaleInfo {
  return UI_LOCALES.find((l) => l.id === id) ?? UI_LOCALES[0];
}

/** Traditional-script regions and script subtags. */
const HANT = /^zh(-hant\b|.*-(tw|hk|mo)\b)/i;

/** Best UI locale for one BCP-47 tag ("de-AT" → de, "zh-TW" → zh-Hant, "pt-PT" → pt-BR), or null. */
export function matchOne(tag: string): UiLocale | null {
  const t = tag.trim().replace(/_/g, "-");
  if (!t) return null;
  const lower = t.toLowerCase();
  if (lower.startsWith("zh")) return HANT.test(lower) ? "zh-Hant" : "zh-Hans";
  const primary = lower.split("-")[0];
  if (primary === "pt") return "pt-BR";
  return IDS.has(primary) ? (primary as UiLocale) : null;
}

/**
 * The system's preferred languages, in order (macOS: app.getPreferredSystemLanguages()),
 * mapped to the first one Sayfern has a translation for. English when none match.
 */
export function matchLocale(tags: readonly string[]): UiLocale {
  for (const tag of tags) {
    const m = matchOne(tag);
    if (m) return m;
  }
  return DEFAULT_UI_LOCALE;
}

/** The locale in effect: the learner's choice, else the system's. */
export function effectiveLocale(chosen: UiLocale | "system" | undefined, systemTags: readonly string[]): UiLocale {
  return chosen && isUiLocale(chosen) ? chosen : matchLocale(systemTags);
}

/** Primary language of a UI locale, to compare with a learning language ("pt-BR" → "pt"). */
export function localeLanguage(id: UiLocale): string {
  return id.startsWith("zh") ? "zh" : id.split("-")[0];
}
