// Feature tests (S2-12). test.js and anything it imports are untrusted, unapproved code, so they never
// run in the app process. Two runners share one harness (test(), assert, console, a fake SDK with fixed
// sample data) and one result format; counts are always computed here, never reported by the model.
//
// - In the app, Electron main injects a runner (src/main/features.ts) that loads the feature's test page
//   (testPageHtml/testRunScript below, served by sayfern-feature://<id>/v<n>/_test/) in a hidden,
//   sandboxed BrowserWindow on its own locked-down session: the same boundary as the feature's UI.
// - runTestsInChildProcess is the plain-Node fallback for unit tests, smoke and dev: a child process under
//   Node's permission model (no file system, child process, worker or addon access), killed on timeout.
//   Node's permission model does NOT restrict the network, so this fallback is not a production sandbox.
import { spawn } from "node:child_process";
import type { FeatureTestResult } from "../../shared/stage2";
import type { Language } from "../../shared/records";

export interface TestSeed {
  language: Language;
  anki: { word: string; reading?: string; meaning?: string; status: string; struggle: number }[];
  grammar: { id: string; pattern: string; name: string; level?: string; state: string }[];
  saved: { word: string; reading?: string; definition?: string; sentence: string }[];
}

export interface FeatureTestRunInput {
  featureId: string;
  version: number;
  /** Every file of the version (path → text). */
  files: ReadonlyMap<string, string>;
  seed: TestSeed;
  /** The version's test page (sayfern-feature://<id>/v<n>/_test/index.html), for runners that load it. */
  url: string;
  timeoutMs: number;
  now(): number;
}

/** Runs test.js somewhere sandboxed and returns counts. Must not throw. */
export type FeatureTestRunner = (input: FeatureTestRunInput) => Promise<FeatureTestResult>;

const MAX_OUTPUT = 6000;

/** The fixed data tests run against (no real learner data leaves the records). */
export function defaultSeed(language: Language): TestSeed {
  if (language === "ja") {
    return {
      language,
      anki: [
        { word: "本", reading: "ほん", meaning: "book", status: "known", struggle: 0.05 },
        { word: "猫", reading: "ねこ", meaning: "cat", status: "known", struggle: 0.1 },
        { word: "紙", reading: "かみ", meaning: "paper", status: "learning", struggle: 0.3 },
        { word: "車", reading: "くるま", meaning: "car", status: "known", struggle: 0.08 },
        { word: "鉛筆", reading: "えんぴつ", meaning: "pencil", status: "learning", struggle: 0.42 },
        { word: "予定", reading: "よてい", meaning: "plan", status: "known", struggle: 0.52 },
        { word: "景色", reading: "けしき", meaning: "scenery", status: "new", struggle: 0 },
        { word: "傘", reading: "かさ", meaning: "umbrella", status: "learning", struggle: 0.36 },
      ],
      grammar: [
        { id: "ja:te-iru", pattern: "〜ている", name: "ongoing action or state", level: "N5", state: "independent" },
        { id: "ja:tara", pattern: "〜たら", name: "if / when", level: "N4", state: "with_help" },
        { id: "ja:noni", pattern: "〜のに", name: "even though", level: "N3", state: "introduced" },
      ],
      saved: [{ word: "行列", reading: "ぎょうれつ", definition: "queue", sentence: "店の前に行列ができている。" }],
    };
  }
  return {
    language: "zh",
    anki: [
      { word: "书", reading: "shū", meaning: "book", status: "known", struggle: 0.05 },
      { word: "桌子", reading: "zhuōzi", meaning: "table", status: "known", struggle: 0.12 },
      { word: "狗", reading: "gǒu", meaning: "dog", status: "known", struggle: 0.08 },
      { word: "衣服", reading: "yīfu", meaning: "clothes", status: "learning", struggle: 0.31 },
      { word: "鱼", reading: "yú", meaning: "fish", status: "learning", struggle: 0.27 },
      { word: "自行车", reading: "zìxíngchē", meaning: "bicycle", status: "learning", struggle: 0.44 },
      { word: "照片", reading: "zhàopiàn", meaning: "photo", status: "known", struggle: 0.15 },
      { word: "雨伞", reading: "yǔsǎn", meaning: "umbrella", status: "new", struggle: 0 },
      { word: "咖啡", reading: "kāfēi", meaning: "coffee", status: "known", struggle: 0.02 },
      { word: "打算", reading: "dǎsuàn", meaning: "to plan", status: "known", struggle: 0.48 },
      { word: "虽然", reading: "suīrán", meaning: "although", status: "learning", struggle: 0.39 },
      { word: "电脑", reading: "diànnǎo", meaning: "computer", status: "known", struggle: 0.06 },
    ],
    grammar: [
      { id: "zh:chule-hai", pattern: "除了…还…", name: "besides A, also B", level: "HSK 3", state: "with_help" },
      { id: "zh:ba", pattern: "把", name: "disposal construction", level: "HSK 3", state: "introduced" },
      { id: "zh:time-before-verb", pattern: "Subj + time + V", name: "time before verb", level: "HSK 1", state: "independent" },
    ],
    saved: [{ word: "排队", reading: "páiduì", definition: "to queue", sentence: "门口有很多人在排队。" }],
  };
}

// Runs inside the vm context: test(), assert, console and the fake SDK. Only JSON crosses the boundary.
const HARNESS = String.raw`
(function (seed) {
  "use strict";
  var tests = [];
  var logs = [];
  function fmt(v) {
    if (typeof v === "string") return v;
    try { var s = JSON.stringify(v); return s === undefined ? String(v) : s; } catch (e) { return String(v); }
  }
  function log() { logs.push(Array.prototype.map.call(arguments, fmt).join(" ")); }
  globalThis.console = Object.freeze({ log: log, info: log, warn: log, error: log, debug: log });
  globalThis.test = function (name, fn) {
    if (typeof fn !== "function") throw new Error("test(name, fn) needs a function");
    tests.push({ name: String(name), fn: fn });
  };
  function fail(msg) { var e = new Error(msg); e.name = "AssertionError"; throw e; }
  function deepEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) if (!Object.prototype.hasOwnProperty.call(b, ka[i]) || !deepEqual(a[ka[i]], b[ka[i]])) return false;
    return true;
  }
  function assert(v, msg) { if (!v) fail(msg || "Expected a truthy value, got " + fmt(v)); }
  assert.ok = assert;
  assert.equal = function (a, b, msg) { if (!Object.is(a, b)) fail(msg || "Expected " + fmt(b) + ", got " + fmt(a)); };
  assert.notEqual = function (a, b, msg) { if (Object.is(a, b)) fail(msg || "Expected something other than " + fmt(b)); };
  assert.deepEqual = function (a, b, msg) { if (!deepEqual(a, b)) fail(msg || "Expected " + fmt(b) + ", got " + fmt(a)); };
  assert.throws = function (fn, msg) { try { fn(); } catch (e) { return; } fail(msg || "Expected the function to throw"); };
  assert.rejects = async function (fn, msg) { try { await fn(); } catch (e) { return; } fail(msg || "Expected the promise to reject"); };
  assert.fail = function (msg) { fail(msg || "Failed"); };
  globalThis.assert = Object.freeze(assert);

  var storage = {};
  var results = [];
  var clone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
  globalThis.sayfern = Object.freeze({
    version: 1,
    context: async function () { return { featureId: "test", version: 1, language: seed.language, preview: true }; },
    anki: Object.freeze({
      words: async function (filter) {
        filter = filter || {};
        var list = seed.anki.slice();
        if (filter.status === "struggling") list = list.filter(function (w) { return w.struggle >= 0.3; }).sort(function (a, b) { return b.struggle - a.struggle; });
        else if (filter.status && filter.status !== "all") list = list.filter(function (w) { return w.status === filter.status; });
        if (filter.search) list = list.filter(function (w) { return (w.word + " " + (w.reading || "") + " " + (w.meaning || "")).indexOf(filter.search) >= 0; });
        var limit = Math.min(Math.max(1, filter.limit || 50), 200);
        var items = list.slice(0, limit).map(function (w) { return Object.assign({ mature: w.status === "known", lapses: Math.round(w.struggle * 6) }, w); });
        return clone({ total: list.length, items: items, syncedAt: 1 });
      }
    }),
    grammar: Object.freeze({ list: async function () { return clone(seed.grammar.map(function (g) { return Object.assign({ explanation: g.name, examples: [], rate: null }, g); })); } }),
    words: Object.freeze({ saved: async function () { return clone(seed.saved.map(function (w) { return Object.assign({ savedAt: 1 }, w); })); } }),
    lookup: async function (word) {
      var w = seed.anki.find(function (x) { return x.word === word; });
      return { query: word, entries: w ? [{ headword: w.word, reading: w.reading || "", senses: [{ glosses: [w.meaning || ""] }] }] : [] };
    },
    annotate: async function (text) {
      return Array.from(String(text)).map(function (ch, i) { return { text: ch, start: i, end: i + 1, isWord: /\p{L}/u.test(ch) }; });
    },
    storage: Object.freeze({
      get: async function (key) { return Object.prototype.hasOwnProperty.call(storage, key) ? clone(storage[key]) : null; },
      set: async function (key, value) { storage[key] = clone(value); return true; }
    }),
    results: Object.freeze({
      record: async function (r) { results.push(clone(r)); return true; },
      list: async function () { return clone(results); }
    })
  });

  globalThis.__sayfernRun = async function () {
    var lines = [], passed = 0, failed = 0;
    for (var i = 0; i < tests.length; i++) {
      var t = tests[i];
      try { await t.fn(); passed++; lines.push("ok   " + t.name); }
      catch (e) { failed++; lines.push("FAIL " + t.name + ": " + (e && e.message ? e.message : fmt(e))); }
    }
    return JSON.stringify({ passed: passed, failed: failed, total: tests.length, lines: lines, logs: logs });
  };
})(__SEED__);
`;

/** The harness for one seed (a classic script: test(), assert, console capture, fake sayfern). */
export function testHarnessScript(seed: TestSeed): string {
  return HARNESS.replace("__SEED__", () => JSON.stringify(seed));
}

/** The test page served at sayfern-feature://<id>/v<n>/_test/index.html. */
export function testPageHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Feature tests</title>
    <script src="./harness.js"></script>
    <script type="module" src="./run.js"></script>
  </head>
  <body></body>
</html>
`;
}

/** Imports ../test.js, runs the registered tests, leaves the JSON result in window.__sayfernResult. */
export function testRunScript(): string {
  return `const report = (o) => { window.__sayfernResult = JSON.stringify(o); };
window.addEventListener("error", (e) => { if (!window.__sayfernResult) report({ error: "Uncaught error: " + (e.message || "unknown") }); });
try {
  await import("../test.js");
  window.__sayfernResult = await window.__sayfernRun();
} catch (err) {
  report({ error: "test.js failed to load: " + (err && err.message ? err.message : String(err)) });
}
`;
}

/** Turns a runner's raw JSON ({ passed, failed, lines, logs } or { error }) into a FeatureTestResult. */
export function parseTestOutput(raw: unknown, durationMs: number): FeatureTestResult {
  const failed = (error: string, output = ""): FeatureTestResult => ({ passed: 0, failed: 0, total: 0, ok: false, output, error, durationMs });
  let r: { passed?: unknown; failed?: unknown; lines?: unknown; logs?: unknown; error?: unknown };
  try {
    r = JSON.parse(String(raw));
  } catch {
    return failed("The test runner sent an unreadable result.");
  }
  if (!r || typeof r !== "object") return failed("The test runner sent an unreadable result.");
  if (typeof r.error === "string") return failed(r.error.slice(0, 500));
  const lines = Array.isArray(r.lines) ? r.lines.map(String) : [];
  const logs = Array.isArray(r.logs) ? r.logs.map(String) : [];
  // Count from the per-test lines, not from numbers the page could fake.
  const passed = lines.filter((l) => l.startsWith("ok   ")).length;
  const failedCount = lines.filter((l) => l.startsWith("FAIL ")).length;
  const total = passed + failedCount;
  const output = trimOutput([...lines, ...(logs.length ? ["", "console:", ...logs.slice(0, 50)] : [])].join("\n"));
  if (total === 0) return failed("test.js registered no tests. Call test(name, fn).", output);
  return { passed, failed: failedCount, total, ok: failedCount === 0, output, durationMs };
}

// The child process body (CommonJS via -e). Reads { files, entry, harness } from stdin, prints the result JSON.
// The vm context only keeps the harness and the feature apart; the boundary is the permission model.
const CHILD = String.raw`
const vm = require("node:vm");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", async () => {
  const out = (s) => process.stdout.write("\n@@SAYFERN_RESULT@@" + s + "\n", () => process.exit(0));
  try {
    const { files, entry, harness } = JSON.parse(input);
    const ctx = vm.createContext(Object.create(null), { name: "sayfern-feature-test", codeGeneration: { strings: false, wasm: false } });
    vm.runInContext(harness, ctx, { filename: "sayfern-test-harness.js" });
    const cache = new Map();
    const resolveRel = (from, spec) => {
      if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
      const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")).split("/") : [];
      for (const s of spec.split("/")) {
        if (s === "" || s === ".") continue;
        if (s === "..") { if (!dir.length) return null; dir.pop(); } else dir.push(s);
      }
      return dir.join("/");
    };
    const load = (path) => {
      if (cache.has(path)) return cache.get(path);
      if (!/\.m?js$/.test(path) || typeof files[path] !== "string") throw new Error("No such module in the feature: " + path);
      const m = new vm.SourceTextModule(files[path], { context: ctx, identifier: path });
      cache.set(path, m);
      return m;
    };
    if (typeof files[entry] !== "string") throw new Error(entry + " doesn't exist. Write tests in " + entry + ".");
    const root = load(entry);
    await root.link((spec, ref) => {
      const target = resolveRel(ref.identifier, spec);
      if (!target) throw new Error("Only relative imports of the feature's own files work in tests (" + ref.identifier + " imports " + JSON.stringify(spec) + ").");
      return load(target);
    });
    await root.evaluate();
    out(String(await vm.runInContext("__sayfernRun()", ctx)));
  } catch (err) {
    out(JSON.stringify({ error: (err && err.message) ? err.message : String(err) }));
  }
});
`;

const RESULT_MARK = "\n@@SAYFERN_RESULT@@";

function trimOutput(s: string): string {
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n… (output trimmed)` : s;
}

/**
 * Plain-Node fallback (tests, smoke, dev): a child process under Node's permission model with no grants,
 * so test code that escapes the vm context still can't touch files, spawn processes or start workers.
 * The network is NOT restricted by Node's permission model: never use this runner in the app.
 */
export function runTestsInChildProcess(input: Pick<FeatureTestRunInput, "files" | "seed" | "timeoutMs" | "now"> & { entry?: string }): Promise<FeatureTestResult> {
  const started = input.now();
  const elapsed = () => input.now() - started;
  const payload = JSON.stringify({ files: Object.fromEntries(input.files), entry: input.entry ?? "test.js", harness: testHarnessScript(input.seed) });
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const done = (r: FeatureTestResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve(r);
    };
    const env: NodeJS.ProcessEnv = { NODE_OPTIONS: "" };
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
    const child = spawn(
      process.execPath,
      ["--permission", "--experimental-vm-modules", "--no-warnings", "--max-old-space-size=64", "-e", CHILD],
      { stdio: ["pipe", "pipe", "pipe"], env, windowsHide: true },
    );
    const timer = setTimeout(
      () => done({ passed: 0, failed: 0, total: 0, ok: false, output: "", error: `Tests timed out after ${Math.max(1, Math.round(input.timeoutMs / 1000))} s.`, durationMs: elapsed() }),
      input.timeoutMs,
    );
    child.stdout.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
      if (stdout.length > 2_000_000) done({ passed: 0, failed: 0, total: 0, ok: false, output: "", error: "Tests printed too much output.", durationMs: elapsed() });
    });
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr = (stderr + d).slice(-4000)));
    child.on("error", (err) => done({ passed: 0, failed: 0, total: 0, ok: false, output: "", error: `Couldn't start the test runner: ${err.message}`, durationMs: elapsed() }));
    child.on("close", (code) => {
      const at = stdout.lastIndexOf(RESULT_MARK);
      if (at >= 0) return done(parseTestOutput(stdout.slice(at + RESULT_MARK.length).trim(), elapsed()));
      const why = /heap|memory/i.test(stderr) ? "Tests ran out of memory." : `The test runner stopped (exit code ${code}).`;
      done({ passed: 0, failed: 0, total: 0, ok: false, output: trimOutput(stderr.trim()), error: why, durationMs: elapsed() });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(payload);
  });
}
