// Sayfern vs Claude Code benchmark. See docs/benchmark.md.
//
//   npm run bench -- doctor                       check setup (no model calls)
//   npm run bench -- run [options]                run scenarios, then write the report
//   npm run bench -- report [run-id]              rebuild report.md from saved captures
//   npm run bench -- judge [run-id] [--all]       grade missing verdicts in a run (--all: re-grade everything)
//   npm run bench -- snapshot-private [options]   copy your real wiki/Anki/reader into fixtures/private
//   npm run bench -- list                         scenarios and arms
//   npm run bench -- selftest                     offline check of the benchmark itself
//
// run options: --scenario a,b  --arms sayfern,claude-code  --reps N  --fixtures name
//              --model id  --judge  --config file  --upstream url  --no-bodies
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name === "ExperimentalWarning" && /SQLite/i.test(w.message)) return;
  console.warn(`${w.name}: ${w.message}`);
});

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readCollection } from "./lib/anki";
import type { Arm } from "./lib/arms/arm";
import { applyRewrites, ClaudeCodeArm } from "./lib/arms/claude-code";
import { SayfernArm } from "./lib/arms/sayfern";
import { BENCH_DIR, expandPath, loadConfig, type ArmConfig, type BenchConfig } from "./lib/config";
import { copyTree, materialize } from "./lib/fixtures";
import { judgeBlock, judgeItems, missingVerdicts, type JudgeResult } from "./lib/judge";
import { RecordingProxy } from "./lib/proxy";
import { renderReport } from "./lib/report";
import type { BlockResult } from "./lib/runner";
import { runAll } from "./lib/runner";
import { loadScenarios } from "./lib/scenarios";

function flags(argv: string[]): { pos: string[]; opt: Record<string, string | true> } {
  const pos: string[] = [];
  const opt: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) opt[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) opt[k] = argv[++i];
      else opt[k] = true;
    } else pos.push(a);
  }
  return { pos, opt };
}

const list = (v: string | true | undefined) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

function makeArm(c: ArmConfig): Arm {
  return c.kind === "sayfern" ? new SayfernArm(c) : new ClaudeCodeArm(c);
}

function resultsRoot(cfg: BenchConfig): string {
  return expandPath(cfg.resultsDir);
}

function resolveRun(cfg: BenchConfig, id?: string): string {
  const root = resultsRoot(cfg);
  if (id && id !== "latest") {
    const dir = existsSync(id) ? id : join(root, id);
    if (!existsSync(join(dir, "meta.json"))) throw new Error(`No run at ${dir}`);
    return dir;
  }
  const runs = existsSync(root) ? readdirSync(root).filter((d) => existsSync(join(root, d, "meta.json"))).sort() : [];
  if (!runs.length) throw new Error(`No runs in ${root}`);
  return join(root, runs[runs.length - 1]);
}

function writeReport(cfg: BenchConfig, runDir: string): string {
  const meta = JSON.parse(readFileSync(join(runDir, "meta.json"), "utf8")) as Record<string, unknown>;
  const scenarios = loadScenarios(meta.scenarios as string[]);
  const md = renderReport(cfg, runDir, scenarios, meta);
  writeFileSync(join(runDir, "report.md"), md);
  return join(runDir, "report.md");
}

/** Judge every block, or with `all` false, only blocks whose saved verdicts are missing or incomplete. */
async function judgeRun(cfg: BenchConfig, runDir: string, all = true): Promise<void> {
  const meta = JSON.parse(readFileSync(join(runDir, "meta.json"), "utf8")) as { scenarios: string[] };
  const scenarios = loadScenarios(meta.scenarios);
  const file = join(runDir, "judge.json");
  const prev: JudgeResult[] = !all && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  const out: JudgeResult[] = [];
  for (const d of readdirSync(join(runDir, "blocks")).sort()) {
    const f = join(runDir, "blocks", d, "block.json");
    if (!existsSync(f)) continue;
    const block = JSON.parse(readFileSync(f, "utf8")) as BlockResult;
    const scenario = scenarios.find((s) => s.id === block.scenario);
    if (!scenario || block.skipped) continue;
    const old = prev.find((p) => p.block === `${block.arm}__${block.scenario}__rep${block.rep}`);
    if (old && !old.error && !missingVerdicts(judgeItems(block, scenario), old.items).length) {
      console.log(`judging ${d} … kept (${old.items.length} items)`);
      out.push(old);
      continue;
    }
    process.stdout.write(`judging ${d} … `);
    const r = await judgeBlock(cfg, block, scenario);
    console.log(r.missing?.length ? `✗ ${r.missing.length} item(s) still ungraded${r.error ? `: ${r.error.slice(0, 120)}` : ""}` : `${r.items.length} items`);
    out.push(r);
  }
  writeFileSync(file, JSON.stringify(out, null, 2));
}

async function run(cfg: BenchConfig, opt: Record<string, string | true>): Promise<void> {
  if (typeof opt.model === "string") cfg.model = opt.model;
  if (typeof opt.fixtures === "string") cfg.fixtures = opt.fixtures;
  if (typeof opt.upstream === "string") cfg.upstream = opt.upstream;
  if (opt["no-bodies"]) cfg.saveBodies = false;
  const reps = typeof opt.reps === "string" ? Math.max(1, parseInt(opt.reps, 10)) : cfg.reps;
  const armIds = list(opt.arms);
  const armCfgs = cfg.arms.filter((a) => a.enabled !== false && (!armIds || armIds.includes(a.id)));
  if (!armCfgs.length) throw new Error("No arms selected.");
  const arms = armCfgs.map(makeArm);
  const scenarios = loadScenarios(list(opt.scenario));
  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = join(resultsRoot(cfg), runId);
  mkdirSync(runDir, { recursive: true });
  const proxy = new RecordingProxy({
    upstream: cfg.upstream,
    logFile: join(runDir, "wire.jsonl"),
    ...(cfg.saveBodies ? { bodiesDir: join(runDir, "bodies") } : {}),
    probe: cfg.probeOverhead,
  });
  await proxy.start();
  const log = (m: string) => {
    console.log(m);
    writeFileSync(join(runDir, "run.log"), m.replace(/\x1b\[[0-9;]*m/g, "") + "\n", { flag: "a" }); // no colour codes in the file
  };
  log(`run ${runId} → ${runDir}`);
  log(`proxy ${proxy.url} → ${cfg.upstream} · model ${cfg.model} · ${reps} rep(s) · scenarios ${scenarios.map((s) => s.id).join(", ")}`);
  const meta: Record<string, unknown> = {
    runId,
    startedAt: new Date().toISOString(),
    model: cfg.model,
    fixtures: cfg.fixtures,
    reps,
    upstream: cfg.upstream,
    scenarios: scenarios.map((s) => s.id),
    ...(scenarios.some((s) => s.sessions.some((x) => x.learner)) ? { learnerModel: cfg.learner.model } : {}),
    arms: [] as unknown[],
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  };
  writeFileSync(join(runDir, "meta.json"), JSON.stringify(meta, null, 2));
  try {
    await runAll({ config: cfg, runId, runDir, arms, scenarios, reps, proxy, log });
  } finally {
    await proxy.stop();
  }
  meta.arms = await Promise.all(arms.map(async (a) => ({ id: a.id, label: a.label, version: await a.version().catch((e) => String(e)) })));
  meta.endedAt = new Date().toISOString();
  writeFileSync(join(runDir, "meta.json"), JSON.stringify(meta, null, 2));
  if (opt.judge || cfg.judge.enabled) await judgeRun(cfg, runDir);
  log(`report: ${writeReport(cfg, runDir)}`);
}

async function doctor(cfg: BenchConfig): Promise<void> {
  let bad = 0;
  const ok = (m: string) => console.log(`✓ ${m}`);
  const no = (m: string) => {
    bad++;
    console.log(`✗ ${m}`);
  };
  const warn = (m: string) => console.log(`! ${m}`);
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj > 22 || (maj === 22 && min >= 13)) ok(`node ${process.version} (node:sqlite available)`);
  else no(`node ${process.version}: need ≥ 22.13 for node:sqlite`);
  const tmp = join(resultsRoot(cfg), ".doctor");
  rmSync(tmp, { recursive: true, force: true }); // a sandbox left by the last doctor run already has a collection
  const sandbox = await materialize(cfg.fixtures, join(tmp, "sandbox"));
  const coll = await readCollection(sandbox.collection);
  ok(`fixtures "${cfg.fixtures}": ${coll.cards.length} cards, ${coll.revlog.length} reviews, deck "${sandbox.deck}"`);
  for (const a of cfg.arms.filter((x) => x.enabled !== false)) {
    if (a.kind === "sayfern") {
      const cred = expandPath(a.credentials);
      if (existsSync(cred) && readFileSync(cred, "utf8").includes(a.provider ?? "anthropic")) ok(`${a.id}: credentials at ${cred}`);
      else no(`${a.id}: no ${a.provider ?? "anthropic"} credentials at ${cred}. Run: npm run smoke -- login ${a.provider ?? "anthropic"}`);
    } else {
      const v = spawnSync(a.command, ["--version"], { encoding: "utf8" });
      if (v.status === 0) ok(`${a.id}: ${a.command} ${v.stdout.trim()}`);
      else no(`${a.id}: cannot run "${a.command} --version"`);
      const skill = expandPath(a.skill);
      if (!existsSync(join(skill, "SKILL.md"))) no(`${a.id}: skill not found at ${skill}`);
      else {
        const probe = join(tmp, "skill", basename(skill));
        copyTree(skill, probe, sandbox.root);
        const hits = applyRewrites(probe, a.rewrites, sandbox.root);
        a.rewrites.forEach((r, i) => (hits[i] ? ok(`${a.id}: rewrite "${r.from.slice(0, 40)}" ×${hits[i]}`) : warn(`${a.id}: rewrite "${r.from}" matched nothing (skill changed?)`)));
        const script = join(probe, "scripts", "anki_snapshot.py");
        if (existsSync(script)) {
          const r = spawnSync("python3", [script, "--collection", sandbox.collection, "--deck", sandbox.deck], { encoding: "utf8" });
          if (r.status === 0) {
            const j = JSON.parse(r.stdout) as { struggling_30d?: { word: string }[] };
            ok(`${a.id}: skill's anki_snapshot.py reads the fixture collection (struggling: ${(j.struggling_30d ?? []).slice(0, 5).map((w) => w.word).join(" ")})`);
          } else no(`${a.id}: anki_snapshot.py failed on the fixture collection: ${r.stderr.slice(0, 300)}`);
        }
      }
      const token = !!(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
      if (a.isolation === "clean" && !token) no(`${a.id}: isolation "clean" needs CLAUDE_CODE_OAUTH_TOKEN (claude setup-token)`);
      else ok(`${a.id}: isolation ${a.isolation === "auto" ? (token ? "clean (token found)" : "user (~/.claude; set CLAUDE_CODE_OAUTH_TOKEN for a clean profile)") : a.isolation}`);
    }
  }
  console.log(bad ? `\n${bad} problem(s).` : "\nReady. Try: npm run bench -- run --scenario zh-anki-grounding --reps 1");
  if (bad) process.exitCode = 1;
}

/** Copies the real sources the skill reads into fixtures/private (gitignored). */
async function snapshotPrivate(cfg: BenchConfig, opt: Record<string, string | true>): Promise<void> {
  const note = expandPath(typeof opt.note === "string" ? opt.note : "~/Obsidian/Imagineer/_wiki/context/mandarin-thinking-practice.md");
  const wikiRoot = expandPath(typeof opt.wiki === "string" ? opt.wiki : "~/Obsidian/Imagineer/_wiki");
  const text = readFileSync(note, "utf8");
  const front = (k: string) => text.match(new RegExp(`^${k}:\\s*(?:>-\\s*\\n\\s*)?(.+)$`, "m"))?.[1]?.trim();
  const out = join(BENCH_DIR, "fixtures", typeof opt.name === "string" ? opt.name : "private");
  const collection = expandPath(typeof opt.collection === "string" ? opt.collection : (front("anki_collection") ?? ""));
  const deck = typeof opt.deck === "string" ? opt.deck : (front("anki_deck") ?? "");
  const reader = typeof opt.reader === "string" ? expandPath(opt.reader) : front("reader_pdf");
  const grammar = front("grammar_notes");
  const deckJson = front("deck_json");
  mkdirSync(join(out, "anki"), { recursive: true });
  const rel = (p: string) => (p.startsWith(wikiRoot) ? join("wiki", p.slice(wikiRoot.length)) : null);
  const copyInto = (src: string) => {
    const r = rel(src);
    if (!r) throw new Error(`${src} is outside the wiki root ${wikiRoot}`);
    mkdirSync(join(out, r, ".."), { recursive: true });
    cpSync(src, join(out, r), { recursive: true, filter: (s) => !/\/\.[^/]+$/.test(s) || s === src });
    return r;
  };
  let noteText = text.replaceAll(wikiRoot, "{{ROOT}}/wiki");
  copyInto(note);
  if (grammar && existsSync(grammar)) copyInto(grammar.replace(/\/$/, ""));
  if (deckJson && existsSync(deckJson)) copyInto(deckJson);
  let readerRel: string | undefined;
  if (reader && existsSync(reader)) {
    mkdirSync(join(out, "reader"), { recursive: true });
    readerRel = join("reader", basename(reader));
    cpSync(reader, join(out, readerRel));
    noteText = noteText.replaceAll(reader, `{{ROOT}}/${readerRel}`);
  } else if (reader) console.log(`! reader not found: ${reader}`);
  if (!existsSync(collection)) throw new Error(`Anki collection not found: ${collection}`);
  cpSync(collection, join(out, "anki", "collection.anki2"));
  for (const ext of ["-wal", "-shm"]) if (existsSync(collection + ext)) cpSync(collection + ext, join(out, "anki", "collection.anki2" + ext));
  noteText = noteText.replaceAll(collection, "{{ROOT}}/anki/collection.anki2");
  writeFileSync(join(out, rel(note)!), noteText);
  const coll = await readCollection(join(out, "anki", "collection.anki2"));
  const fields = coll.cards.find((c) => c.deckName === deck || c.deckName.startsWith(`${deck}::`))?.fieldOrder ?? [];
  const pick = (re: RegExp) => fields.find((f) => re.test(f));
  const synthetic = JSON.parse(readFileSync(join(BENCH_DIR, "fixtures", "synthetic", "manifest.json"), "utf8"));
  const manifest = {
    $comment: "PRIVATE snapshot of your real data. Gitignored. Review profile, selfLevel and sayfernSeed so Sayfern starts from the same history as your wiki note.",
    language: "zh",
    tree: ["wiki", ...(readerRel ? ["reader"] : [])],
    anki: { collection: "anki/collection.anki2", deck, wordField: fields[0] ?? "", readingField: pick(/pinyin|reading/i), meaningField: pick(/meaning|definition|english|gloss/i) },
    ...(readerRel ? { reader: { path: readerRel, kind: "reader", ...(typeof opt["resume-at"] === "string" ? { resumeAt: opt["resume-at"] } : {}) } } : {}),
    profile: synthetic.profile,
    selfLevel: synthetic.selfLevel,
    sayfernSeed: synthetic.sayfernSeed,
    gold: { struggling: [] },
  };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`✓ snapshot in ${out}: ${coll.cards.length} cards, fields ${fields.join(", ")}`);
  if (!manifest.reader || !("resumeAt" in manifest.reader)) console.log("! pass --resume-at \"<text of the checkpoint paragraph>\" so Sayfern starts reading at the same place");
  console.log(`Run with: npm run bench -- run --fixtures ${basename(out)}`);
}

async function main(): Promise<void> {
  const { pos, opt } = flags(process.argv.slice(2));
  const cfg = loadConfig(typeof opt.config === "string" ? opt.config : undefined);
  switch (pos[0]) {
    case "run":
      return run(cfg, opt);
    case "report":
      console.log(writeReport(cfg, resolveRun(cfg, pos[1])));
      return;
    case "judge": {
      const dir = resolveRun(cfg, pos[1]);
      // Re-judges only blocks with missing or failed verdicts; --all re-judges everything.
      await judgeRun(cfg, dir, opt.all === true);
      console.log(writeReport(cfg, dir));
      return;
    }
    case "doctor":
      return doctor(cfg);
    case "snapshot-private":
      return snapshotPrivate(cfg, opt);
    case "selftest": {
      const { selftest } = await import("./test/selftest");
      return selftest(cfg);
    }
    case "list": {
      for (const s of loadScenarios()) console.log(`${s.id.padEnd(22)} ${s.title}`);
      console.log("");
      for (const a of cfg.arms) console.log(`${a.id.padEnd(22)} ${a.kind}${a.enabled === false ? " (disabled)" : ""}`);
      return;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 12).filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  }
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
