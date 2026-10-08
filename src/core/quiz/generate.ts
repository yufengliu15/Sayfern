// Quiz generation (S2-08): plan slots locally (format + what each item practises), ask the model
// for the items as strict JSON in batches, and keep only items that pass local validation.
import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import type { Language } from "../../shared/records";
import type { QuizFocus, QuizFormat } from "../../shared/stage2";
import { requestOptions } from "../agent/options";
import { arr, obj } from "../agent/text";
import { itemKey, validateItem, type QuizItem, type ValidateContext } from "./items";
import { extractJson } from "./json";
import type { ResolvedLevel } from "./levels";
import type { Material, MaterialGrammar, MaterialMistake, MaterialWord } from "./material";

export const BATCH_SIZE = 10;
/** Output tokens per requested item, plus a fixed allowance. */
const TOKENS_PER_ITEM = 260;
const TOKENS_BASE = 400;

export type SlotTarget =
  | { kind: "grammar"; g: MaterialGrammar }
  | { kind: "word"; w: MaterialWord }
  | { kind: "mistake"; m: MaterialMistake }
  | { kind: "passage" }
  | { kind: "free" };

export interface Slot {
  /** 1-based, stable across batches. */
  n: number;
  format: QuizFormat;
  target: SlotTarget;
}

/** Targets in the order the focus wants them, cycled over the slots. */
export function planSlots(focus: QuizFocus, formats: QuizFormat[], m: Material): Slot[] {
  const grammar: SlotTarget[] = m.grammar.map((g) => ({ kind: "grammar", g }));
  const words: SlotTarget[] = m.words.map((w) => ({ kind: "word", w }));
  const mistakes: SlotTarget[] = m.mistakes.map((mm) => ({ kind: "mistake", m: mm }));
  const passage: SlotTarget[] = m.passage ? [{ kind: "passage" }] : [];
  const interleave = (...lists: SlotTarget[][]): SlotTarget[] => {
    const out: SlotTarget[] = [];
    const max = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
    return out;
  };
  let pool: SlotTarget[];
  switch (focus) {
    case "grammar":
      pool = interleave(mistakes.filter((t) => t.kind === "mistake" && t.m.grammarId), grammar, mistakes.filter((t) => t.kind === "mistake" && !t.m.grammarId), passage);
      break;
    case "vocabulary":
      pool = interleave(words, mistakes, passage);
      break;
    default:
      pool = interleave(mistakes, grammar, words, passage);
  }
  // A passage alone still yields many items (each about a different part of it).
  if (pool.length === 0) pool = [{ kind: "free" }];
  return formats.map((format, i) => ({ n: i + 1, format, target: pool[i % pool.length] }));
}

function describeTarget(t: SlotTarget): string {
  switch (t.kind) {
    case "grammar":
      return `grammar ${t.g.id} (${t.g.pattern}, ${t.g.name})`;
    case "word":
      return `word ${t.w.word}${t.w.reading ? ` [${t.w.reading}]` : ""}${t.w.meaning ? ` "${t.w.meaning}"` : ""}`;
    case "mistake":
      return t.m.correctionId
        ? `correction ${t.m.correctionId}: test the same point in a new sentence`
        : `an earlier quiz mistake (${t.m.corrected}): test the same point in a new sentence`;
    case "passage":
      return "the passage (a different part of it each time)";
    case "free":
      return "anything useful at this level";
  }
}

function formatRules(explain: string): string[] {
  return [
    "multiple_choice: text = the question, or a sentence with one ___ gap. choices = exactly 4 options: one correct, three plausible but clearly wrong. answer = the correct option, copied exactly.",
    `cloze: text = a sentence with exactly one ___ gap. answer = the exact text for the gap (a word or short phrase). accepted = other fully correct fillers. hint = optional ${explain} meaning of the missing part, never the answer itself.`,
    `ordering: answer = one natural sentence of 4 to 8 words. text = its ${explain} meaning. accepted = other correct orders of the same words, if any. Do not write tiles; the app cuts the sentence itself.`,
    `written: context = what to write about in ${explain} (one or two sentences, e.g. use a given pattern or word). text = optional target-language prompt. answer = one good model answer. rubric = what a good answer must contain.`,
    `scenario: context = the situation and the learner's role, in ${explain}. text = the other person's opening line in the target language. answer = one good reply. rubric = what a good reply must do.`,
  ];
}

const LANGUAGE_RULES: Record<Language, string> = {
  zh: "Chinese: simplified characters, full-width Chinese punctuation, no pinyin in the items.",
  ja: "Japanese: natural Japanese with kanji appropriate to the level, no furigana or romaji in the items.",
  ko: "Korean: natural Hangul, polite 해요체 unless the item needs another style, correct spacing (띄어쓰기), no romanization.",
  en: "English: natural modern English, North American spelling unless the learner prefers British.",
  es: "Spanish: natural modern Spanish with all accents and ¿ ¡ marks, Latin American usage (ustedes) unless the learner asks for Spain.",
  fr: "French: natural modern French with all accents, correct elision and agreement, French spacing before ? ! : ; is optional.",
  de: "German: natural modern German, correct capitalization of nouns and case endings, ß where standard.",
  it: "Italian: natural modern Italian with all accents and correct apostrophes.",
  pt: "Portuguese: natural European Portuguese (Portugal) with all accents, tu for informal you, estar a + infinitive, pronouns placed as in Portugal.",
  ru: "Russian: natural modern Russian in Cyrillic, no stress marks unless the item is about stress, ё where it helps.",
  vi: "Vietnamese: natural Vietnamese with every tone mark, Northern usage unless the learner asks for Southern.",
};

/** `explain`: the learner's interface language, which instructions and explanations are written in. */
export function systemPrompt(languageName: string, language: Language, explain = "English"): string {
  return [
    `You write quiz items for a learner of ${languageName} in the app Sayfern. The app grades fixed-answer items itself, so keys must be exact.`,
    'Reply with strict JSON only: {"items": [ ... ]}, one item per slot, in slot order.',
    `Item fields: slot (number), format, prompt (short ${explain} instruction), text, context, choices, answer, accepted (array), hint, explanation (one or two short ${explain} sentences on why), rubric, grammar_id, word, correction_id.`,
    ...formatRules(explain),
    "Link items: grammar_id = an id from the grammar list when the item practises that point; word = the target word for a word slot; correction_id = the id when the slot names a correction.",
    `Write original, natural sentences. Exactly one correct answer for multiple choice and cloze. Keep the explanation in ${explain}. Never copy official exam questions.`,
    LANGUAGE_RULES[language],
    `Plain punctuation in ${explain} text: no em dashes.`,
  ].join("\n");
}

function grammarLine(g: MaterialGrammar): string {
  return `- ${g.id}: ${g.pattern} (${g.name}${g.level ? `, ${g.level}` : ""})${g.explanation ? `. ${g.explanation.slice(0, 160)}` : ""}`;
}

export function userPrompt(input: {
  languageName: string;
  level: ResolvedLevel;
  focus: QuizFocus;
  material: Material;
  catalogue: MaterialGrammar[];
  slots: Slot[];
}): string {
  const { material: m } = input;
  const lines: string[] = [`Language: ${input.languageName}`, `Focus: ${input.focus}`, "", "Level:", input.level.guidance, ""];
  const grammar = [...m.grammar, ...input.catalogue.filter((c) => !m.grammar.some((g) => g.id === c.id))];
  if (grammar.length) lines.push("Grammar the learner has met (ids for grammar_id):", ...grammar.map(grammarLine), "");
  if (m.words.length)
    lines.push(
      "Words:",
      ...m.words.map((w) => `- ${w.word}${w.reading ? ` [${w.reading}]` : ""}${w.meaning ? ` "${w.meaning}"` : ""} (${w.why})${w.sentence ? ` e.g. ${w.sentence}` : ""}`),
      "",
    );
  if (m.mistakes.length)
    lines.push(
      "Mistakes to practise again:",
      ...m.mistakes.map(
        (x) => `- ${x.correctionId ? `correction ${x.correctionId}` : "earlier quiz"}: "${x.original}" → "${x.corrected}". ${x.explanation}${x.grammarId ? ` (grammar ${x.grammarId})` : ""}`,
      ),
      "",
    );
  if (m.passage) lines.push(`Passage from "${m.passage.title}"${m.passage.chapter ? `, ${m.passage.chapter}` : ""}:`, m.passage.text, "");
  if (m.goal) lines.push(`The learner's goal: ${m.goal}`, "");
  lines.push("Slots:", ...input.slots.map((s) => `${s.n}. ${s.format} · ${describeTarget(s.target)}`));
  return lines.join("\n");
}

export interface GenerateInput {
  models: MutableModels;
  model: Model<Api>;
  language: Language;
  languageName: string;
  /** Interface language for instructions and explanations ("German"). Default English. */
  explain?: string;
  level: ResolvedLevel;
  focus: QuizFocus;
  material: Material;
  catalogue: MaterialGrammar[];
  slots: Slot[];
  ctx: ValidateContext;
  now: () => number;
  signal: AbortSignal;
}

export interface GenerateResult {
  /** Valid items in slot order (ids not assigned yet). */
  items: Omit<QuizItem, "id">[];
  dropped: { slot?: number; problem: string }[];
  requests: number;
}

export class GenerationError extends Error {}

async function requestBatch(input: GenerateInput, slots: Slot[]): Promise<unknown[]> {
  const reply = await input.models.completeSimple(
    input.model,
    {
      systemPrompt: systemPrompt(input.languageName, input.language, input.explain),
      messages: [
        {
          role: "user",
          content: userPrompt({ ...input, slots }),
          timestamp: input.now(),
        },
      ],
    },
    { ...requestOptions(input.model, TOKENS_BASE + TOKENS_PER_ITEM * slots.length), signal: input.signal },
  );
  if (reply.stopReason === "aborted" || input.signal.aborted) throw new GenerationError("Stopped.");
  if (reply.stopReason === "error") throw new GenerationError(reply.errorMessage || "The model request failed.");
  const raw = reply.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const parsed = extractJson(raw);
  const items = Array.isArray(parsed) ? parsed : arr(obj(parsed).items ?? obj(parsed).questions);
  return items;
}

function batches<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Asks for every slot (batches of BATCH_SIZE, in parallel), validates, then asks once more for
 * slots that came back unusable. Throws GenerationError when the model fails outright.
 */
export async function generateItems(input: GenerateInput): Promise<GenerateResult> {
  const kept = new Map<number, Omit<QuizItem, "id">>();
  const seen = new Set<string>();
  const dropped: GenerateResult["dropped"] = [];
  let requests = 0;
  let lastError: unknown = null;

  const run = async (slots: Slot[]) => {
    const results = await Promise.allSettled(
      batches(slots, BATCH_SIZE).map((b) => {
        requests++;
        return requestBatch(input, b).then((items) => ({ b, items }));
      }),
    );
    for (const r of results) {
      if (r.status === "rejected") {
        lastError = r.reason;
        continue;
      }
      const { b, items } = r.value;
      items.forEach((raw, i) => {
        const slotNo = Number(obj(raw).slot);
        const slot = b.find((s) => s.n === slotNo) ?? b[i];
        if (!slot || kept.has(slot.n)) {
          dropped.push({ problem: "extra item" });
          return;
        }
        const v = validateItem(raw, slot.format, input.ctx);
        if (!v.ok) {
          dropped.push({ slot: slot.n, problem: v.problem });
          return;
        }
        const key = itemKey(v.item, input.ctx.normalize);
        if (seen.has(key)) {
          dropped.push({ slot: slot.n, problem: "duplicate" });
          return;
        }
        seen.add(key);
        kept.set(slot.n, v.item);
      });
    }
  };

  await run(input.slots);
  if (input.signal.aborted) throw new GenerationError("Stopped.");
  const missing = input.slots.filter((s) => !kept.has(s.n));
  // One top-up request when a fair share is missing (and the model answered at all).
  if (missing.length > 0 && kept.size > 0 && missing.length >= Math.max(2, Math.ceil(input.slots.length * 0.2))) {
    await run(missing);
    if (input.signal.aborted) throw new GenerationError("Stopped.");
  }
  if (kept.size === 0 && lastError) throw lastError instanceof Error ? lastError : new GenerationError(String(lastError));
  const items = [...kept.entries()].sort((a, b) => a[0] - b[0]).map(([, it]) => it);
  return { items, dropped, requests };
}
