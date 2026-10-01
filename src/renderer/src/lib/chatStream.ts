// In-flight tutor turns, keyed by session. Lives outside React so a stream survives
// navigating away from the session and back.
import { useSyncExternalStore } from "react";
import type { ChatEvent, SessionView } from "../../../shared/api";
import type { ChatMessage, Correction, ToolActivity } from "../../../shared/records";
import type { ModelRef } from "../../../shared/types";
import { api, errorText } from "../api";

export interface SendInput {
  text: string;
  pastedSpans?: string[];
}

export interface StreamState {
  sessionId: string;
  requestId?: string;
  /**
   * Optimistic learner message, replaced by the canonical copy on `user_saved`.
   * Absent for turns main started on its own (the tutor's opening line).
   */
  user?: ChatMessage;
  saved: boolean;
  text: string;
  tools: ToolActivity[];
  corrections: Correction[];
  /** Failure with no server view to fall back on. */
  error?: string;
  input?: SendInput;
  model?: ModelRef;
}

const streams = new Map<string, StreamState>();
const lastInputs = new Map<string, { input: SendInput; model: ModelRef }>();
const listeners = new Set<() => void>();
const viewListeners = new Set<(sessionId: string, view: SessionView) => void>();
let unsubscribe: (() => void) | null = null;

function emit() {
  for (const l of listeners) l();
}

function put(sessionId: string, s: StreamState | undefined) {
  if (s) streams.set(sessionId, s);
  else streams.delete(sessionId);
  emit();
}

function patch(sessionId: string, p: Partial<StreamState>) {
  const cur = streams.get(sessionId);
  if (cur) put(sessionId, { ...cur, ...p });
}

function emitView(sessionId: string, view: SessionView) {
  for (const l of viewListeners) l(sessionId, view);
}

function handle(e: ChatEvent) {
  let s = streams.get(e.sessionId);
  if (!s) {
    if (e.type === "done" || (e.type === "error" && e.view)) {
      emitView(e.sessionId, e.view!);
      return;
    }
    if (e.type === "error") return;
    // A turn main started without us (practice/reading/placement opening): follow it.
    s = { sessionId: e.sessionId, requestId: e.requestId, saved: true, text: "", tools: [], corrections: [] };
    streams.set(e.sessionId, s);
  }
  if (s.requestId && s.requestId !== e.requestId) return;
  if (!s.requestId) s.requestId = e.requestId;
  switch (e.type) {
    case "user_saved":
      patch(e.sessionId, { user: e.message, saved: true, requestId: e.requestId });
      break;
    case "delta":
      patch(e.sessionId, { text: s.text + e.text, requestId: e.requestId });
      break;
    case "tool":
      patch(e.sessionId, { tools: [...s.tools, e.activity], requestId: e.requestId });
      break;
    case "correction":
      patch(e.sessionId, { corrections: [...s.corrections, e.correction], requestId: e.requestId });
      break;
    case "done":
      put(e.sessionId, undefined);
      emitView(e.sessionId, e.view);
      break;
    case "error":
      if (e.view) {
        put(e.sessionId, undefined);
        emitView(e.sessionId, e.view);
      } else if (e.aborted) {
        put(e.sessionId, undefined);
        void api.getSession(e.sessionId).then((v) => v && emitView(e.sessionId, v));
      } else {
        patch(e.sessionId, { error: e.message });
      }
      break;
  }
}

function ensureSubscribed() {
  if (!unsubscribe) unsubscribe = api.onChatEvent(handle);
}

/** Subscribe at app start so turns main starts on its own (openings) are followed from the first delta. */
export function startChatStream(): void {
  ensureSubscribed();
}

export async function sendMessage(sessionId: string, input: SendInput, model: ModelRef): Promise<void> {
  ensureSubscribed();
  lastInputs.set(sessionId, { input, model });
  const user: ChatMessage = {
    id: `pending-${Date.now()}`,
    sessionId,
    role: "user",
    text: input.text,
    at: Date.now(),
    pastedSpans: input.pastedSpans,
  };
  put(sessionId, { sessionId, user, saved: false, text: "", tools: [], corrections: [], input, model });
  try {
    const { requestId } = await api.send(sessionId, input, model);
    const cur = streams.get(sessionId);
    if (cur && !cur.requestId) patch(sessionId, { requestId });
  } catch (err) {
    patch(sessionId, { error: errorText(err) });
  }
}

/** Resend the last thing the learner sent in this session (after an error). */
export function retryLast(sessionId: string, fallback?: { text: string; model?: ModelRef }): void {
  const last = lastInputs.get(sessionId);
  const input = last?.input ?? (fallback ? { text: fallback.text } : undefined);
  const model = fallback?.model ?? last?.model;
  if (!input || !model) return;
  void sendMessage(sessionId, input, model);
}

export function stopStream(sessionId: string): void {
  const s = streams.get(sessionId);
  if (s?.requestId) void api.abort(s.requestId);
  else if (s) put(sessionId, undefined);
}

export function dismissStreamError(sessionId: string): void {
  const s = streams.get(sessionId);
  if (s?.error) put(sessionId, undefined);
}

export function isStreaming(sessionId: string): boolean {
  const s = streams.get(sessionId);
  return !!s && !s.error;
}

export function useStream(sessionId: string): StreamState | undefined {
  ensureSubscribed();
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => streams.get(sessionId),
  );
}

/** Fires with the canonical session view after a turn finishes (done, or error with a view). */
export function onSessionView(cb: (sessionId: string, view: SessionView) => void): () => void {
  ensureSubscribed();
  viewListeners.add(cb);
  return () => viewListeners.delete(cb);
}
