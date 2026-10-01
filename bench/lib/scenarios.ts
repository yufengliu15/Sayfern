// Scenario files (bench/scenarios/*.json): scripted learner messages with gold
// annotations. They describe what the learner does, never how a harness works.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BENCH_DIR } from "./config";

export interface GoldError {
  id: string;
  /** The learner's erroneous text (for the judge and the report). */
  original: string;
  /** Acceptable corrected forms. */
  accept: string[];
  /** Short fragments that only appear if the fix is shown (deterministic check). Defaults to `accept`. */
  key?: string[];
  pattern: string;
}

export interface GoldTurn {
  /** Real errors the tutor should catch. */
  errors?: GoldError[];
  /** True when the message has no real error (any grammar correction is a false positive). */
  clean?: boolean;
  /** Anki grounding: words the reply should name, words it must not name. */
  anki?: {
    expect?: string[];
    /** Minimum number of `expect` words for a pass (default: all). */
    min?: number;
    forbid?: string[];
    /** A fact the reply must state correctly (judge only). */
    fact?: string;
  };
  /** Free-form checks for the judge ("The tutor ..."). */
  checks?: string[];
}

export interface ScenarioTurn {
  text: string;
  gold?: GoldTurn;
}

export interface ScenarioSession {
  /** chat = conversation only; reading = graded reader at the checkpoint; practice = open practice. */
  mode: "chat" | "reading" | "practice";
  /** Overrides the arm's opening prompt (Claude Code). */
  prompt?: string;
  /** Judge checks for the tutor's opening. */
  openChecks?: string[];
  turns: ScenarioTurn[];
  end?: boolean;
  /** Judge checks over the whole session. */
  checks?: string[];
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  language: string;
  fixtures?: string;
  sessions: ScenarioSession[];
  file: string;
}

export function loadScenarios(filter?: string[]): Scenario[] {
  const dir = join(BENCH_DIR, "scenarios");
  const all = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ ...(JSON.parse(readFileSync(join(dir, f), "utf8")) as Omit<Scenario, "file">), file: f }));
  for (const s of all) validate(s);
  if (!filter?.length) return all;
  const picked = all.filter((s) => filter.some((f) => s.id === f || s.id.includes(f)));
  if (!picked.length) throw new Error(`No scenario matches ${filter.join(", ")}. Available: ${all.map((s) => s.id).join(", ")}`);
  return picked;
}

function validate(s: Scenario): void {
  const where = `scenario ${s.file}`;
  if (!s.id || !s.language || !Array.isArray(s.sessions) || !s.sessions.length) throw new Error(`${where}: needs id, language, sessions`);
  for (const [i, sess] of s.sessions.entries()) {
    if (!["chat", "reading", "practice"].includes(sess.mode)) throw new Error(`${where}: session ${i} has unknown mode ${sess.mode}`);
    for (const t of sess.turns) {
      if (typeof t.text !== "string" || !t.text) throw new Error(`${where}: empty turn text`);
      for (const e of t.gold?.errors ?? []) if (!e.id || !e.accept?.length) throw new Error(`${where}: gold error needs id and accept`);
    }
  }
}
