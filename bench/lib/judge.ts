// Optional model judge for what string checks cannot decide (false positives,
// correctness of a fix, factual Anki answers, session-level checks). It sees
// only what the learner saw, with arm names removed, and runs outside the
// recording proxy so it never counts toward either harness.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BenchConfig } from "./config";
import type { BlockResult } from "./runner";
import type { Scenario } from "./scenarios";
import { surface } from "./score";

export interface JudgeItem {
  item: string;
  /** errors: per gold error */
  errors?: { id: string; flagged: boolean; correctFix: boolean }[];
  falsePositive?: boolean;
  tutorErrors?: number;
  correct?: boolean;
  pass?: boolean;
  note?: string;
}

export interface JudgeResult {
  block: string;
  items: JudgeItem[];
  error?: string;
}

interface Item {
  item: string;
  kind: "turn" | "open" | "session";
  learner?: string;
  tutor: string;
  goldErrors?: { id: string; original: string; accept: string[]; pattern: string }[];
  clean?: boolean;
  fact?: string;
  checks?: string[];
}

export function judgeItems(block: BlockResult, scenario: Scenario): Item[] {
  const items: Item[] = [];
  for (const [si, session] of scenario.sessions.entries()) {
    const steps = block.steps.filter((s) => s.phase.session === si);
    const open = steps.find((s) => s.phase.step === "open");
    if (open?.output && session.openChecks?.length) items.push({ item: `s${si}-open`, kind: "open", tutor: surface(open.output), checks: session.openChecks });
    for (const [ti, turn] of session.turns.entries()) {
      const step = steps.find((s) => s.phase.step === "turn" && s.phase.turn === ti);
      if (!step?.output) continue;
      const g = turn.gold ?? {};
      items.push({
        item: `s${si}-t${ti}`,
        kind: "turn",
        learner: turn.text,
        tutor: surface(step.output),
        ...(g.errors?.length ? { goldErrors: g.errors.map((e) => ({ id: e.id, original: e.original, accept: e.accept, pattern: e.pattern })) } : {}),
        ...(g.clean ? { clean: true } : {}),
        ...(g.anki?.fact ? { fact: g.anki.fact } : {}),
        ...(g.checks?.length ? { checks: g.checks } : {}),
      });
    }
    if (session.checks?.length) {
      const transcript = steps
        .map((s) => `${s.input ? `LEARNER: ${s.input}\n` : ""}TUTOR: ${surface(s.output)}`)
        .join("\n\n");
      items.push({ item: `s${si}-session`, kind: "session", tutor: transcript, checks: session.checks });
    }
  }
  return items;
}

const RUBRIC = `You grade a Mandarin tutor. For each item below, return one JSON object. Judge only from what is written; do not use tools.

Rules:
- "tutor" is everything the learner saw for that step: the reply and any correction notes.
- errors: for each gold error, flagged = the tutor pointed out this mistake (in any language, any format); correctFix = the correction shown is one of the acceptable forms or equally correct. If not flagged, correctFix = false.
- falsePositive (only when "clean": true): true if the tutor claimed a grammar or vocabulary ERROR in the learner's message. Optional style suggestions clearly framed as optional do not count.
- tutorErrors: number of ungrammatical or clearly unnatural Mandarin sentences written by the tutor in this item (0 if none).
- correct (only when "fact" is given): true if the tutor's answer states the fact correctly and does not contradict it.
- pass (only when "checks" are given): true only if every check is satisfied.
- note: at most one short sentence.

Answer with ONLY a JSON object: {"items":[{"item":"...", "errors":[{"id":"...","flagged":true,"correctFix":true}], "falsePositive":false, "tutorErrors":0, "correct":true, "pass":true, "note":"..."}]}. Omit fields that do not apply.

Items:
`;

export async function judgeBlock(config: BenchConfig, block: BlockResult, scenario: Scenario): Promise<JudgeResult> {
  const key = `${block.arm}__${block.scenario}__rep${block.rep}`;
  const items = judgeItems(block, scenario);
  if (!items.length) return { block: key, items: [] };
  const prompt = RUBRIC + JSON.stringify(items, null, 1);
  try {
    const text = await runClaude(config, prompt);
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`judge returned no JSON: ${text.slice(0, 200)}`);
    const parsed = JSON.parse(m[0]) as { items?: JudgeItem[] };
    return { block: key, items: parsed.items ?? [] };
  } catch (err) {
    return { block: key, items: [], error: String((err as Error)?.message ?? err) };
  }
}

function runClaude(config: BenchConfig, prompt: string): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), "sayfern-judge-"));
  const env = { ...process.env };
  delete env.ANTHROPIC_BASE_URL; // never through the recording proxy
  for (const k of ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"]) {
    env[k] = config.judge.model;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(config.judge.command, ["-p", "--output-format", "json", "--model", config.judge.model, "--max-turns", "1"], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => child.kill(), config.judge.timeoutSec * 1000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(t);
      try {
        const j = JSON.parse(out) as { result?: string; is_error?: boolean };
        if (j.is_error) return reject(new Error(`judge error: ${j.result ?? err}`));
        resolve(j.result ?? "");
      } catch {
        reject(new Error(`judge exited ${code}: ${(err || out).slice(0, 300)}`));
      }
    });
    child.stdin.end(prompt);
  });
}
