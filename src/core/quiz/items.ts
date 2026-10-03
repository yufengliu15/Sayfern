// Quiz items as stored (with keys), and local validation/repair of model-written items (S2-08).
// Every item the model writes passes through validateItem before it is kept: multiple choice has
// exactly one key among distinct options, cloze has one gap and an answer, ordering tiles join to
// the answer sentence (built locally by segmenting the answer when needed), written and scenario
// items have a model answer and a rubric.
import type { Token } from "../../shared/lang";
import type { Language } from "../../shared/records";
import type { QuizAnswer, QuizFormat, QuizQuestion } from "../../shared/stage2";
import { arr, canonicalGrammarId, obj, str } from "../agent/text";

export const QUIZ_FORMATS: readonly QuizFormat[] = ["multiple_choice", "cloze", "ordering", "written", "scenario"];
export const GAP = "___";

/** One question with its key, as stored in records/quizzes/<id>.json. Never sent to the renderer as is. */
export interface QuizItem {
  id: string;
  format: QuizFormat;
  prompt: string;
  text?: string;
  context?: string;
  hint?: string;
  choices?: string[];
  tiles?: string[];
  /** MC: the correct option; cloze: the gap text; ordering: the full sentence; written/scenario: a model answer. */
  answer: string;
  /** Other accepted answers (cloze, ordering). */
  accepted: string[];
  explanation: string;
  /** written / scenario: what a good answer must do (for the grader). */
  rubric?: string;
  grammarId?: string;
  word?: string;
  /** The correction this item practises (source "mistakes"). */
  correctionId?: string;
  answered?: QuizAnswer;
}

export interface ValidateContext {
  language: Language;
  /** Language pack normalize (width-fold, strip punctuation and spaces). */
  normalize(text: string): string;
  /** Language pack segmentation (for ordering tiles). */
  segment(text: string): Token[];
  /** Grammar ids the item may link to. Unknown ids are dropped from the item. */
  grammarIds: ReadonlySet<string>;
  correctionIds: ReadonlySet<string>;
  random(): number;
}

export type Validated = { ok: true; item: Omit<QuizItem, "id">; repairs: string[] } | { ok: false; problem: string };

const DEFAULT_PROMPT: Record<QuizFormat, string> = {
  multiple_choice: "Choose the best answer.",
  cloze: "Fill the gap.",
  ordering: "Put the words in order.",
  written: "Write your answer.",
  scenario: "Reply in role.",
};

const MAX_TEXT = 400;
const MAX_CHOICE = 80;
const MIN_TILES = 3;
const MAX_TILES = 8;

function clip(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join("");
}

/** Comparison key: language normalize + lower case (English options). */
export function keyOf(normalize: (s: string) => string, s: string): string {
  return normalize(s).toLowerCase();
}

/** "A. 还" / "1) 还" / "(B) 还" → "还". */
export function stripOptionLabel(s: string): string {
  return s.replace(/^\s*[(（]?[A-Da-d1-5][)）.．、:：]\s*/, "").trim();
}

/** Small deterministic PRNG (mulberry32) seeded from a string, for reproducible shuffles in tests. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Shuffle tiles so they are not already in answer order (when possible). */
export function shuffleTiles(tiles: readonly string[], random: () => number): string[] {
  const joined = tiles.join("\u0000");
  for (let i = 0; i < 12; i++) {
    const s = shuffle(tiles, random);
    if (s.join("\u0000") !== joined) return s;
  }
  // All permutations look the same (e.g. identical tiles): rotate as a last resort.
  return [...tiles.slice(1), tiles[0]];
}

/** Gap markers models use: ___, ＿＿, （ ）, ( ), 【 】, [ ], ★-less blanks. Normalized to "___". */
const GAP_RE = /_{2,}|＿+|（\s*）|\(\s*\)|【\s*】|\[\s*\]/g;

export function normalizeGaps(text: string): { text: string; gaps: number } {
  let gaps = 0;
  const out = text.replace(GAP_RE, () => {
    gaps++;
    return GAP;
  });
  return { text: out, gaps };
}

/**
 * Tiles for an ordering item, from the answer sentence: word tokens (punctuation dropped), with
 * the shortest neighbours merged until there are at most MAX_TILES. Null when too short.
 */
export function buildTiles(answer: string, segment: (t: string) => Token[]): string[] | null {
  // Spans in the answer, so merged neighbours keep the answer's own spacing ("por favor", "l’homme").
  const spans = segment(answer)
    .filter((t) => t.text.trim() !== "" && !/^[\s\p{P}\p{S}]+$/u.test(t.text))
    .map((t) => ({ start: t.start, end: t.end }));
  if (spans.length < MIN_TILES) return null;
  const text = (s: { start: number; end: number }) => answer.slice(s.start, s.end).trim();
  while (spans.length > MAX_TILES) {
    let best = 0;
    let bestLen = Infinity;
    for (let i = 0; i < spans.length - 1; i++) {
      const len = [...text(spans[i])].length + [...text(spans[i + 1])].length;
      if (len < bestLen) {
        bestLen = len;
        best = i;
      }
    }
    spans.splice(best, 2, { start: spans[best].start, end: spans[best + 1].end });
  }
  return spans.map(text);
}

function sortedChars(s: string): string {
  return [...s].sort().join("");
}

function strings(v: unknown): string[] {
  return arr(v)
    .map((x) => (typeof x === "number" ? String(x) : str(x)))
    .filter((x) => x !== "");
}

function dedupeBy<T>(list: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return list.filter((t) => {
    const k = key(t);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Validates (and where possible repairs) one raw item from the model. */
export function validateItem(raw: unknown, expected: QuizFormat | undefined, ctx: ValidateContext): Validated {
  const o = obj(raw);
  const k = (s: string) => keyOf(ctx.normalize, s);
  const fmtRaw = str(o.format).toLowerCase().replace(/[\s-]+/g, "_");
  const format = ((QUIZ_FORMATS as readonly string[]).includes(fmtRaw) ? fmtRaw : expected) as QuizFormat | undefined;
  if (!format) return { ok: false, problem: "unknown format" };
  const repairs: string[] = [];

  const item: Omit<QuizItem, "id"> = {
    format,
    prompt: clip(str(o.prompt) || str(o.instruction) || DEFAULT_PROMPT[format], 200),
    answer: "",
    accepted: [],
    explanation: clip(str(o.explanation), 500),
  };
  const text = clip(str(o.text) || str(o.question) || str(o.sentence), MAX_TEXT);
  const context = clip(str(o.context) || str(o.setup) || str(o.situation), MAX_TEXT);
  if (context) item.context = context;

  const gid = typeof o.grammar_id === "string" || typeof o.grammarId === "string" ? canonicalGrammarId(o.grammar_id ?? o.grammarId, ctx.language) : null;
  if (gid && ctx.grammarIds.has(gid)) item.grammarId = gid;
  const word = clip(str(o.word), 30);
  if (word) item.word = word;
  const cid = str(o.correction_id) || str(o.correctionId);
  if (cid && ctx.correctionIds.has(cid)) item.correctionId = cid;

  switch (format) {
    case "multiple_choice": {
      if (!text) return { ok: false, problem: "multiple choice without a question" };
      item.text = normalizeGaps(text).text;
      let choices = strings(o.choices ?? o.options).map((c) => clip(stripOptionLabel(c), MAX_CHOICE)).filter(Boolean);
      let answer = str(o.answer);
      // Answer given as a letter or index.
      const letter = answer.match(/^\s*[(（]?([A-Ea-e])[)）.．]?\s*$/);
      const index = typeof o.answer === "number" ? o.answer : null;
      if (letter && choices.length) answer = choices["abcde".indexOf(letter[1].toLowerCase())] ?? "";
      else if (index !== null && Number.isInteger(index)) answer = choices[index] ?? choices[index - 1] ?? "";
      answer = clip(stripOptionLabel(answer), MAX_CHOICE);
      if (!answer) return { ok: false, problem: "multiple choice without an answer" };
      const before = choices.length;
      choices = dedupeBy(choices, k);
      if (choices.length < before) repairs.push("removed duplicate options");
      const keys = choices.filter((c) => k(c) === k(answer));
      if (keys.length === 0) {
        // Overwriting an option could leave the model's own (differently worded) right answer in
        // place, giving two right-looking options. Only add the key when there's room for it.
        if (choices.length >= 4) return { ok: false, problem: "answer was not among the options" };
        choices.push(answer);
        repairs.push("answer was not among the options");
      }
      // More than one option the model says is acceptable: ambiguous.
      const alsoRight = strings(o.accepted).filter((a) => k(a) !== k(answer) && choices.some((c) => k(c) === k(a)));
      if (alsoRight.length) return { ok: false, problem: "more than one correct option" };
      if (choices.length > 5) {
        const distractors = shuffle(
          choices.filter((c) => k(c) !== k(answer)),
          ctx.random,
        ).slice(0, 3);
        choices = [answer, ...distractors];
        repairs.push("trimmed options");
      }
      if (choices.length < 3) return { ok: false, problem: "fewer than three distinct options" };
      if (choices.some((c) => !c.trim())) return { ok: false, problem: "empty option" };
      item.choices = shuffle(choices, ctx.random);
      item.answer = choices.find((c) => k(c) === k(answer)) ?? answer;
      if (!item.explanation) return { ok: false, problem: "no explanation" };
      break;
    }
    case "cloze": {
      const answer = clip(str(o.answer), 40);
      if (!answer || answer.includes(GAP)) return { ok: false, problem: "cloze without an answer" };
      let { text: gapped, gaps } = normalizeGaps(text);
      if (gaps === 0 && gapped && gapped.includes(answer)) {
        gapped = gapped.replace(answer, GAP);
        gaps = 1;
        repairs.push("made the gap from the answer");
      }
      if (gaps !== 1) return { ok: false, problem: gaps === 0 ? "cloze without a gap" : "cloze with more than one gap" };
      if (!k(gapped.replace(GAP, ""))) return { ok: false, problem: "cloze is only a gap" };
      item.text = gapped;
      item.answer = answer;
      item.accepted = dedupeBy(strings(o.accepted), k).filter((a) => k(a) !== k(answer) && !a.includes(GAP)).slice(0, 6);
      const hint = clip(str(o.hint), 80);
      if (hint && k(hint) !== k(answer)) item.hint = hint;
      if (!item.explanation) return { ok: false, problem: "no explanation" };
      break;
    }
    case "ordering": {
      const answer = clip(str(o.answer) || text, MAX_TEXT);
      if (!answer) return { ok: false, problem: "ordering without an answer sentence" };
      const target = k(answer);
      const given = strings(o.tiles).map((t) => t.trim());
      let tiles: string[] | null = null;
      if (given.length >= MIN_TILES && given.length <= MAX_TILES && given.every((t) => k(t)) && k(given.join("")) === target) {
        // Keep the model's tiles only if they are not already in order. Shuffling happens below.
        tiles = given;
      } else {
        tiles = buildTiles(answer, ctx.segment);
        if (given.length) repairs.push("rebuilt the tiles from the answer");
      }
      if (!tiles || tiles.length < MIN_TILES) return { ok: false, problem: "sentence too short to order" };
      if (k(tiles.join("")) !== target) return { ok: false, problem: "tiles don't make the answer" };
      item.tiles = shuffleTiles(tiles, ctx.random);
      item.answer = answer;
      item.accepted = dedupeBy(strings(o.accepted), k).filter((a) => k(a) !== target && sortedChars(k(a)) === sortedChars(target)).slice(0, 4);
      // The meaning (English) helps; the model may put it in text or context.
      if (!item.context && text && k(text) !== target) item.context = text;
      if (!item.explanation) item.explanation = "This is the natural word order.";
      break;
    }
    case "written":
    case "scenario": {
      const answer = clip(str(o.answer) || str(o.model_answer) || str(o.modelAnswer), MAX_TEXT);
      if (!answer) return { ok: false, problem: `${format} without a model answer` };
      if (format === "scenario" && !item.context && !text) return { ok: false, problem: "scenario without a setup" };
      if (text) item.text = text;
      item.answer = answer;
      let rubric = clip(str(o.rubric) || str(o.criteria), 400);
      if (!rubric) {
        rubric = "Does the task in natural, correct sentences.";
        repairs.push("added a default rubric");
      }
      item.rubric = rubric;
      if (!item.explanation) item.explanation = rubric;
      break;
    }
  }
  return { ok: true, item, repairs };
}

/** Identity for de-duplicating items within one quiz. */
export function itemKey(item: Pick<QuizItem, "format" | "text" | "answer">, normalize: (s: string) => string): string {
  return `${item.format}:${keyOf(normalize, item.text ?? "")}:${keyOf(normalize, item.answer)}`;
}

/** The renderer's view of an item: no key, rubric or accepted answers until it is answered. */
export function toQuestion(item: QuizItem, index: number, grammarLabels: Record<string, string>): QuizQuestion {
  const q: QuizQuestion = { id: item.id, index, format: item.format, prompt: item.prompt };
  if (item.text) q.text = item.text;
  if (item.context) q.context = item.context;
  if (item.hint) q.hint = item.hint;
  if (item.choices) q.choices = [...item.choices];
  if (item.tiles) q.tiles = [...item.tiles];
  if (item.grammarId) {
    q.grammarId = item.grammarId;
    const label = grammarLabels[item.grammarId];
    if (label) q.grammarLabel = label;
  }
  if (item.word) q.word = item.word;
  if (item.answered) q.answered = structuredClone(item.answered);
  return q;
}
