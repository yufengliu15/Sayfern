// Deterministic scoring: string checks against gold annotations. No model is
// involved, so these numbers are exactly reproducible from saved transcripts.
import type { GoldTurn } from "./scenarios";
import type { TurnOutput } from "./types";

// Punctuation, spaces and the markdown markers a tutor wraps a fix in (**bold**, _italic_, `code`, tables, quotes, headings).
const PUNCT = /[\s，。！？、,.!?：:；;“”"'‘’（）()[\]【】《》「」『』…—\-~～·*_`#>|]/g;
export const norm = (s: string): string => s.normalize("NFKC").replace(PUNCT, "");

/** The shortest stretch of `fix` that shows the change from `original`, plus two characters after it. Null for a pure deletion. */
export function fixKey(original: string, fix: string): string | null {
  const a = norm(original);
  const b = norm(fix);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  if (p + s >= b.length) return null;
  return b.slice(p, b.length - s + 2);
}

/** Words that give the same fix: a tutor may show either. */
const SAME_FIX = [["因为", "由于"]];

const variants = (k: string) => [k, ...SAME_FIX.flatMap(([x, y]) => [k.replaceAll(x, y), k.replaceAll(y, x)])];

const BOUND = /[\s、，,；;：:|()（）"“”'‘’「」『』《》/。！？!?.\-]/;

/** True when `word` stands on its own in `text`: between list or sentence punctuation, not inside a longer phrase (喜欢 in 你喜欢机器人 does not). */
function listed(text: string, word: string): boolean {
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
    const before = text[i - 1];
    const after = text[i + word.length];
    if ((!before || BOUND.test(before)) && (!after || BOUND.test(after))) return true;
  }
  return false;
}

/**
 * Forbidden words the reply names as hard words: listed words in a sentence that also names an expected
 * word (known words mixed into the list), or listed words in a table row. A known word mentioned elsewhere
 * ("all six words you reviewed today were right") is fine.
 */
function forbiddenHits(reply: string, forbid: string[], expect: string[]): string[] {
  const sentences = reply.normalize("NFKC").replace(/[*_`]/g, "").split(/[。！？!?\n]/);
  return forbid.filter((w) =>
    sentences.some((t) => listed(t, w) && (t.trimStart().startsWith("|") || expect.some((e) => t.includes(e)))),
  );
}

export interface TurnScore {
  errors: { id: string; flagged: boolean }[];
  anki?: { expected: number; hit: number; pass: boolean; forbiddenHits: string[] };
}

/** What the learner saw: reply plus any structured feedback cards. */
export const surface = (o: TurnOutput | null): string => (o ? [o.reply, ...o.feedback].join("\n") : "");

export function scoreTurn(gold: GoldTurn | undefined, out: TurnOutput | null): TurnScore {
  const s: TurnScore = { errors: [] };
  if (!gold) return s;
  const text = norm(surface(out));
  for (const e of gold.errors ?? []) {
    // Fragments of the learner's own text prove nothing, so they never count.
    const own = norm(e.original);
    const keys = [...(e.key ?? []), ...e.accept, ...e.accept.map((f) => fixKey(e.original, f) ?? "")].flatMap((k) => variants(norm(k))).filter((k) => k && !own.includes(k));
    s.errors.push({ id: e.id, flagged: keys.some((k) => text.includes(k)) });
  }
  if (gold.anki) {
    const reply = norm(out?.reply ?? "");
    const expect = gold.anki.expect ?? [];
    const hit = expect.filter((w) => reply.includes(norm(w))).length;
    const forbidden = forbiddenHits(out?.reply ?? "", gold.anki.forbid ?? [], expect);
    s.anki = { expected: expect.length, hit, pass: hit >= (gold.anki.min ?? expect.length) && forbidden.length === 0, forbiddenHits: forbidden };
  }
  return s;
}

/** Counts behind the reply-style numbers. Summable, so arms and blocks aggregate by adding. */
export interface ReplyStyle {
  replies: number;
  /** Han characters only. */
  hanChars: number;
  /** All characters. */
  chars: number;
  /** ？ and ? */
  questions: number;
  /** Replies with exactly one question mark. */
  singleQuestion: number;
}

export const emptyStyle = (): ReplyStyle => ({ replies: 0, hanChars: 0, chars: 0, questions: 0, singleQuestion: 0 });

/** Adds one tutor reply (the text only, not feedback cards) to `acc`. */
export function addReply(acc: ReplyStyle, reply: string): void {
  const q = (reply.match(/[？?]/g) ?? []).length;
  acc.replies++;
  acc.hanChars += (reply.match(/\p{Script=Han}/gu) ?? []).length;
  acc.chars += Array.from(reply).length;
  acc.questions += q;
  if (q === 1) acc.singleQuestion++;
}
