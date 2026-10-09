// Sayfern's stored evidence for one block: the corrections and observations the
// tutor wrote for the benchmark's learner messages, read from the block's data
// dir after the run. Counts only, all computed in code. Seeded history is left
// out: a record counts only if it belongs to a learner message the benchmark sent.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GrammarObservation, Correction } from "../../src/shared/records";
import type { Scenario } from "./scenarios";
import type { StepResult } from "./types";

/** Summable counts, so arms and repetitions aggregate by adding. */
export interface Evidence {
  /** Corrections stored for the benchmark's messages, and those without a grammar id. */
  corrections: number;
  noGrammarId: number;
  /** Turns whose gold names errors, the gold errors on them, and the correction cards stored for those turns. */
  goldTurns: number;
  goldErrors: number;
  goldTurnCards: number;
  /** Turns with gold (errors or clean) and the cards beyond the gold error count on them (every such turn). */
  annotatedTurns: number;
  extraCards: number;
  /** Gold-clean turns and the "incorrect" observations stored on them. */
  cleanTurns: number;
  incorrectOnClean: number;
  /** Gold errors that name a grammar id, and those where a stored correction or "incorrect" observation used it. */
  taggable: number;
  tagged: number;
}

export const emptyEvidence = (): Evidence => ({
  corrections: 0,
  noGrammarId: 0,
  goldTurns: 0,
  goldErrors: 0,
  goldTurnCards: 0,
  annotatedTurns: 0,
  extraCards: 0,
  cleanTurns: 0,
  incorrectOnClean: 0,
  taggable: 0,
  tagged: 0,
});

const readJson = <T>(file: string): T[] => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T[]) : []);

/** Null when the block has no Sayfern records (other arms, skipped blocks). */
export function blockEvidence(blockDir: string, scenario: Scenario, steps: StepResult[]): Evidence | null {
  const records = join(blockDir, "sayfern-data", "records");
  if (!existsSync(join(records, "sessions"))) return null;
  // The benchmark's learner messages, found by their text in the stored sessions.
  const stored = readdirSync(join(records, "sessions"))
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => (JSON.parse(readFileSync(join(records, "sessions", f), "utf8")) as { messages: { id: string; sessionId: string; role: string; text: string }[] }).messages)
    .filter((m) => m.role === "user");
  const claimed = new Set<string>();
  const turns: { messageId: string; sessionId: string; gold: StepResult["gold"] }[] = [];
  for (const s of steps.filter((x) => x.phase.step === "turn" && x.input !== undefined)) {
    const m = stored.find((x) => x.text === s.input && !claimed.has(x.id));
    if (!m) continue;
    claimed.add(m.id);
    turns.push({ messageId: m.id, sessionId: m.sessionId, gold: s.gold ?? scenario.sessions[s.phase.session]?.turns[s.phase.turn]?.gold });
  }
  const sessions = new Set(turns.map((t) => t.sessionId));
  const corrections = readJson<Correction>(join(records, "corrections.json")).filter((c) => sessions.has(c.sessionId));
  const observations = readJson<GrammarObservation>(join(records, "observations.json")).filter((o) => sessions.has(o.sessionId) && !o.origin);

  const e = emptyEvidence();
  e.corrections = corrections.length;
  e.noGrammarId = corrections.filter((c) => !c.grammarId).length;
  for (const t of turns) {
    const cards = corrections.filter((c) => c.messageId === t.messageId);
    const wrong = observations.filter((o) => o.messageId === t.messageId && o.verdict === "incorrect");
    const errors = t.gold?.errors ?? [];
    if (errors.length) {
      e.goldTurns++;
      e.goldErrors += errors.length;
      e.goldTurnCards += cards.length;
    }
    if (errors.length || t.gold?.clean) {
      e.annotatedTurns++;
      e.extraCards += Math.max(0, cards.length - errors.length);
    }
    if (t.gold?.clean) {
      e.cleanTurns++;
      e.incorrectOnClean += wrong.length;
    }
    const used = new Set([...cards.map((c) => c.grammarId), ...wrong.map((o) => o.grammarId)]);
    for (const g of errors) {
      if (!g.grammarId) continue;
      e.taggable++;
      if ([g.grammarId].flat().some((id) => used.has(id))) e.tagged++;
    }
  }
  return e;
}
