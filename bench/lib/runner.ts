// Runs scenarios against arms. Order: scenario → repetition → arms (arm order
// alternates each repetition), so consecutive blocks always belong to different
// arms and plan-utilization deltas can be attributed to one block.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readCollection, FakeAnkiConnect } from "./anki";
import type { Arm, ArmContext } from "./arms/arm";
import type { BenchConfig } from "./config";
import { materialize } from "./fixtures";
import { learnerLevel } from "./judge";
import { SimulatedLearner } from "./learner";
import type { RecordingProxy } from "./proxy";
import type { Scenario } from "./scenarios";
import { surface } from "./score";
import type { Phase, StepResult, TurnOutput } from "./types";

export interface BlockResult {
  arm: string;
  scenario: string;
  rep: number;
  dir: string;
  steps: StepResult[];
  error?: string;
  skipped?: string;
  startedAt: number;
  endedAt: number;
}

export const blockKey = (arm: string, scenario: string, rep: number) => `${arm}__${scenario}__rep${rep}`;

export async function runAll(opts: {
  config: BenchConfig;
  runId: string;
  runDir: string;
  arms: Arm[];
  scenarios: Scenario[];
  reps: number;
  proxy: RecordingProxy;
  log(msg: string): void;
}): Promise<BlockResult[]> {
  const { config, runId, runDir, proxy, log } = opts;
  const blocks: BlockResult[] = [];
  const badges = new Map(opts.arms.map((a, i) => [a.id, armBadge(a, i)]));
  for (const scenario of opts.scenarios) {
    for (let rep = 1; rep <= opts.reps; rep++) {
      const order = rep % 2 === 1 ? opts.arms : [...opts.arms].reverse();
      for (const arm of order) {
        const dir = join(runDir, "blocks", blockKey(arm.id, scenario.id, rep));
        mkdirSync(dir, { recursive: true });
        const block: BlockResult = { arm: arm.id, scenario: scenario.id, rep, dir, steps: [], startedAt: Date.now(), endedAt: 0 };
        blocks.push(block);
        const why = arm.supports(scenario);
        if (why) {
          block.skipped = why;
          block.endedAt = Date.now();
          log(`- ${badges.get(arm.id)} ${scenario.id} #${rep}: skipped (${why})`);
          writeFileSync(join(dir, "block.json"), JSON.stringify(block, null, 2));
          continue;
        }
        log("");
        log(`▶ ${badges.get(arm.id)} ${scenario.id} #${rep}`);
        const badge = badges.get(arm.id)!;
        await runBlock({ ...opts, arm, scenario, rep, dir, block, runId, config, proxy, log: (m) => log(m.replace(/^(\s*)/, `$1${badge} `)) });
        block.endedAt = Date.now();
        writeFileSync(join(dir, "block.json"), JSON.stringify(block, null, 2));
      }
    }
  }
  return blocks;
}

async function runBlock(o: {
  config: BenchConfig;
  runId: string;
  runDir: string;
  arm: Arm;
  scenario: Scenario;
  rep: number;
  dir: string;
  block: BlockResult;
  proxy: RecordingProxy;
  log(msg: string): void;
}): Promise<void> {
  const { arm, scenario, rep, dir, block, proxy, log } = o;
  const sandbox = await materialize(scenario.fixtures ?? o.config.fixtures, join(dir, "sandbox"));
  const anki = new FakeAnkiConnect(await readCollection(sandbox.collection), join(o.runDir, "anki.jsonl"));
  await anki.start();
  const phase = (session: number, turn: number, step: Phase["step"]): Phase => ({ runId: o.runId, arm: arm.id, scenario: scenario.id, rep, session, turn, step });
  const setPhase = (p: Phase | null) => {
    proxy.setPhase(p);
    anki.setPhase(p);
  };
  const ctx: ArmContext = {
    config: o.config,
    scenario,
    sandbox,
    runDir: dir,
    proxyUrl: proxy.url,
    ankiUrl: anki.url,
    model: o.config.model,
    log: (m) => log(`  ${m}`),
  };
  const record = async (p: Phase, input: string | undefined, fn: () => Promise<TurnOutput | null>, extra: Partial<StepResult> = {}) => {
    setPhase(p);
    let output: TurnOutput | null;
    const t0 = Date.now();
    try {
      output = await fn();
    } catch (err) {
      output = { reply: "", feedback: [], error: String((err as Error)?.message ?? err), wallMs: Date.now() - t0 };
    }
    await proxy.drain();
    setPhase(null);
    block.steps.push({ phase: p, ...(input !== undefined ? { input } : {}), output, ...extra });
    const tag = `session ${p.session + 1} · ${p.step === "turn" ? `turn ${p.turn + 1}` : p.step}`;
    if (output?.error) log(`  ✗ ${tag}: ${output.error.slice(0, 200)}`);
    else if (output) log(`  ✓ ${tag} (${(output.wallMs / 1000).toFixed(1)} s): ${output.reply.replace(/\s+/g, " ").slice(0, 70)}`);
    return output;
  };
  try {
    setPhase(phase(-1, -2, "setup"));
    await arm.setup(ctx);
    await proxy.drain();
    setPhase(null);
    for (const [si, session] of scenario.sessions.entries()) {
      await record(phase(si, -1, "open"), session.prompt, () => arm.open(session, si));
      if (session.learner) {
        // Simulated learner: each message answers what the tutor just showed. Its call is outside the proxy.
        const learner = new SimulatedLearner(o.config, session.learner, learnerLevel(o.config, scenario));
        for (let ti = 0; ti < session.learner.turns; ti++) {
          const msg = await learner.next(conversationSoFar(block.steps, si), ti);
          if (msg.dropped.length) log(`  ! learner turn ${ti + 1}: dropped reported mistakes not in its message: ${msg.dropped.join(" | ")}`);
          const out = await record(phase(si, ti, "turn"), msg.text, () => arm.send(msg.text), {
            gold: msg.gold,
            ...(msg.dropped.length ? { droppedErrors: msg.dropped } : {}),
          });
          if (out?.error) break; // the tutor failed: the learner has nothing to answer
        }
      } else {
        for (const [ti, turn] of session.turns.entries()) {
          await record(phase(si, ti, "turn"), turn.text, () => arm.send(turn.text));
        }
      }
      if (session.end !== false) await record(phase(si, 1000, "end"), undefined, () => arm.end());
    }
  } catch (err) {
    block.error = String((err as Error)?.stack ?? err);
    log(`  ✗ block failed: ${String((err as Error)?.message ?? err)}`);
  } finally {
    setPhase(null);
    await arm.teardown().catch(() => undefined);
    await anki.stop();
  }
}

/** What the learner has seen in session `si` so far: the tutor's opening and every exchange. */
function conversationSoFar(steps: StepResult[], si: number): string {
  return steps
    .filter((s) => s.phase.session === si && (s.phase.step === "open" || s.phase.step === "turn"))
    .map((s) => `${s.phase.step === "turn" && s.input ? `LEARNER: ${s.input}\n` : ""}TUTOR: ${surface(s.output)}`)
    .join("\n\n");
}

/** "[Sayfern]" / "[Claude Code + skill]", coloured on a terminal (green for the first arm, magenta for the second) so blocks are easy to tell apart. */
function armBadge(arm: Arm, i: number): string {
  const text = `[${arm.label}]`;
  if (!process.stdout.isTTY) return text;
  const colors = ["1;32", "1;35", "1;36", "1;33"];
  return `\x1b[${colors[i % colors.length]}m${text}\x1b[0m`;
}
