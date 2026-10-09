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
import type { OpeningInput, TurnInput, TutorEvent, TutorTool } from "../contracts";
import type { ChatMessage, SessionMeta, ToolActivity, UsageTotals } from "../../shared/records";
import type { TutorDeps } from "./deps";
import { needsEvidencePass, requestOptions } from "./options";
import { buildSystemPrompt, SPOKEN_MARKER } from "./prompt";
import { leakedCalls, leakStart, pendingTail, stripLeak, type LeakedCall } from "./leak";
import { stripPasted } from "./text";
import { toolContext, turnTools, type TurnState } from "./tools";

export const MAX_ITERATIONS = 5;
export const MAX_TOKENS = 1500;
export const MAX_SOURCES = 3;
export const TARGET_COUNT = 5;
/** Output cap for the evidence pass (tool call only). */
export const EVIDENCE_PASS_TOKENS = 1200;

/** Hidden instruction for the evidence pass. Never stored in the transcript. */
export const EVIDENCE_NUDGE =
  "(Message from the app, not from the learner: you replied without calling record_evidence. Call record_evidence now for the learner's latest message: corrections of real mistakes with `original` copied exactly from their message, grammar observations, patterns you taught, level estimates. Use empty lists if there is nothing to record. Do not write any text.)";

export function modelLabel(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

export function kickoffText(session: SessionMeta, opts: { newTopic?: boolean } = {}): string {
  if (opts.newTopic) {
    return "(The learner pressed \"New topic\". Drop the current topic without summing it up and open a fresh one, clearly different from what this session has covered so far. Pick something that fits their interests if you know them. Start.)";
  }
  if (session.kind === "practice" && session.unitId && session.openWith === "explain") {
    return "(The learner started a course unit and asked for a quick overview of its grammar first. Give the short overview, then open the conversation. Start.)";
  }
  if (session.kind === "practice" && session.unitId) {
    return "(The learner started a course unit. Open with a situation from the unit that fits them, and bring in its first grammar point. Start.)";
  }
  if (session.kind === "practice" && session.openWith === "explain") {
    return "(The learner opened a practice session and asked you to explain the focus pattern again, with a new example. Start.)";
  }
  if (session.scenarioId) {
    return "(The learner picked a role-play. Set the scene in one short line, then speak your first line in role. Start.)";
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
  if (input.spoken) user.spoken = true;
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
    // Spoken messages carry a marker so the tutor knows the text came from speech recognition.
    userPi: { role: "user", content: input.spoken ? `${SPOKEN_MARKER} ${input.text}` : input.text, timestamp: at },
    userMessageId: user.id,
    userText: input.text,
  });
}

/** The tutor speaks first: hidden kickoff message in the transcript only. */
export async function runOpening(deps: TutorDeps, input: OpeningInput): Promise<ChatMessage> {
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
    userPi: { role: "user", content: kickoffText(session, { newTopic: input.newTopic }), timestamp: deps.now() },
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

/** The message with its text blocks replaced by one block holding `text` (dropped when empty). */
function withText(m: AssistantMessage, text: string): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  let placed = false;
  for (const c of m.content) {
    if (c.type !== "text") content.push(c);
    else if (!placed) {
      placed = true;
      if (text.trim()) content.push({ ...c, text });
    }
  }
  return { ...m, content };
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

  // Earlier replies saved before v0.9.1 may still hold leaked tool-call text: don't show it to the model again.
  const base = li.base.map((m) => (m.role === "assistant" && leakStart(textOf(m)) >= 0 ? withText(m, stripLeak(textOf(m))) : m));
  const transcript: Message[] = [...base, li.userPi];
  /** transcript.length after the last fully completed iteration. */
  let committed = transcript.length;
  let completedIterations = 0;
  let text = "";
  const usage: UsageTotals = { input: 0, output: 0, cost: 0 };
  const activity: ToolActivity[] = [];
  let failure: TurnFailure | null = null;
  let evidenceCalled = false;
  let systemPrompt = "";

  const appendText = (delta: string) => {
    text += delta;
    emit({ type: "delta", text: delta });
  };

  try {
    systemPrompt = await buildSystemPrompt(deps, session);
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (signal.aborted) throw new TurnFailure("Stopped", true);
      let needSeparator = false;
      // This iteration's reply text, held back from the learner once leaked tool-call text starts (leak.ts).
      let raw = "";
      let shown = 0;
      const flush = (final: boolean) => {
        const cut = leakStart(raw);
        const safe = cut >= 0 ? cut : final ? raw.length : raw.length - pendingTail(raw);
        if (safe > shown) {
          appendText(raw.slice(shown, safe));
          shown = safe;
        }
      };
      let message: AssistantMessage | undefined;
      const stream = deps.models.streamSimple(model, { systemPrompt, messages: transcript, tools: piTools }, { signal, ...requestOptions(model, MAX_TOKENS) });
      for await (const ev of stream) {
        if (ev.type === "text_start") {
          needSeparator = (text + raw.slice(shown)).trim().length > 0;
        } else if (ev.type === "text_delta") {
          if (!ev.delta) continue;
          if (needSeparator) {
            needSeparator = false;
            const tail = text + raw.slice(shown);
            const sep = tail.endsWith("\n\n") ? "" : tail.endsWith("\n") ? "\n" : "\n\n";
            raw += sep;
          }
          raw += ev.delta;
          flush(false);
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
      if (final.trim() && !raw) raw = (text.trim() ? "\n\n" : "") + final;
      addUsage(usage, message);

      // Leaked tool calls: keep only the reply, salvage the calls, and keep the noise out of the transcript.
      let salvaged: LeakedCall[] = [];
      if (leakStart(raw) >= 0) {
        salvaged = leakedCalls(raw);
        const clean = stripLeak(raw);
        if (clean.length >= shown && clean.startsWith(raw.slice(0, shown))) {
          if (clean.length > shown) appendText(clean.slice(shown));
        } else {
          text = text.slice(0, text.length - shown) + clean;
        }
        message = withText(message, stripLeak(final));
      } else {
        flush(true);
      }

      const calls = message.content.filter((c): c is ToolCall => c.type === "toolCall");
      const results: ToolResultMessage[] = [];
      for (const call of calls) {
        if (call.name === EVIDENCE_TOOL) evidenceCalled = true;
        const { result, act } = await runTool(byName.get(call.name), call, ctx, deps.now());
        results.push(result);
        activity.push(act);
        emit({ type: "tool", activity: act });
      }
      // Run salvaged calls to recording-only tools (their results go nowhere, so nothing else is safe).
      for (const leaked of salvaged) {
        const tool = byName.get(leaked.name);
        if (!tool?.recordingOnly) continue;
        if (leaked.name === EVIDENCE_TOOL) {
          if (evidenceCalled) continue;
          evidenceCalled = true;
        }
        const call: ToolCall = { type: "toolCall", id: `leaked-${deps.newId()}`, name: leaked.name, arguments: leaked.args as ToolCall["arguments"] };
        const { act } = await runTool(tool, call, ctx, deps.now());
        activity.push(act);
        emit({ type: "tool", activity: act });
      }
      if (calls.length && !text.trim()) {
        for (const r of results) {
          if (!r.isError && byName.get(r.toolName)?.recordingOnly) r.content = [...r.content, { type: "text", text: NO_REPLY_YET }];
        }
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

  // Evidence pass: some models (OpenAI's especially) end their turn at the final answer and never call
  // record_evidence, so corrections go missing. Ask once more, with record_evidence as the only tool.
  // The reply is already streamed; the pass only records. Its messages stay out of the transcript.
  const evidenceTool = byName.get(EVIDENCE_TOOL);
  const wantPass = deps.evidencePass ? deps.evidencePass(model) : needsEvidencePass(model);
  if (!failure && !evidenceCalled && evidenceTool && li.userMessageId && text.trim() && wantPass && !signal.aborted) {
    await evidencePass(deps, {
      model,
      signal,
      systemPrompt,
      messages: [...transcript.slice(0, committed), { role: "user", content: EVIDENCE_NUDGE, timestamp: deps.now() }],
      tool: evidenceTool,
      ctx,
      usage,
      onActivity: (act) => {
        activity.push(act);
        emit({ type: "tool", activity: act });
      },
    });
  }

  // Nothing to show (e.g. a reasoning model spent the whole output cap thinking): report it rather than
  // saving a blank bubble, and keep the empty exchange out of the transcript so a retry starts clean.
  let empty = false;
  if (!failure && !text.trim()) {
    empty = true;
    failure = new TurnFailure("The model sent an empty reply. Try again, or pick another model.", false);
  }

  // Persist the transcript: drop the failed iteration; if nothing completed, drop the new user message too.
  const finalTranscript = failure && (completedIterations === 0 || empty) ? base : transcript.slice(0, committed);

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
  // Openings and "New topic" start a topic; so does a reply the tutor marked with topic_change.
  if (!failure && (!li.userMessageId || turn.topicChange)) tutor.topicStart = true;
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

const EVIDENCE_TOOL = "record_evidence";

/**
 * Added to a recording tool's result when no reply text exists yet. Some models (Sonnet 5.5 with
 * adaptive thinking) write the reply inside their thinking, call record_evidence, read "Recorded."
 * and end the turn: the learner gets an empty reply (bench run 2026-10-06T17-15-47, 3 of 20 turns).
 * It states a fact only: the system prompt's tool protocol says what to do. An instruction here
 * read as a prompt injection, and the model told the learner so (bench run 2026-10-08T05-41-04).
 */
export const NO_REPLY_YET = "No reply text yet.";

/** One tool-only request for record_evidence. Never throws: a failed pass just records nothing. */
async function evidencePass(
  deps: TutorDeps,
  p: {
    model: Model<Api>;
    signal: AbortSignal;
    systemPrompt: string;
    messages: Message[];
    tool: TutorTool;
    ctx: ReturnType<typeof toolContext>;
    usage: UsageTotals;
    onActivity(act: ToolActivity): void;
  },
): Promise<void> {
  try {
    const piTool: Tool = { name: p.tool.name, description: p.tool.description, parameters: p.tool.parameters };
    const stream = deps.models.streamSimple(
      p.model,
      { systemPrompt: p.systemPrompt, messages: p.messages, tools: [piTool] },
      { signal: p.signal, ...requestOptions(p.model, EVIDENCE_PASS_TOKENS) },
    );
    let message: AssistantMessage | undefined;
    for await (const ev of stream) {
      if (ev.type === "done") message = ev.message;
      else if (ev.type === "error") {
        addUsage(p.usage, ev.error);
        return;
      }
    }
    addUsage(p.usage, message);
    const call = message?.content.find((c): c is ToolCall => c.type === "toolCall" && c.name === p.tool.name);
    if (!call) return;
    const { act } = await runTool(p.tool, call, p.ctx, deps.now());
    p.onActivity(act);
  } catch {
    // Best effort: the reply is already saved-to-be; missing evidence is not a turn failure.
  }
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
