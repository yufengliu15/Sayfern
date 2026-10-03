// Feature builder end to end: the agent loop with pi-ai's faux provider, versions, approvals, the
// extension host's review gate, sayfern-feature:// resolution, the sandbox RPC and the test runner.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type AssistantMessage } from "@earendil-works/pi-ai";
import type { BuilderEvent } from "../../shared/stage2";
import type { ModelRef } from "../../shared/types";
import { FakeAnki } from "../agent/testkit";
import { SayfernApp } from "../app";
import { FileCredentialStore } from "../credential-file-store";
import { FileExtensionHost, hashDir, readDirFiles } from "../extensions";
import { DefaultLanguageService } from "../lang";
import { JsonRecordsStore } from "../records";
import { FeatureRpc } from "./rpc";
import { checkMainSideCode, fullAccessFiles } from "./manifest";
import { defaultSeed, runTestsInChildProcess, type FeatureTestRunInput } from "./runner";
import { FeatureStore } from "./store";

const EXAMPLES = resolve(import.meta.dirname, "../../../examples/extensions");
const DRILL = join(EXAMPLES, "measure-word-drill");
const CHENGYU = join(EXAMPLES, "chengyu-of-the-day");

async function exampleFiles(dir: string): Promise<[string, string][]> {
  return (await readDirFiles(dir)).map(([p, b]) => [p, b.toString("utf8")]);
}

async function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "sayfern-builder-"));
  const credentials = new FileCredentialStore(join(dir, "credentials.json"));
  const models = createModels({ credentials });
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  const events: BuilderEvent[] = [];
  const offline = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  const app = new SayfernApp({
    dataDir: dir,
    models,
    credentials,
    fetch: offline,
    now: () => 1_790_000_000_000,
    emit: (channel, payload) => {
      if (channel === "builder") events.push(payload as BuilderEvent);
    },
    extensionLog: () => undefined,
  });
  await app.init();
  const m = faux.getModel();
  const ref: ModelRef = { provider: m.provider, id: m.id };
  return { dir, app, faux, ref, events };
}

const call = (name: string, args: Record<string, unknown> = {}) => fauxToolCall(name, args as never);
const step = (...calls: ReturnType<typeof call>[]): AssistantMessage => fauxAssistantMessage(calls, { stopReason: "toolUse" });

/** A scripted builder run that writes `files`, runs the tests and finishes. */
function script(files: [string, string][], opts: { name: string; text?: string }): AssistantMessage[] {
  return [
    fauxAssistantMessage([fauxText(opts.text ?? "I'll read the guide and an example first."), call("list_kit")], { stopReason: "toolUse" }),
    step(call("read_kit_file", { path: "docs/feature-builder.md" }), call("read_kit_file", { path: "examples/extensions/measure-word-drill/ui/drill.js" })),
    step(...files.map(([path, content]) => call("write_feature_file", { path, content }))),
    step(call("run_tests")),
    step(call("finish", { summary: "A measure-word drill in your sidebar and on Today.", name: opts.name, description: "Pick the right measure word." })),
  ];
}

test("build: reads the kit, writes files, runs tests, finishes; v1 is a sealed draft with code-counted tests", async () => {
  const { app, faux, ref, events } = await makeApp();
  faux.setResponses(script(await exampleFiles(DRILL), { name: "Measure-word drill" }));
  const { buildId, featureId } = await app.buildFeature({ prompt: "Add a measure-word drill. Use nouns from my Anki.", language: "zh" }, ref);
  assert.match(featureId, /^f-[a-z0-9]{8}$/);
  assert.equal((await app.getFeature(featureId))?.status, "building");
  await app.builder.whenIdle();

  const f = (await app.getFeature(featureId))!;
  assert.equal(f.status, "preview");
  assert.equal(f.name, "Measure-word drill");
  assert.equal(f.draft, 1);
  assert.equal(f.enabled, false);
  const v = f.versions[0];
  assert.equal(v.state, "ready");
  assert.equal(v.fullAccess, false);
  assert.match(v.hash ?? "", /^[0-9a-f]{64}$/);
  assert.deepEqual(v.surfaces.map((s) => s.kind), ["tab", "activity"]);
  assert.deepEqual({ passed: v.tests?.passed, total: v.tests?.total, ok: v.tests?.ok }, { passed: 12, total: 12, ok: true });

  const turn = f.turns[0];
  assert.equal(turn.status, "done");
  assert.match(turn.text, /read the guide/);
  const titles = Object.fromEntries(turn.steps.map((s) => [s.id, `${s.title}${s.detail ? ` · ${s.detail}` : ""}`]));
  assert.equal(titles.read, "Read the docs and one example · measure-word-drill");
  assert.match(titles.write, /^Wrote the tab · features\/f-[a-z0-9]{8} · 6 files$/);
  assert.equal(titles.test, "Tests passed · 12 of 12");
  assert.equal(titles.preview, "Preview ready · Reloads instantly. No rebuild needed.");

  const kinds = events.filter((e) => e.buildId === buildId).map((e) => e.type);
  assert.equal(kinds[0], "started");
  assert.equal(kinds.at(-1), "done");
  assert.ok(kinds.includes("text") && kinds.includes("step"));

  // Not on yet: no surfaces. Turn it on: the tab and the activity appear for Chinese only.
  assert.deepEqual(await app.featureSurfaces("zh"), []);
  const on = await app.enableFeature(featureId);
  assert.equal(on.status, "on");
  assert.equal(on.active, 1);
  assert.equal(on.draft, undefined);
  assert.deepEqual((await app.featureSurfaces("zh")).map((s) => `${s.surface.kind}:${s.surface.title}`).sort(), ["activity:Measure-word drill", "tab:Measure words"]);
  assert.deepEqual(await app.featureSurfaces("ja"), []);

  // The sandboxed page and the SDK are served with a locked-down CSP; nothing outside the version folder is.
  const src = await app.featureFrame(featureId, 1, "ui/index.html");
  assert.deepEqual(src, { url: `sayfern-feature://${featureId}/v1/ui/index.html` });
  const page = await app.builder.serveAsset(`sayfern-feature://${featureId}/v1/ui/index.html`);
  assert.equal(page.status, 200);
  assert.match(page.headers["Content-Type"], /text\/html/);
  assert.match(page.headers["Content-Security-Policy"], /connect-src 'none'/);
  assert.match(page.body ?? "", /_sdk\/sayfern-sdk\.js/);
  const sdk = await app.builder.serveAsset(`sayfern-feature://${featureId}/_sdk/sayfern-sdk.js`);
  assert.match(sdk.body ?? "", /window\.sayfern = Object\.freeze/);
  for (const bad of [
    `sayfern-feature://${featureId}/v1/%2E%2E/%2E%2E/feature.json`,
    `sayfern-feature://${featureId}/v9/ui/index.html`,
    `sayfern-feature://f-00000000/v1/ui/index.html`,
    `sayfern-feature://${featureId}/v1/ui/nope.html`,
  ]) {
    assert.notEqual((await app.builder.serveAsset(bad)).status, 200, bad);
  }
  await assert.rejects(app.featureFrame(featureId, 1, "../feature.json"));
});

test("ask for changes: a new draft based on the last version; old versions never change; roll back and discard", async () => {
  const { dir, app, faux, ref } = await makeApp();
  const files = await exampleFiles(DRILL);
  faux.setResponses(script(files, { name: "Measure-word drill" }));
  const { featureId } = await app.buildFeature({ prompt: "Measure-word drill", language: "zh" }, ref);
  await app.builder.whenIdle();
  await app.enableFeature(featureId);
  const v1Dir = join(dir, "builder", "features", featureId, "versions", "1");
  const v1Hash = await hashDir(v1Dir);

  let seenPrompt = "";
  faux.setResponses([
    (ctx) => {
      seenPrompt = JSON.stringify(ctx.messages.find((m) => m.role === "user"));
      return step(call("read_feature_file", { path: "ui/style.css" }));
    },
    step(call("write_feature_file", { path: "ui/style.css", content: ".prompt { font-size: 80px; }" })),
    step(call("finish", { summary: "Bigger.", name: "Measure-word drill", description: "Bigger words." })), // refused: tests not rerun
    step(call("run_tests")),
    step(call("finish", { summary: "Bigger characters.", name: "Measure-word drill", description: "Pick the right measure word." })),
  ]);
  const second = await app.buildFeature({ prompt: "Make the characters bigger", featureId, language: "zh" }, ref);
  assert.equal(second.featureId, featureId);
  await assert.rejects(app.buildFeature({ prompt: "again", featureId, language: "zh" }, ref), /already being built/);
  await app.builder.whenIdle();
  assert.match(seenPrompt, /v1: \\"Measure-word drill\\"/, "earlier request is in the context");
  assert.match(seenPrompt, /starts as a copy of the previous version/);

  let f = (await app.getFeature(featureId))!;
  assert.deepEqual(f.versions.map((v) => [v.n, v.state, v.basedOn]), [[2, "ready", 1], [1, "ready", undefined]]);
  assert.equal(f.status, "preview", "v2 is a draft while v1 stays on");
  assert.equal(f.active, 1);
  assert.equal(await hashDir(v1Dir), v1Hash, "v1 untouched");
  assert.equal(readFileSync(join(dir, "builder", "features", featureId, "versions", "2", "ui", "style.css"), "utf8"), ".prompt { font-size: 80px; }");
  assert.ok(f.turns[1].text.includes("Bigger characters."));

  // Turn on v2, roll back to v1 (stays on), then discard nothing (no draft).
  f = await app.enableFeature(featureId, 2);
  assert.equal(f.active, 2);
  f = await app.rollbackFeature(featureId, 1);
  assert.equal(f.active, 1);
  assert.equal(f.enabled, true);
  assert.equal((await app.featureSurfaces("zh"))[0].version, 1);
  f = await app.disableFeature(featureId);
  assert.equal(f.status, "off");
  assert.deepEqual(await app.featureSurfaces("zh"), []);

  // A third request that fails leaves a failed draft; discard removes just that version.
  faux.setResponses([fauxAssistantMessage("I can't do that."), fauxAssistantMessage("Still no.")]);
  await app.buildFeature({ prompt: "Make it play sounds from the web", featureId, language: "zh" }, ref);
  await app.builder.whenIdle();
  f = (await app.getFeature(featureId))!;
  assert.equal(f.status, "failed");
  assert.equal(f.versions[0].state, "failed");
  await assert.rejects(app.enableFeature(featureId, 3), /didn't finish/);
  const after = await app.discardDraft(featureId);
  assert.deepEqual(after?.versions.map((v) => v.n), [2, 1]);
  assert.equal(after?.status, "off");

  await app.deleteFeature(featureId);
  assert.equal(await app.getFeature(featureId), null);
  assert.deepEqual(await app.listFeatures(), []);
});

test("review gate: full-access code needs approval of its exact hash; the host refuses changed code", async () => {
  const { dir, app, faux, ref } = await makeApp();
  const files = await exampleFiles(CHENGYU);
  files.push(["test.js", `import { chengyuFor } from "./index.js";\ntest("has an idiom", () => assert.equal(chengyuFor(new Date(2026, 0, 1)).idiom.length, 4));`]);
  faux.setResponses(script(files, { name: "Chengyu of the day" }));
  const { featureId } = await app.buildFeature({ prompt: "Give the tutor a chengyu of the day", language: "zh" }, ref);
  await app.builder.whenIdle();

  let f = (await app.getFeature(featureId))!;
  assert.equal(f.status, "review");
  assert.equal(f.versions[0].fullAccess, true);
  assert.ok(f.turns[0].steps.some((s) => s.kind === "review"));
  const review = await app.featureFiles(featureId, 1);
  assert.deepEqual(review.filter((x) => x.fullAccess).map((x) => x.path), ["index.js"]);
  assert.equal(review[0].path, "package.json");
  await assert.rejects(app.enableFeature(featureId), /approve its code first/);
  assert.equal(app.tutor ? app.extensions.tools().some((t) => t.name === "chengyu_of_the_day") : false, false);

  f = await app.approveFeature(featureId, 1);
  assert.equal(f.versions[0].approved, true);
  assert.equal(f.status, "preview");
  f = await app.enableFeature(featureId);
  assert.equal(f.status, "on");
  assert.equal(f.loadError, undefined);
  assert.ok(app.extensions.tools().some((t) => t.name === "chengyu_of_the_day"), "approved tool loads");
  assert.deepEqual(app.extensions.list(), [], "builder features are not listed as hand-installed extensions");

  // The host loads a frozen, read-only copy keyed by the approved hash, not the version folder.
  const loaded = app.extensions.managedList().find((x) => x.id === featureId)!;
  const frozen = join(dir, "builder", "features", featureId, "approved", f.versions[0].hash!);
  assert.equal(loaded.path, frozen);
  assert.equal(statSync(join(frozen, "index.js")).mode & 0o222, 0, "frozen copy is read-only");

  // Writing the version folder after approval changes nothing that runs, and can't be approved again.
  writeFileSync(join(dir, "builder", "features", featureId, "versions", "1", "index.js"), "export function activate(api) { api.log('changed'); }");
  await app.extensions.load();
  assert.ok(app.extensions.tools().some((t) => t.name === "chengyu_of_the_day"), "still the approved code");
  await assert.rejects(app.approveFeature(featureId, 1), /changed on disk/);

  // Tampering with the frozen copy itself: the host re-hashes and refuses it.
  chmodSync(frozen, 0o755);
  chmodSync(join(frozen, "index.js"), 0o644);
  writeFileSync(join(frozen, "index.js"), "export function activate(api) { api.log('changed'); }");
  await app.extensions.load();
  assert.equal(app.extensions.tools().some((t) => t.name === "chengyu_of_the_day"), false);
  f = (await app.getFeature(featureId))!;
  assert.match(f.loadError ?? "", /hasn't been approved/);
});

test("extension host: managed features load from their version folder; UI-only ones import nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sayfern-host-"));
  const extDir = join(dir, "extensions");
  mkdirSync(extDir);
  const host = new FileExtensionHost({ dir: extDir, log: () => undefined });
  const uiOnly = join(dir, "ui-only");
  mkdirSync(join(uiOnly, "ui"), { recursive: true });
  writeFileSync(join(uiOnly, "package.json"), JSON.stringify({ name: "UI", type: "module", sayfern: { surfaces: [] } }));
  host.setManagedSource({
    list: async () => [
      { id: "f-aaaaaaaa", dir: uiOnly, enabled: true, approvedHashes: [] },
      { id: "f-bbbbbbbb", dir: CHENGYU, enabled: true, approvedHashes: [] },
      { id: "f-cccccccc", dir: CHENGYU, enabled: true, approvedHashes: [await hashDir(CHENGYU)] },
    ],
  });
  await host.load();
  const byId = Object.fromEntries(host.managedList().map((x) => [x.id, x]));
  assert.equal(byId["f-aaaaaaaa"].error, undefined);
  assert.match(byId["f-bbbbbbbb"].error ?? "", /hasn't been approved/);
  assert.equal(byId["f-cccccccc"].error, undefined);
  assert.deepEqual(byId["f-cccccccc"].contributes.tools, ["chengyu_of_the_day"]);
  assert.equal(host.list().length, 0);
});

const runChild = (files: Map<string, string> | Record<string, string>, timeoutMs = 8000) =>
  runTestsInChildProcess({ files: files instanceof Map ? files : new Map(Object.entries(files)), seed: defaultSeed("zh"), timeoutMs, now: Date.now });

test("Node fallback runner: pass, fail, timeout, imports", async () => {
  const pass = await runChild(new Map(await exampleFiles(DRILL)));
  assert.deepEqual([pass.passed, pass.failed, pass.total, pass.ok], [12, 0, 12, true]);

  const fail = await runChild({ "test.js": `test("a", () => assert.equal(1, 1)); test("b", () => assert.deepEqual([1], [2]));` });
  assert.deepEqual([fail.passed, fail.failed, fail.ok], [1, 1, false]);
  assert.match(fail.output, /FAIL b: Expected \[2\], got \[1\]/);

  const slow = await runChild({ "test.js": `test("forever", () => { for (;;) {} });` }, 1500);
  assert.equal(slow.ok, false);
  assert.match(slow.error ?? "", /timed out/);

  const node = await runChild({ "test.js": `import { readFileSync } from "node:fs"; test("x", () => {});` });
  assert.match(node.error ?? "", /Only relative imports/);
  const none = await runChild({ "test.js": "export const x = 1;" });
  assert.match(none.error ?? "", /registered no tests/);
});

test("Node fallback runner: the vm escape reaches a process with no file system, child process or worker access (review #1)", async () => {
  const escape = await runChild({
    "test.js": `test("escape", async () => {
  let p;
  try { await import("node:fs"); } catch (e) { p = e.constructor.constructor("return process")(); }
  assert.equal(typeof p, "object", "the vm context alone is not a boundary");
  const denied = (fn) => { try { fn(); return "allowed"; } catch (e) { return e.code; } };
  assert.equal(denied(() => p.getBuiltinModule("fs").readFileSync("/etc/hostname")), "ERR_ACCESS_DENIED");
  assert.equal(denied(() => p.getBuiltinModule("fs").writeFileSync("/tmp/sayfern-escape", "x")), "ERR_ACCESS_DENIED");
  assert.equal(denied(() => p.getBuiltinModule("child_process").execSync("id")), "ERR_ACCESS_DENIED");
  assert.equal(denied(() => new (p.getBuiltinModule("worker_threads").Worker)("1", { eval: true })), "ERR_ACCESS_DENIED");
});`,
  });
  assert.equal(escape.ok, true, escape.error ?? escape.output);
  assert.equal(existsSync("/tmp/sayfern-escape"), false);
});

test("the app's runner is injected; test pages are served only to it, with no network (review #1)", async () => {
  const { app, faux, ref } = await makeApp();
  const calls: FeatureTestRunInput[] = [];
  app.builder.setTestRunner(async (input) => {
    calls.push(input);
    return { passed: 3, failed: 0, total: 3, ok: true, output: "", durationMs: 0 };
  });
  faux.setResponses(script(await exampleFiles(DRILL), { name: "Measure-word drill" }));
  const { featureId } = await app.buildFeature({ prompt: "drill", language: "zh" }, ref);
  await app.builder.whenIdle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `sayfern-feature://${featureId}/v1/_test/index.html`);
  assert.equal((await app.getFeature(featureId))!.versions[0].tests?.passed, 3);

  const url = calls[0].url;
  assert.equal((await app.builder.serveAsset(url)).status, 404, "not on the app session");
  const page = await app.builder.serveAsset(url, { tests: true });
  assert.equal(page.status, 200);
  assert.match(page.headers["Content-Security-Policy"], /connect-src 'none'/);
  assert.match(page.headers["Content-Security-Policy"], /default-src 'none'/);
  const harness = await app.builder.serveAsset(url.replace("index.html", "harness.js"), { tests: true });
  assert.match(harness.body ?? "", /桌子/, "fake SDK seeded for the feature's language");
  const run = await app.builder.serveAsset(url.replace("index.html", "run.js"), { tests: true });
  assert.match(run.body ?? "", /import\("\.\.\/test\.js"\)/);
  await assert.rejects(app.builder.installFeature(new Map([["_test/x.js", ""]]), { language: "zh" }), /reserved/);
});

test("full-access code must stay inside its version folder and import statically (review #2)", async () => {
  const pkg = JSON.stringify({ name: "X", type: "module", main: "index.js" });
  const files = (index: string, extra: Record<string, string> = {}) => new Map(Object.entries({ "package.json": pkg, "index.js": index, ...extra }));
  for (const [code, re] of [
    [`export async function activate() { await import("../3/x.js"); }`, /may only import the feature's own files/],
    [`import "../../2/x.js"; export function activate() {}`, /may only import the feature's own files/],
    [`export async function activate() { const p = "./x.js"; await import(p); }`, /computed path/],
    ["export async function activate() { await import(`./${'x'}.js`); }", /computed path/],
    [`const fs = require("fs"); export function activate() {}`, /require\(\)/],
    [`export function activate() { eval("1"); }`, /eval\(\)/],
    [`export function activate() { new Function("return 1")(); }`, /new Function/],
    [`import x from "lodash"; export function activate() {}`, /may only import/],
    [`import "./missing.js"; export function activate() {}`, /isn't a file/],
  ] as const) {
    assert.match(checkMainSideCode(files(code), "index.js").join(" "), re, code);
  }
  assert.deepEqual(checkMainSideCode(files(`import { a } from "./lib/a.js"; import fs from "node:fs"; export async function activate() { await import("./lib/a.js"); }`, { "lib/a.js": "export const a = 1;" }), "index.js"), []);
  assert.deepEqual(checkMainSideCode(files(`export function activate() {}`, { "ui/main.js": `import(location.href);` }), "index.js"), [], "UI code is sandboxed, not checked");

  // Review flags: with a main entry, every .js outside ui/ is full access (test.js only when imported).
  const flagged = fullAccessFiles(files(`export function activate() {}`, { "lib/x.js": "", "ui/main.js": "", "test.js": "" }), "index.js");
  assert.deepEqual([...flagged].sort(), ["index.js", "lib/x.js"]);

  // A build that writes such code doesn't finish, and installing it is refused.
  const { app, faux, ref } = await makeApp();
  await assert.rejects(app.builder.installFeature(files(`export async function activate() { await import("../3/x.js"); }`, { "test.js": "" }), { language: "zh" }), /own files/);
  faux.setResponses([
    ...script([["package.json", pkg], ["index.js", `export async function activate() { await import("../2/evil.js"); }`], ["test.js", `test("t", () => assert.ok(true));`]], { name: "Sneaky" }),
    fauxAssistantMessage("I can't."),
    fauxAssistantMessage("Done."),
  ]);
  const { featureId } = await app.buildFeature({ prompt: "sneaky", language: "zh" }, ref);
  await app.builder.whenIdle();
  const f = (await app.getFeature(featureId))!;
  assert.equal(f.versions[0].state, "failed");
  await assert.rejects(app.approveFeature(featureId, 1), /finished version/);
});

test("two quick builds of one feature: the second is refused, versions are never shared (review #3)", async () => {
  const { app, faux, ref } = await makeApp();
  faux.setResponses(script(await exampleFiles(DRILL), { name: "Measure-word drill" }));
  const { featureId } = await app.buildFeature({ prompt: "drill", language: "zh" }, ref);
  await app.builder.whenIdle();
  faux.setResponses([fauxAssistantMessage("ok"), fauxAssistantMessage("ok")]);
  const results = await Promise.allSettled([
    app.buildFeature({ prompt: "change A", featureId, language: "zh" }, ref),
    app.buildFeature({ prompt: "change B", featureId, language: "zh" }, ref),
  ]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected"]);
  assert.match(String((results[1] as PromiseRejectedResult).reason), /already being built/);
  await app.builder.whenIdle();
  const f = (await app.getFeature(featureId))!;
  assert.deepEqual(f.versions.map((v) => v.n), [2, 1]);
  // A version folder is never reused.
  await assert.rejects(app.builder.store.createVersionDir(featureId, 2), /already exists/);
  // After the lock is released, the next request works.
  faux.setResponses([fauxAssistantMessage("ok"), fauxAssistantMessage("ok")]);
  await app.buildFeature({ prompt: "change C", featureId, language: "zh" }, ref);
  await app.builder.whenIdle();
  assert.deepEqual((await app.getFeature(featureId))!.versions.map((v) => v.n), [3, 2, 1]);
});

test("builder loop: abort stops the build and keeps a stopped draft", async () => {
  const { app, faux, ref, events } = await makeApp();
  let started!: () => void;
  const waiting = new Promise<void>((r) => (started = r));
  faux.setResponses([
    async (_ctx, options) => {
      started();
      await new Promise<void>((r) => options?.signal?.addEventListener("abort", () => r()));
      return fauxAssistantMessage("late");
    },
  ]);
  const { buildId, featureId } = await app.buildFeature({ prompt: "Something slow", language: "ja" }, ref);
  await waiting;
  await app.abortBuild(buildId);
  await app.builder.whenIdle();
  const f = (await app.getFeature(featureId))!;
  assert.equal(f.turns[0].status, "stopped");
  assert.equal(f.versions[0].state, "stopped");
  assert.equal(f.status, "failed");
  const last = events.at(-1)!;
  assert.equal(last.type, "error");
  assert.equal(last.type === "error" && last.message, "Stopped");
  // A stopped first version can be discarded, which removes the whole feature.
  assert.equal(await app.discardDraft(featureId), null);
  assert.equal(await app.getFeature(featureId), null);
});

test("buildFeature: readable errors for an empty request or a missing model", async () => {
  const { app, ref } = await makeApp();
  await assert.rejects(app.buildFeature({ prompt: "  ", language: "zh" }, ref), /Describe the feature/);
  await assert.rejects(app.buildFeature({ prompt: "x", language: "zh" }, { provider: "nope", id: "nope" }));
  assert.deepEqual(await app.listFeatures(), [], "nothing created");
});

test("sandbox RPC: allowlist, argument checks, data shapes, storage cap, results", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sayfern-rpc-"));
  const store = new FeatureStore(join(dir, "builder"));
  await store.create({ id: "f-12345678", name: "X", description: "", language: "zh", createdAt: 0, updatedAt: 0, versions: [{ n: 1, createdAt: 0, prompt: "x", state: "ready", files: [], surfaces: [], fullAccess: false }], enabled: true, active: 1, approvals: [], turns: [] });
  const anki = new FakeAnki();
  anki.cards = [{ cardId: 1, noteId: 1, deck: "中文", word: "书", reading: "shū", meaning: "book", interval: 30, ease: 2500, reps: 10, lapses: 0, stage: "review", mature: true }];
  const records = new JsonRecordsStore({ dataDir: join(dir, "records"), now: () => 1 });
  const lang = new DefaultLanguageService({ dataDir: join(dir, "dict"), fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
  let t = 100;
  const rpc = new FeatureRpc({ store, anki, records, lang, now: () => t++ });
  const ctx = { featureId: "f-12345678", version: 1, language: "zh" as const };

  const words = (await rpc.call(ctx, "anki.words", [{ limit: 5 }])) as { items: Record<string, unknown>[] };
  assert.equal(words.items[0].word, "书");
  assert.deepEqual(Object.keys(words.items[0]).sort(), ["lapses", "mature", "meaning", "reading", "status", "struggle", "word"]);

  for (const [method, args, re] of [
    ["fs.readFile", [], /Unknown method/],
    ["anki.words", [{ limit: 1000 }], /limit must be/],
    ["anki.words", [{ status: "everything" }], /status must be/],
    ["lookup", [""], /word must be 1 to 40/],
    ["storage.get", [{}], /key must be a string/],
    ["results.record", [{ correct: true }], /item is required/],
    ["results.record", [{ item: "x", score: 2 }], /score must be/],
    ["annotate", "not a list", /must be a list/],
    ["storage.set", ["k", "x".repeat(70_000)], /too large/],
  ] as const) {
    await assert.rejects(rpc.call(ctx, method, args as unknown as unknown[]), re as RegExp, method);
  }
  await assert.rejects(rpc.call({ ...ctx, version: 7 }, "grammar.list", []), /Unknown feature/);
  await assert.rejects(rpc.call({ ...ctx, featureId: "../x" }, "grammar.list", []), /Unknown feature/);

  assert.equal(await rpc.call(ctx, "storage.get", ["best"]), null);
  await rpc.call(ctx, "storage.set", ["best", { right: 8 }]);
  assert.deepEqual(await rpc.call(ctx, "storage.get", ["best"]), { right: 8 });
  for (let i = 0; i < 5; i++) await rpc.call(ctx, "storage.set", [`k${i}`, "x".repeat(60_000)]).catch(() => undefined);
  await assert.rejects(rpc.call(ctx, "storage.set", ["more", "x".repeat(60_000)]), /Storage is full/);

  await rpc.call(ctx, "results.record", [{ item: "书", correct: true, answer: "本", expected: "本" }]);
  await rpc.call({ ...ctx, preview: true }, "results.record", [{ item: "狗", correct: false }]);
  const list = (await rpc.call(ctx, "results.list", [10])) as { item: string; preview: boolean; version: number }[];
  assert.deepEqual(list.map((r) => [r.item, r.preview, r.version]), [["狗", true, 1], ["书", false, 1]]);
  assert.ok(JSON.parse(readFileSync(join(dir, "builder", "data", "f-12345678", "results.json"), "utf8")).length === 2);
  assert.deepEqual(await rpc.call(ctx, "grammar.list", []), []);
});

test("erase all data keeps built features but removes what they stored", async () => {
  const { dir, app, faux, ref } = await makeApp();
  faux.setResponses(script(await exampleFiles(DRILL), { name: "Measure-word drill" }));
  const { featureId } = await app.buildFeature({ prompt: "Measure-word drill", language: "zh" }, ref);
  await app.builder.whenIdle();
  await app.featureCall({ featureId, version: 1, language: "zh" }, "results.record", [{ item: "书", correct: true }]);
  await app.featureCall({ featureId, version: 1, language: "zh" }, "storage.set", ["best", 9]);
  assert.ok(existsSync(join(dir, "builder", "data", featureId, "results.json")));
  await app.eraseData({ keepSignIns: true });
  assert.ok(existsSync(join(dir, "builder", "features", featureId, "versions", "1", "package.json")), "feature code kept");
  assert.equal(existsSync(join(dir, "builder", "data")), false, "feature data erased");
});

test("erase all data stops a running build first; export includes features and their data (review #5, #6, #7)", async () => {
  const { dir, app, faux, ref } = await makeApp();
  faux.setResponses(script(await exampleFiles(DRILL), { name: "Measure-word drill" }));
  const { featureId } = await app.buildFeature({ prompt: "drill", language: "zh" }, ref);
  await app.builder.whenIdle();
  const v = (await app.getFeature(featureId))!.versions[0];
  assert.equal(v.tests?.durationMs, 0, "durations come from deps.now (fixed in tests)");
  await app.featureCall({ featureId, version: 1, language: "zh" }, "storage.set", ["best", 9]);
  await app.featureCall({ featureId, version: 1, language: "zh" }, "results.record", [{ item: "书", correct: true }]);

  const out = join(dir, "export.json");
  await app.exportTo(out);
  const data = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(data.builder.features[0].id, featureId);
  assert.equal(data.builder.features[0].turns, undefined);
  assert.deepEqual(data.builder.data[featureId].storage, { best: 9 });
  assert.equal(data.builder.data[featureId].results[0].item, "书");

  faux.setResponses([
    async (_ctx, options) => {
      await new Promise<void>((r) => (options?.signal?.aborted ? r() : options?.signal?.addEventListener("abort", () => r())));
      return fauxAssistantMessage("late");
    },
  ]);
  await app.buildFeature({ prompt: "slow change", featureId, language: "zh" }, ref);
  await app.eraseData({ keepSignIns: true });
  const after = JSON.parse(readFileSync(join(dir, "builder", "features", featureId, "feature.json"), "utf8"));
  assert.equal(after.turns.at(-1).status, "stopped", "the build was stopped and sealed before the erase");
  assert.equal(after.versions.at(-1).state, "stopped");
});
