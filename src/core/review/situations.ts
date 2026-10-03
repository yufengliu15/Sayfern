// Situation prompts for "Situation → sentence" cards: one batched, strict-JSON model call
// (same one-shot pattern as checkRetry in agent/retry.ts).
import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import { LANGUAGE_META } from "../../shared/languages";
import type { Language } from "../../shared/records";
import type { ReviewItem } from "../../shared/stage2";
import { requestOptions } from "../agent/options";
import { parseSituations, usableSituation } from "./cards";
import { revisedText } from "./list";

const TIMEOUT_MS = 60_000;

/** `explain`: the interface language the situations are written in ("German"). */
export function situationsSystemPrompt(language: Language, explain = "English"): string {
  const target = LANGUAGE_META[language]?.name ?? language;
  return [
    "You write prompts for language-learning flashcards.",
    `For each card you get a correct ${target} sentence. Write ONE short ${explain} sentence describing a real-life situation in which the learner would say that sentence, so recalling the sentence answers the prompt.`,
    `Write it as an instruction to the learner in ${explain}, e.g. "Tell a friend you went hiking yesterday." Keep the meaning that the highlighted part carries (tense, the key word, the nuance), but do not translate word by word.`,
    `Never include ${target} words, readings or romanization. Never mention the grammar rule.`,
    `Reply with strict JSON only: {"cards":[{"id":"<id>","situation":"<one ${explain} sentence>"}]}.`,
  ].join(" ");
}

/** Situation per correction id; missing ids (or an unusable answer) get the local fallback. */
export async function writeSituations(
  models: MutableModels,
  model: Model<Api>,
  language: Language,
  items: ReviewItem[],
  now: () => number,
  explain: { name: string; locale: string } = { name: "English", locale: "en" },
): Promise<Map<string, string>> {
  if (!items.length) return new Map();
  const lines = items.map((it, i) =>
    JSON.stringify({
      id: `c${i + 1}`,
      sentence: revisedText(it.revised),
      highlighted: it.revised.fixed,
      why: it.correction.explanation,
      topic: it.session?.title ?? "",
    }),
  );
  const reply = await models.completeSimple(
    model,
    {
      systemPrompt: situationsSystemPrompt(language, explain.name),
      messages: [{ role: "user", content: [`Language: ${LANGUAGE_META[language]?.name ?? language}`, "Cards:", ...lines].join("\n"), timestamp: now() }],
    },
    { ...requestOptions(model, 120 + 80 * items.length), signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (reply.stopReason === "error" || reply.stopReason === "aborted") throw new Error(reply.errorMessage || "The model request failed.");
  const raw = reply.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const parsed = parseSituations(raw);
  const out = new Map<string, string>();
  items.forEach((it, i) => {
    const s = usableSituation(parsed.get(`c${i + 1}`), it, language, explain.locale);
    if (s) out.set(it.correction.id, s);
  });
  return out;
}
