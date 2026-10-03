// Quiz length and duration, computed locally (S2-07): the format plan for a spec, minutes for a
// question count, and a question count for a target duration.
import type { QuizFocus, QuizFormat, QuizFormatChoice, QuizLength } from "../../shared/stage2";
import { QUIZ_MAX_QUESTIONS, QUIZ_MIN_QUESTIONS } from "../../shared/stage2";

/** Rough seconds a learner spends per question, including reading the feedback. */
export const SECONDS_PER_QUESTION: Record<QuizFormat, number> = {
  multiple_choice: 30,
  cloze: 40,
  ordering: 50,
  written: 120,
  scenario: 150,
};

/** Format rotation for "mixed", per focus. */
const MIXES: Record<QuizFocus, QuizFormat[]> = {
  grammar: ["cloze", "multiple_choice", "ordering", "multiple_choice", "cloze", "ordering", "written"],
  vocabulary: ["multiple_choice", "cloze", "multiple_choice", "cloze", "ordering", "written"],
  scenarios: ["scenario", "multiple_choice", "written", "cloze", "scenario", "multiple_choice"],
  exam: ["multiple_choice", "cloze", "ordering", "multiple_choice", "multiple_choice", "ordering", "cloze", "written"],
  mixed: ["multiple_choice", "cloze", "ordering", "written", "multiple_choice", "scenario", "cloze", "ordering"],
};

export function clampQuestions(n: number): number {
  if (!Number.isFinite(n)) return 10;
  return Math.max(QUIZ_MIN_QUESTIONS, Math.min(QUIZ_MAX_QUESTIONS, Math.round(n)));
}

/** The format of each question, in order. */
export function planFormats(focus: QuizFocus, format: QuizFormatChoice, count: number): QuizFormat[] {
  const n = clampQuestions(count);
  if (format !== "mixed") return Array.from({ length: n }, () => format);
  const mix = MIXES[focus] ?? MIXES.mixed;
  return Array.from({ length: n }, (_, i) => mix[i % mix.length]);
}

export function minutesFor(formats: readonly QuizFormat[]): number {
  const seconds = formats.reduce((s, f) => s + SECONDS_PER_QUESTION[f], 0);
  return Math.max(1, Math.round(seconds / 60));
}

/** Questions that fit in `minutes` for this focus and format (at least the minimum). */
export function questionsForMinutes(focus: QuizFocus, format: QuizFormatChoice, minutes: number): number {
  const budget = Math.max(0, minutes) * 60;
  const full = planFormats(focus, format, QUIZ_MAX_QUESTIONS);
  let used = 0;
  let n = 0;
  for (const f of full) {
    if (used + SECONDS_PER_QUESTION[f] > budget) break;
    used += SECONDS_PER_QUESTION[f];
    n++;
  }
  return clampQuestions(n);
}

export function questionCount(focus: QuizFocus, format: QuizFormatChoice, length: QuizLength): number {
  return "minutes" in length ? questionsForMinutes(focus, format, length.minutes) : clampQuestions(length.questions);
}
