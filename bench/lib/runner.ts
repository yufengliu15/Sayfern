// Runs scenarios against arms. Order: scenario → repetition → arms (arm order
// alternates each repetition), so consecutive blocks always belong to different
// arms and plan-utilization deltas can be attributed to one block.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readCollection, FakeAnkiConnect } from "./anki";
import type { Arm, ArmContext } from "./arms/arm";
import type { BenchConfig } from "./config";
import { materialize } from "./fixtures";
import type { RecordingProxy } from "./proxy";
import type { Scenario } from "./scenarios";
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
          log(`- ${arm.id} × ${scenario.id} #${rep}: skipped (${why})`);
          writeFileSync(join(dir, "block.json"), JSON.stringify(block, null, 2));
          continue;
        }
        log(`▶ ${arm.id} × ${scenario.id} #${rep}`);
        await runBlock({ ...opts, arm, scenario, rep, dir, block, runId, config, proxy });
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
  const record = async (p: Phase, input: string | undefined, fn: () => Promise<TurnOutput | null>) => {
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
    block.steps.push({ phase: p, ...(input !== undefined ? { input } : {}), output });
    const tag = p.step === "turn" ? `turn ${p.turn + 1}` : p.step;
    if (output?.error) log(`  ✗ s${p.session + 1} ${tag}: ${output.error.slice(0, 200)}`);
    else if (output) log(`  ✓ s${p.session + 1} ${tag} (${(output.wallMs / 1000).toFixed(1)} s): ${output.reply.replace(/\s+/g, " ").slice(0, 70)}`);
    return output;
  };
  try {
    setPhase(phase(-1, -2, "setup"));
    await arm.setup(ctx);
    await proxy.drain();
    setPhase(null);
    for (const [si, session] of scenario.sessions.entries()) {
      await record(phase(si, -1, "open"), session.prompt, () => arm.open(session, si));
      for (const [ti, turn] of session.turns.entries()) {
        await record(phase(si, ti, "turn"), turn.text, () => arm.send(turn.text));
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
