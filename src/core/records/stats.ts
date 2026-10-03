// Progress statistics, computed locally from stored evidence (S1-22..S1-25).
import type {
  AnkiSnapshot,
  Correction,
  CorrectionKind,
  GrammarSummary,
  Language,
  ProgressRange,
  ProgressStats,
  WordUsage,
} from "../../shared/records";
import { lastDates, localDate } from "./dates";
import type { ActivityEntry, WritingRow } from "./files";

export const CORRECTION_KINDS: readonly CorrectionKind[] = ["grammar", "vocabulary", "phrasing", "style"];

const RANGE_DAYS: Record<ProgressRange, number | null> = { week: 7, month: 30, all: null };
const ALL_DAILY_DAYS = 90;
const FIRST_USED_LIMIT = 50;

export interface ProgressInputs {
  language: Language;
  range: ProgressRange;
  now: number;
  /** All activity entries (any language). */
  activity: ActivityEntry[];
  /** Writing rows for `language`. */
  writing: WritingRow[];
  /** Learner messages in sessions of `language` (covers sessions without writing rows). */
  learnerMessages: { sessionId: string; at: number }[];
  wordUsage: Iterable<WordUsage>;
  grammar: GrammarSummary[];
  /** Corrections for `language`. */
  corrections: Correction[];
  anki?: AnkiSnapshot | null;
}

export function computeProgress(i: ProgressInputs): ProgressStats {
  const days = RANGE_DAYS[i.range];
  const windowDates = lastDates(i.now, days ?? ALL_DAILY_DAYS);
  const start = days === null ? null : windowDates[0]!;
  const dateIn = (date: string) => start === null || date >= start;
  const timeIn = (ms: number) => dateIn(localDate(ms));

  const activity = i.activity.filter((a) => a.language === i.language && dateIn(a.date));
  const perDay = new Map<string, number>();
  let activeMs = 0;
  let voiceMs = 0;
  for (const a of activity) {
    activeMs += a.ms;
    voiceMs += a.voiceMs ?? 0;
    perDay.set(a.date, (perDay.get(a.date) ?? 0) + a.ms);
  }
  const daily = windowDates.map((date) => ({ date, activeMs: perDay.get(date) ?? 0 }));

  const sessions = new Set<string>();
  for (const a of activity) if (a.ms > 0 || (a.voiceMs ?? 0) > 0) sessions.add(a.sessionId);
  for (const m of i.learnerMessages) if (timeIn(m.at)) sessions.add(m.sessionId);

  let wordsWritten = 0;
  const distinct = new Set<string>();
  for (const row of i.writing) {
    if (!timeIn(row.at)) continue;
    wordsWritten += row.words.length;
    for (const w of row.words) distinct.add(w);
    sessions.add(row.sessionId);
  }

  const usage = [...i.wordUsage];
  const firstUsed = usage
    .filter((u) => timeIn(u.firstUsedAt))
    .sort((a, b) => b.firstUsedAt - a.firstUsedAt)
    .slice(0, FIRST_USED_LIMIT);

  const grammar = { introduced: 0, with_help: 0, independent: 0 };
  for (const g of i.grammar) grammar[g.state]++;

  const byKind = Object.fromEntries(CORRECTION_KINDS.map((k) => [k, 0])) as Record<CorrectionKind, number>;
  let total = 0;
  for (const c of i.corrections) {
    if (!timeIn(c.createdAt)) continue;
    total++;
    byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
  }

  const stats: ProgressStats = {
    language: i.language,
    range: i.range,
    activeMs,
    voiceMs,
    sessions: sessions.size,
    wordsWritten,
    distinctWords: distinct.size,
    firstUsed,
    daily,
    grammar,
    corrections: { total, byKind },
  };

  if (i.anki) {
    const used = new Set(usage.map((u) => u.word));
    const cardWords = new Set(i.anki.cards.map((c) => c.word).filter((w) => w));
    let usedInWriting = 0;
    for (const w of cardWords) if (used.has(w)) usedInWriting++;
    stats.anki = {
      matureCount: i.anki.matureCount,
      usedInWriting,
      reviewedToday: i.anki.reviewedToday,
      syncedAt: i.anki.syncedAt,
    };
  }
  return stats;
}
