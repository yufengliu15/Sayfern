import { createHash } from "node:crypto";

function hashId(parts: string[]): string {
  return createHash("sha1").update(parts.join("\u001f"), "utf8").digest("hex").slice(0, 16);
}

/** Deterministic observation id: a repeated tool call yields the same id (S1-27). */
export function observationId(messageId: string, grammarId: string, span: string): string {
  return hashId(["obs", messageId, grammarId, span]);
}

/** Deterministic correction id: one correction per (message, original span) (S1-27). */
export function correctionId(messageId: string, original: string): string {
  return hashId(["cor", messageId, original]);
}
