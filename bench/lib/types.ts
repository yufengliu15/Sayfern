// Shared types for the Sayfern vs Claude Code benchmark.
// Everything here describes what crossed a boundary (HTTP to the model API,
// HTTP to AnkiConnect, text shown to the learner). Nothing depends on the
// internals of either harness, so results stay comparable across versions.

/** Which part of a run a request belongs to. Set by the runner before each step. */
export interface Phase {
  runId: string;
  arm: string;
  scenario: string;
  rep: number;
  session: number;
  /** -1 = opening, 0.. = learner turns, 1000 = end of session, -2 = setup. */
  turn: number;
  step: "setup" | "open" | "turn" | "end";
}

export interface Usage {
  /** Uncached input tokens. */
  input: number;
  output: number;
  cacheRead: number;
  /** All cache writes (5-minute and 1-hour TTL). */
  cacheWrite: number;
  /** The part of cacheWrite with a 1-hour TTL (billed higher). */
  cacheWrite1h: number;
}

export interface RequestShape {
  bytes: number;
  model?: string;
  stream: boolean;
  maxTokens?: number;
  thinking?: string;
  systemChars: number;
  toolsChars: number;
  toolCount: number;
  toolNames: string[];
  messagesChars: number;
  messageCount: number;
  /** tool_result blocks in the request (results of the previous step's tool calls). */
  toolResults: { name?: string; isError: boolean; chars: number }[];
}

/** One HTTP exchange with the model API, as seen on the wire. */
export interface WireRecord {
  seq: number;
  phase: Phase | null;
  method: string;
  path: string;
  /** "messages" for model calls; everything else is auxiliary. */
  kind: "messages" | "count_tokens" | "other";
  status: number;
  t0: number;
  firstByteMs?: number;
  totalMs?: number;
  req?: RequestShape;
  /** Model reported by the response (may differ from the request alias). */
  model?: string;
  usage?: Usage;
  stopReason?: string;
  toolUses: { name: string; inputChars: number }[];
  textChars: number;
  thinkingChars: number;
  /** Every anthropic-ratelimit-* / retry-after response header, verbatim. */
  rateLimit: Record<string, string>;
  error?: string;
  /** Exact token counts of fixed overhead, when a count_tokens probe ran for this request. */
  probe?: { systemAndTools?: number; tools?: number; empty?: number; error?: string };
}

/** One AnkiConnect call seen by the fake (or pass-through) AnkiConnect server. */
export interface AnkiCallRecord {
  seq: number;
  phase: Phase | null;
  action: string;
  params?: unknown;
  ok: boolean;
  error?: string;
  resultSize: number;
  t: number;
}

/** What the learner saw after one step. */
export interface TurnOutput {
  /** Tutor reply text. */
  reply: string;
  /** Structured feedback shown next to the reply (Sayfern correction cards), rendered as text. */
  feedback: string[];
  error?: string;
  wallMs: number;
  /** Usage as reported by the harness itself (cross-check against the wire). */
  reported?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; costUsd?: number };
  /** Harness-specific extras (tool activity lines, permission denials, ...). */
  extra?: Record<string, unknown>;
}

export interface StepResult {
  phase: Phase;
  input?: string;
  output: TurnOutput | null;
}

export interface Price {
  /** USD per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
}
