// Word-level view of an Anki snapshot (S1-14). Pure functions, no I/O.
//
// Several cards can share one word (recognition + production, or the same word in
// two decks). The tutor thinks in words, so cards are grouped by their cleaned word
// and summarised: status, maturity, lapses, recent answers and a struggle score.
import type {
  AnkiCard,
  AnkiCardStatus,
  AnkiOverview,
  AnkiSnapshot,
  AnkiWord,
  AnkiWordFilter,
  AnkiWordPage,
  AnkiWordStatus,
} from "../../shared/records";

export const MATURE_DAYS = 21;
/** Words above this struggle score count as "struggling". */
export const STRUGGLE_THRESHOLD = 0.35;
export const DEFAULT_WORD_LIMIT = 20;
export const MAX_WORD_LIMIT = 1000;

type Stage = "new" | "learning" | "review";

/**
 * Scheduling stage of a card. 0.2+ snapshots store it; older ones are inferred:
 * never reviewed → new, interval of a day or more → review, otherwise learning.
 */
export function cardStage(c: AnkiCard): Stage {
  if (c.stage) return c.stage;
  if (c.status === "new" || c.status === "learning" || c.status === "review") return c.status;
  if (!c.reps) return "new";
  return c.interval >= 1 ? "review" : "learning";
}

export function cardStatus(c: AnkiCard): AnkiCardStatus {
  return c.status ?? cardStage(c);
}

export function cardMature(c: AnkiCard): boolean {
  return c.mature ?? (cardStage(c) === "review" && c.interval >= MATURE_DAYS);
}

// ---------------------------------------------------------------- struggle

export interface StruggleInput {
  /** Lapses summed over the word's cards. */
  lapses: number;
  /** Answers and "again" answers in the history window. */
  recentReviews: number;
  recentFails: number;
  /** Lowest ease factor among the word's reviewed cards (2500 = 250%); 0 or undefined = unknown. */
  ease?: number;
  relearning: boolean;
  leech: boolean;
  /** Mean answer time (ms) and the deck's median of per-card means. */
  avgAnswerMs?: number;
  medianAnswerMs?: number;
}

/** Weights sum to 1, so the score stays in 0..1. */
const W = { lapses: 0.3, again: 0.3, ease: 0.15, relearning: 0.1, leech: 0.1, slow: 0.05 };
/** Beta prior on the again-rate: mean 10%, worth 5 answers. */
const PRIOR_FAILS = 0.5;
const PRIOR_REVIEWS = 5;
const BASE_AGAIN_RATE = 0.1;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);

/**
 * How hard a word is for the learner right now, 0..1, with short reasons.
 *
 *   score = 0.30 · lapses      1 − e^(−lapses/4)                  (2 → .39, 4 → .63, 8 → .86)
 *         + 0.30 · again-rate  (fails+0.5)/(reviews+5), mapped from 10% → 0 to 50% → 1
 *                              (the prior keeps "1 fail of 1 review" at .38, not 1)
 *         + 0.15 · low ease    (2500 − ease)/1200                 (250% → 0, 130% → 1)
 *         + 0.10 · relearning now
 *         + 0.10 · leech tag
 *         + 0.05 · slow        avg answer time vs deck median, 1.5× → 0 to 3× → 1 (needs 3+ answers)
 *
 * Reasons list the components that matter, strongest first.
 */
export function struggleScore(input: StruggleInput): { score: number; reasons: string[] } {
  const parts: { w: number; reason?: string }[] = [];

  const lapses = Math.max(0, input.lapses || 0);
  const lapseC = 1 - Math.exp(-lapses / 4);
  parts.push({ w: W.lapses * lapseC, reason: lapses >= 2 ? `${lapses} lapses` : undefined });

  const reviews = Math.max(0, input.recentReviews || 0);
  const fails = Math.min(reviews, Math.max(0, input.recentFails || 0));
  const rate = (fails + PRIOR_FAILS) / (reviews + PRIOR_REVIEWS);
  const againC = clamp01((rate - BASE_AGAIN_RATE) / 0.4);
  parts.push({ w: W.again * againC, reason: fails >= 1 && againC >= 0.25 ? `failed ${fails} of last ${reviews}` : undefined });

  const ease = input.ease ?? 0;
  const easeC = ease > 0 ? clamp01((2500 - ease) / 1200) : 0;
  parts.push({ w: W.ease * easeC, reason: easeC >= 0.25 ? `ease ${Math.round(ease / 10)}%` : undefined });

  parts.push({ w: input.relearning ? W.relearning : 0, reason: input.relearning ? "relearning now" : undefined });
  parts.push({ w: input.leech ? W.leech : 0, reason: input.leech ? "leech" : undefined });

  const avg = input.avgAnswerMs ?? 0;
  const med = input.medianAnswerMs ?? 0;
  const slowC = reviews >= 3 && avg > 0 && med > 0 ? clamp01((avg / med - 1.5) / 1.5) : 0;
  parts.push({ w: W.slow * slowC, reason: slowC > 0 ? `slow answers (${(avg / 1000).toFixed(avg < 10_000 ? 1 : 0)} s)` : undefined });

  const score = clamp01(parts.reduce((a, p) => a + p.w, 0));
  const reasons = parts
    .filter((p) => p.reason && p.w > 0)
    .sort((a, b) => b.w - a.w)
    .map((p) => p.reason!);
  return { score, reasons };
}

// ---------------------------------------------------------------- aggregation

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Group a snapshot's cards by cleaned word. Order: first appearance in the snapshot. */
export function aggregateWords(snapshot: AnkiSnapshot | null | undefined): AnkiWord[] {
  if (!snapshot) return [];
  const groups = new Map<string, AnkiCard[]>();
  for (const c of snapshot.cards) {
    if (!c?.word) continue;
    const list = groups.get(c.word);
    if (list) list.push(c);
    else groups.set(c.word, [c]);
  }
  const medianAnswerMs = median(
    snapshot.cards.filter((c) => (c.recentReviews ?? 0) > 0 && (c.avgAnswerMs ?? 0) > 0).map((c) => c.avgAnswerMs!),
  );

  const out: AnkiWord[] = [];
  for (const [word, cards] of groups) {
    const active = cards.filter((c) => cardStatus(c) !== "suspended");
    const stages = active.map(cardStage);
    let status: AnkiWordStatus;
    if (active.length === 0) status = "suspended";
    else if (stages.includes("review")) status = "known";
    else if (stages.includes("learning")) status = "learning";
    else status = "new";

    const w: AnkiWord = {
      word,
      status,
      mature: active.some(cardMature),
      cards: cards.length,
      cardIds: cards.map((c) => c.cardId),
      decks: [...new Set(cards.map((c) => c.deck).filter(Boolean))],
      lapses: 0,
      recentReviews: 0,
      recentFails: 0,
      struggle: 0,
      reasons: [],
    };
    const reading = cards.find((c) => c.reading)?.reading;
    if (reading) w.reading = reading;
    const meaning = cards.find((c) => c.meaning)?.meaning;
    if (meaning) w.meaning = meaning;

    let minEase = 0;
    let answerMsTotal = 0;
    let timedReviews = 0;
    for (const c of cards) {
      w.lapses += c.lapses || 0;
      const r = c.recentReviews ?? 0;
      w.recentReviews += r;
      w.recentFails += c.recentFails ?? 0;
      if (r > 0 && (c.avgAnswerMs ?? 0) > 0) {
        answerMsTotal += c.avgAnswerMs! * r;
        timedReviews += r;
      }
      if (c.ease > 0 && cardStage(c) !== "new" && (minEase === 0 || c.ease < minEase)) minEase = c.ease;
      if (c.lastReviewAt !== undefined && (w.lastReviewAt === undefined || c.lastReviewAt > w.lastReviewAt)) w.lastReviewAt = c.lastReviewAt;
    }
    if (status === "new") {
      const positions = active.map((c) => c.newPosition).filter((p): p is number => typeof p === "number");
      if (positions.length) w.newPosition = Math.min(...positions);
    }
    if (status !== "new") {
      const s = struggleScore({
        lapses: w.lapses,
        recentReviews: w.recentReviews,
        recentFails: w.recentFails,
        ease: minEase,
        relearning: active.some((c) => c.relearning === true),
        leech: cards.some((c) => c.leech === true),
        avgAnswerMs: timedReviews ? answerMsTotal / timedReviews : undefined,
        medianAnswerMs,
      });
      w.struggle = s.score;
      w.reasons = s.reasons;
    }
    out.push(w);
  }
  return out;
}

// ---------------------------------------------------------------- queries

/** Fold a reading for matching: NFD, tone marks and spaces dropped, lowercase, katakana → hiragana. */
export function foldReading(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s'·・]/g, "")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .normalize("NFC");
}

const byRecent = (a: AnkiWord, b: AnkiWord) =>
  (b.lastReviewAt ?? -1) - (a.lastReviewAt ?? -1) || b.struggle - a.struggle;
const byNewOrder = (a: AnkiWord, b: AnkiWord) =>
  (a.newPosition ?? Number.MAX_SAFE_INTEGER) - (b.newPosition ?? Number.MAX_SAFE_INTEGER) || a.cardIds[0] - b.cardIds[0];
const byStruggle = (a: AnkiWord, b: AnkiWord) => b.struggle - a.struggle || b.lapses - a.lapses || byRecent(a, b);
const STATUS_ORDER: Record<AnkiWordStatus, number> = { learning: 0, known: 1, new: 2, suspended: 3 };

export function isStruggling(w: AnkiWord): boolean {
  return w.status !== "suspended" && w.status !== "new" && w.struggle > STRUGGLE_THRESHOLD;
}

function inDeck(w: AnkiWord, deck: string): boolean {
  const d = deck.trim().toLowerCase();
  return w.decks.some((x) => {
    const n = x.toLowerCase();
    return n === d || n.startsWith(`${d}::`);
  });
}

function matchesSearch(w: AnkiWord, q: string): boolean {
  const raw = q.trim().normalize("NFC");
  if (!raw) return true;
  if (w.word.includes(raw)) return true;
  const folded = foldReading(raw);
  if (folded && w.reading && foldReading(w.reading).includes(folded)) return true;
  return !!w.meaning && w.meaning.toLowerCase().includes(raw.toLowerCase());
}

/**
 * Filter, sort and page words.
 * struggling: struggle desc (above the threshold) · known/learning: most recently reviewed first ·
 * new: introduction order ("will learn next") · suspended: struggle desc · all: learning, known, new, suspended.
 */
export function queryWords(words: AnkiWord[], filter: AnkiWordFilter = {}): { total: number; items: AnkiWord[] } {
  const status = filter.status ?? "all";
  let list = words;
  if (status === "struggling") list = list.filter(isStruggling);
  else if (status !== "all") list = list.filter((w) => w.status === status);
  if (filter.deck?.trim()) list = list.filter((w) => inDeck(w, filter.deck!));
  if (filter.search?.trim()) list = list.filter((w) => matchesSearch(w, filter.search!));

  const sorted = [...list];
  switch (status) {
    case "struggling":
    case "suspended":
      sorted.sort(byStruggle);
      break;
    case "new":
      sorted.sort(byNewOrder);
      break;
    case "known":
    case "learning":
      sorted.sort(byRecent);
      break;
    default:
      sorted.sort((a, b) => {
        const d = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (d) return d;
        return a.status === "new" ? byNewOrder(a, b) : a.status === "suspended" ? byStruggle(a, b) : byRecent(a, b);
      });
  }
  const asked = Math.floor(Number(filter.limit));
  const limit = asked > 0 ? Math.min(MAX_WORD_LIMIT, asked) : DEFAULT_WORD_LIMIT;
  const offset = Math.max(0, Math.floor(Number(filter.offset)) || 0);
  return { total: sorted.length, items: sorted.slice(offset, offset + limit) };
}

export function wordPage(snapshot: AnkiSnapshot | null, words: AnkiWord[], filter: AnkiWordFilter): AnkiWordPage {
  if (!snapshot) return { total: 0, items: [], syncedAt: null };
  return { ...queryWords(words, filter), syncedAt: snapshot.syncedAt };
}

/** Status of each asked word, matched on the cleaned word or its reading. */
export function checkWordsIn(words: AnkiWord[], asked: string[]): Record<string, AnkiWordStatus | "unknown"> {
  const byWord = new Map<string, AnkiWord>();
  const byReading = new Map<string, AnkiWord>();
  for (const w of words) {
    byWord.set(w.word, w);
    if (w.reading) {
      const key = foldReading(w.reading);
      // Prefer the "most known" word when several share a reading.
      const prev = byReading.get(key);
      if (!prev || STATUS_RANK[w.status] > STATUS_RANK[prev.status]) byReading.set(key, w);
    }
  }
  const out: Record<string, AnkiWordStatus | "unknown"> = {};
  for (const raw of asked) {
    if (typeof raw !== "string") continue;
    const q = raw.trim().normalize("NFC");
    if (!q || q in out) continue;
    const hit = byWord.get(q) ?? byReading.get(foldReading(q));
    out[q] = hit ? hit.status : "unknown";
  }
  return out;
}
const STATUS_RANK: Record<AnkiWordStatus, number> = { known: 3, learning: 2, new: 1, suspended: 0 };

export function buildOverview(snapshot: AnkiSnapshot, words: AnkiWord[]): AnkiOverview {
  const counts: Record<AnkiWordStatus, number> = { known: 0, learning: 0, new: 0, suspended: 0 };
  let mature = 0;
  let struggling = 0;
  for (const w of words) {
    counts[w.status]++;
    if (w.status === "known" && w.mature) mature++;
    if (isStruggling(w)) struggling++;
  }
  return {
    language: snapshot.language,
    syncedAt: snapshot.syncedAt,
    counts,
    mature,
    young: counts.known - mature,
    newRemaining: counts.new,
    struggling,
    reviewedToday: snapshot.reviewedToday ?? 0,
    nextNew: queryWords(words, { status: "new", limit: 20 }).items,
    topStruggling: queryWords(words, { status: "struggling", limit: 5 }).items,
  };
}
