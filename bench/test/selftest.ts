// Offline end-to-end check of the benchmark itself: mock model API, fake
// Claude Code CLI, the real Sayfern core, the real proxy, fake AnkiConnect,
// scoring and report. No network, no subscription, no tokens spent.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeArm } from "../lib/arms/claude-code";
import { SayfernArm } from "../lib/arms/sayfern";
import { BENCH_DIR, type BenchConfig, type ClaudeCodeArmConfig, type SayfernArmConfig } from "../lib/config";
import { learnerPrompt, parseLearner } from "../lib/learner";
import { extractJudgeItems, judgeItems, learnerLevel, missingVerdicts, needs, type Item, type JudgeItem } from "../lib/judge";
import { RecordingProxy } from "../lib/proxy";
import { blockEvidence } from "../lib/evidence";
import { computeMetrics, renderReport, spread, type BlockMetrics } from "../lib/report";
import { blockOk, runAll, type BlockResult } from "../lib/runner";
import { loadScenarios, type GoldTurn, type Scenario } from "../lib/scenarios";
import { fixKey, norm, scoreTurn } from "../lib/score";
import type { StepResult, TurnOutput } from "../lib/types";
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
  const cfg: BenchConfig = {
    ...base,
    upstream: mock.url,
    model: "claude-sonnet-5-5",
    reps: 1,
    judge: { ...base.judge, enabled: false },
    learner: { command: join(BENCH_DIR, "test", "fake-learner.mjs"), model: "claude-haiku-5-5", timeoutSec: 30 },
    arms: [sayfern, cc],
  };
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
  const strip = (l: string) => l.replace(/\x1b\[[0-9;]*m/g, "");
  const stepLines = lines.map(strip).filter((l) => /[✓✗] session \d+ · /.test(l));
  assert.ok(stepLines.length > 0 && stepLines.every((l) => /^\s*\[(Sayfern|Claude Code \+ skill)\] [✓✗] session/.test(l)), "every step line names its arm");
  assert.ok(lines.map(strip).some((l) => l.startsWith("▶ [Claude Code + skill] zh-long-chat #1")), "block headers name the arm");
  step("run log: every block header and step line names its arm");
  console.log(lines.map(strip).filter((l) => l.includes("zh-level-fit")  || /\] [✓✗] session 1 · (open|turn 1) /.test(l)).slice(0, 8).join("\n"));

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
  // Judge replies: prose, code fences, a second object, and braces inside strings (the parse
  // failure seen in run 2026-10-01T17-47-57).
  assert.deepEqual(extractJudgeItems('Here:\n```json\n{"items":[{"item":"s0-t0","note":"uses {braces}"}]}\n```'), [{ item: "s0-t0", note: "uses {braces}" }]);
  assert.deepEqual(
    (extractJudgeItems('{"items":[{"item":"a"}]}\n{"items":[{"item":"b"}]}') ?? []).map((i) => i.item),
    ["a", "b"],
  );
  assert.equal(extractJudgeItems("no json here"), null);
  assert.equal(extractJudgeItems('{"other":1}'), null);
  step("judge reply parsing: fenced, split and brace-in-string replies");
  // Missing verdicts are detected per item and field.
  const jItems: Item[] = [
    { item: "f", kind: "turn", tutor: "", fact: "x" },
    { item: "c", kind: "turn", tutor: "", clean: true },
    { item: "e", kind: "turn", tutor: "", goldErrors: [{ id: "g1", original: "", accept: [], pattern: "" }] },
    { item: "n", kind: "turn", tutor: "" },
  ];
  assert.deepEqual(missingVerdicts(jItems, []), ["f", "c", "e"]);
  assert.deepEqual(missingVerdicts(jItems, [{ item: "f", correct: false }, { item: "c", falsePositive: false }, { item: "e", errors: [{ id: "g1", flagged: true, correctFix: true }] }]), []);
  // A block whose judge call failed keeps its denominators: both arms are scored out of the same totals.
  const blockKeys = readdirSync(join(runDir, "blocks")).sort();
  const failedKey = blockKeys.find((k) => k.startsWith("sayfern__zh-anki-grounding"));
  writeFileSync(join(runDir, "judge.json"), JSON.stringify(blockKeys.map((k) => (k === failedKey ? { block: k, items: [], error: "simulated parse failure" } : { block: k, items: [] }))));
  const md2 = renderReport(cfg, runDir, scenarios, { runId: "selftest", startedAt: new Date().toISOString(), fixtures: "synthetic", reps: 1, arms: [{ id: "sayfern", label: "Sayfern", version: "selftest" }, { id: "claude-code", label: "Claude Code + skill", version: "fake" }] });
  const factsRow = md2.split("\n").find((l) => l.startsWith("| Judge: Anki facts stated correctly"));
  assert.ok(factsRow, "facts row present");
  const dens = [...factsRow!.matchAll(/\(\d+\/(\d+)/g)].map((m) => m[1]);
  assert.equal(dens.length, 2);
  assert.equal(dens[0], dens[1], `same Anki fact totals for both arms: ${factsRow}`);
  assert.ok(md2.includes("ungraded"), "missing verdicts are flagged");
  step(`judge denominators come from gold items (${factsRow!.trim()})`);

  // Conversation quality: reply-style counts come from code, ratings and move-on verdicts from the judge.
  assert.equal(sf.style.replies, 6, "style counted over the six chat replies");
  assert.equal(sf.style.questions, 6);
  assert.equal(sf.style.singleQuestion, 6);
  assert.ok(sf.style.hanChars > 0 && sf.style.chars - sf.style.hanChars === 2 * sf.style.replies, "Han characters counted apart from punctuation");
  const pacing = scenarios.find((x) => x.id === "zh-pacing")!;
  assert.equal(learnerLevel(cfg, pacing), "HSK 3", "learner level comes from the fixture manifest");
  const load = (k: string) => JSON.parse(readFileSync(join(runDir, "blocks", k, "block.json"), "utf8")) as BlockResult;
  const sfKey = blockKeys.find((k) => k.startsWith("sayfern__zh-pacing"))!;
  const ccKey = blockKeys.find((k) => k.startsWith("claude-code__zh-pacing"))!;
  const pItems = judgeItems(load(sfKey), pacing, "HSK 3");
  const sess = pItems.find((i) => i.item === "s0-session")!;
  assert.deepEqual(sess.rate, ["engagement", "pacing", "level"]);
  assert.equal(sess.learnerLevel, "HSK 3");
  assert.ok(sess.tutor.startsWith("TUTOR (opening):") && sess.tutor.split("LEARNER:").length - 1 === 10, "rated session shows the opening and all ten turns");
  const moveOn = pItems.filter((i) => i.moveOn);
  const stay = pItems.filter((i) => i.stay);
  assert.equal(moveOn.length, 3);
  assert.equal(stay.length, 3);
  assert.ok(moveOn.every((i) => i.before?.startsWith("TUTOR (opening):") && i.before.includes("LEARNER: 我也喜欢。")), "moveOn turns carry the conversation so far");
  const verdicts = (items: Item[], v: { movedOn: boolean; stayed: boolean; ratings: JudgeItem["ratings"] }): JudgeItem[] =>
    items.map((it) => {
      const n = needs(it);
      return {
        item: it.item,
        ...(n.errors.length ? { errors: n.errors.map((id) => ({ id, flagged: true, correctFix: true })) } : {}),
        ...(n.clean ? { falsePositive: false } : {}),
        ...(n.checks ? { pass: true } : {}),
        ...(n.rate.length ? { ratings: v.ratings } : {}),
        ...(n.movedOn ? { movedOn: v.movedOn } : {}),
        ...(n.stayed ? { stayed: v.stayed } : {}),
      };
    });
  const sfVerdicts = verdicts(pItems, { movedOn: false, stayed: true, ratings: { engagement: 4, pacing: 2, level: 5 } });
  assert.deepEqual(missingVerdicts(pItems, sfVerdicts), []);
  // A rating that is out of range, fractional or missing is no verdict.
  const ccVerdicts = verdicts(pItems, { movedOn: true, stayed: false, ratings: { engagement: 3, pacing: 9 } });
  assert.deepEqual(missingVerdicts(pItems, ccVerdicts), ["s0-session"]);
  assert.deepEqual(missingVerdicts(pItems, verdicts(pItems, { movedOn: true, stayed: true, ratings: { engagement: 3.5, pacing: 3, level: 3 } })), ["s0-session"]);
  const parsed = extractJudgeItems('{"items":[{"item":"s0-session","ratings":{"engagement":4,"pacing":3,"level":5},"movedOn":true,"stayed":false}]}');
  assert.deepEqual(parsed, [{ item: "s0-session", ratings: { engagement: 4, pacing: 3, level: 5 }, movedOn: true, stayed: false }]);
  step("judge items: ratings see the full transcript; moveOn/stay verdicts and rating validity decide what is missing");
  writeFileSync(
    join(runDir, "judge.json"),
    JSON.stringify(blockKeys.map((k) => ({ block: k, items: k === sfKey ? sfVerdicts : k === ccKey ? ccVerdicts : [] }))),
  );
  const md3 = renderReport(cfg, runDir, scenarios, { runId: "selftest", startedAt: new Date().toISOString(), fixtures: "synthetic", reps: 1, arms: [{ id: "sayfern", label: "Sayfern", version: "selftest" }, { id: "claude-code", label: "Claude Code + skill", version: "fake" }] });
  const row = (name: string) => md3.split("\n").find((l) => l.startsWith(`| ${name}`)) ?? "";
  assert.ok(md3.includes("## Conversation quality") && md3.indexOf("## Accuracy") < md3.indexOf("## Conversation quality"), "section follows Accuracy");
  assert.match(row("Judge: engagement"), /4\.00 \(n=1\) \| 3\.00 \(n=1\)/);
  assert.match(row("Judge: level"), /5\.00 \(n=1\) \| –/, "an invalid or missing rating is not averaged");
  assert.match(row("Judge: ratings missing"), /⚠ \d+ ungraded/);
  assert.match(row("Judge: moved on when it should"), /0% \(0\/3.*\| 100% \(3\/3/, "denominators from the scenario");
  assert.match(row("Judge: stayed when it should"), /100% \(3\/3.*\| 0% \(0\/3/);
  assert.match(row("Replies with exactly one question"), /100% \(\d+\/\d+\) \| 100%/);
  assert.match(row("Mean reply length, Han characters"), /\d+\.\d \| \d+\.\d/);
  step("report: Conversation quality section with ratings, move-on and stay rates, reply-style numbers");
  assert.ok(!row("Judge: teaching"), "no teaching row when no unit session was rated");

  // Course unit: Sayfern opens the unit from its course, Claude Code gets the patterns in the first message.
  const unitSc = scenarios.find((x) => x.id === "zh-course-unit")!;
  const sfUnitKey = blockKeys.find((k) => k.startsWith("sayfern__zh-course-unit"))!;
  const ccUnitKey = blockKeys.find((k) => k.startsWith("claude-code__zh-course-unit"))!;
  const sfUnit = load(sfUnitKey);
  assert.ok(sfUnit.steps.find((s) => s.phase.step === "open")?.output?.reply, "Sayfern opened the unit with a tutor turn");
  const bodies = readdirSync(join(runDir, "bodies")).map((f) => readFileSync(join(runDir, "bodies", f), "utf8"));
  assert.ok(bodies.some((b) => b.includes("Unit zh-hsk30-3-12 (HSK 3)") && b.includes("Session: course unit")), "Sayfern's prompt carries the unit block");
  assert.ok(bodies.some((b) => b.includes("HSK 3, \\\"Complex sentences\\\"") && b.includes("- 只有…才… (only if with 只有…才…)") && b.includes("Go over them quickly first")), "Claude Code's first message names the unit and lists its patterns");
  // Simulated learner: one message per turn, gold from the mistakes it reports, phantom mistakes dropped.
  const learnerTurns = sfUnit.steps.filter((x) => x.phase.step === "turn");
  assert.equal(learnerTurns.length, 20, "the simulated learner wrote 20 messages");
  assert.equal(learnerTurns[1].input, "要是你有时间，就我们一起去看比赛吧！");
  assert.deepEqual(learnerTurns[1].gold?.errors?.map((e) => [e.id, e.original, e.accept[0]]), [["t2-yaoshi-jiu", "就我们一起去", "我们就一起去"]]);
  assert.ok(learnerTurns[2].gold?.clean && learnerTurns[2].droppedErrors?.[0] === "或者去实验室", "a reported mistake not in the message is dropped");
  assert.equal(learnerTurns[3].input, "好的，这是我的第4条消息。", "JSON wrapped in prose is parsed");
  assert.ok(learnerTurns.every((x, i) => x.phase.turn === i && x.output?.reply), "every learner message got a tutor reply");
  assert.equal(parseLearner("no json", 0), null);
  assert.equal(parseLearner('{"text":"   "}', 0), null);
  const lp = learnerPrompt(unitSc.sessions[0].learner!, "HSK 3", "TUTOR: 你好！", 19);
  assert.ok(lp.includes("Level: HSK 3.") && lp.includes("TUTOR: 你好！") && lp.includes("message 20 of 20") && lp.includes("last one"), "learner prompt carries level, conversation and the last-message cue");
  const sfUnitMetrics = computeMetrics(cfg, runDir, scenarios).blocks.find((b) => b.arm === "sayfern" && b.scenario === "zh-course-unit")!;
  assert.deepEqual(sfUnitMetrics.learner, { turns: 20, withMistakes: 1, dropped: 1 });
  step("simulated learner: answers each tutor reply, reported mistakes become gold, phantom mistakes dropped");
  const uItems = judgeItems(sfUnit, unitSc, "HSK 3");
  const t1 = uItems.find((i) => i.item === "s0-t1")!;
  assert.equal(t1.learner, "要是你有时间，就我们一起去看比赛吧！");
  assert.deepEqual(t1.goldErrors?.map((e) => e.id), ["t2-yaoshi-jiu"]);
  assert.ok(uItems.find((i) => i.item === "s0-t0")?.clean, "a message without reported mistakes is a clean turn");
  const uOpen = uItems.find((i) => i.item === "s0-open")!;
  const uSess = uItems.find((i) => i.item === "s0-session")!;
  assert.equal(uOpen.unitPoints?.length, 7);
  assert.deepEqual(uOpen.pointVerdicts, ["explained"]);
  assert.deepEqual(uSess.pointVerdicts, ["modeled", "elicited"]);
  assert.deepEqual(uSess.rate, ["teaching", "engagement", "level"]);
  assert.ok(uSess.tutor.startsWith("TUTOR (opening):") && uSess.tutor.split("LEARNER:").length - 1 === 20, "unit session shows the opening and all twenty turns");
  const unitVerdicts = (items: Item[], yes: (id: string, v: string) => boolean): JudgeItem[] =>
    items.map((it) => {
      const n = needs(it);
      return {
        item: it.item,
        ...(n.errors.length ? { errors: n.errors.map((id) => ({ id, flagged: true, correctFix: true })) } : {}),
        ...(n.clean ? { falsePositive: false } : {}),
        ...(n.checks ? { pass: true } : {}),
        ...(n.rate.length ? { ratings: { teaching: 4, engagement: 4, level: 4 } } : {}),
        ...(n.points.length ? { points: n.points.map((id) => ({ id, ...Object.fromEntries(n.pointVerdicts.map((v) => [v, yes(id, v)])) })) } : {}),
      };
    });
  const sfU = unitVerdicts(uItems, () => true);
  assert.deepEqual(missingVerdicts(uItems, sfU), []);
  // A point the judge skipped counts as missing, so the next attempt asks again.
  const partial = sfU.map((r) => (r.item === "s0-session" ? { ...r, points: r.points!.slice(1) } : r));
  assert.deepEqual(missingVerdicts(uItems, partial), ["s0-session"]);
  const ccU = unitVerdicts(judgeItems(load(ccUnitKey), unitSc, "HSK 3"), (id, v) => v === "explained" || (v === "modeled" && id === "zh:yaoshi-jiu"));
  writeFileSync(join(runDir, "judge.json"), JSON.stringify(blockKeys.map((k) => ({ block: k, items: k === sfUnitKey ? sfU : k === ccUnitKey ? ccU : [] }))));
  const md4 = renderReport(cfg, runDir, scenarios, { runId: "selftest", startedAt: new Date().toISOString(), fixtures: "synthetic", reps: 1, learnerModel: "claude-haiku-5-5", arms: [{ id: "sayfern", label: "Sayfern", version: "selftest" }, { id: "claude-code", label: "Claude Code + skill", version: "fake" }] });
  const row4 = (name: string) => md4.split("\n").find((l) => l.startsWith(`| ${name}`)) ?? "";
  assert.ok(md4.includes("## Course unit teaching"));
  assert.match(row4("Points explained correctly"), /100% \(7\/7\) \| 100% \(7\/7\)/);
  assert.match(row4("Points used by the tutor"), /100% \(7\/7\) \| 14% \(1\/7\)/);
  assert.match(row4("Points invited from the learner"), /100% \(7\/7\) \| 0% \(0\/7\)/);
  assert.match(row4("Points brought into the conversation"), /100% \(7\/7\) \| 14% \(1\/7\)/);
  assert.match(row4("要是…，就…"), /1\/1 · 1\/1 · 1\/1 \| 1\/1 · 1\/1 · 0\/1/);
  assert.match(row4("Judge: teaching"), /4\.00 \(n=1\)/);
  assert.ok(md4.includes("## Simulated learner") && md4.includes("`claude-haiku-5-5`"));
  assert.match(row4("Reported mistakes dropped"), /\| 1 \| 1 \|$/);
  assert.match(row4("Messages with a planned mistake"), /\| 1 \| 1 \|$/);
  step("course unit: Sayfern opens from the course, Claude Code gets the patterns; per-point verdicts, missing points and report rows");
  scorerChecks();
  step("scorer: markdown markers ignored, fixes derived from the learner's stretch, forbidden words matched as listed words");
  invalidChecks(cfg, runDir, scenarios, blockKeys);
  step("invalid blocks: excluded from means, listed in Errors, skipped by blockOk");
  evidenceChecks(runDir);
  step("evidence metrics: seeded records left out; extra cards, incorrect observations on clean turns, tag accuracy, missing grammar ids");
  console.log(`\n${md3.slice(md3.indexOf("## Conversation quality"), md3.indexOf("## Plan utilization"))}`);
  console.log(md4.slice(md4.indexOf("## Course unit teaching"), md4.indexOf("## Plan utilization")));
  console.log(`✓ bench selftest passed (${runDir})`);
}

const out = (reply: string, feedback: string[] = []): TurnOutput => ({ reply, feedback, wallMs: 0 });

function scorerChecks(): void {
  assert.equal(norm("我**昨天**去了`图书馆`_。"), "我昨天去了图书馆");
  assert.equal(norm("| 「选择」 | **设计** |"), "选择设计");
  const gold: GoldTurn = { errors: [{ id: "time", original: "我去了图书馆昨天", accept: ["我昨天去了图书馆"], key: ["昨天去了图书馆"], pattern: "" }] };
  assert.equal(scoreTurn(gold, out("时间词要放在动词前面：我**昨天**去了图书馆。")).errors[0].flagged, true, "a fix wrapped in bold counts");
  assert.equal(scoreTurn(gold, out("我去了图书馆昨天，很好。")).errors[0].flagged, false, "the learner's own text is no fix");
  // Fixes the simulated learner reports carry context around the change: the card shows less than the gold.
  const sim: GoldTurn = { errors: [{ id: "weile", original: "为了下雨，我们的户外", accept: ["因为下雨，我们的户外"], pattern: "" }] };
  assert.equal(fixKey("为了下雨，我们的户外", "因为下雨，我们的户外"), "因为下雨");
  assert.equal(scoreTurn(sim, out("", ["为了下雨 → 因为下雨 (grammar): reason"])).errors[0].flagged, true);
  assert.equal(scoreTurn(sim, out("可以说：由于下雨，户外测试取消了。")).errors[0].flagged, true, "由于 shows the same fix as 因为");
  assert.equal(scoreTurn(sim, out("为了下雨很奇怪，下雨取消了。")).errors[0].flagged, false);
  assert.equal(fixKey("比上次的考试很难", "比上次的考试难"), null, "a pure deletion has no key");
  const duration: GoldTurn = { errors: [{ id: "d", original: "我已经三个小时学习了", accept: ["学习三个小时"], pattern: "" }] };
  assert.equal(scoreTurn(duration, out("", ["我已经三个小时学习了 → 我已经学习三个小时了 (grammar)"])).errors[0].flagged, true);
  // Anki: a forbidden word is a hit only when listed with the expected words (or in a table row).
  const anki: GoldTurn = { anki: { expect: ["选择", "设计"], min: 2, forbid: ["喜欢"] } };
  assert.equal(scoreTurn(anki, out("记不住的词有选择、设计。你喜欢机器人，那你昨天做了什么？")).anki?.pass, true, "喜欢 inside 你喜欢机器人 is no listed word");
  assert.equal(scoreTurn(anki, out("记不住的词有选择、设计、喜欢。")).anki?.pass, false, "a known word in the list fails");
  assert.deepEqual(scoreTurn(anki, out("记不住的词有选择、设计、喜欢。")).anki?.forbiddenHits, ["喜欢"]);
  assert.equal(scoreTurn(anki, out("选择、设计最难。\n今天你复习的词（朋友、喜欢）都答对了。")).anki?.pass, true, "known words reported as right are fine");
  assert.equal(scoreTurn(anki, out("选择、设计最难。\n\n| 词 | 次数 |\n| 喜欢 | 5 |")).anki?.pass, false, "a known word in a table row fails");
  assert.equal(scoreTurn(anki, out("选择最难。")).anki?.pass, false, "too few expected words");
  // Per-repetition range.
  const m = (rep: number, num: number, den: number) => ({ rep, grammar: { flagged: num, gold: den } }) as BlockMetrics;
  assert.equal(spread([m(1, 4, 5), m(2, 5, 5)], (b) => b.grammar.flagged, (b) => b.grammar.gold), " · reps 80–100%");
  assert.equal(spread([m(1, 5, 5), m(2, 5, 5)], (b) => b.grammar.flagged, (b) => b.grammar.gold), " · reps 100%");
  assert.equal(spread([m(1, 4, 5)], (b) => b.grammar.flagged, (b) => b.grammar.gold), "", "one repetition has no range");
}

/** A block that hit an error is not averaged, not judged, and listed as excluded. */
function invalidChecks(cfg: BenchConfig, runDir: string, scenarios: Scenario[], blockKeys: string[]): void {
  const key = blockKeys.find((k) => k.startsWith("sayfern__zh-chat-corrections"))!;
  const file = join(runDir, "blocks", key, "block.json");
  const text = readFileSync(file, "utf8");
  const block = JSON.parse(text) as BlockResult;
  const meta = { runId: "selftest", startedAt: "", fixtures: "synthetic", reps: 1, arms: [{ id: "sayfern", label: "Sayfern", version: "selftest" }, { id: "claude-code", label: "Claude Code + skill", version: "fake" }] };
  const gold = (md: string) => (md.split("\n").find((l) => l.startsWith("| Grammar errors caught, deterministic")) ?? "").split("|")[2].trim();
  assert.ok(blockOk(block));
  const before = gold(renderReport(cfg, runDir, scenarios, meta));
  assert.ok(!before.startsWith("–"), `Sayfern has grammar numbers before: ${before}`);
  block.steps[1].output = { reply: "", feedback: [], error: "You've hit your session limit", wallMs: 0 };
  assert.ok(!blockOk(block) && !blockOk({ ...block, steps: [], error: "boom" }) && !blockOk({ steps: [], skipped: "language" }));
  writeFileSync(file, JSON.stringify(block));
  try {
    const md = renderReport(cfg, runDir, scenarios, meta);
    assert.ok(md.includes(`- excluded \`${key}\``) && md.includes("hit your session limit"), "listed as excluded under Errors");
    assert.ok(md.includes("excluded from every mean and rate"));
    assert.match(gold(md), /^–|^0% \(0\/0\)|^\d+% \(\d+\/\d+\)/);
    assert.notEqual(gold(md), before, "the block's gold errors left the totals");
    assert.ok(!computeMetrics(cfg, runDir, scenarios).blocks.find((b) => `${b.arm}__${b.scenario}__rep${b.rep}` === key)!.ok);
  } finally {
    writeFileSync(file, text);
  }
}

/** Evidence for a block, from a hand-written records dir: one seeded session and one benchmark session. */
function evidenceChecks(runDir: string): void {
  const dir = mkdtempSync(join(runDir, "evidence-"));
  const records = join(dir, "sayfern-data", "records");
  mkdirSync(join(records, "sessions"), { recursive: true });
  const msg = (id: string, sessionId: string, text: string) => ({ id, sessionId, role: "user", text, at: 0 });
  writeFileSync(join(records, "sessions", "seed.json"), JSON.stringify({ messages: [msg("m0", "seed", "我去了超市昨天。")] }));
  writeFileSync(join(records, "sessions", "bench.json"), JSON.stringify({ messages: [msg("m1", "bench", "一"), msg("m2", "bench", "二"), msg("m3", "bench", "三"), msg("m4", "bench", "四")] }));
  const card = (id: string, sessionId: string, messageId: string, grammarId?: string) => ({ id, sessionId, messageId, original: "", corrected: "", explanation: "", kind: "grammar", createdAt: 0, status: "open", retries: [], ...(grammarId ? { grammarId } : {}) });
  writeFileSync(
    join(records, "corrections.json"),
    JSON.stringify([
      card("c0", "seed", "m0", "zh:time-before-verb"), // seeded: not counted
      card("c1", "bench", "m1", "zh:bi-comparison"),
      card("c2", "bench", "m2"), // no grammar id; m2 is a clean turn: an extra card
      card("c3", "bench", "m3", "zh:other"), // the wrong tag
      card("c4", "bench", "m3", "zh:other"), // a second card for one gold error: extra
    ]),
  );
  const obs = (id: string, messageId: string, grammarId: string, verdict: string, origin?: string) => ({ id, grammarId, language: "zh", sessionId: "bench", messageId, span: "", verdict, assistance: "independent", at: 0, ...(origin ? { origin } : {}) });
  writeFileSync(
    join(records, "observations.json"),
    JSON.stringify([obs("o1", "m1", "zh:bi-comparison", "incorrect"), obs("o2", "m2", "zh:x", "incorrect"), obs("o3", "m2", "zh:y", "correct"), obs("o4", "m4", "zh:z", "incorrect"), obs("o5", "m4", "zh:q", "incorrect", "quiz")]),
  );
  const err = (id: string, grammarId?: string | string[]) => ({ id, original: "x", accept: ["y"], pattern: "", ...(grammarId ? { grammarId } : {}) });
  const turns: { text: string; gold?: GoldTurn }[] = [
    { text: "一", gold: { errors: [err("a", "zh:bi-comparison")] } },
    { text: "二", gold: { clean: true } },
    { text: "三", gold: { errors: [err("b", ["zh:time-before-verb", "zh:ruguo-jiu"])] } },
    { text: "四", gold: { clean: true } },
    { text: "五" },
  ];
  const scenario = { id: "t", sessions: [{ mode: "chat", turns }] } as unknown as Scenario;
  const steps = turns.map((t, i) => ({ phase: { session: 0, turn: i, step: "turn" }, input: t.text, output: null })) as unknown as StepResult[];
  const e = blockEvidence(dir, scenario, steps)!;
  assert.deepEqual(e, {
    corrections: 4,
    noGrammarId: 1,
    goldTurns: 2,
    goldErrors: 2,
    goldTurnCards: 3,
    annotatedTurns: 4,
    extraCards: 2,
    cleanTurns: 2,
    incorrectOnClean: 2,
    taggable: 2,
    tagged: 1,
  });
  assert.equal(blockEvidence(join(dir, "nowhere"), scenario, steps), null, "no records, no evidence (other arms)");
}
