// The builder agent (S2-10, S2-12): the learner's chosen model, with tools to read the builder kit,
// write files into the draft version, run the feature's tests and finish. Same streaming pattern as the
// tutor's turn loop (src/core/agent/turn.ts): stream, run tool calls between iterations, abort, usage.
import { Type, type Api, type AssistantMessage, type Message, type Model, type MutableModels, type Tool, type ToolCall, type ToolResultMessage } from "@earendil-works/pi-ai";
import type { BuildStep, FeatureTestResult } from "../../shared/stage2";
import { LANGUAGE_META } from "../../shared/languages";
import { LANGUAGES, type Language } from "../../shared/records";
import { requestOptions } from "../agent/options";
import type { BuilderKit } from "./kit";
import { checkMainSideCode, readManifest } from "./manifest";
import { PACKAGE_LIMITS, normalizeFeaturePath } from "./paths";
import { msg } from "../../shared/i18n";

export const MAX_BUILD_ITERATIONS = 25;
/** Output tokens per request: whole files arrive as tool arguments. */
export const BUILD_ANSWER_TOKENS = 16_000;
const TOOL_RESULT_LIMIT = 20_000;

/** The draft version's files, as the loop may touch them. Writes are refused once the version is sealed. */
export interface DraftFiles {
  list(): Promise<{ path: string; bytes: number }[]>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<string>;
  remove(path: string): Promise<boolean>;
  all(): Promise<Map<string, string>>;
}

export interface BuilderLoopInput {
  models: MutableModels;
  model: Model<Api>;
  signal: AbortSignal;
  kit: BuilderKit;
  files: DraftFiles;
  runTests(): Promise<FeatureTestResult>;
  prompt: string;
  language: Language;
  /** Interface language for the feature's UI copy ("German"). Default English. */
  explain?: string;
  featureId: string;
  version: number;
  /** Earlier requests and outcomes for this feature ("Ask for changes"). */
  history: { prompt: string; outcome: string; version: number }[];
  now(): number;
  onText(delta: string): void;
  onStep(step: BuildStep): void;
}

export interface FinishInfo {
  summary: string;
  name: string;
  description: string;
}

export interface BuilderLoopResult {
  finished?: FinishInfo;
  text: string;
  usage: { input: number; output: number; cost: number };
  lastTests?: FeatureTestResult;
  error?: string;
  aborted?: boolean;
}

export function builderSystemPrompt(language: Language, explain = "English"): string {
  const meta = LANGUAGE_META[language];
  return `You are Sayfern's feature builder. Sayfern is a macOS app for learning languages (${LANGUAGES.map((l) => LANGUAGE_META[l].name).join(", ")}) with an AI tutor. A learner describes a small personal feature; you build it as a feature package (an extension folder), test it, and hand it back for preview.

How to work:
1. Call list_kit, then read docs/feature-builder.md (the rules and SDK) and at least one example in examples/extensions/ before writing anything.
2. Write the files with write_feature_file. Keep it small: usually package.json, ui/index.html, ui/main.js, one pure logic module, test.js.
3. Write test.js for the pure logic (and the SDK calls it makes), then call run_tests. Fix and rerun until every test passes.
4. Call finish with a short summary, a name and a one-line description.

Rules:
- Prefer sandboxed UI surfaces (a "tab" or an "activity" in package.json "sayfern.surfaces"). They run in a locked-down frame and reach Sayfern only through window.sayfern (the SDK).
- Add a "main" entry (tutor tools or prompt additions with full app access) only when the request needs the tutor itself to change. The learner must read and approve that code before it can run, so say so in the summary.
- Plain JavaScript ES modules, HTML and CSS only. No build step, no npm packages, no imports from URLs, no network, no external fonts, images or CDNs. Link the SDK and stylesheet exactly as the guide shows.
- Put logic in pure modules that don't touch the DOM when imported, so tests can import them.
- Every number shown to the learner (scores, counts) is computed by your code, never made up.
- UI copy is in ${explain} (the learner's interface language), plain and short, with no em dashes. Learning content is in the target language.
- Only call the tools. Don't paste file contents into your messages.

The learner's current workspace: ${meta ? `${meta.name}, ${meta.variety}` : language} (${language}).`;
}

function userMessage(input: BuilderLoopInput, existing: { path: string; bytes: number }[]): string {
  const parts: string[] = [];
  if (input.history.length) {
    parts.push("Earlier requests for this feature:");
    for (const h of input.history.slice(-6)) parts.push(`- v${h.version}: "${h.prompt.slice(0, 400)}" → ${h.outcome.slice(0, 400)}`);
    parts.push("");
  }
  if (existing.length) {
    parts.push(`You are building version ${input.version}. It starts as a copy of the previous version, with these files:`);
    for (const f of existing) parts.push(`- ${f.path} (${f.bytes} bytes)`);
    parts.push("Change only what the request needs. Read files before editing them.", "");
  }
  parts.push(`Request: ${input.prompt}`);
  return parts.join("\n");
}

const TOOLS: Tool[] = [
  { name: "list_kit", description: "List the builder kit: docs, the SDK reference, Sayfern's extension types and example extensions.", parameters: Type.Object({}) },
  {
    name: "read_kit_file",
    description: "Read one file from the builder kit (paths from list_kit).",
    parameters: Type.Object({ path: Type.String() }),
  },
  { name: "list_feature_files", description: "List the files of the feature you are building.", parameters: Type.Object({}) },
  {
    name: "read_feature_file",
    description: "Read one file of the feature you are building.",
    parameters: Type.Object({ path: Type.String() }),
  },
  {
    name: "write_feature_file",
    description: `Create or replace one file of the feature (path relative to the feature folder, e.g. "ui/main.js"). Text files only: .js .mjs .html .css .json .md .txt .svg. Max ${PACKAGE_LIMITS.fileBytes / 1024} KB per file.`,
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
  },
  {
    name: "delete_feature_file",
    description: "Delete one file of the feature.",
    parameters: Type.Object({ path: Type.String() }),
  },
  {
    name: "run_tests",
    description: "Run test.js in a sandbox against a fake SDK with sample learner data. Returns pass/fail counts and output.",
    parameters: Type.Object({}),
  },
  {
    name: "finish",
    description: "Hand the feature to the learner for preview. Call once, after the tests pass.",
    parameters: Type.Object({
      summary: Type.String({ description: "2 or 3 plain sentences for the learner: what it does and where to find it. No em dashes." }),
      name: Type.String({ description: "Feature name, max 40 characters." }),
      description: Type.String({ description: "One sentence, max 120 characters." }),
    }),
  },
];

class Stop extends Error {
  constructor(
    message: string,
    readonly aborted: boolean,
    readonly partial?: AssistantMessage,
  ) {
    super(message);
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function cap(s: string, n = TOOL_RESULT_LIMIT): string {
  return s.length > n ? `${s.slice(0, n)}\n… (cut)` : s;
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string") throw new Error(`${key} must be a string`);
  return v;
}

export function testLine(t: FeatureTestResult): string {
  if (t.error) return t.error;
  return t.ok ? `${t.passed} of ${t.total} passed` : `${t.passed} of ${t.total} passed, ${t.failed} failed`;
}

/** Tracks the checklist the learner sees. Titles and counts come from code, not from the model. */
class Steps {
  private readonly kitRead = new Set<string>();
  private readonly written = new Set<string>();
  private readStep?: BuildStep;
  private writeStep?: BuildStep;
  private testStep?: BuildStep;

  constructor(
    private readonly emit: (s: BuildStep) => void,
    private readonly featureId: string,
  ) {}

  private examples(): string[] {
    return [...new Set([...this.kitRead].filter((p) => p.startsWith("examples/extensions/")).map((p) => p.split("/")[2]))];
  }

  reading(path?: string): void {
    if (path) this.kitRead.add(path);
    const ex = this.examples();
    const done = !!this.writeStep;
    const title = done
      ? ex.length
        ? `Read the docs and ${ex.length === 1 ? "one example" : ex.length === 2 ? "two examples" : `${ex.length} examples`}`
        : "Read the docs"
      : "Reading the docs and examples";
    this.readStep = { id: "read", kind: "read", status: done ? "done" : "running", title, detail: ex.join(" · ") || undefined };
    this.emit(this.readStep);
  }

  wrote(path: string, removed = false): void {
    if (this.readStep?.status === "running") {
      this.writeStep = { id: "write", kind: "write", status: "running", title: msg("Writing the feature") };
      this.reading();
    }
    if (removed) this.written.delete(path);
    else this.written.add(path);
    const n = this.written.size;
    this.writeStep = { id: "write", kind: "write", status: "running", title: msg("Writing the feature"), detail: `features/${this.featureId} · ${n} file${n === 1 ? "" : "s"}` };
    this.emit(this.writeStep);
  }

  /** Called with the manifest's first surface kind once files exist. */
  wroteDone(kind: string | undefined, files: number): void {
    if (!this.writeStep || this.writeStep.status === "done") return;
    const what = kind === "tab" ? "the tab" : kind === "activity" ? "the activity" : kind === "main" ? "the tutor add-on" : "the feature";
    this.writeStep = { ...this.writeStep, status: "done", title: `Wrote ${what}`, detail: `features/${this.featureId} · ${files} file${files === 1 ? "" : "s"}` };
    this.emit(this.writeStep);
  }

  testing(): void {
    this.testStep = { id: "test", kind: "test", status: "running", title: msg("Running tests") };
    this.emit(this.testStep);
  }

  tested(t: FeatureTestResult): void {
    this.testStep = t.ok
      ? { id: "test", kind: "test", status: "done", title: msg("Tests passed"), detail: `${t.passed} of ${t.total}` }
      : { id: "test", kind: "test", status: "failed", title: t.error ? "Tests didn't run" : "Tests failed", detail: t.error ? cap(t.error, 160) : `${t.passed} of ${t.total} passed` };
    this.emit(this.testStep);
  }

  reopenWrite(): void {
    if (this.writeStep?.status === "done") {
      this.writeStep = { ...this.writeStep, status: "running", title: msg("Writing the feature") };
      this.emit(this.writeStep);
    }
  }
}

export async function runBuilderLoop(input: BuilderLoopInput): Promise<BuilderLoopResult> {
  const { model, signal } = input;
  const steps = new Steps(input.onStep, input.featureId);
  const usage = { input: 0, output: 0, cost: 0 };
  let text = "";
  let finished: FinishInfo | undefined;
  let lastTests: FeatureTestResult | undefined;
  /** Writes since the last test run. */
  let dirty = false;
  let wroteAnything = false;
  let nudged = false;

  const appendText = (delta: string) => {
    text += delta;
    input.onText(delta);
  };
  const addUsage = (m?: AssistantMessage) => {
    if (!m?.usage) return;
    usage.input += m.usage.input || 0;
    usage.output += m.usage.output || 0;
    usage.cost += m.usage.cost?.total || 0;
  };

  const exec = async (call: ToolCall): Promise<{ text: string; isError: boolean }> => {
    const args = (call.arguments ?? {}) as Record<string, unknown>;
    switch (call.name) {
      case "list_kit": {
        steps.reading();
        const files = await input.kit.list();
        if (!files.length) return { text: "The kit is empty in this build. Follow the rules in the system prompt.", isError: false };
        return { text: `Start with docs/feature-builder.md.\n${files.map((f) => `${f.path} (${f.bytes} bytes)`).join("\n")}`, isError: false };
      }
      case "read_kit_file": {
        const path = str(args, "path").trim().replace(/^\.\//, "");
        const body = await input.kit.read(path);
        steps.reading(path);
        return { text: body, isError: false };
      }
      case "list_feature_files": {
        const files = await input.files.list();
        return { text: files.length ? files.map((f) => `${f.path} (${f.bytes} bytes)`).join("\n") : "No files yet.", isError: false };
      }
      case "read_feature_file":
        return { text: cap(await input.files.read(str(args, "path"))), isError: false };
      case "write_feature_file": {
        const path = await input.files.write(str(args, "path"), str(args, "content"));
        dirty = true;
        wroteAnything = true;
        steps.reopenWrite();
        steps.wrote(path);
        return { text: `Wrote ${path}.`, isError: false };
      }
      case "delete_feature_file": {
        const path = normalizeFeaturePath(str(args, "path"));
        const ok = await input.files.remove(path);
        if (ok) {
          dirty = true;
          steps.wrote(path, true);
        }
        return { text: ok ? `Deleted ${path}.` : `No such file: ${path}`, isError: !ok };
      }
      case "run_tests": {
        const all = await input.files.all();
        const { manifest } = readManifest(all);
        steps.wroteDone(manifest?.surfaces[0]?.kind ?? (manifest?.main ? "main" : undefined), all.size);
        steps.testing();
        const t = await input.runTests();
        lastTests = t;
        dirty = false;
        steps.tested(t);
        const head = t.error ? `Tests didn't run: ${t.error}` : `${t.passed} passed, ${t.failed} failed (of ${t.total}).`;
        return { text: cap(`${head}\n${t.output}`), isError: false };
      }
      case "finish": {
        const all = await input.files.all();
        const read = readManifest(all);
        const manifest = read.manifest;
        const problems = [...read.problems, ...checkMainSideCode(all, manifest?.main)];
        if (problems.length) return { text: `Fix these before finishing:\n- ${problems.join("\n- ")}`, isError: true };
        if (!all.has("test.js")) return { text: "Write test.js and run the tests before finishing.", isError: true };
        if (!lastTests || dirty) return { text: "Files changed since the last test run. Call run_tests first.", isError: true };
        steps.wroteDone(manifest?.surfaces[0]?.kind ?? (manifest?.main ? "main" : undefined), all.size);
        finished = {
          summary: String(args.summary ?? "").trim().slice(0, 1200),
          name: String(args.name ?? "").trim().slice(0, 40) || manifest?.name || "New feature",
          description: String(args.description ?? "").trim().slice(0, 160) || manifest?.description || "",
        };
        return { text: "Handed to the learner for preview.", isError: false };
      }
      default:
        return { text: `Unknown tool: ${call.name}`, isError: true };
    }
  };

  const existing = await input.files.list();
  const transcript: Message[] = [{ role: "user", content: userMessage(input, existing), timestamp: input.now() }];
  const systemPrompt = builderSystemPrompt(input.language, input.explain);
  const opts = requestOptions(model, BUILD_ANSWER_TOKENS);
  if (model.maxTokens && opts.maxTokens > model.maxTokens) opts.maxTokens = model.maxTokens;

  try {
    for (let iter = 0; iter < MAX_BUILD_ITERATIONS && !finished; iter++) {
      if (signal.aborted) throw new Stop("Stopped", true);
      let message: AssistantMessage | undefined;
      let streamed = "";
      let needSeparator = false;
      const stream = input.models.streamSimple(model, { systemPrompt, messages: transcript, tools: TOOLS }, { signal, ...opts });
      for await (const ev of stream) {
        if (ev.type === "text_start") needSeparator = text.trim().length > 0;
        else if (ev.type === "text_delta") {
          if (!ev.delta) continue;
          if (needSeparator) {
            needSeparator = false;
            if (!text.endsWith("\n\n")) appendText(text.endsWith("\n") ? "\n" : "\n\n");
          }
          appendText(ev.delta);
          streamed += ev.delta;
        } else if (ev.type === "done") message = ev.message;
        else if (ev.type === "error") {
          const aborted = ev.reason === "aborted" || signal.aborted;
          throw new Stop(aborted ? "Stopped" : ev.error.errorMessage || "The model request failed.", aborted, ev.error);
        }
      }
      if (!message) throw new Stop(signal.aborted ? "Stopped" : "The model stream ended without a reply.", signal.aborted);
      addUsage(message);
      const final = message.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");
      if (final.trim() && !streamed) appendText((text.trim() ? "\n\n" : "") + final);

      const calls = message.content.filter((c): c is ToolCall => c.type === "toolCall");
      const results: ToolResultMessage[] = [];
      for (const call of calls) {
        if (signal.aborted) throw new Stop("Stopped", true);
        let out: { text: string; isError: boolean };
        try {
          out = await exec(call);
        } catch (err) {
          out = { text: `Error: ${errorText(err)}`, isError: true };
        }
        results.push({ role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text: out.text }], isError: out.isError, timestamp: input.now() });
      }
      transcript.push(message, ...results);
      if (finished) break;
      if (calls.length === 0) {
        if (nudged) throw new Stop(wroteAnything ? "The builder stopped before finishing. Ask for changes to continue." : "The builder stopped without writing anything.", false);
        nudged = true;
        transcript.push({
          role: "user",
          content: "Keep going with the tools: write the files, run_tests until they pass, then call finish. If the request can't be built with the SDK, explain why in one or two sentences and stop.",
          timestamp: input.now(),
        });
      }
    }
    if (!finished) throw new Stop(`The builder used all ${MAX_BUILD_ITERATIONS} steps without finishing. Ask for changes to continue.`, false);
  } catch (err) {
    const stop = err instanceof Stop ? err : new Stop(signal.aborted ? "Stopped" : errorText(err), signal.aborted);
    addUsage(stop.partial);
    return { text: text.trim(), usage, lastTests, error: stop.aborted ? "Stopped" : stop.message, aborted: stop.aborted };
  }
  return { finished, text: text.trim(), usage, lastTests };
}
