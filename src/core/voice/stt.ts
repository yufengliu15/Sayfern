// ElevenLabs Scribe speech to text (S3-01). One recorded clip in, the text out.
// The body is built by hand (multipart/form-data) so it works with any fetch, including Electron's net.fetch.
import { randomUUID } from "node:crypto";
import type { Language } from "../../shared/records";
import { msg } from "../../shared/i18n";
import { elevenError, elevenFetch, TtsError } from "../decks/tts";

/** Scribe v2: ElevenLabs' current batch transcription model (scribe_v1 is the legacy one). */
export const SCRIBE_MODEL = "scribe_v2";
/** Recorded clips are small; anything bigger than this is a mistake. */
export const STT_MAX_BYTES = 25 * 1024 * 1024;

const EXT: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav" };

export function multipart(fields: Record<string, string>, file: { field: string; name: string; mime: string; data: Uint8Array }): { body: Uint8Array; contentType: string } {
  const boundary = `----sayfern${randomUUID().replaceAll("-", "")}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, "utf8"));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`, "utf8"));
  parts.push(Buffer.from(file.data.buffer, file.data.byteOffset, file.data.byteLength));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"));
  return { body: new Uint8Array(Buffer.concat(parts)), contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function elevenStt(
  fetchImpl: typeof fetch,
  key: string,
  input: { audio: Uint8Array; mime: string; language?: Language; signal?: AbortSignal },
): Promise<{ text: string; heard?: string }> {
  const base = (input.mime || "audio/webm").split(";")[0]!.trim().toLowerCase();
  const fields: Record<string, string> = { model_id: SCRIBE_MODEL, tag_audio_events: "false", timestamps_granularity: "none" };
  if (input.language) fields.language_code = input.language;
  const { body, contentType } = multipart(fields, { field: "file", name: `speech.${EXT[base] ?? "webm"}`, mime: base, data: input.audio });
  const res = await elevenFetch(fetchImpl, "/v1/speech-to-text", key, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: body as unknown as RequestInit["body"],
    signal: input.signal,
  });
  if (!res.ok) throw await elevenError(res);
  const b = (await res.json().catch(() => null)) as { text?: unknown; language_code?: unknown } | null;
  if (!b || typeof b.text !== "string") throw new TtsError(msg("ElevenLabs sent back no transcript."), "other");
  const out: { text: string; heard?: string } = { text: b.text.trim() };
  if (typeof b.language_code === "string" && b.language_code) out.heard = b.language_code;
  return out;
}
