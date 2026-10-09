// Stage 2 · Corrections review and correction-to-Anki export (S2-01..S2-03).
// Owned by the review feature. Types only (compiled by both node and web TS projects), plus
// one tiny pure helper (clozeFront) that the core and the UI must agree on.
// Every invokable method added to ReviewApi must also be listed in REVIEW_METHODS (compile-time check).
import type { Correction, CorrectionKind, Language, SessionKind } from "../records";
import type { ModelRef } from "../types";

// ---------------------------------------------------------------- review list (S2-01, S2-02)

/** The three filter chips: one per correction kind. */
export type ReviewKind = CorrectionKind;
export type ReviewKindFilter = "all" | ReviewKind;

/**
 * - `practise`: not fixed yet (open, retried wrong, or answer revealed)
 * - `fixed`: fixed on retry
 * - `disputed`: the learner said it isn't a mistake
 * - `not_exported`: never sent to Anki (disputed ones excluded)
 */
export type ReviewStatusFilter = "all" | "practise" | "fixed" | "disputed" | "not_exported";

export interface ReviewFilter {
  language: Language;
  kind?: ReviewKindFilter;
  status?: ReviewStatusFilter;
  grammarId?: string;
  /** Substring of the sentence, fix, explanation, session title or grammar pattern/name. */
  search?: string;
}

export interface ReviewItem {
  correction: Correction;
  /** The learner's sentence that held the problem (just `original` when the message is gone). */
  sentence: string;
  /** The same sentence with the fix applied, split around the fixed part. */
  revised: { before: string; fixed: string; after: string };
  session?: { id: string; title: string; kind: SessionKind; at: number };
  grammar?: { id: string; pattern: string; name: string };
}

export interface ReviewList {
  /** Newest first. */
  items: ReviewItem[];
  /** Items per chip under the current status, grammar and search filters (computed locally). */
  counts: Record<ReviewKindFilter, number>;
  /** Grammar points with corrections in this language, for the grammar filter. Most corrections first. */
  grammarPoints: { id: string; pattern: string; name: string; count: number }[];
  /** All corrections in this language, before any filter. */
  total: number;
}

// ---------------------------------------------------------------- Anki export (S2-03)

/** "Fill the gap" (cloze) or "Situation → sentence". */
export type AnkiCardStyle = "cloze" | "situation";

/** One editable card. Its answer side is always the corrected sentence, never the learner's wrong version. */
export interface AnkiCardDraft {
  correctionId: string;
  style: AnkiCardStyle;
  /** Front. cloze: clozeFront(back, gap, hint); situation: an English situation prompt. */
  front: string;
  /** The correct sentence. */
  back: string;
  /** The fixed part of `back`: hidden on a cloze front, highlighted on the answer side. Must occur in `back`. */
  gap: string;
  /** cloze: short English hint shown in the gap. */
  hint?: string;
  explanation: string;
  /** "周末计划 · Sep 29, 2026" */
  source: string;
  tags: string[];
  /** Situation written without the model (no model picked, or the call failed). */
  fallback?: boolean;
}

export interface DraftAnkiCardsInput {
  language: Language;
  correctionIds: string[];
  style: AnkiCardStyle;
}

export interface DraftAnkiCardsResult {
  /** In the order of `correctionIds`. */
  cards: AnkiCardDraft[];
  /** Corrections not turned into cards (disputed, missing). */
  skipped: { correctionId: string; reason: string }[];
  /** Shown above the preview, e.g. why situations came from the explanations. */
  notice?: string;
}

export interface ExportAnkiCardsInput {
  language: Language;
  deck: string;
  cards: AnkiCardDraft[];
}

export type AnkiExportStatus = "added" | "duplicate" | "failed";

export interface ExportAnkiCardsResult {
  deck: string;
  added: number;
  /** Already in Anki (same first field in the same Sayfern note type). */
  duplicates: number;
  failed: number;
  results: { correctionId: string; status: AnkiExportStatus; noteId?: number; error?: string }[];
}

/** Cloze front as the learner sees it: "我们昨天 ___ (went hiking) 。" */
export const clozeFront = (back: string, gap: string, hint?: string): string => {
  const at = gap ? back.indexOf(gap) : -1;
  const blank = hint?.trim() ? `___ (${hint.trim()})` : "___";
  if (at < 0) return blank;
  return `${back.slice(0, at)} ${blank} ${back.slice(at + gap.length)}`.trim();
};

export interface ReviewApi {
  /** S2-01/S2-02: corrections across sessions, newest first, with chip counts. */
  listReviewCorrections(filter: ReviewFilter): Promise<ReviewList>;
  /**
   * S2-03: editable card drafts. Cloze cards are built locally; situation prompts come from one
   * batched model call, or from the explanation when there is no model or the call fails.
   * Disputed corrections are skipped.
   */
  draftAnkiCards(input: DraftAnkiCardsInput, model?: ModelRef): Promise<DraftAnkiCardsResult>;
  /** S2-03: adds the cards through AnkiConnect (Sayfern note types), skips duplicates, marks corrections exported. */
  exportAnkiCards(input: ExportAnkiCardsInput): Promise<ExportAnkiCardsResult>;
}

export const REVIEW_METHODS: Record<Exclude<keyof ReviewApi, `on${string}`>, true> = {
  listReviewCorrections: true,
  draftAnkiCards: true,
  exportAnkiCards: true,
};
