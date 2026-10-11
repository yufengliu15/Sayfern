import { LANGUAGE_META } from "../../../shared/languages";
import type { GrammarState, Language, SessionKind, UsageTotals } from "../../../shared/records";
import { intlLocale, msg, t, tn } from "../i18n";

const DAY = 86_400_000;

export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return ms > 0 ? t("<1 min") : t("{n} min", { n: 0 });
  if (min < 60) return t("{n} min", { n: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? t("{h}h {m}m", { h, m }) : t("{h}h", { h });
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function fmtCost(usd: number): string {
  if (usd <= 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function fmtUsage(u?: UsageTotals): string {
  if (!u) return "";
  const tok = fmtTokens(u.input + u.output);
  return u.cost > 0 ? t("{tokens} tokens · {cost}", { tokens: tok, cost: fmtCost(u.cost) }) : t("{tokens} tokens", { tokens: tok });
}

export function fmtNumber(n: number): string {
  return n.toLocaleString(intlLocale());
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function daysBetween(at: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(at)) / DAY);
}

/** "Today", "Yesterday", "3 days ago", "Sep 22". */
export function fmtDay(at: number, now = Date.now()): string {
  const days = daysBetween(at, now);
  if (days <= 0) return t("Today");
  if (days === 1) return t("Yesterday");
  if (days < 7) return tn(days, "{count} day ago", "{count} days ago");
  return fmtShortDate(at);
}

export function fmtShortDate(at: number): string {
  return new Date(at).toLocaleDateString(intlLocale(), { month: "short", day: "numeric" });
}

export function fmtTime(at: number): string {
  return new Date(at).toLocaleTimeString(intlLocale(), { hour: "numeric", minute: "2-digit" });
}

/** "2 min ago", "just now", "3 h ago", then day formatting. */
export function fmtAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return t("just now");
  const m = Math.round(s / 60);
  if (m < 60) return t("{n} min ago", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("{n} h ago", { n: h });
  const days = daysBetween(at, now);
  if (days <= 1) return t("yesterday");
  if (days < 7) return tn(days, "{count} day ago", "{count} days ago");
  return fmtShortDate(at);
}

export function practisedLabel(lastAt: number | undefined, now = Date.now()): string {
  if (!lastAt) return t("Not started yet");
  const days = daysBetween(lastAt, now);
  if (days <= 0) return t("Practised today");
  if (days === 1) return t("Practised yesterday");
  if (days < 7) return tn(days, "Practised {count} day ago", "Practised {count} days ago");
  return t("Practised on {date}", { date: fmtShortDate(lastAt) });
}

/** Translate with t() where they render. */
export const KIND_LABEL: Record<SessionKind, string> = {
  chat: msg("Conversation"),
  reading: msg("Reading"),
  practice: msg("Practice"),
  placement: msg("Placement"),
};

/** Translate with t() where they render. */
export const STATE_LABEL: Record<GrammarState, string> = {
  independent: msg("On your own"),
  with_help: msg("With help"),
  introduced: msg("Introduced"),
};

export const STATE_CLASS: Record<GrammarState, string> = {
  independent: "st st-ind",
  with_help: "st st-help",
  introduced: "st st-intro",
};

/** Composer placeholder, written in the language being learned. */
export const COMPOSER_PLACEHOLDER: Record<Language, string> = {
  zh: "用中文回答…",
  ja: "日本語で答える…",
  ko: "한국어로 답하기…",
  en: "Answer in English…",
  es: "Responde en español…",
  fr: "Réponds en français…",
  de: "Antworte auf Deutsch…",
  it: "Rispondi in italiano…",
  pt: "Responda em português…",
  ru: "Ответь по-русски…",
  vi: "Trả lời bằng tiếng Việt…",
};

/** Sentence around a character offset: split on CJK and latin terminators and newlines. */
export function sentenceAt(text: string, offset: number): string {
  const isEnd = (ch: string) => /[。！？!?\n]/.test(ch);
  let a = offset;
  while (a > 0 && !isEnd(text[a - 1])) a--;
  let b = offset;
  while (b < text.length && !isEnd(text[b])) b++;
  if (b < text.length && text[b] !== "\n") b++; // keep the terminator
  return text.slice(a, b).trim();
}

export function cls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * The language font class, but only when the text is written in that script: CJK for zh/ja,
 * Hangul for ko (Latin titles stay in the UI font). Latin and Cyrillic targets always get theirs.
 */
export function cjkClass(text: string, fontClass: string): string {
  if (fontClass === "zh" || fontClass === "ja") return /[\u3040-\u30ff\u3400-\u9fff]/.test(text) ? fontClass : "";
  if (fontClass === "ko") return /\p{Script=Hangul}/u.test(text) ? fontClass : "";
  return fontClass;
}

/** A tool activity line in the interface language (core writes most in it; the default is "Used <tool>"). */
export function activityText(summary: string): string {
  const m = /^Used (\S+)$/.exec(summary);
  return m ? t("Used {name}", { name: m[1] }) : t(summary);
}

/** CSS font class for text in a learning language ("zh", "ja", "ko", "lt" for Latin, "cy" for Cyrillic). */
export const fontOf = (l: Language): string => LANGUAGE_META[l]?.fontClass ?? l;

/** Sentence-end test for any learning language. */
export const SENTENCE_END = /[。！？!?.\n]/;

/** Does the language get ruby readings (pinyin, furigana)? */
export const hasReadings = (l: Language): boolean => !!LANGUAGE_META[l]?.readingName && (l === "zh" || l === "ja");
