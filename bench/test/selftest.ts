// Offline end-to-end check of the benchmark itself: mock model API, fake
// Claude Code CLI, the real Sayfern core, the real proxy, fake AnkiConnect,
// scoring and report. No network, no subscription, no tokens spent.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeArm } from "../lib/arms/claude-code";
import { SayfernArm } from "../lib/arms/sayfern";
import { BENCH_DIR, type BenchConfig, type ClaudeCodeArmConfig, type SayfernArmConfig } from "../lib/config";
import { RecordingProxy } from "../lib/proxy";
import { computeMetrics, renderReport } from "../lib/report";
import { runAll } from "../lib/runner";
import { loadScenarios } from "../lib/scenarios";
import { startMockUpstream } from "./mock-upstream";

export async function selftest(base: BenchConfig): Promise<void> {
  const mock = await startMockUpstream();
  const runDir = mkdtempSync(join(tmpdir(), "sayfern-bench-selftest-"));
  process.env.ANTHROPIC_API_KEY = "sk-ant-selftest-SECRET-42";
  const sayfern = { ...(base.arms.find((a) => a.kind === "sayfern") as SayfernArmConfig), credentials: join(runDir, "no-credentials.json") };
  const cc: ClaudeCodeArmConfig = {
    ...(base.arms.find((a) => a.kind === "claude-code") as ClaudeCodeArmConfig),
    command: join(BENCH_DIR, "test", "fake-claude.mjs"),
    skill: join(BENCH_DIR, "test", "skill"),
    isolation: "clean",
  };
  const cfg: BenchConfig = { ...base, upstream: mock.url, model: "claude-sonnet-5-5", reps: 1, judge: { ...base.judge, enabled: false }, arms: [sayfern, cc] };
  const proxy = new RecordingProxy({ upstream: mock.url, logFile: join(runDir, "wire.jsonl"), bodiesDir: join(runDir, "bodies"), probe: true });
  await proxy.start();
  const scenarios = loadScenarios();
  const lines: string[] = [];
  try {
    await runAll({ config: cfg, runId: "selftest", runDir, arms: [new SayfernArm(sayfern), new ClaudeCodeArm(cc)], scenarios, reps: 1, proxy, log: (m) => lines.push(m) });
  } finally {
    await proxy.stop();
    await mock.stop();
  }
  const { blocks, utilKeys } = computeMetrics(cfg, runDir, scenarios);
  const failed = blocks.filter((b) => !b.ok);
  assert.equal(failed.length, 0, `blocks failed:\n${lines.join("\n")}`);
  const step = (m: string) => console.log(`✓ ${m}`);
  step(`${blocks.length} blocks ran (${scenarios.length} scenarios × 2 arms)`);

  for (const b of blocks) {
    assert.ok(b.requests > 0, `${b.arm}/${b.scenario}: requests reached the proxy`);
    assert.ok(b.promptTokens > 0 && b.outputTokens > 0, `${b.arm}/${b.scenario}: usage parsed`);
    assert.ok(b.overhead?.systemAndTools !== undefined, `${b.arm}/${b.scenario}: count_tokens probe ran`);
  }
  step("every block's model traffic went through the recording proxy, with usage and overhead probes");

  const models = [...new Set(blocks.flatMap((b) => Object.keys(b.models)))];
  assert.deepEqual(models, ["claude-sonnet-5-5"], `only the benchmark model on the wire (saw ${models.join(", ")})`);
  step("every request used claude-sonnet-5-5 (Claude Code's side-request model pinned via env)");

  const sf = blocks.find((b) => b.arm === "sayfern" && b.scenario === "zh-chat-corrections")!;
  const ccb = blocks.find((b) => b.arm === "claude-code" && b.scenario === "zh-chat-corrections")!;
  assert.ok(sf.grammar.flagged >= 1, "Sayfern correction card scored as flagged");
  assert.ok(sf.toolNames.record_evidence >= 1 && sf.toolErrors === 0, "record_evidence seen on the wire");
  assert.equal(sf.requests, 6, "one request per learner turn (recording-only tool, no follow-up)");
  assert.ok(ccb.toolErrors >= 1 && ccb.toolNames.Skill >= 1 && ccb.roundTrips >= 1, "Claude Code tool loop and tool errors seen on the wire");
  assert.equal(ccb.skillUsed, true, "skill invocation detected");
  assert.ok(ccb.cacheRead > 0, "cache reads parsed");
  step(`scoring: Sayfern ${sf.grammar.flagged}/${sf.grammar.gold} errors flagged; tool calls and errors attributed per arm`);

  assert.ok(blocks.some((b) => b.arm === "sayfern" && b.ankiCalls > 0), "Sayfern synced Anki from the fake AnkiConnect");
  step("fake AnkiConnect served Sayfern's sync");

  assert.ok(utilKeys.length > 0 && blocks.some((b) => Object.values(b.utilDelta).some((d) => typeof d === "number")), "utilization deltas");
  step(`rate-limit headers captured (${utilKeys.join(", ")})`);

  assert.ok(blocks.every((b) => !b.reportedVsWire || b.reportedVsWire.wire >= b.reportedVsWire.reported * 0.99), "wire ≥ reported");
  step("capture check: wire tokens ≥ harness-reported tokens");

  const md = renderReport(cfg, runDir, scenarios, { runId: "selftest", startedAt: new Date().toISOString(), fixtures: "synthetic", reps: 1, arms: [{ id: "sayfern", label: "Sayfern", version: "selftest" }, { id: "claude-code", label: "Claude Code + skill", version: "fake" }] });
  assert.ok(md.includes("## Headline") && md.includes("Estimated plan-limit usage"));
  assert.ok(!readFileSync(join(runDir, "wire.jsonl"), "utf8").includes("SECRET-42"), "API keys never written to disk");
  step(`report rendered (${md.split("\n").length} lines); no credentials in captures`);
  console.log(`✓ bench selftest passed (${runDir})`);
}
