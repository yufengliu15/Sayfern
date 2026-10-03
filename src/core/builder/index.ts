// AI feature builder (S2-10..S2-13). Implements BuilderApi (minus the on* event subscription,
// which the preload/mocks provide; core emits on EVENT_CHANNELS.builder through deps.emit).
//
// A feature is an extension folder per version under <dataDir>/builder/features/<id>/versions/<n>/.
// Versions are sealed (hashed, never written again) when their build ends. Sandboxed UI surfaces are
// served by sayfern-feature:// (serveAsset); a main-side entry (full access) loads through the
// extension host only when the learner approved that exact hash.
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { LANGUAGES, type Language } from "../../shared/records";
import { FEATURE_SDK_CSS, FEATURE_SDK_JS } from "../../shared/stage2/builder-sdk";
import type {
  BuilderApi,
  BuilderEvent,
  BuildRequest,
  BuildStep,
  FeatureCallContext,
  FeatureFile,
  FeatureFrameSource,
  FeatureInfo,
  FeatureStatus,
  FeatureSurfaceRef,
  FeatureTestResult,
  FeatureTurn,
  FeatureVersion,
} from "../../shared/stage2";
import type { ModelRef } from "../../shared/types";
import { hashFiles, type ManagedExtension } from "../extensions";
import { type Stage2Deps, explanationFor } from "../stage2";
import { runBuilderLoop, testLine, type DraftFiles } from "./agent";
import { BuilderKit, findKitRoot } from "./kit";
import { checkMainSideCode, fullAccessFiles, readManifest } from "./manifest";
import { PACKAGE_LIMITS, contentTypeOf, extensionOf, featureHeaders, featureTestUrl, featureUrl, FEATURE_ID, normalizeFeaturePath, parseFeatureUrl } from "./paths";
import { FeatureRpc } from "./rpc";
import { defaultSeed, runTestsInChildProcess, testHarnessScript, testPageHtml, testRunScript, type FeatureTestRunner } from "./runner";
import { FeatureStore, type FeatureRecord, type StoredVersion } from "./store";
import { msg } from "../../shared/i18n";

export { parseFeatureUrl, featureHeaders } from "./paths";
export { parseTestOutput, type FeatureTestRunner, type FeatureTestRunInput } from "./runner";

export interface AssetResponse {
  status: number;
  headers: Record<string, string>;
  body?: string;
}

interface RunningBuild {
  buildId: string;
  featureId: string;
  controller: AbortController;
  done: Promise<void>;
  /** Progress so far (persisted when the build ends), so a reopened Customize screen catches up. */
  live: { turnId: string; steps: Map<string, BuildStep>; text: string };
}

export interface BuilderServiceOptions {
  /** Folder holding docs/feature-builder.md, docs/, examples/ and the public source files. Default: found from this module. */
  kitDir?: string;
  /** Per-run test timeout. */
  testTimeoutMs?: number;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class BuilderService implements Omit<BuilderApi, `on${string}`> {
  readonly store: FeatureStore;
  readonly kit: BuilderKit;
  private readonly rpc: FeatureRpc;
  private readonly builds = new Map<string, RunningBuild>();
  /** Features with a build starting or running. Taken synchronously, before any await, so two quick requests can't race. */
  private readonly locked = new Set<string>();
  private recovered: Promise<void> | null = null;
  private testRunner: FeatureTestRunner = (input) => runTestsInChildProcess(input);
  private readonly testTimeoutMs: number;

  constructor(
    private readonly deps: Stage2Deps,
    opts: BuilderServiceOptions = {},
  ) {
    this.store = new FeatureStore(join(deps.dataDir, "builder"));
    this.kit = new BuilderKit(opts.kitDir ?? process.env.SAYFERN_KIT_DIR ?? findKitRoot(import.meta.dirname));
    this.testTimeoutMs = opts.testTimeoutMs ?? 8000;
    this.rpc = new FeatureRpc({ store: this.store, anki: deps.anki, records: deps.records, lang: deps.lang, now: deps.now });
    deps.extensions.setManagedSource({ list: () => this.managedExtensions() });
  }

  // ------------------------------------------------------------ reading

  async listFeatures(): Promise<FeatureInfo[]> {
    await this.recover();
    const list = await this.store.list();
    return list.map((r) => this.toInfo(r)).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getFeature(id: string): Promise<FeatureInfo | null> {
    await this.recover();
    const rec = await this.store.get(id);
    return rec ? this.toInfo(rec) : null;
  }

  async featureFiles(id: string, version: number): Promise<FeatureFile[]> {
    const rec = await this.mustGet(id);
    const v = this.version(rec, version);
    const files = await this.store.readVersion(id, v.n);
    const { manifest } = readManifest(files);
    const full = v.fullAccess ? fullAccessFiles(files, manifest?.main) : new Set<string>();
    const order = (p: string) => (p === "package.json" ? 0 : full.has(p) ? 1 : p === "test.js" ? 3 : 2);
    return [...files.entries()]
      .map(([path, text]) => ({ path, text, bytes: Buffer.byteLength(text), fullAccess: full.has(path) }))
      .sort((a, b) => order(a.path) - order(b.path) || a.path.localeCompare(b.path));
  }

  async featureSurfaces(language: Language): Promise<FeatureSurfaceRef[]> {
    const out: FeatureSurfaceRef[] = [];
    for (const rec of await this.store.list()) {
      if (!rec.enabled || rec.active == null) continue;
      const v = rec.versions.find((x) => x.n === rec.active && x.state === "ready");
      if (!v) continue;
      v.surfaces.forEach((surface, index) => {
        if (surface.languages && !surface.languages.includes(language)) return;
        out.push({ featureId: rec.id, featureName: rec.name, version: v.n, index, surface });
      });
    }
    return out.sort((a, b) => a.surface.title.localeCompare(b.surface.title));
  }

  async featureFrame(id: string, version: number, entry: string): Promise<FeatureFrameSource> {
    const rec = await this.mustGet(id);
    const v = this.version(rec, version);
    const path = normalizeFeaturePath(entry);
    if (extensionOf(path) !== ".html" || !v.files.some((f) => f.path === path)) throw new Error(`No page ${path} in this version.`);
    return { url: featureUrl(id, v.n, path) };
  }

  featureCall(ctx: FeatureCallContext, method: string, args: unknown[]): Promise<unknown> {
    return this.rpc.call(ctx, method, args);
  }

  /** sayfern-feature:// handler body (main wraps it in a Response). Never throws. */
  /**
   * sayfern-feature:// handler body (main wraps it in a Response). Never throws. Test pages (`_test/`) are
   * only served when `tests` is set: main passes it on the test runner's own session.
   */
  async serveAsset(url: string, opts: { tests?: boolean } = {}): Promise<AssetResponse> {
    const t = parseFeatureUrl(url);
    const notFound = (status = 404): AssetResponse => ({ status, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "Not found" });
    if (t.kind === "invalid") return notFound(t.status);
    const rec = await this.store.get(t.id).catch(() => null);
    if (!rec) return notFound();
    if (t.kind === "sdk") {
      const js = t.file === "sayfern-sdk.js";
      return { status: 200, headers: featureHeaders(t.id, js ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8"), body: js ? FEATURE_SDK_JS : FEATURE_SDK_CSS };
    }
    const v = rec.versions.find((x) => x.n === t.version);
    if (!v) return notFound();
    if (t.kind === "test") {
      if (!opts.tests) return notFound();
      if (t.file === "index.html") return { status: 200, headers: featureHeaders(t.id, "text/html; charset=utf-8"), body: testPageHtml() };
      const body = t.file === "harness.js" ? testHarnessScript(defaultSeed(rec.language)) : testRunScript();
      return { status: 200, headers: featureHeaders(t.id, "text/javascript; charset=utf-8"), body };
    }
    const files = await this.store.readVersion(t.id, v.n).catch(() => new Map<string, string>());
    const body = files.get(t.path);
    if (body == null) return notFound();
    return { status: 200, headers: featureHeaders(t.id, contentTypeOf(t.path)), body };
  }

  // ------------------------------------------------------------ building

  async buildFeature(req: BuildRequest, ref: ModelRef): Promise<{ buildId: string; featureId: string }> {
    let held = typeof req?.featureId === "string" ? req.featureId : null;
    if (held) {
      if (this.locked.has(held)) throw new Error("This feature is already being built.");
      this.locked.add(held);
    }
    let handedOff = false;
    try {
      const r = await this.startBuild(req, ref, (id) => {
        if (!held) {
          held = id;
          this.locked.add(id);
        }
      });
      handedOff = true;
      return r;
    } finally {
      if (!handedOff && held) this.locked.delete(held);
    }
  }

  private async startBuild(req: BuildRequest, ref: ModelRef, onId: (id: string) => void): Promise<{ buildId: string; featureId: string }> {
    await this.recover();
    const prompt = typeof req?.prompt === "string" ? req.prompt.trim() : "";
    if (!prompt) throw new Error("Describe the feature you want.");
    if (prompt.length > 4000) throw new Error("That description is too long. Keep it under 4,000 characters.");
    const language: Language = (LANGUAGES as readonly string[]).includes(req.language) ? req.language : "zh";
    const model = this.deps.resolveModel(ref);
    const now = this.deps.now();
    const buildId = this.deps.newId();
    const modelLabel = `${model.provider}/${model.id}`;

    let rec: FeatureRecord;
    let base: StoredVersion | undefined;
    if (req.featureId) {
      const existing = await this.mustGet(req.featureId);
      if (this.buildFor(existing.id)) throw new Error("This feature is already being built.");
      rec = existing;
      base = [...rec.versions].reverse().find((v) => v.state !== "building");
    } else {
      const id = await this.newFeatureId();
      rec = {
        id,
        name: placeholderName(prompt),
        description: "",
        language,
        createdAt: now,
        updatedAt: now,
        versions: [],
        enabled: false,
        approvals: [],
        turns: [],
      };
      await this.store.create(rec);
    }
    const id = rec.id;
    onId(id);
    const n = Math.max(0, ...rec.versions.map((v) => v.n)) + 1;
    if (base) await this.store.copyVersion(id, base.n, n);
    else await this.store.createVersionDir(id, n);
    const baseFiles = base ? await this.store.readVersion(id, n) : new Map<string, string>();

    const turn: FeatureTurn = { id: this.deps.newId(), buildId, prompt, at: now, version: n, model: modelLabel, steps: [], text: "", status: "building" };
    rec = await this.store.update(id, (r) => {
      r.versions.push({
        n,
        createdAt: now,
        prompt,
        ...(base ? { basedOn: base.n } : {}),
        state: "building",
        files: [...baseFiles.entries()].map(([path, t]) => ({ path, bytes: Buffer.byteLength(t) })),
        surfaces: [],
        fullAccess: false,
      });
      r.draft = n;
      r.turns.push(turn);
      r.updatedAt = now;
      return structuredClone(r);
    });

    const controller = new AbortController();
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));
    const live = { turnId: turn.id, steps: new Map<string, BuildStep>(), text: "" };
    this.builds.set(buildId, { buildId, featureId: id, controller, done, live });
    this.emit({ type: "started", buildId, featureId: id, feature: this.toInfo(rec) });

    const history = rec.turns
      .filter((t) => t.id !== turn.id)
      .map((t) => ({ prompt: t.prompt, version: t.version, outcome: t.status === "done" ? t.text.split("\n").pop() || "built" : `not finished (${t.error ?? t.status})` }));

    void this.runBuild({ id, n, buildId, turnId: turn.id, prompt, language: rec.language, history, model, controller, live })
      .catch((err) => console.error("Feature build failed:", errorText(err)))
      .finally(() => {
        this.builds.delete(buildId);
        this.locked.delete(id);
        resolveDone();
      });
    return { buildId, featureId: id };
  }

  async abortBuild(buildId: string): Promise<void> {
    this.builds.get(buildId)?.controller.abort();
  }

  private async runBuild(b: {
    id: string;
    n: number;
    buildId: string;
    turnId: string;
    prompt: string;
    language: Language;
    history: { prompt: string; outcome: string; version: number }[];
    model: ReturnType<Stage2Deps["resolveModel"]>;
    controller: AbortController;
    live: RunningBuild["live"];
  }): Promise<void> {
    const { id, n, buildId } = b;
    let sealed = false;
    const steps = b.live.steps;
    const files = this.draftFiles(id, n, () => sealed);
    const onStep = (step: BuildStep) => {
      steps.set(step.id, step);
      this.emit({ type: "step", buildId, featureId: id, step });
    };
    const runTests = async (): Promise<FeatureTestResult> => this.runTests(id, n, b.language, await files.all());

    const result = await runBuilderLoop({
      models: this.deps.models,
      model: b.model,
      signal: b.controller.signal,
      kit: this.kit,
      files,
      runTests,
      prompt: b.prompt,
      language: b.language,
      explain: await explanationFor(this.deps),
      featureId: id,
      version: n,
      history: b.history,
      now: this.deps.now,
      onText: (delta) => {
        b.live.text += delta;
        this.emit({ type: "text", buildId, featureId: id, delta });
      },
      onStep,
    }).catch((err) => ({ text: "", usage: { input: 0, output: 0, cost: 0 }, error: errorText(err), aborted: false, finished: undefined, lastTests: undefined }));

    // Seal the version: no more writes, hash the files.
    sealed = true;
    const all = await this.store.readVersion(id, n).catch(() => new Map<string, string>());
    const read = readManifest(all);
    const { manifest } = read;
    // Full-access code must be fully covered by the hash: static, in-folder imports only.
    const problems = [...read.problems, ...checkMainSideCode(all, manifest?.main)];
    const hash = hashFiles(all);
    const ok = !!result.finished && problems.length === 0;
    const state: StoredVersion["state"] = ok ? "ready" : result.aborted ? "stopped" : "failed";
    const fullAccess = !!manifest?.main;
    if (ok) {
      onStep({ id: "preview", kind: "preview", status: "done", title: msg("Preview ready"), detail: msg("Reloads instantly. No rebuild needed.") });
      if (fullAccess) {
        onStep({ id: "review", kind: "review", status: "running", title: msg("Needs your review"), detail: "Part of it runs with full access to your Mac account. Read the code before turning it on." });
      }
    } else if (!result.aborted) {
      onStep({ id: "error", kind: "error", status: "failed", title: msg("Couldn't finish"), detail: (result.error || problems[0] || "Unknown error").slice(0, 300) });
    }
    const error = ok ? undefined : result.aborted ? "Stopped" : result.error || problems.join(" ") || "The build failed.";
    const summary = result.finished?.summary;
    const text = [result.text, summary && !result.text.includes(summary) ? summary : ""].filter(Boolean).join("\n\n");

    const rec = await this.store.update(id, (r) => {
      const v = r.versions.find((x) => x.n === n);
      if (v) {
        v.state = state;
        v.hash = hash;
        v.files = [...all.entries()].map(([path, t]) => ({ path, bytes: Buffer.byteLength(t) })).sort((x, y) => x.path.localeCompare(y.path));
        v.surfaces = manifest?.surfaces ?? [];
        v.fullAccess = fullAccess;
        if (result.lastTests) v.tests = result.lastTests;
        if (summary) v.summary = summary;
        if (error) v.error = error;
        else delete v.error;
      }
      const t = r.turns.find((x) => x.id === b.turnId);
      if (t) {
        t.status = ok ? "done" : result.aborted ? "stopped" : "failed";
        t.text = text;
        t.steps = [...steps.values()];
        t.usage = result.usage;
        if (error) t.error = error;
      }
      if (ok && result.finished) {
        // The first finished version names the feature; later ones may rename it.
        if (result.finished.name) r.name = result.finished.name;
        if (result.finished.description) r.description = result.finished.description;
      }
      r.updatedAt = this.deps.now();
      return structuredClone(r);
    });
    const info = this.toInfo(rec);
    if (ok) this.emit({ type: "done", buildId, featureId: id, feature: info });
    else this.emit({ type: "error", buildId, featureId: id, message: error!, feature: info });
  }

  /** The draft's files as the builder loop sees them: path checks, size limits, sealed after the build. */
  private draftFiles(id: string, n: number, isSealed: () => boolean): DraftFiles {
    const all = () => this.store.readVersion(id, n);
    const guard = async () => {
      const sealedMsg = "This version is sealed. Versions can't change after their build ends.";
      if (isSealed()) throw new Error(sealedMsg);
      const v = (await this.store.get(id))?.versions.find((x) => x.n === n);
      if (!v || v.state !== "building") throw new Error(sealedMsg);
    };
    return {
      all,
      list: async () => [...(await all()).entries()].map(([path, t]) => ({ path, bytes: Buffer.byteLength(t) })).sort((a, b) => a.path.localeCompare(b.path)),
      read: async (raw) => {
        const path = normalizeFeaturePath(raw);
        const text = (await all()).get(path);
        if (text == null) throw new Error(`No such file: ${path}`);
        return text;
      },
      write: async (raw, text) => {
        await guard();
        const path = normalizeFeaturePath(raw);
        if (typeof text !== "string") throw new Error("content must be text");
        const bytes = Buffer.byteLength(text);
        if (bytes > PACKAGE_LIMITS.fileBytes) throw new Error(`${path} is too large (${Math.round(bytes / 1024)} KB, max ${PACKAGE_LIMITS.fileBytes / 1024} KB).`);
        const current = await all();
        const others = [...current.entries()].filter(([p]) => p !== path);
        if (others.length + 1 > PACKAGE_LIMITS.files) throw new Error(`Too many files (max ${PACKAGE_LIMITS.files}).`);
        const total = others.reduce((s, [, t]) => s + Buffer.byteLength(t), 0) + bytes;
        if (total > PACKAGE_LIMITS.totalBytes) throw new Error(`The feature is too large (max ${PACKAGE_LIMITS.totalBytes / 1024} KB in total).`);
        return this.store.writeVersionFile(id, n, path, text);
      },
      remove: async (raw) => {
        await guard();
        return this.store.deleteVersionFile(id, n, raw);
      },
    };
  }

  // ------------------------------------------------------------ managing

  async approveFeature(id: string, version: number): Promise<FeatureInfo> {
    const rec = await this.mustGet(id);
    const v = this.version(rec, version);
    if (v.state !== "ready" || !v.hash) throw new Error("Only a finished version can be approved.");
    // Approve what is on disk now, and only if it is still the sealed code the learner was shown.
    const files = await this.store.readVersion(id, v.n);
    const onDisk = hashFiles(files);
    if (onDisk !== v.hash) throw new Error("This version's files changed on disk after it was built. It can't be approved.");
    const problems = checkMainSideCode(files, readManifest(files).manifest?.main);
    if (problems.length) throw new Error(`This version can't be approved: ${problems[0]}`);
    // The host loads main-side code from an immutable copy keyed by the approved hash, never from versions/.
    if (v.fullAccess) await this.store.freezeApproved(id, v.n, onDisk);
    const next = await this.store.update(id, (r) => {
      if (!r.approvals.some((a) => a.version === v.n && a.hash === onDisk)) r.approvals.push({ version: v.n, hash: onDisk, at: this.deps.now() });
      r.updatedAt = this.deps.now();
      return structuredClone(r);
    });
    return this.toInfo(next);
  }

  async enableFeature(id: string, version?: number): Promise<FeatureInfo> {
    const rec = await this.mustGet(id);
    const n = version ?? rec.draft ?? rec.active ?? [...rec.versions].reverse().find((v) => v.state === "ready")?.n;
    if (n == null) throw new Error("This feature has no finished version yet.");
    return this.activate(rec, n, true);
  }

  async disableFeature(id: string): Promise<FeatureInfo> {
    const rec = await this.mustGet(id);
    const next = await this.store.update(id, (r) => {
      r.enabled = false;
      r.updatedAt = this.deps.now();
      return structuredClone(r);
    });
    if (rec.enabled) await this.deps.extensions.load();
    return this.toInfo(next);
  }

  async rollbackFeature(id: string, version: number): Promise<FeatureInfo> {
    const rec = await this.mustGet(id);
    return this.activate(rec, version, rec.enabled);
  }

  private async activate(rec: FeatureRecord, n: number, enabled: boolean): Promise<FeatureInfo> {
    const v = this.version(rec, n);
    if (this.buildFor(rec.id) && rec.draft === n) throw new Error("This version is still being built.");
    if (v.state !== "ready") throw new Error(`Version ${n} didn't finish building, so it can't be used.`);
    if (enabled && v.fullAccess && !this.isApproved(rec, v)) {
      throw new Error("Part of this version runs with full access to your Mac account. Read and approve its code first.");
    }
    const next = await this.store.update(rec.id, (r) => {
      r.active = n;
      r.enabled = enabled;
      if (r.draft != null && r.draft <= n) delete r.draft;
      r.updatedAt = this.deps.now();
      return structuredClone(r);
    });
    await this.deps.extensions.load();
    return this.toInfo(next);
  }

  async discardDraft(id: string): Promise<FeatureInfo | null> {
    const rec = await this.mustGet(id);
    if (this.buildFor(id)) throw new Error("Stop the build before discarding it.");
    const n = rec.draft;
    if (n == null) return this.toInfo(rec);
    const remaining = rec.versions.filter((v) => v.n !== n);
    if (remaining.length === 0) {
      await this.deleteFeature(id);
      return null;
    }
    await this.store.removeVersion(id, n);
    const dropped = rec.approvals.filter((a) => a.version === n && !rec.approvals.some((b) => b.version !== n && b.hash === a.hash));
    for (const a of dropped) await this.store.removeApproved(id, a.hash);
    const next = await this.store.update(id, (r) => {
      r.versions = r.versions.filter((v) => v.n !== n);
      r.approvals = r.approvals.filter((a) => a.version !== n);
      delete r.draft;
      r.updatedAt = this.deps.now();
      return structuredClone(r);
    });
    return this.toInfo(next);
  }

  async deleteFeature(id: string): Promise<void> {
    const rec = await this.mustGet(id);
    const running = this.buildFor(id);
    if (running) {
      running.controller.abort();
      await running.done;
    }
    await this.store.remove(rec.id);
    this.rpc.forget(rec.id);
    if (rec.enabled) await this.deps.extensions.load();
  }

  /** Resolves when no build is running (tests). */
  async whenIdle(): Promise<void> {
    while (this.builds.size) await Promise.allSettled([...this.builds.values()].map((b) => b.done));
  }

  /**
   * Adds a feature from ready-made files as a sealed draft v1 (examples, e2e checks, tests). Not an IPC method:
   * the files go through the same path, manifest and full-access checks as a build.
   */
  async installFeature(files: ReadonlyMap<string, string>, opts: { language: Language }): Promise<FeatureInfo> {
    for (const p of files.keys()) normalizeFeaturePath(p);
    const read = readManifest(files);
    const problems = [...read.problems, ...checkMainSideCode(files, read.manifest?.main)];
    if (!read.manifest || problems.length) throw new Error(problems[0] ?? "Invalid feature.");
    const id = await this.newFeatureId();
    const now = this.deps.now();
    await this.store.create({ id, name: read.manifest.name, description: read.manifest.description, language: opts.language, createdAt: now, updatedAt: now, versions: [], enabled: false, approvals: [], turns: [] });
    await this.store.createVersionDir(id, 1);
    for (const [path, text] of files) await this.store.writeVersionFile(id, 1, path, text);
    const all = await this.store.readVersion(id, 1);
    const rec = await this.store.update(id, (r) => {
      r.versions.push({
        n: 1,
        createdAt: now,
        prompt: "(installed)",
        state: "ready",
        files: [...all.entries()].map(([path, t]) => ({ path, bytes: Buffer.byteLength(t) })).sort((x, y) => x.path.localeCompare(y.path)),
        hash: hashFiles(all),
        surfaces: read.manifest!.surfaces,
        fullAccess: !!read.manifest!.main,
      });
      r.draft = 1;
      return structuredClone(r);
    });
    return this.toInfo(rec);
  }

  /** Stops every running build and waits until they have sealed their versions ("Erase all data", shutdown). */
  async abortAll(): Promise<void> {
    for (const b of this.builds.values()) b.controller.abort();
    await this.whenIdle();
  }

  /** Main injects the sandboxed Electron test runner; the default is the plain-Node fallback (tests, smoke, dev). */
  setTestRunner(runner: FeatureTestRunner): void {
    this.testRunner = runner;
  }

  /** Runs a version's test.js with the current runner (also used by the e2e check). */
  async testVersion(id: string, version: number): Promise<FeatureTestResult> {
    const rec = await this.mustGet(id);
    const v = this.version(rec, version);
    return this.runTests(id, v.n, rec.language, await this.store.readVersion(id, v.n));
  }

  private async runTests(id: string, n: number, language: Language, files: Map<string, string>): Promise<FeatureTestResult> {
    const now = this.deps.now;
    const started = now();
    try {
      return await this.testRunner({ featureId: id, version: n, files, seed: defaultSeed(language), url: featureTestUrl(id, n), timeoutMs: this.testTimeoutMs, now });
    } catch (err) {
      return { passed: 0, failed: 0, total: 0, ok: false, output: "", error: `The test runner failed: ${errorText(err)}`, durationMs: now() - started };
    }
  }

  /** For "Export your data": every feature (without file contents) and what each one stored. */
  async exportAll(): Promise<{ features: Omit<FeatureInfo, "turns">[]; data: Record<string, { storage: unknown; results: unknown }> }> {
    const features = (await this.listFeatures()).map(({ turns: _turns, ...f }) => f);
    const data: Record<string, { storage: unknown; results: unknown }> = {};
    for (const f of features) data[f.id] = await this.rpc.exportFeature(f.id);
    return { features, data };
  }

  // ------------------------------------------------------------ internals

  /** What the extension host loads: the active version of every feature, with its approvals. */
  private async managedExtensions(): Promise<ManagedExtension[]> {
    const out: ManagedExtension[] = [];
    for (const r of await this.store.list()) {
      const v = r.active == null ? undefined : r.versions.find((x) => x.n === r.active && x.state === "ready");
      if (!v) continue;
      const approvedHashes = r.approvals.filter((a) => a.version === v.n && a.hash === v.hash).map((a) => a.hash);
      // Full-access code loads from the frozen copy of exactly the approved files; the builder never writes there.
      const frozen = v.fullAccess && approvedHashes.length ? this.store.approvedDir(r.id, approvedHashes[0]) : undefined;
      out.push({ id: r.id, dir: frozen ?? this.store.versionDir(r.id, v.n), enabled: r.enabled, approvedHashes });
    }
    return out;
  }

  /** Builds interrupted by a quit are marked stopped (once per process). */
  private recover(): Promise<void> {
    this.recovered ??= (async () => {
      for (const r of await this.store.list()) {
        if (!r.versions.some((v) => v.state === "building") && !r.turns.some((t) => t.status === "building")) continue;
        const sealed = new Map<number, string>();
        for (const v of r.versions) if (v.state === "building") sealed.set(v.n, hashFiles(await this.store.readVersion(r.id, v.n)));
        await this.store.update(r.id, (x) => {
          for (const v of x.versions) {
            if (v.state !== "building") continue;
            v.state = "stopped";
            v.hash = sealed.get(v.n);
            v.error = "Sayfern closed during the build.";
          }
          for (const t of x.turns) {
            if (t.status !== "building") continue;
            t.status = "stopped";
            t.error = "Sayfern closed during the build.";
          }
        });
      }
    })().catch((err) => console.error("Builder recovery failed:", errorText(err)));
    return this.recovered;
  }

  private emit(e: BuilderEvent): void {
    try {
      this.deps.emit("builder", e);
    } catch {
      // A broken listener must not break the build.
    }
  }

  private buildFor(id: string): RunningBuild | undefined {
    for (const b of this.builds.values()) if (b.featureId === id) return b;
    return undefined;
  }

  private async mustGet(id: string): Promise<FeatureRecord> {
    const rec = await this.store.get(id);
    if (!rec) throw new Error("That feature doesn't exist anymore.");
    return rec;
  }

  private version(rec: FeatureRecord, n: number): StoredVersion {
    const v = rec.versions.find((x) => x.n === n);
    if (!v) throw new Error(`Version ${n} doesn't exist.`);
    return v;
  }

  private isApproved(rec: FeatureRecord, v: StoredVersion): boolean {
    return !!v.hash && rec.approvals.some((a) => a.version === v.n && a.hash === v.hash);
  }

  private async newFeatureId(): Promise<string> {
    const taken = new Set(await this.store.ids());
    const fromNewId = `f-${this.deps.newId().replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8)}`;
    if (FEATURE_ID.test(fromNewId) && fromNewId.length === 10 && !taken.has(fromNewId)) return fromNewId;
    for (;;) {
      const id = `f-${randomBytes(4).toString("hex")}`;
      if (!taken.has(id)) return id;
    }
  }

  private toInfo(r: FeatureRecord): FeatureInfo {
    const build = this.buildFor(r.id);
    const versions: FeatureVersion[] = [...r.versions].reverse().map((v) => ({ ...structuredClone(v), approved: this.isApproved(r, v) }));
    const draft = r.draft == null ? undefined : versions.find((v) => v.n === r.draft);
    let status: FeatureStatus;
    if (build) status = "building";
    else if (draft) status = draft.state !== "ready" ? "failed" : draft.fullAccess && !draft.approved ? "review" : "preview";
    else if (r.active != null) status = r.enabled ? "on" : "off";
    else status = "failed";
    const loadError = r.enabled ? this.deps.extensions.managedList().find((x) => x.id === r.id)?.error : undefined;
    const info: FeatureInfo = {
      id: r.id,
      name: r.name,
      description: r.description,
      language: r.language,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      status,
      versions,
      enabled: r.enabled,
      turns: structuredClone(r.turns),
    };
    if (build) {
      const t = info.turns.find((x) => x.id === build.live.turnId);
      if (t) {
        t.steps = [...build.live.steps.values()].map((x) => ({ ...x }));
        t.text = build.live.text;
      }
    }
    if (r.active != null) info.active = r.active;
    if (r.draft != null) info.draft = r.draft;
    if (build) info.buildId = build.buildId;
    if (loadError) info.loadError = loadError;
    return info;
  }
}

/** Until the builder names it: the request's first words. */
function placeholderName(prompt: string): string {
  const first = prompt.split(/[.!?。！？\n]/)[0].trim();
  return first.length > 40 ? `${first.slice(0, 38).trim()}…` : first || "New feature";
}

export { testLine };
