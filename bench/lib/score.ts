// Deterministic scoring: string checks against gold annotations. No model is
// involved, so these numbers are exactly reproducible from saved transcripts.
import type { GoldTurn } from "./scenarios";
import type { TurnOutput } from "./types";

const PUNCT = /[\s，。！？、,.!?：:；;“”"'‘’（）()[\]【】《》…—\-~～·]/g;
export const norm = (s: string): string => s.normalize("NFKC").replace(PUNCT, "");

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
    const keys = [...(e.key ?? []), ...e.accept].map(norm).filter(Boolean);
    s.errors.push({ id: e.id, flagged: keys.some((k) => text.includes(k)) });
  }
  if (gold.anki) {
    const reply = norm(out?.reply ?? "");
    const expect = gold.anki.expect ?? [];
    const hit = expect.filter((w) => reply.includes(norm(w))).length;
    const forbiddenHits = (gold.anki.forbid ?? []).filter((w) => reply.includes(norm(w)));
    s.anki = { expected: expect.length, hit, pass: hit >= (gold.anki.min ?? expect.length) && forbiddenHits.length === 0, forbiddenHits };
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
