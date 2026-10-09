// Learning-record domain types. Shared by core, main and renderer.
// No runtime imports: this file must stay types-only (plus tiny pure consts).

/** Learning languages. Metadata (names, levels, scripts) lives in ./languages. */
export type Language = "zh" | "ja" | "ko" | "en" | "es" | "fr" | "de" | "it" | "pt" | "ru" | "vi";
export const LANGUAGES: readonly Language[] = ["zh", "ja", "ko", "en", "es", "fr", "de", "it", "pt", "ru", "vi"];

// ---------------------------------------------------------------- sources

/** Where a piece of evidence or explanation came from. */
export type SourceRef =
  | { kind: "library"; docId: string; paragraph: number; title?: string; quote?: string }
  | { kind: "session"; sessionId: string; messageId: string };

// ---------------------------------------------------------------- sessions

export type SessionKind = "chat" | "reading" | "practice" | "placement";
export type FeedbackMode = "inline" | "end";

/** Session difficulty offset from the learner's estimated level: -2 much easier … 2 much harder. */
export type Difficulty = -2 | -1 | 0 | 1 | 2;
export const DIFFICULTIES: readonly Difficulty[] = [-2, -1, 0, 1, 2];

/** Where the learner says they are before a placement chat. The diagnostic starts in that part of the level scale. */
export type LevelBand = "beginner" | "intermediate" | "advanced";
export const LEVEL_BANDS: readonly LevelBand[] = ["beginner", "intermediate", "advanced"];

export interface SessionMeta {
  id: string;
  language: Language;
  kind: SessionKind;
  title: string;
  createdAt: number;
  updatedAt: number;
  feedbackMode: FeedbackMode;
  /** "Go easier / go harder" slider: -2..2, 0 (or absent) = the tutor's default level. */
  difficulty?: Difficulty;
  /** practice sessions: grammar point to work on (S1-19). */
  focusGrammarId?: string;
  /** practice sessions: the course unit to work through (src/shared/course). */
  unitId?: string;
  /** practice sessions: how the tutor opens. "explain" = a fresh explanation of the focus pattern with a new example first;
   *  in a course unit session, a short overview of the unit's grammar points first. */
  openWith?: "explain";
  /** reading sessions: the document being read (S1-11). */
  docId?: string;
  /** chat sessions: the role-play scenario (src/shared/scenarios.ts); the tutor opens in role. */
  scenarioId?: string;
  /** placement sessions: the learner's own rough level, picked before the chat. */
  levelBand?: LevelBand;
  /** Active (non-idle) milliseconds, text practice only (S1-24). */
  activeMs: number;
  /** Stage 3 (S3-04): speaking and listening milliseconds, counted apart from activeMs. */
  voiceMs?: number;
  /** Set when the learner ends the session (end-of-session feedback). */
  endedAt?: number;
  usage: UsageTotals;
}

export interface UsageTotals {
  input: number;
  output: number;
  /** USD at list price (subscription sign-ins bill differently). */
  cost: number;
}

export interface ToolActivity {
  name: string;
  /** One line, human readable: "Logged 2 observations", "Searched library: 除了". */
  summary: string;
  ok: boolean;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "tutor";
  text: string;
  at: number;
  /** tutor: "provider/model-id". */
  model?: string;
  /** tutor: failure or "Stopped". */
  error?: string;
  /** user: substrings the learner pasted in; excluded from independent-use stats (S1-23). */
  pastedSpans?: string[];
  /** user: spoken, then transcribed by speech to text (Stage 3). Not evidence of pronunciation. */
  spoken?: boolean;
  /** tutor: cached translation (S1-08). */
  translation?: string;
  /** Language the translation is in ("German"); absent = English (written before v0.7). */
  translationLang?: string;
  /** tutor: this reply opened a topic (an opening, "New topic", or record_evidence new_topic). Pacing counts from here. */
  topicStart?: boolean;
  /** tutor: tools called while producing this reply (F-07). */
  toolActivity?: ToolActivity[];
  /** tutor: sources the reply relied on (S1-12). */
  sources?: SourceRef[];
  usage?: UsageTotals;
}

// ---------------------------------------------------------------- corrections (S1-06, S1-21)

/**
 * - `grammar`: the sentence does not make grammatical sense (wrong form, wrong word, wrong order).
 * - `typo`: the sentence makes grammatical sense but looks wrong written down (spelling, capitals, punctuation).
 * - `speaking`: only on spoken messages: something people write but would not say aloud.
 */
export type CorrectionKind = "grammar" | "typo" | "speaking";
/** Kinds stored before v0.21.0. The store maps them on read: vocabulary, phrasing → grammar; style → typo. */
export type LegacyCorrectionKind = "vocabulary" | "phrasing" | "style";
export type CorrectionStatus =
  | "open" // shown, not acted on
  | "retried_ok" // learner fixed it on retry
  | "retried_wrong" // learner retried, still wrong (may retry again)
  | "revealed" // learner asked to see the answer
  | "disputed"; // learner disagrees (S1-20)

export interface Correction {
  id: string;
  language: Language;
  sessionId: string;
  /** The learner message being corrected. */
  messageId: string;
  /** Exact substring of the learner's message that has the problem. */
  original: string;
  /** Suggested replacement for `original`. */
  corrected: string;
  /** One short English sentence. */
  explanation: string;
  kind: CorrectionKind;
  grammarId?: string;
  createdAt: number;
  status: CorrectionStatus;
  /** Learner retries, oldest first. */
  retries: { text: string; ok: boolean; at: number }[];
  disputeNote?: string;
  /** Stage 2 (S2-03): last time it was sent to Anki (added, or found already there). */
  exportedAt?: number;
  /** Stage 2 (S2-03): Anki note ids created from this correction. */
  ankiNoteIds?: number[];
}

// ---------------------------------------------------------------- grammar (S1-15..S1-20)

export type GrammarState = "introduced" | "with_help" | "independent";
export type Verdict = "correct" | "incorrect" | "uncertain" | "unassessed";
export type Assistance = "independent" | "prompted" | "corrected_retry";

export interface GrammarExample {
  text: string;
  translation: string;
}

export interface GrammarPoint {
  /** Stable id: "<lang>:<ascii-slug>", e.g. "zh:chule-hai", "ja:te-iru". */
  id: string;
  language: Language;
  /** Surface pattern: "除了…还…", "〜ている". */
  pattern: string;
  /** Short English name: "besides A, also B". */
  name: string;
  /** Pinyin / kana reading of the pattern. */
  reading?: string;
  /** "HSK 3", "N4" … */
  level?: string;
  /** Plain text, a few sentences. */
  explanation: string;
  examples: GrammarExample[];
  sources: SourceRef[];
  createdAt: number;
  updatedAt: number;
  /** When the tutor first taught it (null if only ever observed). */
  introducedAt?: number;
}

export interface GrammarObservation {
  /** Deterministic: dedupes retried tool calls (S1-27). See observationId() in core. */
  id: string;
  grammarId: string;
  language: Language;
  sessionId: string;
  messageId: string;
  /** The learner's text that attempts the pattern. */
  span: string;
  verdict: Verdict;
  assistance: Assistance;
  note?: string;
  at: number;
  disputed?: { note: string; at: number; originalVerdict: Verdict };
  /**
   * Stage 2 (S2-09): "quiz" = evidence from a quiz answer (sessionId "quiz:<quizId>", messageId = the
   * question id). Quiz evidence is prompted practice: it never makes a point "independent" and is
   * counted apart from conversation (GrammarSummary.quiz). Absent = conversation.
   */
  origin?: "quiz";
  quizId?: string;
}

export interface GrammarCounts {
  correct: number;
  incorrect: number;
  uncertain: number;
  unassessed: number;
}

/** Derived locally, never by a model (S1-25). */
export interface GrammarSummary {
  point: GrammarPoint;
  state: GrammarState;
  counts: GrammarCounts;
  /** correct / (correct + incorrect); null when nothing assessed. */
  rate: number | null;
  lastUsedAt?: number;
  /** Stage 2 (S2-09): quiz answers, kept apart from conversation use. Absent when there are none. */
  quiz?: { counts: GrammarCounts; rate: number | null; lastAt: number };
}

// ---------------------------------------------------------------- vocabulary (S1-09, S1-22, S1-23)

export interface SavedWord {
  id: string;
  language: Language;
  word: string;
  reading?: string;
  definition?: string;
  /** The sentence the word was saved from. */
  sentence: string;
  source: SourceRef;
  createdAt: number;
}

export interface WordUsage {
  word: string;
  language: Language;
  count: number;
  firstUsedAt: number;
  firstSessionId: string;
  firstMessageId: string;
  /** The learner sentence where it first appeared. */
  firstSentence: string;
}

// ---------------------------------------------------------------- level (S1-04)

export type Skill = "reading" | "recognition" | "writing";
export const SKILLS: readonly Skill[] = ["reading", "recognition", "writing"];

export interface LevelEstimate {
  language: Language;
  skill: Skill;
  /** A value from the language's level scale, e.g. "HSK 3" or "N4". */
  level: string;
  confidence: "low" | "medium" | "high";
  /** One sentence of reasoning. */
  evidence: string;
  examples: SourceRef[];
  at: number;
  by: "self" | "placement" | "observed";
}

// ---------------------------------------------------------------- profile (S1-03)

export interface LearnerProfile {
  /** Shared across languages: interests, background, goals, in the learner's words. */
  about: string;
  /** Per-language goals ("pass HSK 4 by June"). */
  goals: Partial<Record<Language, string>>;
  /** Display name used by the tutor. */
  name?: string;
}

// ---------------------------------------------------------------- library (S1-10..S1-12)

export type DocKind = "textbook" | "reader" | "personal" | "other";
export type DocFormat = "txt" | "md" | "pdf" | "epub" | "html";

export interface ReadingCheckpoint {
  paragraph: number;
  /** Character offset inside the paragraph. */
  offset: number;
  at: number;
}

export interface LibraryDoc {
  id: string;
  language: Language;
  title: string;
  kind: DocKind;
  format: DocFormat;
  addedAt: number;
  paragraphCount: number;
  charCount: number;
  checkpoint?: ReadingCheckpoint;
  /** e.g. "No text layer found: scanned PDFs need OCR, which isn't supported yet." */
  warnings: string[];
}

export interface LibraryParagraph {
  docId: string;
  index: number;
  text: string;
  /** Nearest chapter/section heading above this paragraph. */
  heading?: string;
}

export interface LibraryHit {
  docId: string;
  title: string;
  paragraph: number;
  heading?: string;
  text: string;
  score: number;
}

// ---------------------------------------------------------------- anki (S1-13, S1-14)

export interface AnkiDeckMapping {
  language: Language;
  deck: string;
  /** Note field holding the target-language word. */
  wordField: string;
  readingField?: string;
  meaningField?: string;
}

export interface AnkiConfig {
  enabled: boolean;
  /** AnkiConnect endpoint. */
  url: string;
  decks: AnkiDeckMapping[];
  /** Stage 2 (S2-03): last deck correction cards were exported to, per language. */
  exportDecks?: Partial<Record<Language, string>>;
}

export interface AnkiCard {
  cardId: number;
  noteId: number;
  deck: string;
  word: string;
  reading?: string;
  meaning?: string;
  /** Days. */
  interval: number;
  /** Anki ease factor, e.g. 2500 = 250%. */
  ease: number;
  lapses: number;
  reps: number;
  /** ms epoch of the most recent review, if known. */
  lastReviewAt?: number;
  /** Most recent answer button (1 = again). */
  lastEase?: number;

  // Added in 0.2.0. Optional: snapshots cached by 0.1.x lack them (see core/anki/words.ts cardStatus).
  /** Where the card is now. "suspended"/"buried" hide the scheduling stage, which `stage` keeps. */
  status?: AnkiCardStatus;
  /** Scheduling stage regardless of suspension or burying (relearning counts as "learning"). */
  stage?: "new" | "learning" | "review";
  /** In relearning after a lapse (Anki card type 3). */
  relearning?: boolean;
  /** New cards: position in Anki's new queue (lower = introduced sooner). */
  newPosition?: number;
  /** In review with an interval of 21 days or more. */
  mature?: boolean;
  /** Answers in the snapshot's history window (AnkiSnapshot.historyDays), manual reschedules excluded. */
  recentReviews?: number;
  /** "Again" answers (button 1) in the history window. */
  recentFails?: number;
  /** Mean answer time in the history window, ms (each answer capped at 60 s). */
  avgAnswerMs?: number;
  /** The note carries Anki's "leech" tag. */
  leech?: boolean;
}

export type AnkiCardStatus = "new" | "learning" | "review" | "suspended" | "buried";

export interface AnkiSnapshot {
  language: Language;
  syncedAt: number;
  cards: AnkiCard[];
  reviewedToday: number;
  reviewsLast7d: number;
  /** interval >= 21 days. */
  matureCount: number;
  /** Days of review history behind recentReviews/recentFails (absent: no history, e.g. 0.1.x snapshots). */
  historyDays?: number;
}

/** Status of a word across all of its cards (recognition, production, ...). */
export type AnkiWordStatus = "known" | "learning" | "new" | "suspended";

/** One word aggregated over its cards (core/anki/words.ts aggregateWords). */
export interface AnkiWord {
  word: string;
  reading?: string;
  meaning?: string;
  status: AnkiWordStatus;
  mature: boolean;
  /** Number of cards for this word. */
  cards: number;
  cardIds: number[];
  decks: string[];
  lapses: number;
  recentReviews: number;
  recentFails: number;
  /** 0..1, higher = harder right now (words.ts struggleScore). */
  struggle: number;
  /** Short human reasons behind `struggle`, strongest first ("8 lapses", "leech"). */
  reasons: string[];
  lastReviewAt?: number;
  /** New words: lowest new-queue position among the word's cards. */
  newPosition?: number;
}

export interface AnkiWordFilter {
  status?: AnkiWordStatus | "struggling" | "all";
  /** Substring of the word, its reading (tone marks and spaces ignored) or its meaning. */
  search?: string;
  /** Only words with a card in this deck (or a subdeck of it). */
  deck?: string;
  limit?: number;
  offset?: number;
}

export interface AnkiWordPage {
  total: number;
  items: AnkiWord[];
  /** null when the language has never been synced. */
  syncedAt: number | null;
}

export interface AnkiOverview {
  language: Language;
  syncedAt: number;
  /** Words per status. */
  counts: Record<AnkiWordStatus, number>;
  /** Known words with a mature card. */
  mature: number;
  /** Known words without a mature card. */
  young: number;
  /** New words not studied yet. */
  newRemaining: number;
  /** Words above the struggling threshold (suspended words excluded). */
  struggling: number;
  reviewedToday: number;
  /** The next 20 new words, in introduction order. */
  nextNew: AnkiWord[];
  /** The 5 hardest words right now. */
  topStruggling: AnkiWord[];
}

export type TargetStatus = "pending" | "asked" | "used";

export interface PracticeTarget {
  word: string;
  reading?: string;
  meaning?: string;
  reason: "recent" | "difficult";
  cardId?: number;
  status: TargetStatus;
}

// ---------------------------------------------------------------- progress (S1-22..S1-25)

export type ProgressRange = "week" | "month" | "all";

export interface ProgressStats {
  language: Language;
  range: ProgressRange;
  activeMs: number;
  /** Stage 3 (S3-04): speaking and listening time, apart from activeMs. */
  voiceMs: number;
  sessions: number;
  /** Learner-produced words (tutor text and pasted spans excluded). */
  wordsWritten: number;
  distinctWords: number;
  firstUsed: WordUsage[];
  /** One entry per day in range (local dates, YYYY-MM-DD), oldest first. For "all", last 90 days. */
  daily: { date: string; activeMs: number }[];
  grammar: { introduced: number; with_help: number; independent: number };
  corrections: { total: number; byKind: Record<CorrectionKind, number> };
  anki?: { matureCount: number; usedInWriting: number; reviewedToday: number; syncedAt: number };
}
