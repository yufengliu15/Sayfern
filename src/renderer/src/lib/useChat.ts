// Shared conversation state for any screen that hosts a tutor chat (Session, Reader pane):
// loads the session view, merges the in-flight stream and correction overrides, and sends.
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { SessionView } from "../../../shared/api";
import type { ChatMessage, Correction, GrammarSummary } from "../../../shared/records";
import { api } from "../api";
import { useApp } from "../context";
import { dismissStreamError, onSessionView, requestNewTopic, retryLast, sendMessage, useStream, type SendInput, type StreamState } from "./chatStream";

export interface ChatState {
  /** undefined while loading, null when the session doesn't exist. */
  view: SessionView | null | undefined;
  setView: Dispatch<SetStateAction<SessionView | null | undefined>>;
  stream: StreamState | undefined;
  /** Stored + streamed corrections, with local updates applied. */
  corrections: Correction[];
  /** Stored messages plus the optimistic learner message while a turn runs. */
  messages: ChatMessage[];
  grammarById: Record<string, GrammarSummary>;
  /** Anki target words to underline. */
  targets: string[];
  busy: boolean;
  /** Active ms stored on the session when it loaded. */
  loadedActiveMs: number;
  onCorrectionUpdate(c: Correction): void;
  /** Returns false when no model is connected. */
  send(input: SendInput): boolean;
  /** "New topic": the tutor opens a fresh topic. Returns false when no model is connected. */
  newTopic(): boolean;
  retry(): void;
}

export function useChat(id: string | undefined, onTurnDone?: (v: SessionView) => void): ChatState {
  const app = useApp();
  const appRef = useRef(app);
  appRef.current = app;
  const doneRef = useRef(onTurnDone);
  doneRef.current = onTurnDone;
  const [view, setView] = useState<SessionView | null | undefined>(undefined);
  const [overrides, setOverrides] = useState<Record<string, Correction>>({});
  const [loadedActiveMs, setLoadedActiveMs] = useState(0);
  const stream = useStream(id ?? "");

  // Load
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setView(undefined);
    setOverrides({});
    api
      .getSession(id)
      .then((v) => {
        if (!alive) return;
        setLoadedActiveMs(v?.meta.activeMs ?? 0);
        setView(v);
      })
      .catch(() => alive && setView(null));
    return () => {
      alive = false;
    };
  }, [id]);

  // Canonical view after each turn
  useEffect(
    () =>
      onSessionView((sid, v) => {
        if (sid !== id) return;
        setView(v);
        setOverrides({});
        void appRef.current.refreshSessions();
        doneRef.current?.(v);
      }),
    [id],
  );

  const corrections = useMemo(() => {
    const map = new Map<string, Correction>();
    for (const c of view?.corrections ?? []) map.set(c.id, c);
    for (const c of stream?.corrections ?? []) map.set(c.id, c);
    for (const c of Object.values(overrides)) if (map.has(c.id)) map.set(c.id, c);
    return [...map.values()];
  }, [view?.corrections, stream?.corrections, overrides]);

  const messages = useMemo(() => {
    const list = view?.messages ?? [];
    const user = stream?.user;
    if (user && !list.some((m) => m.id === user.id)) return [...list, user];
    return list;
  }, [view?.messages, stream]);

  const grammarById = useMemo(() => Object.fromEntries((view?.grammarInPlay ?? []).map((g) => [g.point.id, g])), [view?.grammarInPlay]);
  const targets = useMemo(() => (view?.targets ?? []).map((t) => t.word), [view?.targets]);

  const onCorrectionUpdate = useCallback((c: Correction) => setOverrides((o) => ({ ...o, [c.id]: c })), []);

  const send = useCallback(
    (input: SendInput) => {
      const model = appRef.current.model;
      if (!id || !model) return false;
      void sendMessage(id, input, model);
      return true;
    },
    [id],
  );

  const newTopic = useCallback(() => {
    const model = appRef.current.model;
    if (!id || !model) return false;
    void requestNewTopic(id, model);
    return true;
  }, [id]);

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const retry = useCallback(() => {
    const model = appRef.current.model;
    if (!id || !model) return;
    dismissStreamError(id);
    retryLast(id, lastUser ? { text: lastUser.text, model } : undefined);
  }, [id, lastUser]);

  return {
    view,
    setView,
    stream,
    corrections,
    messages,
    grammarById,
    targets,
    busy: !!stream && !stream.error,
    loadedActiveMs,
    onCorrectionUpdate,
    send,
    newTopic,
    retry,
  };
}
