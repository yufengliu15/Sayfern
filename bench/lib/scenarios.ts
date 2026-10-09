// Scenario files (bench/scenarios/*.json): scripted learner messages with gold
// annotations. They describe what the learner does, never how a harness works.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findUnit, type CourseUnit } from "../../src/shared/course";
import { BENCH_DIR } from "./config";
import type { StepResult } from "./types";

export const RATINGS = ["engagement", "pacing", "level", "teaching"] as const;
export type Rating = (typeof RATINGS)[number];

export interface GoldError {
  id: string;
  /** The learner's erroneous text (for the judge and the report). */
  original: string;
  /** Acceptable corrected forms. */
  accept: string[];
  /** Short fragments that only appear if the fix is shown (deterministic check). Defaults to `accept`. */
  key?: string[];
  /** Grammar id(s) the tutor should store for this error (src/shared/course), checked against its records (Sayfern only). */
  grammarId?: string | string[];
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
  /** The topic is exhausted: by the tutor's reply to this turn, it should have changed topic or raised the challenge. */
  moveOn?: boolean;
  /** The learner is invested or asked something: the tutor's reply should engage with it, not change the subject. */
  stay?: boolean;
}

export interface ScenarioTurn {
  text: string;
  gold?: GoldTurn;
}

export interface ScenarioSession {
  /** chat = conversation only; reading = graded reader at the checkpoint; practice = open practice; unit = one course unit. */
  mode: "chat" | "reading" | "practice" | "unit";
  /** unit mode: the course unit id (src/shared/course). The judge checks each of its grammar points. */
  unit?: string;
  /** unit mode: the learner asks for a quick overview of the unit's grammar first. */
  explain?: boolean;
  /** A simulated learner writes the turns instead of a fixed script (then `turns` stays empty). */
  learner?: SimulatedLearnerSpec;
  /** Overrides the arm's opening prompt (Claude Code). */
  prompt?: string;
  /** Judge checks for the tutor's opening. */
  openChecks?: string[];
  turns: ScenarioTurn[];
  end?: boolean;
  /** Judge checks over the whole session. */
  checks?: string[];
  /** Ask the judge for 1-5 ratings of these qualities over the whole session transcript. */
  rate?: Rating[];
}

export interface SimulatedLearnerSpec {
  /** Number of learner messages. */
  turns: number;
  /** Who the learner is (background, interests, level). */
  persona: string;
  /** Rules the learner follows, including the mistakes it makes on purpose. */
  plan: string[];
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  language: string;
  fixtures?: string;
  /** Learner level told to the judge. Defaults to `selfLevel` in the fixture manifest. */
  learnerLevel?: string;
  /** Repetitions for this scenario when `--reps` is not given (default: `reps` in the config). Noisy scenarios need more. */
  reps?: number;
  sessions: ScenarioSession[];
  file: string;
}

export function loadScenarios(filter?: string[]): Scenario[] {
  const dir = join(BENCH_DIR, "scenarios");
  const all = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ ...(JSON.parse(readFileSync(join(dir, f), "utf8")) as Omit<Scenario, "file">), file: f }));
  for (const s of all) for (const sess of s.sessions ?? []) sess.turns ??= [];
  for (const s of all) validate(s);
  if (!filter?.length) return all;
  const picked = all.filter((s) => filter.some((f) => s.id === f || s.id.includes(f)));
  if (!picked.length) throw new Error(`No scenario matches ${filter.join(", ")}. Available: ${all.map((s) => s.id).join(", ")}`);
  return picked;
}

/**
 * The learner turns of a session as they ran: scripted turns come from the scenario, simulated
 * ones from the block's steps (text and the gold the learner reported).
 */
export function sessionTurns(session: ScenarioSession, steps: StepResult[]) {
  const turnSteps = steps.filter((s) => s.phase.step === "turn");
  if (session.learner) return turnSteps.map((step) => ({ turn: step.phase.turn, text: step.input ?? "", gold: step.gold, step }));
  return session.turns.map((t, turn) => ({ turn, text: t.text, gold: t.gold, step: turnSteps.find((s) => s.phase.turn === turn) }));
}

/** The course unit a unit-mode session works through. */
export function sessionUnit(session: ScenarioSession): CourseUnit | undefined {
  return session.mode === "unit" && session.unit ? findUnit(session.unit)?.unit : undefined;
}

function validate(s: Scenario): void {
  const where = `scenario ${s.file}`;
  if (!s.id || !s.language || !Array.isArray(s.sessions) || !s.sessions.length) throw new Error(`${where}: needs id, language, sessions`);
  for (const [i, sess] of s.sessions.entries()) {
    if (!["chat", "reading", "practice", "unit"].includes(sess.mode)) throw new Error(`${where}: session ${i} has unknown mode ${sess.mode}`);
    if (sess.mode === "unit") {
      const found = sess.unit ? findUnit(sess.unit) : undefined;
      if (!found) throw new Error(`${where}: session ${i} needs a course unit that exists (got ${sess.unit})`);
      if (found.course.language !== s.language) throw new Error(`${where}: unit ${sess.unit} is not in the ${s.language} course`);
    }
    for (const r of sess.rate ?? []) if (!RATINGS.includes(r)) throw new Error(`${where}: session ${i} rates unknown quality ${r}`);
    if (sess.learner) {
      if (sess.turns.length) throw new Error(`${where}: session ${i} has both a simulated learner and scripted turns`);
      if (!(sess.learner.turns > 0) || !sess.learner.persona || !sess.learner.plan?.length) throw new Error(`${where}: session ${i} learner needs turns, persona and plan`);
    } else if (!sess.turns.length) throw new Error(`${where}: session ${i} needs turns or a simulated learner`);
    for (const t of sess.turns) {
      if (typeof t.text !== "string" || !t.text) throw new Error(`${where}: empty turn text`);
      if (t.gold?.moveOn && t.gold.stay) throw new Error(`${where}: a turn cannot have both moveOn and stay`);
      for (const e of t.gold?.errors ?? []) if (!e.id || !e.accept?.length) throw new Error(`${where}: gold error needs id and accept`);
    }
  }
}
