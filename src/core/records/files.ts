// On-disk record shapes that are private to the records store.
import type { Message } from "@earendil-works/pi-ai";
import { LANGUAGE_META, spaceSeparated } from "../../shared/languages";
import { LANGUAGES, type ChatMessage, type Correction, type CorrectionKind, type LegacyCorrectionKind, type Language, type PracticeTarget, type SessionMeta, type WordUsage } from "../../shared/records";
import type { JsonCodec } from "./io";

/** sessions/<id>.json */
export interface SessionFile {
  meta: SessionMeta;
  messages: ChatMessage[];
  transcript: Message[];
  targets: PracticeTarget[];
}

/** writing-<lang>.json: one row per learner message (S1-23). */
export interface WritingRow {
  at: number;
  sessionId: string;
  messageId: string;
  words: string[];
}

/** activity.json: active practice time aggregated per local date + session (S1-24). */
export interface ActivityEntry {
  date: string;
  language: Language;
  sessionId: string;
  ms: number;
  /** Stage 3 (S3-04): listening and speaking time, counted apart from text practice. */
  voiceMs?: number;
}

/** word-usage-<lang>.json is stored as an array (oldest first) and held as a Map in memory. */
export const wordUsageCodec: JsonCodec<Map<string, WordUsage>> = {
  decode(raw) {
    const map = new Map<string, WordUsage>();
    if (Array.isArray(raw)) for (const u of raw as WordUsage[]) if (u && typeof u.word === "string") map.set(u.word, u);
    return map;
  },
  encode(data) {
    return [...data.values()].sort((a, b) => a.firstUsedAt - b.firstUsedAt);
  },
};

/** Kinds stored before v0.21.0 and what they are now. */
const LEGACY_KIND: Record<LegacyCorrectionKind, CorrectionKind> = { vocabulary: "grammar", phrasing: "grammar", style: "typo" };

/** corrections.json: old kinds are mapped on load, so every reader sees only the current kinds (the next write keeps them). */
export const correctionsCodec: JsonCodec<Correction[]> = {
  decode(raw) {
    if (!Array.isArray(raw)) return [];
    return (raw as (Correction | { kind: LegacyCorrectionKind })[]).map((c) => {
      const mapped = LEGACY_KIND[c.kind as LegacyCorrectionKind];
      return mapped ? ({ ...c, kind: mapped } as Correction) : (c as Correction);
    });
  },
  encode: (data) => data,
};

export const DEFAULT_TITLES = Object.fromEntries(LANGUAGES.map((l) => [l, LANGUAGE_META[l].titles.chat])) as Record<Language, string>;

/** Title a session from the learner's first message (~14 CJK characters, ~28 for languages written with spaces). */
export function titleFrom(text: string, language?: Language): string {
  const max = language && spaceSeparated(language) ? 28 : 14;
  const chars = [...text.replace(/\s+/g, " ").trim()];
  return chars.slice(0, max).join("") + (chars.length > max ? "…" : "");
}
