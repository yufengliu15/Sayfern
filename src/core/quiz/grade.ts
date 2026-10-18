// Grading (S2-08): fixed-answer formats on this computer, open answers by the model with a readable
// "uncertain" fallback when the model can't be reached or replies with something unusable.
import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import { msg } from "../../shared/i18n";
import type { QuizAnswer, QuizVerdict } from "../../shared/stage2";
import { requestOptions } from "../agent/options";
import { obj, oneOf, str } from "../agent/text";
import { GAP, keyOf, type QuizItem } from "./items";
import { extractJson } from "./json";

// Stored in English; the renderer translates these exact strings for display (msg marks them for the catalogs).
export const FEEDBACK = {
  correct: msg("Right."),
  incorrect: msg("Not quite."),
  revealed: msg("Here's the answer."),
  empty: msg("No answer given."),
  fallback: msg("Couldn't check this one right now. Compare with the model answer."),
} as const;

/** Local verdict for multiple choice, cloze and ordering. */
export function gradeLocal(item: QuizItem, response: string, normalize: (s: string) => string): QuizVerdict {
  const k = (s: string) => keyOf(normalize, s);
  const r = k(response);
  if (!r) return "incorrect";
  const keys = [item.answer, ...item.accepted].map(k);
  if (keys.includes(r)) return "correct";
  // Cloze: the learner typed the whole sentence with the gap filled in.
  if (item.format === "cloze" && item.text) {
    for (const a of [item.answer, ...item.accepted]) if (k(item.text.replace(GAP, a)) === r) return "correct";
  }
  return "incorrect";
}

export function isLocallyGraded(item: Pick<QuizItem, "format">): boolean {
  return item.format === "multiple_choice" || item.format === "cloze" || item.format === "ordering";
}

export interface ModelGrade {
  verdict: QuizVerdict;
  feedback: string;
  better?: string;
}

/** {"verdict", "feedback", "better"} from a model reply, defensively. Null when unusable. */
export function parseGradeJson(raw: string): ModelGrade | null {
  const v = obj(extractJson(raw));
  const verdictRaw = str(v.verdict).toLowerCase();
  if (!verdictRaw) return null;
  const verdict = oneOf<QuizVerdict>(verdictRaw === "partly_correct" || verdictRaw === "partial" ? "uncertain" : verdictRaw, ["correct", "incorrect", "uncertain"], "uncertain");
  const out: ModelGrade = { verdict, feedback: str(v.feedback) };
  const better = str(v.better) || str(v.better_version) || str(v.corrected);
  if (better) out.better = better;
  return out;
}

export interface GradeOpenInput {
  models: MutableModels;
  model: Model<Api> | null;
  languageName: string;
  /** Interface language for the feedback ("German"). Default English. */
  explain?: string;
  item: QuizItem;
  response: string;
  now: number;
  signal?: AbortSignal;
}

function graderPrompt(explain: string): string {
  return [
    "You grade one open answer in a language quiz for a learner.",
    "Judge whether the answer does the task with correct, natural language for the learner's level. Small typos in an otherwise right answer are fine.",
    'verdict: "correct" (does the task, no real errors), "incorrect" (misses the task or has a real error), or "uncertain" (you can\'t tell, or it is borderline).',
    `feedback: one short ${explain} sentence naming the main thing that is right or wrong.`,
    "better: a corrected, natural version of the learner's own answer in the target language (keep their idea; if it is already good, polish lightly).",
    'Reply with strict JSON only: {"verdict": "...", "feedback": "...", "better": "..."}',
  ].join("\n");
}

/** Model grading for written and scenario items. Never throws: failures become "uncertain". */
export async function gradeOpen(input: GradeOpenInput): Promise<Pick<QuizAnswer, "verdict" | "feedback" | "better" | "gradedBy">> {
  const { item, response } = input;
  const fallback = { verdict: "uncertain" as const, feedback: FEEDBACK.fallback, better: item.answer, gradedBy: "fallback" as const };
  if (!input.model) return fallback;
  try {
    const reply = await input.models.completeSimple(
      input.model,
      {
        systemPrompt: graderPrompt(input.explain || "English"),
        messages: [
          {
            role: "user",
            content: [
              `Language: ${input.languageName}`,
              `Task: ${item.prompt}`,
              item.context ? `Situation: ${item.context}` : "",
              item.text ? `Prompt text: ${item.text}` : "",
              `What a good answer does: ${item.rubric ?? "Does the task in natural, correct sentences."}`,
              `One model answer (others can be right too): ${item.answer}`,
              `Learner's answer: ${response}`,
            ]
              .filter(Boolean)
              .join("\n"),
            timestamp: input.now,
          },
        ],
      },
      { ...requestOptions(input.model, 400), ...(input.signal ? { signal: input.signal } : {}) },
    );
    if (reply.stopReason === "error" || reply.stopReason === "aborted") return fallback;
    const raw = reply.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const parsed = parseGradeJson(raw);
    if (!parsed) return fallback;
    return {
      verdict: parsed.verdict,
      feedback: parsed.feedback || (parsed.verdict === "correct" ? FEEDBACK.correct : parsed.verdict === "incorrect" ? FEEDBACK.incorrect : FEEDBACK.fallback),
      better: parsed.better || item.answer,
      gradedBy: "model",
    };
  } catch {
    return fallback;
  }
}
