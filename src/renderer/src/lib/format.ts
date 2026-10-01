import type { GrammarState, Language, SessionKind, UsageTotals } from "../../../shared/records";

const DAY = 86_400_000;

export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return ms > 0 ? "<1 min" : "0 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
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
  return u.cost > 0 ? `${tok} tokens · ${fmtCost(u.cost)}` : `${tok} tokens`;
}

export function fmtNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "today", "yesterday", "3 days ago", "Sep 22". */
export function fmtDay(t: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtShortDate(t: number): string {
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "2 min ago", "just now", "3 h ago", then day formatting. */
export function fmtAgo(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return fmtDay(t, now).toLowerCase();
}

export function practisedLabel(lastAt: number | undefined, now = Date.now()): string {
  if (!lastAt) return "Not started yet";
  const d = fmtDay(lastAt, now);
  if (d === "Today") return "Practised today";
  if (d === "Yesterday") return "Practised yesterday";
  return `Practised ${d.includes("ago") ? d : `on ${d}`}`;
}

export const KIND_LABEL: Record<SessionKind, string> = {
  chat: "Conversation",
  reading: "Reading",
  practice: "Practice",
  placement: "Placement",
};

export const STATE_LABEL: Record<GrammarState, string> = {
  independent: "On your own",
  with_help: "With help",
  introduced: "Introduced",
};

export const STATE_CLASS: Record<GrammarState, string> = {
  independent: "st st-ind",
  with_help: "st st-help",
  introduced: "st st-intro",
};

export const COMPOSER_PLACEHOLDER: Record<Language, string> = {
  zh: "用中文回答…",
  ja: "日本語で答える…",
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

/** The language font class, but only when the text actually contains CJK (Latin titles stay in the UI font). */
export function cjkClass(text: string, fontClass: string): string {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(text) ? fontClass : "";
}
