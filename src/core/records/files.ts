// On-disk record shapes that are private to the records store.
import type { Message } from "@earendil-works/pi-ai";
import type { ChatMessage, Language, PracticeTarget, SessionMeta, WordUsage } from "../../shared/records";
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

export const DEFAULT_TITLES: Record<Language, string> = { zh: "新对话", ja: "新しい会話" };

/** Title a session from the learner's first message (~14 characters). */
export function titleFrom(text: string): string {
  const chars = [...text.replace(/\s+/g, " ").trim()];
  return chars.slice(0, 14).join("") + (chars.length > 14 ? "…" : "");
}
