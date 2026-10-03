// Stage 2 · AI feature builder (S2-10..S2-13).
// Owned by the builder feature. Types only (plus tiny pure consts); compiled by both node and web TS projects.
// Every invokable method added to BuilderApi must also be listed in BUILDER_METHODS (compile-time check).
// Event subscriptions (`on*`) are not invokable: they are wired in src/preload/index.ts and the mock.
import type { Language } from "../records";

// ---------------------------------------------------------------- feature packages

/** Where a feature's sandboxed UI shows up (S2-11). More kinds (widgets, importers, ...) are follow-ups. */
export type FeatureSurfaceKind = "tab" | "activity";

/** One entry of `package.json` → `sayfern.surfaces`. */
export interface FeatureSurface {
  kind: FeatureSurfaceKind;
  /** Short label: the sidebar entry (tab) or the tile title (activity). */
  title: string;
  /** HTML file relative to the feature folder, e.g. "ui/index.html". */
  entry: string;
  /** One line under an activity tile. */
  description?: string;
  /** Show only in these language workspaces. Absent: every language. */
  languages?: Language[];
}

/** An enabled surface, for the sidebar (tabs) and Today (activities). */
export interface FeatureSurfaceRef {
  featureId: string;
  featureName: string;
  version: number;
  /** Index into the version's surfaces. */
  index: number;
  surface: FeatureSurface;
}

export type BuildStepKind = "read" | "write" | "test" | "preview" | "review" | "error";
export type BuildStepStatus = "running" | "done" | "failed";

/** One line of the builder's checklist (wireframe: "Read the docs…", "Wrote the activity", "Tests passed · 12 of 12"). */
export interface BuildStep {
  id: string;
  kind: BuildStepKind;
  status: BuildStepStatus;
  title: string;
  detail?: string;
}

/** Counted in code from the test runner, never reported by the model. */
export interface FeatureTestResult {
  passed: number;
  failed: number;
  total: number;
  ok: boolean;
  /** Per-test lines and console output, trimmed. */
  output: string;
  /** Set when the run itself failed (syntax error, timeout, no tests). */
  error?: string;
  durationMs: number;
}

export type FeatureVersionState = "building" | "ready" | "failed" | "stopped";

export interface FeatureFileInfo {
  path: string;
  bytes: number;
}

export interface FeatureVersion {
  n: number;
  createdAt: number;
  /** The request that produced this version. */
  prompt: string;
  /** Version this one was built from ("Ask for changes"). */
  basedOn?: number;
  state: FeatureVersionState;
  /** The builder's one-paragraph summary (from finish). */
  summary?: string;
  files: FeatureFileInfo[];
  /** sha256 of every file (path + bytes), set when the version is sealed. Approvals are tied to it. */
  hash?: string;
  tests?: FeatureTestResult;
  surfaces: FeatureSurface[];
  /** The version has a main-side entry (`package.json` "main"): it runs with full app access. */
  fullAccess: boolean;
  /** Learner approved this exact code (hash matches an approval). */
  approved: boolean;
  error?: string;
}

/** One request in a feature's builder conversation. */
export interface FeatureTurn {
  id: string;
  buildId: string;
  prompt: string;
  at: number;
  /** Version this request built. */
  version: number;
  /** "provider/model". */
  model: string;
  steps: BuildStep[];
  /** What the builder said (streamed text plus its final summary). */
  text: string;
  status: "building" | "done" | "failed" | "stopped";
  error?: string;
  usage?: { input: number; output: number; cost: number };
}

/** Status chip in Customize. */
export type FeatureStatus = "building" | "preview" | "review" | "on" | "off" | "failed";

export interface FeatureInfo {
  id: string;
  name: string;
  description: string;
  /** Workspace the feature was first built in (used for the test data). */
  language: Language;
  createdAt: number;
  updatedAt: number;
  status: FeatureStatus;
  /** Newest version first. */
  versions: FeatureVersion[];
  /** Version in use when enabled. */
  active?: number;
  enabled: boolean;
  /** Newest version that was never turned on (the preview). */
  draft?: number;
  /** Build in progress. */
  buildId?: string;
  turns: FeatureTurn[];
  /** The extension host refused or failed to load the active version. */
  loadError?: string;
}

/** One file, for the review sheet. */
export interface FeatureFile {
  path: string;
  text: string;
  bytes: number;
  /** Runs in the app with full access (main entry and its modules), not in the sandbox. */
  fullAccess: boolean;
}

/** How the renderer loads a feature UI: a sayfern-feature:// URL (app) or an inlined document (mock). */
export type FeatureFrameSource = { url: string } | { srcdoc: string };

/** Context of a sandboxed frame, sent with each forwarded call. */
export interface FeatureCallContext {
  featureId: string;
  version: number;
  language: Language;
  /** Calls from the Customize preview: results are stored as preview results. */
  preview?: boolean;
}

export interface BuildRequest {
  prompt: string;
  /** Continue this feature ("Ask for changes"); absent: a new feature. */
  featureId?: string;
  language: Language;
}

// ---------------------------------------------------------------- events

interface BuilderEventBase {
  buildId: string;
  featureId: string;
}

/** Progress of a feature build, streamed on EVENT_CHANNELS.builder (main → renderer). */
export type BuilderEvent =
  | (BuilderEventBase & { type: "started"; feature: FeatureInfo })
  | (BuilderEventBase & { type: "step"; step: BuildStep })
  | (BuilderEventBase & { type: "text"; delta: string })
  | (BuilderEventBase & { type: "done"; feature: FeatureInfo })
  | (BuilderEventBase & { type: "error"; message: string; feature: FeatureInfo | null });

// ---------------------------------------------------------------- sandbox RPC

/**
 * Methods a sandboxed feature UI may call through the SDK (window.sayfern). `context` is answered by
 * the renderer; the rest are forwarded to `featureCall`. Anything else is rejected on both sides.
 */
export const FEATURE_RPC_METHODS = [
  "context",
  "anki.words",
  "grammar.list",
  "words.saved",
  "lookup",
  "annotate",
  "storage.get",
  "storage.set",
  "results.record",
  "results.list",
] as const;
export type FeatureRpcMethod = (typeof FEATURE_RPC_METHODS)[number];

/** Limits shared by the core checks and the renderer host. */
export const FEATURE_LIMITS = {
  /** Serialized arguments of one sandbox call. */
  callArgsBytes: 64 * 1024,
  /** Calls in flight per frame. */
  callsInFlight: 16,
  /** Per-feature storage (sayfern.storage), serialized. */
  storageBytes: 256 * 1024,
  /** Stored results per feature (oldest dropped). */
  results: 2000,
} as const;

export const FEATURE_SCHEME = "sayfern-feature";

// ---------------------------------------------------------------- API

export interface BuilderApi {
  /** Built features, newest first. */
  listFeatures(): Promise<FeatureInfo[]>;
  getFeature(id: string): Promise<FeatureInfo | null>;
  /** Starts a build (a new feature, or a new draft version of `featureId`). Progress arrives on onBuilderEvent. */
  buildFeature(req: BuildRequest, model: import("../types").ModelRef): Promise<{ buildId: string; featureId: string }>;
  abortBuild(buildId: string): Promise<void>;
  /** Every file of a version, for the review sheet. */
  featureFiles(id: string, version: number): Promise<FeatureFile[]>;
  /** "I've read this code": approves this exact version (by hash). */
  approveFeature(id: string, version: number): Promise<FeatureInfo>;
  /** Turns the feature on at `version` (default: the draft, else the active version). Full-access code must be approved. */
  enableFeature(id: string, version?: number): Promise<FeatureInfo>;
  disableFeature(id: string): Promise<FeatureInfo>;
  /** Makes an older (or newer) version the active one, keeping the on/off state. */
  rollbackFeature(id: string, version: number): Promise<FeatureInfo>;
  /** Deletes the draft version. Returns null when that was the feature's only version (the feature is gone). */
  discardDraft(id: string): Promise<FeatureInfo | null>;
  deleteFeature(id: string): Promise<void>;
  /** Tabs and activities of enabled features for this workspace. */
  featureSurfaces(language: Language): Promise<FeatureSurfaceRef[]>;
  /** Where to load a surface (or any HTML entry) of a version in a sandboxed frame. */
  featureFrame(id: string, version: number, entry: string): Promise<FeatureFrameSource>;
  /** A call from a sandboxed feature UI, forwarded by the renderer host. Validated again here. */
  featureCall(ctx: FeatureCallContext, method: string, args: unknown[]): Promise<unknown>;
  onBuilderEvent(cb: (e: BuilderEvent) => void): () => void;
}

export const BUILDER_METHODS: Record<Exclude<keyof BuilderApi, `on${string}`>, true> = {
  listFeatures: true,
  getFeature: true,
  buildFeature: true,
  abortBuild: true,
  featureFiles: true,
  approveFeature: true,
  enableFeature: true,
  disableFeature: true,
  rollbackFeature: true,
  discardDraft: true,
  deleteFeature: true,
  featureSurfaces: true,
  featureFrame: true,
  featureCall: true,
};
