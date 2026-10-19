// Renderer translations. One locale at a time: AppProvider calls setLocale() before rendering and
// remounts the tree when it changes, so plain t() calls in render code always use the current
// locale. Keys are the English text (see src/shared/i18n/index.ts).
//
//   t("Settings")                              → "Einstellungen"
//   t("Synced {ago}", { ago })                 → placeholders
//   tn(n, "{count} word", "{count} words")     → plural-aware
//   tc("card side", "Back")                    → same English, different meaning
//   msg("Models")                              → marks a module-level constant for the catalogs;
//                                                 translate it where it renders: t(TAB.label)
import { createElement, Fragment, type ReactNode } from "react";
import { dateLocale, learningLanguageName, msg, translate, translateContext, translatePlural, type Vars } from "../../shared/i18n";
import { levelBand } from "../../shared/languages";
import { DEFAULT_UI_LOCALE, type UiLocale } from "../../shared/locales";
import type { Language, LevelBand } from "../../shared/records";

export { msg } from "../../shared/i18n";

export const BAND_LABEL: Record<LevelBand, string> = {
  beginner: msg("Beginner"),
  intermediate: msg("Intermediate"),
  advanced: msg("Advanced"),
};

let current: UiLocale = DEFAULT_UI_LOCALE;

export function setLocale(locale: UiLocale): void {
  current = locale;
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

export function getLocale(): UiLocale {
  return current;
}

/** Translate English UI text into the current locale. Unknown text (model output, names) passes through. */
export function t(en: string, vars?: Vars): string {
  return translate(current, en, vars);
}

/** Translate a word whose meaning depends on where it shows: tc("card side", "Back"). */
export function tc(context: string, en: string, vars?: Vars): string {
  return translateContext(current, context, en, vars);
}

/** Plural-aware translate; `count` fills {count}. */
export function tn(count: number, one: string, other: string, vars?: Vars): string {
  return translatePlural(current, count, one, other, vars);
}

/** A learning language's name in the interface language ("Spanisch"). */
export function langName(id: Language): string {
  return learningLanguageName(current, id);
}

/** A level with its band, for display: "A2 (Beginner)", "N3 (Intermediate)". Unknown levels pass through. */
export function levelLabel(level: string): string {
  const band = levelBand(level);
  return band ? t("{level} ({band})", { level, band: t(BAND_LABEL[band]) }) : level;
}

/** Locale tag for Intl formatting of dates and numbers. */
export function intlLocale(): string {
  return dateLocale(current);
}

/**
 * Translate text whose placeholders are elements: tj("Bring back {pattern} naturally", { pattern: <span/> }).
 * String and number values fill as in t(); element values are placed between the translated parts.
 */
export function tj(en: string, vars: Record<string, ReactNode>): ReactNode[] {
  const plain: Vars = {};
  for (const [k, v] of Object.entries(vars)) if (typeof v === "string" || typeof v === "number") plain[k] = v;
  const text = translate(current, en, plain);
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    if (!(m[1] in vars)) continue;
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(createElement(Fragment, { key: `v${i++}` }, vars[m[1]]));
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
