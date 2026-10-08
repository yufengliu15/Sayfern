// Interface translations. Keys are the English text itself (gettext style), so English needs no
// catalog and a missing translation falls back to readable English. Catalogs live next to this
// file, one per locale. Shared by the renderer (all UI copy) and core (learner-visible text that
// core builds, such as quiz labels and fallback card prompts). No DOM or Node APIs here.
//
// Placeholders: "{name}" in the key and the translation, filled from `vars`.
// Plurals: tn(count, "{count} word", "{count} words"); the catalog entry for the plural form is
// either a string or { one, few, many, other } following Intl.PluralRules for the locale.
import { LANGUAGE_META } from "../languages";
import { DEFAULT_UI_LOCALE, type UiLocale } from "../locales";
import type { Language } from "../records";
import de from "./de";
import es from "./es";
import fr from "./fr";
import it from "./it";
import ja from "./ja";
import ko from "./ko";
import ptBR from "./pt-BR";
import ptPT from "./pt-PT";
import ru from "./ru";
import vi from "./vi";
import zhHans from "./zh-Hans";
import zhHant from "./zh-Hant";

export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Catalog = Record<string, string | PluralForms>;
export type Vars = Record<string, string | number>;

export const CATALOGS: Record<Exclude<UiLocale, "en">, Catalog> = {
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
  ja,
  ko,
  vi,
  ru,
  fr,
  it,
  es,
  de,
  "pt-BR": ptBR,
  "pt-PT": ptPT,
};

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralCategory(locale: UiLocale, n: number): Intl.LDMLPluralRule {
  let r = pluralRules.get(locale);
  if (!r) pluralRules.set(locale, (r = new Intl.PluralRules(locale)));
  return r.select(n);
}

/** Number formatting per locale (grouping separators differ: 1,234 / 1 234 / 1.234). */
export function formatNumber(locale: UiLocale, n: number): string {
  return n.toLocaleString(locale === "en" ? "en-US" : locale);
}

export function fill(text: string, vars?: Vars, locale: UiLocale = DEFAULT_UI_LOCALE): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = vars[k];
    if (v === undefined) return m;
    return typeof v === "number" ? formatNumber(locale, v) : v;
  });
}

/** Translate `en` (the English text, also the key) into `locale`, filling {placeholders}. */
export function translate(locale: UiLocale, en: string, vars?: Vars): string {
  if (locale === "en") return fill(en, vars, locale);
  const entry = CATALOGS[locale]?.[en];
  const text = typeof entry === "string" ? entry : (entry?.other ?? en);
  return fill(text, vars, locale);
}

/**
 * Plural-aware translate. `one` and `other` are the English forms; the key is `other`.
 * `count` is available as {count} in both.
 */
export function translatePlural(locale: UiLocale, count: number, one: string, other: string, vars?: Vars): string {
  const all = { count, ...vars };
  if (locale === "en") return fill(count === 1 ? one : other, all, locale);
  const entry = CATALOGS[locale]?.[other];
  let text: string;
  if (entry === undefined) text = count === 1 ? one : other;
  else if (typeof entry === "string") text = entry;
  else text = entry[pluralCategory(locale, count)] ?? entry.other;
  return fill(text, all, locale);
}

/**
 * Same English word, different meanings ("Back" the button, "Back" the side of a card): the catalog
 * key is "<context>\u0004<English>" (gettext's separator); English shows just the text.
 */
export function translateContext(locale: UiLocale, context: string, en: string, vars?: Vars): string {
  if (locale === "en") return fill(en, vars, locale);
  const entry = CATALOGS[locale]?.[`${context}\u0004${en}`];
  const text = typeof entry === "string" ? entry : (entry?.other ?? en);
  return fill(text, vars, locale);
}

/** Marks an English string for translation without translating it yet (module-level constants). */
export const msg = (en: string): string => en;

/** A translator bound to one locale (core services build one per request). */
export interface Translator {
  locale: UiLocale;
  t(en: string, vars?: Vars): string;
  tn(count: number, one: string, other: string, vars?: Vars): string;
  /** A learning language's name in this locale: "Spanisch". */
  language(id: Language): string;
  /** Date in this locale, e.g. "Sep 29, 2026" / "29.09.2026". */
  date(at: number, opts?: Intl.DateTimeFormatOptions): string;
}

export function translator(locale: UiLocale): Translator {
  return {
    locale,
    t: (en, vars) => translate(locale, en, vars),
    tn: (count, one, other, vars) => translatePlural(locale, count, one, other, vars),
    language: (id) => learningLanguageName(locale, id),
    date: (at, opts) => new Date(at).toLocaleDateString(dateLocale(locale), opts ?? { month: "short", day: "numeric", year: "numeric" }),
  };
}

/** Locale tag for Intl date/number formatting ("en" → "en-US" so months read "Sep 29"). */
export function dateLocale(locale: UiLocale): string {
  return locale === "en" ? "en-US" : locale;
}

export function learningLanguageName(locale: UiLocale, id: Language): string {
  const m = LANGUAGE_META[id];
  if (!m) return id;
  if (locale === "en") return m.name;
  return languageName(locale, m.bcp47, m.name);
}

/** A learning language's name in the interface language ("Spanisch" for es in a German interface). */
export function languageName(locale: UiLocale, bcp47: string, fallback: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(bcp47.split("-")[0]);
    if (!name || name === bcp47) return fallback;
    // Some locales return lower case ("español"); interface labels start with a capital where scripts have case.
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  } catch {
    return fallback;
  }
}
