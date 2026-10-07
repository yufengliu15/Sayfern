// Turns raw captures (wire.jsonl, anki.jsonl, blocks, judge.json) into numbers.
// Everything here is recomputable from the saved files: `npm run bench -- report <run>`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { priceFor, type BenchConfig } from "./config";
import { judgeItems, needs, validRating, type JudgeResult } from "./judge";
import { blockKey, type BlockResult } from "./runner";
import { RATINGS, type Rating, type Scenario } from "./scenarios";
import { addReply, emptyStyle, scoreTurn, type ReplyStyle } from "./score";
import type { AnkiCallRecord, WireRecord } from "./types";
import { promptTokens } from "./wire";

export interface BlockMetrics {
  arm: string;
  scenario: string;
  rep: number;
  ok: boolean;
  error?: string;
  skipped?: string;
  requests: number;
  auxRequests: number;
  httpErrors: number;
  promptTokens: number;
  uncachedInput: number;
  cacheRead: number;
  cacheWrite: number;
  outputTokens: number;
  peakPrompt: number;
  costUsd: number;
  /** Cost expressed in input tokens of the configured model: the limit-usage estimate. */
  limitUnits: number;
  models: Record<string, number>;
  overhead?: { systemAndTools?: number; tools?: number; error?: string };
  firstRequestPrompt: number;
  toolCalls: number;
  /** Requests beyond the first in a step: model round trips spent on tool loops. */
  roundTrips: number;
  toolErrors: number;
  /** Claude Code only: whether the skill was invoked in any step (null for other arms). */
  skillUsed: boolean | null;
  toolNames: Record<string, number>;
  permissionDenials: number;
  ankiCalls: number;
  ankiCallsInTurns: number;
  ankiErrors: number;
  wallMs: number;
  steps: { label: string; requests: number; prompt: number; output: number; peak: number; wallMs: number; error?: string }[];
  grammar: { gold: number; flagged: number };
  anki: { checks: number; passed: number };
  /** Deterministic reply-style counts over the tutor replies to learner turns in chat sessions. */
  style: ReplyStyle;
  judge?: {
    errors: number;
    flagged: number;
    correctFix: number;
    cleanTurns: number;
    falsePositives: number;
    tutorErrors: number;
    facts: number;
    factsCorrect: number;
    checks: number;
    checksPassed: number;
    /** Conversation quality: valid 1-5 ratings returned, per quality. */
    ratings: Record<Rating, number[]>;
    /** moveOn turns: how many, and how many the tutor moved on by. */
    moveOn: { turns: number; passed: number };
    /** stay turns: how many, and how many the tutor stayed with. */
    stay: { turns: number; passed: number };
    /** Expected verdicts the judge did not return (denominators above still count them). */
    ungraded: { errors: number; clean: number; facts: number; checks: number; ratings: number; moveOn: number; stay: number };
    error?: string;
  };
  reportedVsWire?: { reported: number; wire: number };
  utilDelta: Record<string, number | null>;
}

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

function costOf(cfg: BenchConfig, r: WireRecord): number {
  const u = r.usage;
  if (!u) return 0;
  const p = priceFor(cfg, r.model ?? r.req?.model);
  const w1h = Math.min(u.cacheWrite1h, u.cacheWrite);
  const w5m = u.cacheWrite - w1h;
  return (u.input * p.input + w5m * p.cacheWrite + w1h * (p.cacheWrite1h ?? p.input * 2) + u.cacheRead * p.cacheRead + u.output * p.output) / 1e6;
}

const stepLabel = (s: { session: number; step: string; turn: number }) =>
  `s${s.session + 1}·${s.step === "turn" ? `t${s.turn + 1}` : s.step}`;

/** Utilization headers: every anthropic-ratelimit-* header whose name mentions utilization, parsed as a number. */
function utilOf(r: WireRecord): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.rateLimit ?? {})) {
    if (!/utilization/i.test(k)) continue;
    const n = parseFloat(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function resetsOf(r: WireRecord): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.rateLimit ?? {})) if (/reset/i.test(k)) out[k] = v;
  return out;
}

export function computeMetrics(cfg: BenchConfig, runDir: string, scenarios: Scenario[]): { blocks: BlockMetrics[]; utilKeys: string[] } {
  const wire = readJsonl<WireRecord>(join(runDir, "wire.jsonl")).sort((a, b) => a.seq - b.seq);
  const anki = readJsonl<AnkiCallRecord>(join(runDir, "anki.jsonl"));
  const judge: JudgeResult[] = existsSync(join(runDir, "judge.json")) ? JSON.parse(readFileSync(join(runDir, "judge.json"), "utf8")) : [];
  const blockDirs = existsSync(join(runDir, "blocks")) ? readdirSync(join(runDir, "blocks")) : [];
  const blocks: BlockResult[] = blockDirs
    .filter((d) => existsSync(join(runDir, "blocks", d, "block.json")))
    .map((d) => JSON.parse(readFileSync(join(runDir, "blocks", d, "block.json"), "utf8")) as BlockResult)
    .sort((a, b) => a.startedAt - b.startedAt);
  const byScenario = new Map(scenarios.map((s) => [s.id, s]));
  const utilKeys = [...new Set(wire.flatMap((r) => Object.keys(utilOf(r))))].sort();

  // Plan utilization: value after this block's last response minus value after the previous block's.
  let prevUtil: Record<string, number> | null = null;
  let prevResets: Record<string, string> | null = null;

  const out: BlockMetrics[] = [];
  for (const b of blocks) {
    const inBlock = (p: { arm: string; scenario: string; rep: number } | null) => !!p && p.arm === b.arm && p.scenario === b.scenario && p.rep === b.rep;
    const recs = wire.filter((r) => inBlock(r.phase) && r.phase!.step !== "setup");
    const msgs = recs.filter((r) => r.kind === "messages");
    const m: BlockMetrics = {
      arm: b.arm,
      scenario: b.scenario,
      rep: b.rep,
      ok: !b.error && !b.skipped && b.steps.every((s) => !s.output?.error),
      ...(b.error ? { error: b.error.split("\n")[0] } : {}),
      ...(b.skipped ? { skipped: b.skipped } : {}),
      requests: msgs.length,
      auxRequests: recs.length - msgs.length,
      httpErrors: recs.filter((r) => r.status >= 400).length,
      promptTokens: 0,
      uncachedInput: 0,
      cacheRead: 0,
      cacheWrite: 0,
      outputTokens: 0,
      peakPrompt: 0,
      costUsd: 0,
      limitUnits: 0,
      models: {},
      firstRequestPrompt: promptTokens(msgs[0]?.usage),
      toolCalls: 0,
      roundTrips: 0,
      toolErrors: 0,
      skillUsed: null,
      toolNames: {},
      permissionDenials: 0,
      ankiCalls: anki.filter((a) => inBlock(a.phase)).length,
      ankiCallsInTurns: anki.filter((a) => inBlock(a.phase) && a.phase!.step !== "setup").length,
      ankiErrors: anki.filter((a) => inBlock(a.phase) && !a.ok).length,
      wallMs: 0,
      steps: [],
      grammar: { gold: 0, flagged: 0 },
      anki: { checks: 0, passed: 0 },
      style: emptyStyle(),
      utilDelta: {},
    };
    for (const r of msgs) {
      const u = r.usage;
      if (u) {
        m.promptTokens += promptTokens(u);
        m.uncachedInput += u.input;
        m.cacheRead += u.cacheRead;
        m.cacheWrite += u.cacheWrite;
        m.outputTokens += u.output;
        m.peakPrompt = Math.max(m.peakPrompt, promptTokens(u));
      }
      m.costUsd += costOf(cfg, r);
      const model = r.model ?? r.req?.model ?? "?";
      m.models[model] = (m.models[model] ?? 0) + 1;
      m.toolCalls += r.toolUses.length;
      for (const t of r.toolUses) m.toolNames[t.name] = (m.toolNames[t.name] ?? 0) + 1;
      m.toolErrors += (r.req?.toolResults ?? []).filter((t) => t.isError).length;
      if (r.probe && !m.overhead) m.overhead = r.probe;
    }
    m.limitUnits = Math.round((m.costUsd * 1e6) / priceFor(cfg, cfg.model).input);

    const scenario = byScenario.get(b.scenario);
    for (const s of b.steps) {
      const sr = msgs.filter((r) => r.phase!.session === s.phase.session && r.phase!.turn === s.phase.turn && r.phase!.step === s.phase.step);
      m.steps.push({
        label: stepLabel(s.phase),
        requests: sr.length,
        prompt: sr.reduce((t, r) => t + promptTokens(r.usage), 0),
        output: sr.reduce((t, r) => t + (r.usage?.output ?? 0), 0),
        peak: sr.reduce((t, r) => Math.max(t, promptTokens(r.usage)), 0),
        wallMs: s.output?.wallMs ?? 0,
        ...(s.output?.error ? { error: s.output.error } : {}),
      });
      m.wallMs += s.output?.wallMs ?? 0;
      m.roundTrips += Math.max(0, sr.length - 1);
      const su = (s.output?.extra as Record<string, unknown> | undefined)?.skillUsed;
      if (typeof su === "boolean") m.skillUsed = !!m.skillUsed || su;
      m.permissionDenials += Number((s.output?.extra as Record<string, unknown> | undefined)?.permissionDenials ?? 0);
      if (s.phase.step === "turn" && scenario) {
        const gold = scenario.sessions[s.phase.session]?.turns[s.phase.turn]?.gold;
        const sc = scoreTurn(gold, s.output);
        m.grammar.gold += sc.errors.length;
        m.grammar.flagged += sc.errors.filter((e) => e.flagged).length;
        if (scenario.sessions[s.phase.session]?.mode === "chat" && s.output && !s.output.error) addReply(m.style, s.output.reply);
        if (sc.anki && sc.anki.expected) {
          m.anki.checks++;
          if (sc.anki.pass) m.anki.passed++;
        }
      }
    }
    // Harness-reported vs wire usage (input + output + cache), for a capture sanity check.
    const reported = b.steps.reduce((t, s) => {
      const r = s.output?.reported;
      return t + (r ? (r.input ?? 0) + (r.output ?? 0) + (r.cacheRead ?? 0) + (r.cacheWrite ?? 0) : 0);
    }, 0);
    if (reported) m.reportedVsWire = { reported, wire: m.promptTokens + m.outputTokens };

    // Denominators come from the scenario's gold items, so both arms are graded out of the same
    // totals. A verdict the judge failed to return is counted as ungraded, never dropped.
    const j = judge.find((x) => x.block === blockKey(b.arm, b.scenario, b.rep));
    if (scenario && !b.skipped && (j || judge.length)) {
      const jm = { errors: 0, flagged: 0, correctFix: 0, cleanTurns: 0, falsePositives: 0, tutorErrors: 0, facts: 0, factsCorrect: 0, checks: 0, checksPassed: 0,
        ratings: { engagement: [], pacing: [], level: [] } as Record<Rating, number[]>, moveOn: { turns: 0, passed: 0 }, stay: { turns: 0, passed: 0 },
        ungraded: { errors: 0, clean: 0, facts: 0, checks: 0, ratings: 0, moveOn: 0, stay: 0 }, ...(j?.error ? { error: j.error } : !j ? { error: "not judged" } : {}) };
      const got = new Map((j?.items ?? []).map((it) => [it.item, it]));
      for (const it of j?.items ?? []) jm.tutorErrors += Number(it.tutorErrors ?? 0) || 0;
      for (const item of judgeItems(b, scenario)) {
        const n = needs(item);
        const r = got.get(item.item);
        for (const id of n.errors) {
          jm.errors++;
          const e = r?.errors?.find((x) => x.id === id);
          if (!e) jm.ungraded.errors++;
          else {
            if (e.flagged) jm.flagged++;
            if (e.correctFix) jm.correctFix++;
          }
        }
        if (n.clean) {
          jm.cleanTurns++;
          if (typeof r?.falsePositive !== "boolean") jm.ungraded.clean++;
          else if (r.falsePositive) jm.falsePositives++;
        }
        if (n.fact) {
          jm.facts++;
          if (typeof r?.correct !== "boolean") jm.ungraded.facts++;
          else if (r.correct) jm.factsCorrect++;
        }
        if (n.checks) {
          jm.checks++;
          if (typeof r?.pass !== "boolean") jm.ungraded.checks++;
          else if (r.pass) jm.checksPassed++;
        }
        for (const k of n.rate) {
          const v = r?.ratings?.[k];
          if (validRating(v)) jm.ratings[k].push(v);
          else jm.ungraded.ratings++;
        }
        if (n.movedOn) {
          jm.moveOn.turns++;
          if (typeof r?.movedOn !== "boolean") jm.ungraded.moveOn++;
          else if (r.movedOn) jm.moveOn.passed++;
        }
        if (n.stayed) {
          jm.stay.turns++;
          if (typeof r?.stayed !== "boolean") jm.ungraded.stay++;
          else if (r.stayed) jm.stay.passed++;
        }
      }
      m.judge = jm;
    }

    const last = [...recs].reverse().find((r) => Object.keys(utilOf(r)).length);
    if (last) {
      const now = utilOf(last);
      const resets = resetsOf(last);
      for (const k of utilKeys) {
        const window = k.replace(/-?utilization/i, "");
        const sameWindow = prevResets && Object.entries(resets).every(([rk, rv]) => !rk.includes(window) || prevResets![rk] === rv);
        m.utilDelta[k] = prevUtil && k in prevUtil && k in now && sameWindow ? +(now[k] - prevUtil[k]).toFixed(4) : null;
      }
      prevUtil = now;
      prevResets = resets;
    }
    out.push(m);
  }
  return { blocks: out, utilKeys };
}

// ------------------------------------------------------------------ rendering

const fmt = (n: number | undefined, d = 0) => (n === undefined || !Number.isFinite(n) ? "–" : n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "–");

function ratio(a: number, b: number): string {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0 || b === 0) return "–";
  const r = b / a;
  return r >= 1 ? `${r.toFixed(1)}×` : `${r.toFixed(2)}×`;
}

/** "## Conversation quality": judge ratings and move-on / stay verdicts next to deterministic reply-style numbers. */
function conversationQuality(L: string[], good: BlockMetrics[], arms: string[], armLabel: (id: string) => string): void {
  const of = (arm: string) => good.filter((b) => b.arm === arm);
  const sty = (arm: string) => of(arm).reduce((t, b) => ({ replies: t.replies + b.style.replies, hanChars: t.hanChars + b.style.hanChars, chars: t.chars + b.style.chars, questions: t.questions + b.style.questions, singleQuestion: t.singleQuestion + b.style.singleQuestion }), emptyStyle());
  const judged = good.some((b) => b.judge);
  const rated = judged && good.some((b) => b.judge && (RATINGS.some((k) => b.judge!.ratings[k].length) || b.judge.moveOn.turns || b.judge.stay.turns || b.judge.ungraded.ratings));
  if (!arms.some((a) => sty(a).replies) && !rated) return;
  L.push(`## Conversation quality`, "");
  L.push("Mandarin chat sessions. Ratings are 1-5 from the judge over each whole session (anchors in `docs/benchmark.md`); a higher number is better. The judge sees only what the learner saw, so it may be able to tell the arms apart. The learner script is fixed and cannot follow a topic change by the tutor. Reply-style numbers are counted in code over the tutor's replies to learner turns.", "");
  L.push(`| Metric | ${arms.map(armLabel).join(" | ")} |`, `|---|${arms.map(() => "---:").join("|")}|`);
  const row = (name: string, f: (arm: string) => string) => L.push(`| ${name} | ${arms.map(f).join(" | ")} |`);
  if (rated) {
    for (const k of RATINGS) {
      row(`Judge: ${k} (mean 1-5)`, (a) => {
        const xs = of(a).flatMap((b) => b.judge?.ratings[k] ?? []);
        return xs.length ? `${fmt(mean(xs), 2)} (n=${xs.length})` : "–";
      });
    }
    const unRatings = (a: string) => of(a).reduce((t, b) => t + (b.judge?.ungraded.ratings ?? 0), 0);
    if (arms.some((a) => unRatings(a))) row("Judge: ratings missing", (a) => (unRatings(a) ? `⚠ ${unRatings(a)} ungraded` : "0"));
    const passRow = (name: string, key: "moveOn" | "stay") =>
      row(name, (a) => {
        const num = of(a).reduce((t, b) => t + (b.judge?.[key].passed ?? 0), 0);
        const den = of(a).reduce((t, b) => t + (b.judge?.[key].turns ?? 0), 0);
        const un = of(a).reduce((t, b) => t + (b.judge?.ungraded[key] ?? 0), 0);
        return `${pct(num, den)} (${num}/${den}${un ? `, ⚠ ${un} ungraded` : ""})`;
      });
    passRow("Judge: moved on when it should", "moveOn");
    passRow("Judge: stayed when it should", "stay");
  } else L.push(`| Judge ratings and move-on verdicts | ${arms.map(() => "not run").join(" | ")} |`);
  row("Mean reply length, Han characters", (a) => (sty(a).replies ? fmt(sty(a).hanChars / sty(a).replies, 1) : "–"));
  row("Mean reply length, all characters", (a) => (sty(a).replies ? fmt(sty(a).chars / sty(a).replies, 1) : "–"));
  row("Mean question marks per reply (？ and ?)", (a) => (sty(a).replies ? fmt(sty(a).questions / sty(a).replies, 2) : "–"));
  row("Replies with exactly one question", (a) => (sty(a).replies ? `${pct(sty(a).singleQuestion, sty(a).replies)} (${sty(a).singleQuestion}/${sty(a).replies})` : "–"));
  L.push("");
}

export function renderReport(cfg: BenchConfig, runDir: string, scenarios: Scenario[], meta: Record<string, unknown>): string {
  const { blocks, utilKeys } = computeMetrics(cfg, runDir, scenarios);
  const arms = [...new Set(blocks.map((b) => b.arm))];
  const [a0, a1] = arms;
  const good = blocks.filter((b) => !b.skipped);
  const armLabel = (id: string) => ((meta.arms as { id: string; label: string; version: string }[] | undefined)?.find((a) => a.id === id)?.label ?? id);
  const L: string[] = [];
  L.push(`# Sayfern vs Claude Code benchmark`, "");
  L.push(`Run \`${meta.runId}\` · ${meta.startedAt} · model \`${cfg.model}\` · fixtures \`${meta.fixtures}\` · ${meta.reps} rep(s)`, "");
  for (const a of (meta.arms as { id: string; label: string; version: string }[]) ?? []) L.push(`- **${a.label}** (\`${a.id}\`): ${a.version}`);
  L.push("");
  const failed = blocks.filter((b) => !b.ok && !b.skipped);
  if (failed.length) {
    L.push(`> ⚠ ${failed.length} block(s) had errors. Numbers below include them; see "Errors".`, "");
  }
  const offModel = [...new Set(good.flatMap((b) => Object.keys(b.models)))].filter((m) => m !== "?" && !m.startsWith(cfg.model));
  if (offModel.length) {
    L.push(`> ⚠ Requests used models other than \`${cfg.model}\`: ${offModel.map((m) => `\`${m}\``).join(", ")}. See "Capture checks" for which arm.`, "");
  }
  const noSkill = blocks.filter((b) => b.skillUsed === false);
  if (noSkill.length) {
    L.push(`> ⚠ The skill was never invoked in ${noSkill.length} Claude Code block(s): ${noSkill.map((b) => blockKey(b.arm, b.scenario, b.rep)).join(", ")}. Those runs measure plain Claude Code, not Claude Code + skill.`, "");
  }

  // Headline: mean per repetition, summed over scenarios both arms ran.
  const shared = scenarios.filter((s) => arms.every((a) => good.some((b) => b.arm === a && b.scenario === s.id)));
  const perRep = (arm: string, f: (b: BlockMetrics) => number) =>
    shared.reduce((t, s) => t + mean(good.filter((b) => b.arm === arm && b.scenario === s.id).map(f)), 0);
  if (a0 && a1) {
    L.push(`## Headline`, "");
    L.push(`All scenarios both arms ran (${shared.map((s) => s.id).join(", ")}), mean per repetition. Last column: how many times more ${armLabel(a1)} used than ${armLabel(a0)} (lower is better for both).`, "");
    L.push(`| Metric | ${armLabel(a0)} | ${armLabel(a1)} | ${armLabel(a1)} ÷ ${armLabel(a0)} |`, "|---|---:|---:|---:|");
    const row = (name: string, f: (b: BlockMetrics) => number, d = 0) => {
      const x = perRep(a0, f);
      const y = perRep(a1, f);
      L.push(`| ${name} | ${fmt(x, d)} | ${fmt(y, d)} | ${ratio(x, y)} |`);
    };
    row("**Estimated plan-limit usage** (input-token equivalents)", (b) => b.limitUnits);
    row("API-price equivalent (USD)", (b) => b.costUsd, 3);
    row("Prompt tokens processed (cached + uncached)", (b) => b.promptTokens);
    row("Uncached input tokens", (b) => b.uncachedInput);
    row("Cache writes", (b) => b.cacheWrite);
    row("Cache reads", (b) => b.cacheRead);
    row("Output tokens", (b) => b.outputTokens);
    row("Model requests", (b) => b.requests);
    const peak = (arm: string) => Math.max(...good.filter((b) => b.arm === arm).map((b) => b.peakPrompt));
    L.push(`| Peak context in one request (tokens) | ${fmt(peak(a0))} | ${fmt(peak(a1))} | ${ratio(peak(a0), peak(a1))} |`);
    const oh = (arm: string) => good.find((b) => b.arm === arm && b.overhead?.systemAndTools !== undefined)?.overhead;
    const o0 = oh(a0);
    const o1 = oh(a1);
    L.push(`| Fixed context per request: system + tools (exact, count_tokens) | ${fmt(o0?.systemAndTools)} | ${fmt(o1?.systemAndTools)} | ${ratio(o0?.systemAndTools ?? NaN, o1?.systemAndTools ?? NaN)} |`);
    L.push(`| …of which tool definitions | ${fmt(o0?.tools)} | ${fmt(o1?.tools)} | ${ratio(o0?.tools ?? NaN, o1?.tools ?? NaN)} |`);
    row("Tool calls", (b) => b.toolCalls);
    row("Extra model round trips for tool loops", (b) => b.roundTrips);
    row("Wall time (s)", (b) => b.wallMs / 1000, 0);
    L.push("");

    L.push(`## Accuracy`, "");
    L.push(`| Metric | ${armLabel(a0)} | ${armLabel(a1)} |`, "|---|---:|---:|");
    const sum = (arm: string, f: (b: BlockMetrics) => number) => good.filter((b) => b.arm === arm).reduce((t, b) => t + f(b), 0);
    const cell = (arm: string, num: (b: BlockMetrics) => number, den: (b: BlockMetrics) => number, un?: (b: BlockMetrics) => number) => {
      const u = un ? sum(arm, un) : 0;
      return `${pct(sum(arm, num), sum(arm, den))} (${sum(arm, num)}/${sum(arm, den)}${u ? `, ⚠ ${u} ungraded` : ""})`;
    };
    const pair = (name: string, num: (b: BlockMetrics) => number, den: (b: BlockMetrics) => number, un?: (b: BlockMetrics) => number) =>
      L.push(`| ${name} | ${cell(a0, num, den, un)} | ${cell(a1, num, den, un)} |`);
    pair("Grammar errors caught, deterministic (fix shown to the learner)", (b) => b.grammar.flagged, (b) => b.grammar.gold);
    pair("Anki grounding checks passed, deterministic", (b) => b.anki.passed, (b) => b.anki.checks);
    const judged = good.some((b) => b.judge);
    if (judged) {
      pair("Judge: grammar errors flagged", (b) => b.judge?.flagged ?? 0, (b) => b.judge?.errors ?? 0, (b) => b.judge?.ungraded.errors ?? 0);
      pair("Judge: flagged with a correct fix", (b) => b.judge?.correctFix ?? 0, (b) => b.judge?.errors ?? 0, (b) => b.judge?.ungraded.errors ?? 0);
      pair("Judge: false alarms on clean messages", (b) => b.judge?.falsePositives ?? 0, (b) => b.judge?.cleanTurns ?? 0, (b) => b.judge?.ungraded.clean ?? 0);
      pair("Judge: Anki facts stated correctly", (b) => b.judge?.factsCorrect ?? 0, (b) => b.judge?.facts ?? 0, (b) => b.judge?.ungraded.facts ?? 0);
      pair("Judge: behaviour checks passed", (b) => b.judge?.checksPassed ?? 0, (b) => b.judge?.checks ?? 0, (b) => b.judge?.ungraded.checks ?? 0);
      L.push(`| Judge: tutor's own Mandarin errors (count) | ${sum(a0, (b) => b.judge?.tutorErrors ?? 0)} | ${sum(a1, (b) => b.judge?.tutorErrors ?? 0)} |`);
    } else L.push(`| Judge metrics | not run | not run |`);
    const ungradedTotal = good.reduce((t, b) => t + (b.judge ? Object.values(b.judge.ungraded).reduce((x, y) => x + y, 0) : 0), 0);
    L.push(`| Tool errors returned to the model | ${sum(a0, (b) => b.toolErrors)} | ${sum(a1, (b) => b.toolErrors)} |`);
    L.push(`| Permission denials (Claude Code) | ${sum(a0, (b) => b.permissionDenials)} | ${sum(a1, (b) => b.permissionDenials)} |`);
    L.push(`| AnkiConnect calls during turns (setup excluded) | ${sum(a0, (b) => b.ankiCallsInTurns)} | ${sum(a1, (b) => b.ankiCallsInTurns)} |`);
    L.push("");
    if (ungradedTotal) {
      const which = good.filter((b) => b.judge && Object.values(b.judge.ungraded).some(Boolean)).map((b) => `\`${blockKey(b.arm, b.scenario, b.rep)}\``);
      L.push(`> ⚠ ${ungradedTotal} judge verdict(s) missing (${which.join(", ")}). Both arms are still scored out of the same totals; ungraded items count as not passed. Run \`npm run bench -- judge <run-id>\` to grade only the missing ones.`, "");
    }
  }

  conversationQuality(L, good, arms, armLabel);

  L.push(`## Plan utilization (rate-limit headers)`, "");
  if (!utilKeys.length) {
    L.push("No utilization headers were observed. Expected with API-key auth; with a subscription, the API may not send them for these requests. The limit estimate above stands on token counts alone.", "");
  } else {
    L.push("Change in each utilization header across a block (value after the block minus value after the previous block). Blank when the window reset in between, or for the first block. Other traffic on the same account during the run pollutes these numbers.", "");
    L.push(`| Header | ${arms.map(armLabel).join(" | ")} |`, `|---|${arms.map(() => "---:").join("|")}|`);
    for (const k of utilKeys) {
      L.push(`| \`${k}\` | ${arms.map((a) => {
        const ds = good.filter((b) => b.arm === a).map((b) => b.utilDelta[k]).filter((d): d is number => typeof d === "number");
        return ds.length ? `${fmt(ds.reduce((x, y) => x + y, 0), 4)} (${ds.length} blocks)` : "–";
      }).join(" | ")} |`);
    }
    L.push("");
  }

  L.push(`## Per scenario`, "");
  for (const s of scenarios) {
    const bs = blocks.filter((b) => b.scenario === s.id);
    if (!bs.length) continue;
    L.push(`### ${s.title} (\`${s.id}\`)`, "", s.description, "");
    L.push(`| Arm | Rep | Requests | Prompt tok | Peak | Output | Limit units | USD | Tool calls | Tool errs | Grammar caught | Anki pass | Wall s |`);
    L.push(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
    for (const b of bs) {
      if (b.skipped) {
        L.push(`| ${armLabel(b.arm)} | ${b.rep} | skipped: ${b.skipped} |||||||||||`);
        continue;
      }
      L.push(
        `| ${armLabel(b.arm)}${b.ok ? "" : " ⚠"} | ${b.rep} | ${b.requests} | ${fmt(b.promptTokens)} | ${fmt(b.peakPrompt)} | ${fmt(b.outputTokens)} | ${fmt(b.limitUnits)} | ${fmt(b.costUsd, 3)} | ${b.toolCalls} | ${b.toolErrors} | ${b.grammar.gold ? `${b.grammar.flagged}/${b.grammar.gold}` : "–"} | ${b.anki.checks ? `${b.anki.passed}/${b.anki.checks}` : "–"} | ${fmt(b.wallMs / 1000)} |`,
      );
    }
    L.push("");
    // Per-step context curve, first repetition of each arm.
    const firsts = arms.map((a) => bs.find((b) => b.arm === a && !b.skipped)).filter((b): b is BlockMetrics => !!b);
    if (firsts.length) {
      const labels = [...new Set(firsts.flatMap((b) => b.steps.map((st) => st.label)))];
      L.push(`<details><summary>Per step (rep 1): requests · prompt tokens · peak</summary>`, "");
      L.push(`| Step | ${firsts.map((b) => armLabel(b.arm)).join(" | ")} |`, `|---|${firsts.map(() => "---:").join("|")}|`);
      for (const lb of labels) {
        L.push(`| ${lb} | ${firsts.map((b) => {
          const st = b.steps.find((x) => x.label === lb);
          return st ? `${st.requests} · ${fmt(st.prompt)} · ${fmt(st.peak)}${st.error ? " ✗" : ""}` : "–";
        }).join(" | ")} |`);
      }
      L.push("", "</details>", "");
    }
  }

  L.push(`## Capture checks`, "");
  L.push("Harness-reported tokens vs tokens seen on the wire. The wire can be higher (side requests the harness does not report); it should never be lower. A lower wire count means requests bypassed the proxy.", "");
  L.push(`| Block | Reported | Wire | Models on the wire |`, `|---|---:|---:|---|`);
  for (const b of good) {
    L.push(`| ${blockKey(b.arm, b.scenario, b.rep)} | ${fmt(b.reportedVsWire?.reported)} | ${fmt(b.reportedVsWire?.wire ?? b.promptTokens + b.outputTokens)} | ${Object.entries(b.models).map(([k, v]) => `${k}×${v}`).join(", ")} |`);
  }
  L.push("");
  const probeErr = good.find((b) => b.overhead?.error);
  if (probeErr) L.push(`count_tokens probe failed: ${probeErr.overhead!.error}`, "");

  if (failed.length) {
    L.push(`## Errors`, "");
    for (const b of failed) {
      L.push(`- \`${blockKey(b.arm, b.scenario, b.rep)}\`: ${b.error ?? b.steps.filter((s) => s.error).map((s) => `${s.label}: ${s.error}`).join("; ")}`);
    }
    L.push("");
  }
  L.push(`## Method`, "", "See `docs/benchmark.md`. Limit units = API-price-weighted tokens expressed as input tokens of the benchmark model (cache reads, cache writes and output weighted by their price ratios). Fixed context = count_tokens(system + tools) on the first request of each arm.", "");
  writeFileSync(join(runDir, "summary.json"), JSON.stringify({ meta, blocks, utilKeys }, null, 2));
  return L.join("\n");
}
