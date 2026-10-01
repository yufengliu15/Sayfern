// Streaming turn loop (S1-05, S1-26, S1-27).
import type {
  Api,
  AssistantMessage,
  Message,
  Model,
  Tool,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import type { TurnInput, TutorEvent, TutorTool } from "../contracts";
import type { ChatMessage, SessionMeta, ToolActivity, UsageTotals } from "../../shared/records";
import type { TutorDeps } from "./deps";
import { requestOptions } from "./options";
import { buildSystemPrompt } from "./prompt";
import { stripPasted } from "./text";
import { toolContext, turnTools, type TurnState } from "./tools";

export const MAX_ITERATIONS = 5;
export const MAX_TOKENS = 1500;
export const MAX_SOURCES = 3;
export const TARGET_COUNT = 5;

export function modelLabel(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

export function kickoffText(session: SessionMeta): string {
  if (session.kind === "practice" && session.openWith === "explain") {
    return "(The learner opened a practice session and asked you to explain the focus pattern again, with a new example. Start.)";
  }
  return `(The learner opened a ${session.kind} session. Start.)`;
}

class TurnFailure extends Error {
  constructor(
    message: string,
    readonly aborted: boolean,
    readonly partial?: AssistantMessage,
  ) {
    super(message);
  }
}

interface LoopInput {
  session: SessionMeta;
  model: Model<Api>;
  signal: AbortSignal;
  onEvent(e: TutorEvent): void;
  /** Transcript before this turn. */
  base: Message[];
  /** The new (visible or hidden) user message for the provider transcript. */
  userPi: UserMessage;
  userMessageId?: string;
  userText?: string;
}

/** Learner turn: save message, record learner words, pick targets, run the loop. */
export async function runTurn(deps: TutorDeps, input: TurnInput): Promise<ChatMessage> {
  const { records } = deps;
  const session = await records.getSession(input.sessionId).catch(() => null);
  if (!session) return unsavedError(deps, input, `Session not found: ${input.sessionId}`);

  const at = deps.now();
  const user: ChatMessage = { id: deps.newId(), sessionId: session.id, role: "user", text: input.text, at };
  if (input.pastedSpans?.length) user.pastedSpans = [...input.pastedSpans];
  try {
    await records.appendMessage(user);
  } catch (err) {
    return unsavedError(deps, input, errorText(err));
  }
  safeEmit(input.onEvent, { type: "user_saved", message: user });

  await recordLearnerWords(deps, session, user).catch(() => undefined);
  await ensureTargets(deps, session).catch(() => undefined);

  const base = await records.getTranscript(session.id).catch(() => [] as Message[]);
  return runLoop(deps, {
    session,
    model: input.model,
    signal: input.signal,
    onEvent: input.onEvent,
    base,
    userPi: { role: "user", content: input.text, timestamp: at },
    userMessageId: user.id,
    userText: input.text,
  });
}

/** The tutor speaks first: hidden kickoff message in the transcript only. */
export async function runOpening(deps: TutorDeps, input: Omit<TurnInput, "text" | "pastedSpans">): Promise<ChatMessage> {
  const session = await deps.records.getSession(input.sessionId).catch(() => null);
  if (!session) return unsavedError(deps, input, `Session not found: ${input.sessionId}`);
  await ensureTargets(deps, session).catch(() => undefined);
  const base = await deps.records.getTranscript(session.id).catch(() => [] as Message[]);
  return runLoop(deps, {
    session,
    model: input.model,
    signal: input.signal,
    onEvent: input.onEvent,
    base,
    userPi: { role: "user", content: kickoffText(session), timestamp: deps.now() },
  });
}

async function recordLearnerWords(deps: TutorDeps, session: SessionMeta, user: ChatMessage): Promise<void> {
  const pack = deps.lang.pack(session.language);
  await pack.ready();
  const own = stripPasted(user.text, user.pastedSpans);
  const words = pack.learnerWords(own);
  await deps.records.recordLearnerWords({
    language: session.language,
    sessionId: session.id,
    messageId: user.id,
    sentence: user.text,
    words,
    at: user.at,
  });
  if (words.length === 0) return;
  const targets = await deps.records.getTargets(session.id);
  const used = new Set(words);
  const hits = targets.filter((t) => used.has(t.word)).map((t) => t.word);
  if (hits.length) await deps.records.markTargets(session.id, hits, "used");
}

async function ensureTargets(deps: TutorDeps, session: SessionMeta): Promise<void> {
  const existing = await deps.records.getTargets(session.id);
  if (existing.length > 0) return;
  if (!(await deps.ankiEnabled())) return;
  const targets = await deps.anki.selectTargets(session.language, TARGET_COUNT, async (word) => {
    const u = await deps.records.getWordUsage(session.language, word);
    return u?.count ?? 0;
  });
  if (targets.length) await deps.records.setTargets(session.id, targets);
}

/** Anki tools are offered only when Anki is on and this language has a snapshot. */
export async function ankiReady(deps: TutorDeps, language: SessionMeta["language"]): Promise<boolean> {
  try {
    return (await deps.ankiEnabled()) && !!(await deps.anki.snapshot(language));
  } catch {
    return false;
  }
}

function textOf(m: AssistantMessage): string {
  return m.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function addUsage(total: UsageTotals, m: AssistantMessage | undefined): void {
  if (!m?.usage) return;
  total.input += m.usage.input || 0;
  total.output += m.usage.output || 0;
  total.cost += m.usage.cost?.total || 0;
}

async function runLoop(deps: TutorDeps, li: LoopInput): Promise<ChatMessage> {
  const { records } = deps;
  const { session, model, signal } = li;
  const emit = (e: TutorEvent) => safeEmit(li.onEvent, e);

  const turn: TurnState = {
    session,
    userMessageId: li.userMessageId,
    userText: li.userText,
    emit,
    sources: [],
    emittedCorrections: new Set(),
  };
  const tools = turnTools(deps, turn, { anki: await ankiReady(deps, session.language) });
  const byName = new Map(tools.map((t) => [t.name, t]));
  const piTools: Tool[] = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  const ctx = toolContext(deps, turn);

  const transcript: Message[] = [...li.base, li.userPi];
  /** transcript.length after the last fully completed iteration. */
  let committed = transcript.length;
  let completedIterations = 0;
  let text = "";
  const usage: UsageTotals = { input: 0, output: 0, cost: 0 };
  const activity: ToolActivity[] = [];
  let failure: TurnFailure | null = null;

  const appendText = (delta: string) => {
    text += delta;
    emit({ type: "delta", text: delta });
  };

  try {
    const systemPrompt = await buildSystemPrompt(deps, session);
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (signal.aborted) throw new TurnFailure("Stopped", true);
      let needSeparator = false;
      let streamedThisIter = "";
      let message: AssistantMessage | undefined;
      const stream = deps.models.streamSimple(model, { systemPrompt, messages: transcript, tools: piTools }, { signal, ...requestOptions(model, MAX_TOKENS) });
      for await (const ev of stream) {
        if (ev.type === "text_start") {
          needSeparator = text.trim().length > 0;
        } else if (ev.type === "text_delta") {
          if (!ev.delta) continue;
          if (needSeparator) {
            needSeparator = false;
            const sep = text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
            if (sep) appendText(sep);
          }
          appendText(ev.delta);
          streamedThisIter += ev.delta;
        } else if (ev.type === "done") {
          message = ev.message;
        } else if (ev.type === "error") {
          const aborted = ev.reason === "aborted" || signal.aborted;
          throw new TurnFailure(aborted ? "Stopped" : ev.error.errorMessage || "The model request failed.", aborted, ev.error);
        }
      }
      if (!message) throw new TurnFailure(signal.aborted ? "Stopped" : "The model stream ended without a reply.", signal.aborted);

      // A provider that returned text without streaming deltas: surface it now.
      const final = textOf(message);
      if (final.trim() && !streamedThisIter) appendText((text.trim() ? "\n\n" : "") + final);
      addUsage(usage, message);

      const calls = message.content.filter((c): c is ToolCall => c.type === "toolCall");
      const results: ToolResultMessage[] = [];
      for (const call of calls) {
        const { result, act } = await runTool(byName.get(call.name), call, ctx, deps.now());
        results.push(result);
        activity.push(act);
        emit({ type: "tool", activity: act });
      }
      transcript.push(message, ...results);
      committed = transcript.length;
      completedIterations++;

      if (calls.length === 0) break;
      const recordingOnly = calls.every((c) => byName.get(c.name)?.recordingOnly === true);
      if (recordingOnly && text.trim()) break; // S1-27: no follow-up request just to acknowledge a write
    }
  } catch (err) {
    failure =
      err instanceof TurnFailure
        ? err
        : new TurnFailure(signal.aborted ? "Stopped" : errorText(err), signal.aborted);
    addUsage(usage, failure.partial);
  }

  // Nothing to show (e.g. a reasoning model spent the whole output cap thinking): report it rather than
  // saving a blank bubble, and keep the empty exchange out of the transcript so a retry starts clean.
  let empty = false;
  if (!failure && !text.trim()) {
    empty = true;
    failure = new TurnFailure("The model sent an empty reply. Try again, or pick another model.", false);
  }

  // Persist the transcript: drop the failed iteration; if nothing completed, drop the new user message too.
  const finalTranscript = failure && (completedIterations === 0 || empty) ? li.base : transcript.slice(0, committed);

  const tutor: ChatMessage = {
    id: deps.newId(),
    sessionId: session.id,
    role: "tutor",
    text: text.trim(),
    at: deps.now(),
    model: modelLabel(model),
    usage,
  };
  if (failure) tutor.error = failure.aborted ? "Stopped" : failure.message;
  if (activity.length) tutor.toolActivity = activity;
  const sources = turn.sources.slice(0, MAX_SOURCES);
  if (sources.length) tutor.sources = sources;

  try {
    await records.setTranscript(session.id, finalTranscript);
    await records.appendMessage(tutor);
    await records.addUsage(session.id, usage);
    if (!failure) await markAsked(deps, session.id, tutor.text);
  } catch (err) {
    tutor.error ??= `Could not save the reply: ${errorText(err)}`;
  }
  return tutor;
}

async function markAsked(deps: TutorDeps, sessionId: string, text: string): Promise<void> {
  if (!text) return;
  const targets = await deps.records.getTargets(sessionId);
  const asked = targets.filter((t) => t.status === "pending" && text.includes(t.word)).map((t) => t.word);
  if (asked.length) await deps.records.markTargets(sessionId, asked, "asked");
}

async function runTool(
  tool: TutorTool | undefined,
  call: ToolCall,
  ctx: ReturnType<typeof toolContext>,
  at: number,
): Promise<{ result: ToolResultMessage; act: ToolActivity }> {
  const base = { role: "toolResult" as const, toolCallId: call.id, toolName: call.name, timestamp: at };
  if (!tool) {
    return {
      result: { ...base, content: [{ type: "text", text: `Unknown tool: ${call.name}` }], isError: true },
      act: { name: call.name, summary: `Unknown tool ${call.name}`, ok: false },
    };
  }
  try {
    const out = await tool.execute(call.arguments ?? {}, ctx);
    return {
      result: { ...base, content: [{ type: "text", text: out.content || "Done." }], isError: false },
      act: { name: call.name, summary: out.activity, ok: true },
    };
  } catch (err) {
    const msg = errorText(err);
    return {
      result: { ...base, content: [{ type: "text", text: `Error: ${msg}` }], isError: true },
      act: { name: call.name, summary: `${call.name} failed: ${msg}`, ok: false },
    };
  }
}

function unsavedError(deps: TutorDeps, input: { sessionId: string; model: Model<Api> }, error: string): ChatMessage {
  return {
    id: deps.newId(),
    sessionId: input.sessionId,
    role: "tutor",
    text: "",
    at: deps.now(),
    model: modelLabel(input.model),
    error,
  };
}

function safeEmit(onEvent: (e: TutorEvent) => void, e: TutorEvent): void {
  try {
    onEvent(e);
  } catch {
    // A broken listener must not break the turn.
  }
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
