// Prompt caching for the tutor (ADR 39). Providers cache a request's prefix: tools, system prompt, then the
// transcript. The system prompt stays the same all session; what changes every turn (prompt.ts notes) rides
// on the newest learner message as a last text block, in the request only, never in the stored transcript.
import type { Message, UserMessage } from "@earendil-works/pi-ai";
import { NOTES_HEADER } from "./prompt";

/** `transcript` with `notes` added as the last block of the user message at `at`. The transcript is not changed. */
export function withNotes(transcript: readonly Message[], at: number, notes: string): Message[] {
  return transcript.map((m, i) => {
    if (i !== at || m.role !== "user") return m;
    const content: UserMessage["content"] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    return { ...m, content: [...content, { type: "text", text: notes }] };
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * pi-ai's `onPayload` hook. pi-ai marks the last block of the last message as the cache breakpoint; when that
 * block is the notes, the cache entry would include them and miss on the next turn. Move the mark to the
 * block before (the learner's own text), so the next turn reads the whole history from the cache.
 * Payloads without Anthropic-style `cache_control` marks (most OpenAI-compatible APIs) are left alone.
 */
export function notesOutOfCache(payload: unknown): undefined {
  const messages = isRecord(payload) ? payload.messages : undefined;
  if (!Array.isArray(messages)) return;
  for (const m of messages) {
    const content = isRecord(m) ? m.content : undefined;
    if (!Array.isArray(content)) continue;
    const i = content.findIndex((b) => isRecord(b) && typeof b.text === "string" && b.text.startsWith(NOTES_HEADER));
    const notes = content[i];
    const prev = content[i - 1];
    if (i < 1 || !isRecord(notes) || !isRecord(prev) || !notes.cache_control) continue;
    prev.cache_control = notes.cache_control;
    delete notes.cache_control;
  }
}
