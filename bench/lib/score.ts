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
