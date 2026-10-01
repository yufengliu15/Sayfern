// Parsing of Anthropic Messages API traffic. This is the stable boundary both
// harnesses share: request bodies (system, tools, messages) and response usage.
// Unknown fields are ignored, so new API features do not break parsing.
import type { RequestShape, Usage } from "./types";

const len = (v: unknown): number => (v === undefined ? 0 : JSON.stringify(v).length);

function blocks(content: unknown): Record<string, unknown>[] {
  if (Array.isArray(content)) return content.filter((b) => b && typeof b === "object") as Record<string, unknown>[];
  return [];
}

export function parseRequest(body: string): RequestShape | undefined {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(body);
  } catch {
    return undefined;
  }
  const tools = Array.isArray(j.tools) ? (j.tools as Record<string, unknown>[]) : [];
  const messages = Array.isArray(j.messages) ? (j.messages as Record<string, unknown>[]) : [];
  // Map tool_use ids to names so tool_result blocks can be attributed.
  const names = new Map<string, string>();
  for (const m of messages) for (const b of blocks(m.content)) if (b.type === "tool_use") names.set(String(b.id), String(b.name));
  const toolResults: RequestShape["toolResults"] = [];
  // Only the newest user message carries this step's tool results. Skip trailing
  // non-conversation entries (some clients append system/config messages).
  const last = [...messages].reverse().find((m) => m.role === "user" || m.role === "assistant");
  if (last && last.role === "user") {
    for (const b of blocks(last.content)) {
      if (b.type !== "tool_result") continue;
      toolResults.push({ name: names.get(String(b.tool_use_id)), isError: b.is_error === true, chars: len(b.content) });
    }
  }
  const thinking = j.thinking && typeof j.thinking === "object" ? (j.thinking as Record<string, unknown>) : undefined;
  return {
    bytes: Buffer.byteLength(body),
    model: typeof j.model === "string" ? j.model : undefined,
    stream: j.stream === true,
    maxTokens: typeof j.max_tokens === "number" ? j.max_tokens : undefined,
    thinking: thinking ? String(thinking.type ?? "") + (thinking.budget_tokens ? `:${thinking.budget_tokens}` : "") : undefined,
    systemChars: len(j.system),
    toolsChars: len(j.tools),
    toolCount: tools.length,
    toolNames: tools.map((t) => String(t.name ?? t.type ?? "?")),
    messagesChars: len(j.messages),
    messageCount: messages.length,
    toolResults,
  };
}

export interface ParsedResponse {
  model?: string;
  usage?: Usage;
  stopReason?: string;
  toolUses: { name: string; inputChars: number }[];
  textChars: number;
  thinkingChars: number;
  error?: string;
}

function usageFrom(u: Record<string, unknown> | undefined, into: Usage): void {
  if (!u) return;
  const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : undefined);
  const set = (key: keyof Usage, v: number | undefined) => {
    if (v !== undefined) into[key] = v;
  };
  set("input", n("input_tokens"));
  set("output", n("output_tokens"));
  set("cacheRead", n("cache_read_input_tokens"));
  set("cacheWrite", n("cache_creation_input_tokens"));
  const cc = u.cache_creation as Record<string, unknown> | undefined;
  if (cc && typeof cc.ephemeral_1h_input_tokens === "number") into.cacheWrite1h = cc.ephemeral_1h_input_tokens;
}

const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 });

/** Non-streaming JSON response. */
export function parseJsonResponse(body: string): ParsedResponse {
  const out: ParsedResponse = { toolUses: [], textChars: 0, thinkingChars: 0 };
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(body);
  } catch {
    return out;
  }
  if (j.type === "error") {
    out.error = JSON.stringify(j.error ?? j).slice(0, 300);
    return out;
  }
  if (typeof j.model === "string") out.model = j.model;
  if (typeof j.stop_reason === "string") out.stopReason = j.stop_reason;
  if (j.usage) {
    out.usage = emptyUsage();
    usageFrom(j.usage as Record<string, unknown>, out.usage);
  }
  for (const b of blocks(j.content)) {
    if (b.type === "text") out.textChars += String(b.text ?? "").length;
    else if (b.type === "thinking") out.thinkingChars += String(b.thinking ?? "").length;
    else if (b.type === "tool_use" || b.type === "server_tool_use") out.toolUses.push({ name: String(b.name), inputChars: len(b.input) });
  }
  return out;
}

/** Incremental SSE parser for streamed responses. */
export class SseParser {
  private buf = "";
  private toolInput = new Map<number, { name: string; chars: number }>();
  readonly out: ParsedResponse = { toolUses: [], textChars: 0, thinkingChars: 0 };

  push(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf("\n\n")) >= 0) {
      const raw = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const data = raw
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) this.event(data);
    }
  }

  end(): ParsedResponse {
    if (this.buf.trim()) this.push("\n\n");
    for (const t of this.toolInput.values()) this.out.toolUses.push({ name: t.name, inputChars: t.chars });
    this.toolInput.clear();
    return this.out;
  }

  private event(data: string): void {
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(data);
    } catch {
      return;
    }
    const o = this.out;
    switch (e.type) {
      case "message_start": {
        const m = (e.message ?? {}) as Record<string, unknown>;
        if (typeof m.model === "string") o.model = m.model;
        o.usage ??= emptyUsage();
        usageFrom(m.usage as Record<string, unknown>, o.usage);
        break;
      }
      case "message_delta": {
        const d = (e.delta ?? {}) as Record<string, unknown>;
        if (typeof d.stop_reason === "string") o.stopReason = d.stop_reason;
        o.usage ??= emptyUsage();
        usageFrom(e.usage as Record<string, unknown>, o.usage);
        break;
      }
      case "content_block_start": {
        const b = (e.content_block ?? {}) as Record<string, unknown>;
        const idx = Number(e.index);
        if (b.type === "tool_use" || b.type === "server_tool_use") this.toolInput.set(idx, { name: String(b.name), chars: 0 });
        break;
      }
      case "content_block_delta": {
        const d = (e.delta ?? {}) as Record<string, unknown>;
        if (d.type === "text_delta") o.textChars += String(d.text ?? "").length;
        else if (d.type === "thinking_delta") o.thinkingChars += String(d.thinking ?? "").length;
        else if (d.type === "input_json_delta") {
          const t = this.toolInput.get(Number(e.index));
          if (t) t.chars += String(d.partial_json ?? "").length;
        }
        break;
      }
      case "content_block_stop": {
        const idx = Number(e.index);
        const t = this.toolInput.get(idx);
        if (t) {
          o.toolUses.push({ name: t.name, inputChars: t.chars });
          this.toolInput.delete(idx);
        }
        break;
      }
      case "error":
        o.error = JSON.stringify(e.error ?? e).slice(0, 300);
        break;
    }
  }
}

/** Total prompt tokens the model processed for a request (cached or not). */
export const promptTokens = (u: Usage | undefined): number => (u ? u.input + u.cacheRead + u.cacheWrite : 0);
