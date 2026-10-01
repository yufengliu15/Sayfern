// Anki tools (S1-14, F-05): what the learner knows, is learning, will learn next, and
// struggles with. Offered only when Anki is on and the language has a snapshot. Results
// are compact word lines and always say when the snapshot was synced.
import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { TutorTool } from "../contracts";
import type { AnkiCard, AnkiOverview, AnkiWord, AnkiWordStatus } from "../../shared/records";
import { cardStage, cardStatus } from "../anki/words";
import type { TutorDeps } from "./deps";
import { arr, obj, plural, str, truncate } from "./text";

export const ANKI_DEFAULT_LIMIT = 20;
export const ANKI_MAX_LIMIT = 100;
export const ANKI_MAX_CHECK = 50;
const MEANING_CHARS = 40;

const VOCAB_STATUS = ["known", "learning", "new", "struggling", "suspended", "all"] as const;
type VocabStatus = (typeof VOCAB_STATUS)[number];

const NOT_SYNCED = "Anki hasn't been synced for this language yet.";

function limitOf(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(ANKI_MAX_LIMIT, n) : ANKI_DEFAULT_LIMIT;
}

function ago(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** "Anki snapshot from 2026-09-30 13:02 UTC (2 h ago)." */
export function syncedLine(syncedAt: number, now: number): string {
  const when = new Date(syncedAt).toISOString().slice(0, 16).replace("T", " ");
  return `Anki snapshot from ${when} UTC (${ago(Math.max(0, now - syncedAt))}).`;
}

const STATUS_TEXT: Record<AnkiWordStatus, string> = { known: "known", learning: "learning", new: "new", suspended: "suspended" };

/** "印象 · yìnxiàng · impression · known · 3 lapses, failed 4 of last 9" */
export function wordLine(w: AnkiWord): string {
  const parts = [w.word];
  if (w.reading) parts.push(w.reading);
  if (w.meaning) parts.push(truncate(w.meaning, MEANING_CHARS).replace(/\s+…$/, "…"));
  parts.push(w.status === "known" && w.mature ? "known (mature)" : STATUS_TEXT[w.status]);
  if (w.reasons.length) parts.push(w.reasons.join(", "));
  return parts.join(" · ");
}

const n = (x: number) => x.toLocaleString("en-US");

export function overviewText(o: AnkiOverview, now: number): string {
  const c = o.counts;
  const lines = [
    syncedLine(o.syncedAt, now),
    `Words: ${n(c.known)} known (${n(o.mature)} mature, ${n(o.young)} young), ${n(c.learning)} learning, ${n(c.new)} new (not studied yet), ${n(c.suspended)} suspended. ${n(o.struggling)} struggling. Cards reviewed today: ${n(o.reviewedToday)}.`,
  ];
  if (o.topStruggling.length) lines.push("Hardest right now:", ...o.topStruggling.map((w) => `- ${wordLine(w)}`));
  if (o.nextNew.length) lines.push("Next new words, in the order Anki will introduce them:", ...o.nextNew.map((w) => `- ${wordLine(w)}`));
  return lines.join("\n");
}

function ankiOverview(deps: TutorDeps): TutorTool {
  return {
    name: "anki_overview",
    description:
      "Summary of the learner's Anki vocabulary: how many words they know, are learning and have not studied yet, their hardest words right now, and the next new words they will learn.",
    parameters: Type.Object({}),
    recordingOnly: false,
    async execute(_args, ctx) {
      const o = await ctx.anki.overview(ctx.language);
      if (!o) return { content: NOT_SYNCED, activity: "Read Anki overview (not synced)" };
      return { content: overviewText(o, deps.now()), activity: "Read Anki overview" };
    },
  };
}

function ankiStruggling(deps: TutorDeps): TutorTool {
  return {
    name: "anki_struggling",
    description:
      "The learner's hardest Anki words right now (many lapses, recent 'again' answers, low ease, leeches), hardest first, each with the reasons.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: ANKI_MAX_LIMIT, description: `Default ${ANKI_DEFAULT_LIMIT}.` })),
      deck: Type.Optional(Type.String({ description: "Only words from this deck (and its subdecks)." })),
    }),
    recordingOnly: false,
    async execute(rawArgs, ctx) {
      const args = obj(rawArgs);
      const deck = str(args.deck);
      const page = await ctx.anki.words(ctx.language, { status: "struggling", limit: limitOf(args.limit), ...(deck ? { deck } : {}) });
      if (page.syncedAt === null) return { content: NOT_SYNCED, activity: "Read struggling Anki words (not synced)" };
      const head = `${syncedLine(page.syncedAt, deps.now())}\n${plural(page.total, "struggling word")}${deck ? ` in ${deck}` : ""}; showing the ${page.items.length} hardest.`;
      const content = page.items.length ? `${head}\n${page.items.map(wordLine).join("\n")}` : `${head}\nNone: nothing stands out as hard right now.`;
      return { content, activity: `Read ${plural(page.items.length, "struggling Anki word")}` };
    },
  };
}

const ORDER_NOTE: Record<VocabStatus, string> = {
  known: "most recently reviewed first",
  learning: "most recently reviewed first",
  new: "not studied yet, in the order Anki will introduce them",
  struggling: "hardest first",
  suspended: "hardest first",
  all: "learning, known, new, suspended",
};

function ankiVocabulary(deps: TutorDeps): TutorTool {
  return {
    name: "anki_vocabulary",
    description:
      "Page through the learner's Anki words by status: known (in review), learning, new (in their decks but not studied yet; listed in the order they will learn them), struggling, suspended, or all. Optional search matches the word, its reading or its meaning.",
    parameters: Type.Object({
      status: Type.Optional(StringEnum(VOCAB_STATUS, { description: "Default \"known\"." })),
      search: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: ANKI_MAX_LIMIT, description: `Default ${ANKI_DEFAULT_LIMIT}.` })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    recordingOnly: false,
    async execute(rawArgs, ctx) {
      const args = obj(rawArgs);
      const status: VocabStatus = (VOCAB_STATUS as readonly string[]).includes(str(args.status)) ? (str(args.status) as VocabStatus) : "known";
      const search = str(args.search);
      const offset = Math.max(0, Math.floor(Number(args.offset)) || 0);
      const page = await ctx.anki.words(ctx.language, { status, limit: limitOf(args.limit), offset, ...(search ? { search } : {}) });
      const label = `${status} Anki words`;
      if (page.syncedAt === null) return { content: NOT_SYNCED, activity: `Listed ${label} (not synced)` };
      const what = `${status === "all" ? "Words" : `${status[0].toUpperCase()}${status.slice(1)} words`}${search ? ` matching "${search}"` : ""}`;
      const range = page.items.length ? `showing ${offset + 1}–${offset + page.items.length}` : "none on this page";
      const lines = [syncedLine(page.syncedAt, deps.now()), `${what}: ${n(page.total)} (${ORDER_NOTE[status]}); ${range}.`, ...page.items.map(wordLine)];
      const next = offset + page.items.length;
      if (page.items.length && next < page.total) lines.push(`More: offset ${next}.`);
      const activity = search ? `Searched ${label}: ${search} (${page.total})` : `Listed ${page.items.length} ${label}`;
      return { content: lines.join("\n"), activity };
    },
  };
}

const CHECK_GROUPS: { status: AnkiWordStatus | "unknown"; label: string }[] = [
  { status: "known", label: "Known" },
  { status: "learning", label: "Learning" },
  { status: "new", label: "In their deck, not studied yet" },
  { status: "suspended", label: "Suspended" },
  { status: "unknown", label: "Not in Anki" },
];

function ankiCheckWords(deps: TutorDeps): TutorTool {
  return {
    name: "anki_check_words",
    description:
      "Check whether the learner knows words before you use them: known, learning, in their deck but not studied yet, or not in Anki at all. Matches the word or its reading.",
    parameters: Type.Object({
      words: Type.Array(Type.String(), { minItems: 1, maxItems: ANKI_MAX_CHECK, description: `Up to ${ANKI_MAX_CHECK} words.` }),
    }),
    recordingOnly: false,
    async execute(rawArgs, ctx) {
      const all = arr(obj(rawArgs).words).map(str).filter(Boolean);
      const asked = [...new Set(all)].slice(0, ANKI_MAX_CHECK);
      if (!asked.length) return { content: "Give at least one word.", activity: "Checked 0 words in Anki" };
      const snap = await ctx.anki.snapshot(ctx.language);
      if (!snap) return { content: NOT_SYNCED, activity: `Checked ${plural(asked.length, "word")} in Anki (not synced)` };
      const result = await ctx.anki.checkWords(ctx.language, asked);
      const lines = [syncedLine(snap.syncedAt, deps.now())];
      for (const g of CHECK_GROUPS) {
        const hits = Object.entries(result).filter(([, s]) => s === g.status).map(([w]) => w);
        if (hits.length) lines.push(`${g.label}: ${hits.join(", ")}`);
      }
      const dropped = new Set(all).size - asked.length;
      if (dropped > 0) lines.push(`(${plural(dropped, "word")} over the ${ANKI_MAX_CHECK}-word limit not checked.)`);
      return { content: lines.join("\n"), activity: `Checked ${plural(asked.length, "word")} in Anki` };
    },
  };
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** One card in detail (anki_lookup). */
export function cardText(card: AnkiCard, historyDays?: number): string {
  const status = cardStatus(card);
  const stage = cardStage(card);
  const parts = [`${card.word}${card.reading ? ` [${card.reading}]` : ""}${card.meaning ? `: ${card.meaning}` : ""}`];
  parts.push(`status ${status}${status !== stage ? ` (${stage})` : ""}${card.relearning ? ", relearning" : ""}`);
  if (stage === "new") {
    if (card.newPosition !== undefined) parts.push(`new-queue position ${card.newPosition}`);
  } else {
    parts.push(`interval ${card.interval} days${card.mature || (stage === "review" && card.interval >= 21) ? " (mature)" : ""}`);
    if (card.ease > 0) parts.push(`ease ${Math.round(card.ease / 10)}%`);
  }
  parts.push(`lapses ${card.lapses}`, `reviews ${card.reps}`);
  if (card.recentReviews !== undefined) {
    parts.push(`last ${historyDays ?? 90} days: ${card.recentFails ?? 0} again of ${card.recentReviews}`);
  }
  if (card.avgAnswerMs) parts.push(`avg answer ${(card.avgAnswerMs / 1000).toFixed(1)} s`);
  if (card.leech) parts.push("leech");
  parts.push(`last review ${card.lastReviewAt ? day(card.lastReviewAt) : "unknown"}`);
  return parts.join(", ");
}

function ankiLookup(deps: TutorDeps): TutorTool {
  return {
    name: "anki_lookup",
    description: "Look up the learner's Anki card for one word: status, interval, ease, lapses, recent answers, last review.",
    parameters: Type.Object({ word: Type.String() }),
    recordingOnly: false,
    async execute(rawArgs, ctx) {
      const word = str(obj(rawArgs).word);
      const activity = `Checked Anki: ${word || "(empty)"}`;
      if (!word) return { content: "Give a word.", activity };
      const [card, snap] = await Promise.all([ctx.anki.findCard(ctx.language, word), ctx.anki.snapshot(ctx.language)]);
      if (!card) return { content: "Not in the learner's Anki decks.", activity };
      const text = cardText(card, snap?.historyDays);
      return { content: snap ? `${syncedLine(snap.syncedAt, deps.now())}\n${text}` : text, activity };
    },
  };
}

export function ankiTools(deps: TutorDeps): TutorTool[] {
  return [ankiOverview(deps), ankiStruggling(deps), ankiVocabulary(deps), ankiCheckWords(deps), ankiLookup(deps)];
}
