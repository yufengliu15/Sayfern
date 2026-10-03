// Stage 2 · Configurable quizzes (S2-04..S2-09).
// Owned by the quiz feature. Types only (compiled by both node and web TS projects).
// Every invokable method added to QuizApi must also be listed in QUIZ_METHODS (compile-time check).
//
// Answer keys never reach the renderer before a question is answered: QuizQuestion is the
// renderer's view; the full items (keys, rubrics) stay in core storage (records/quizzes/).
import type { GrammarState, Language } from "../records";
import type { ModelRef } from "../types";

// ---------------------------------------------------------------- spec (what the learner asks for)

/** S2-04 */
export type QuizFocus = "grammar" | "vocabulary" | "scenarios" | "exam" | "mixed";

/** S2-07. Listening and speaking arrive with voice (Stage 3). */
export type QuizFormat = "multiple_choice" | "cloze" | "ordering" | "written" | "scenario";
export type QuizFormatChoice = QuizFormat | "mixed";

/**
 * S2-05. "mistakes" = corrections from chats + earlier wrong quiz answers; "targets" = profile goal,
 * grammar to follow up and Anki practice targets.
 */
export type QuizSourceKind = "mistakes" | "anki" | "grammar" | "document" | "targets" | "saved_words";

export interface QuizSource {
  kind: QuizSourceKind;
  /** anki: which words. Default "recent" (reviewed this week, plus struggling). */
  anki?: "recent" | "struggling" | "all";
  /** grammar: the chosen points. Empty or absent = the points that need work. */
  grammarIds?: string[];
  /** document: the library document, optionally one chapter (heading). */
  docId?: string;
  chapter?: string;
}

/**
 * S2-06. "hsk2" = HSK 2.0 (levels 1-6), "hsk3" = HSK 3.0 (levels 1-6 and 7-9), "jlpt" = N5..N1,
 * "topik" = TOPIK 1..6, and CEFR-aligned exams A1..C2: "cambridge" (en), "dele" (es), "delf" (fr),
 * "goethe" (de), "cils" (it), "torfl" (ru), "cefr-pt", "cefr-vi" (CEFR descriptors, no single exam).
 */
export type ExamSystem = "hsk2" | "hsk3" | "jlpt" | "topik" | "cambridge" | "dele" | "delf" | "goethe" | "cils" | "torfl" | "cefr-pt" | "cefr-vi";

export type QuizLevel =
  /** The learner's current estimate (getLevels), resolved when the quiz is made. */
  | { kind: "current" }
  /** `level` is one of QuizExamInfo.levels, e.g. "HSK 3", "HSK 7-9", "N4". */
  | { kind: "exam"; exam: ExamSystem; level: string };

export type QuizLength = { questions: number } | { minutes: number };

export interface QuizSpec {
  language: Language;
  focus: QuizFocus;
  sources: QuizSource[];
  level: QuizLevel;
  format: QuizFormatChoice;
  length: QuizLength;
}

// ---------------------------------------------------------------- options (what the builder can offer now)

export interface QuizExamInfo {
  exam: ExamSystem;
  /** "HSK 2.0", "HSK 3.0", "JLPT" */
  name: string;
  levels: string[];
}

export interface QuizDocOption {
  docId: string;
  title: string;
  kind: string;
  paragraphs: number;
}

export interface QuizGrammarOption {
  id: string;
  pattern: string;
  name: string;
  level?: string;
  state: GrammarState;
}

/** Local counts so the builder can disable empty sources. */
export interface QuizOptions {
  language: Language;
  counts: {
    /** Corrections (style suggestions excluded) + wrong answers in earlier quizzes. */
    mistakes: number;
    ankiRecent: number;
    ankiStruggling: number;
    ankiAll: number;
    savedWords: number;
    grammar: number;
    /** Grammar points that are introduced or used with help. */
    grammarToWork: number;
    targets: number;
  };
  /** null: Anki never synced for this language (or turned off). */
  ankiSyncedAt: number | null;
  ankiEnabled: boolean;
  grammar: QuizGrammarOption[];
  docs: QuizDocOption[];
  /** The learner's current level ("HSK 3"), or null before placement. */
  currentLevel: string | null;
  goal?: string;
  exams: QuizExamInfo[];
}

export interface QuizChapter {
  heading: string;
  /** First paragraph index. */
  from: number;
  paragraphs: number;
}

/** Computed locally (no model): length, duration and provenance for a spec. */
export interface QuizEstimate {
  questions: number;
  minutes: number;
  /** "HSK 3 (HSK 2.0 levels)", "JLPT N4", "Your level (HSK 3)". */
  alignment: string;
  /** "Generated in HSK 3 style (HSK 2.0 levels). Not official exam material." or, at the learner's level, "Generated practice at your level (HSK 3). Not official exam material." */
  provenance: string;
  /** Set for exam-aligned specs. */
  exam?: ExamSystem;
}

// ---------------------------------------------------------------- quiz (what the renderer sees)

export type QuizStatus = "generating" | "ready" | "finished" | "failed";
export type QuizVerdict = "correct" | "incorrect" | "uncertain";

export interface QuizAnswer {
  /** What the learner gave: the chosen option, the typed gap, the tiles joined, or the written text. */
  response: string;
  /** true when the learner asked to see the answer without trying. */
  revealed?: boolean;
  verdict: QuizVerdict;
  /** One short sentence. */
  feedback: string;
  /** The key: correct option, gap text, ordered sentence, or model answer. */
  answer: string;
  /** Other accepted answers (cloze, ordering). */
  accepted?: string[];
  explanation: string;
  /** written / scenario: a better version of the learner's answer. */
  better?: string;
  gradedBy: "local" | "model" | "fallback";
  at: number;
}

export interface QuizQuestion {
  id: string;
  /** 0-based. */
  index: number;
  format: QuizFormat;
  /** Short English instruction: "Choose the word that fits." */
  prompt: string;
  /**
   * Target-language text. multiple_choice: the question or sentence (may contain "___");
   * cloze: the sentence with exactly one "___"; scenario: the other speaker's opening line.
   */
  text?: string;
  /** English context: the scenario setup, or what to write about. */
  context?: string;
  /** cloze: a hint such as the meaning or base form. */
  hint?: string;
  /** multiple_choice: options in display order. */
  choices?: string[];
  /** ordering: tiles in shuffled order. */
  tiles?: string[];
  grammarId?: string;
  /** "除了…还…" for display. */
  grammarLabel?: string;
  word?: string;
  /** Present once answered. */
  answered?: QuizAnswer;
}

export interface QuizSummary {
  total: number;
  answered: number;
  correct: number;
  incorrect: number;
  uncertain: number;
  /** Per grammar point, quiz evidence only. */
  grammar: { grammarId: string; label: string; correct: number; incorrect: number; uncertain: number }[];
  /** Questions answered wrong or uncertain, in quiz order. */
  review: string[];
}

export interface QuizView {
  id: string;
  language: Language;
  title: string;
  spec: QuizSpec;
  status: QuizStatus;
  createdAt: number;
  finishedAt?: number;
  /** status "failed": a readable reason. */
  error?: string;
  /** "provider/model-id" that generated it. */
  model?: string;
  /** Resolved level, e.g. "HSK 3 (HSK 2.0 levels)" or "Your level (HSK 3)". */
  alignment: string;
  /** Always present (S2-09): what it is aligned to and that it is generated practice. */
  provenance: string;
  /** Set for exam-aligned quizzes. */
  exam?: ExamSystem;
  /** Always true: Sayfern never ships official exam items. */
  generated: true;
  minutes: number;
  questions: QuizQuestion[];
  /** Locally computed, always present (live while in progress). */
  summary: QuizSummary;
  /** Set when this quiz retries another quiz's mistakes. */
  retryOf?: string;
}

export interface QuizListItem {
  id: string;
  language: Language;
  title: string;
  status: QuizStatus;
  createdAt: number;
  finishedAt?: number;
  alignment: string;
  total: number;
  answered: number;
  correct: number;
}

// ---------------------------------------------------------------- API

export interface QuizApi {
  /** What the quiz builder can offer right now, with local counts. */
  quizOptions(language: Language): Promise<QuizOptions>;
  /** Chapters (headings) of a library document, for "from a textbook chapter". */
  quizChapters(docId: string): Promise<QuizChapter[]>;
  /** Question count, minutes and exam provenance for a spec. Local, instant. */
  estimateQuiz(spec: QuizSpec): Promise<QuizEstimate>;
  /**
   * Gathers material locally and starts generation in the background. Returns at once with
   * status "generating"; poll getQuiz until "ready" or "failed".
   */
  startQuiz(spec: QuizSpec, model: ModelRef): Promise<QuizView>;
  /** Stops a running generation and deletes the unfinished quiz. */
  cancelQuizGeneration(quizId: string): Promise<void>;
  getQuiz(quizId: string): Promise<QuizView | null>;
  /** Newest first. */
  listQuizzes(language: Language): Promise<QuizListItem[]>;
  /**
   * Grades one answer: fixed formats on this Mac, written and scenario answers by the model
   * (with an "uncertain" fallback). `response` is the option text, the gap text, the tiles in
   * order joined with "", or the written text. Empty + reveal = show the answer.
   */
  answerQuestion(quizId: string, questionId: string, response: string, model: ModelRef | null, opts?: { reveal?: boolean }): Promise<QuizView>;
  /** Scores locally and records grammar evidence as quiz practice. Idempotent. */
  finishQuiz(quizId: string): Promise<QuizView>;
  /** A new quiz from this quiz's wrong and uncertain answers (no model call). */
  retryMistakes(quizId: string): Promise<QuizView>;
  /** Deletes the quiz and the grammar evidence it recorded. */
  deleteQuiz(quizId: string): Promise<void>;
}

export const QUIZ_METHODS: Record<Exclude<keyof QuizApi, `on${string}`>, true> = {
  quizOptions: true,
  quizChapters: true,
  estimateQuiz: true,
  startQuiz: true,
  cancelQuizGeneration: true,
  getQuiz: true,
  listQuizzes: true,
  answerQuestion: true,
  finishQuiz: true,
  retryMistakes: true,
  deleteQuiz: true,
};

/** Bounds for QuizLength. */
export const QUIZ_MIN_QUESTIONS = 3;
export const QUIZ_MAX_QUESTIONS = 30;
