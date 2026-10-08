// Text to speech for deck cards (S2-16): ElevenLabs (the learner's own account, optional) and
// Microsoft Edge's free online voices, the same service /ankigen uses through edge-tts.
// Plain Node: fetch and the global WebSocket (both injectable for tests).
import { createHash, randomUUID } from "node:crypto";
import type { Language } from "../../shared/records";
import type { ElevenLabsVoice } from "../../shared/stage2";

// ---------------------------------------------------------------- Edge (free)

/** Constants from edge-tts 7.2.8 (rany2/edge-tts). Bump CHROMIUM_FULL_VERSION when edge-tts does. */
const EDGE_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split(".")[0];
const EDGE_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${EDGE_TOKEN}`;
const WIN_EPOCH = 11644473600;

/** Word and sentence voices per language (different speakers on purpose, as in /ankigen). */
export const EDGE_VOICES: Record<Language, { word: string; sentence: string }> = {
  zh: { word: "zh-CN-XiaoxiaoNeural", sentence: "zh-CN-YunxiNeural" },
  ja: { word: "ja-JP-NanamiNeural", sentence: "ja-JP-KeitaNeural" },
  ko: { word: "ko-KR-SunHiNeural", sentence: "ko-KR-InJoonNeural" },
  en: { word: "en-US-AriaNeural", sentence: "en-US-GuyNeural" },
  es: { word: "es-MX-DaliaNeural", sentence: "es-MX-JorgeNeural" },
  fr: { word: "fr-FR-DeniseNeural", sentence: "fr-FR-HenriNeural" },
  de: { word: "de-DE-KatjaNeural", sentence: "de-DE-ConradNeural" },
  it: { word: "it-IT-ElsaNeural", sentence: "it-IT-DiegoNeural" },
  pt: { word: "pt-PT-RaquelNeural", sentence: "pt-PT-DuarteNeural" },
  ru: { word: "ru-RU-SvetlanaNeural", sentence: "ru-RU-DmitryNeural" },
  vi: { word: "vi-VN-HoaiMyNeural", sentence: "vi-VN-NamMinhNeural" },
};

/** Sec-MS-GEC: SHA-256 of Windows file time (rounded down to 5 minutes) + the client token. */
export function secMsGec(nowMs: number): string {
  let ticks = Math.floor(nowMs / 1000) + WIN_EPOCH;
  ticks -= ticks % 300;
  return createHash("sha256")
    .update(`${BigInt(ticks) * 10_000_000n}${EDGE_TOKEN}`)
    .digest("hex")
    .toUpperCase();
}

const noDash = () => randomUUID().replaceAll("-", "");

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** Minimal WebSocket surface (Node's global WebSocket, or a fake in tests). */
export interface WsLike {
  binaryType: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  send(data: string): void;
  close(): void;
}
export type WsFactory = (url: string, headers: Record<string, string>) => WsLike;

/** Node's global WebSocket (undici) accepts headers as a non-standard init option. */
export const nodeWebSocket: WsFactory = (url, headers) => {
  const Ctor = (globalThis as unknown as { WebSocket?: new (url: string, init: unknown) => WsLike }).WebSocket;
  if (!Ctor) throw new Error("This version of Node has no WebSocket.");
  return new Ctor(url, { headers });
};

function jsDate(nowMs: number): string {
  return new Date(nowMs).toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)");
}

async function bytesOf(data: unknown): Promise<Buffer | null> {
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data && typeof (data as Blob).arrayBuffer === "function") return Buffer.from(await (data as Blob).arrayBuffer());
  return null;
}

export class TtsError extends Error {
  constructor(
    message: string,
    /** ElevenLabs: out of credits / rate limited / bad key. Edge: unreachable. */
    readonly kind: "quota" | "auth" | "network" | "other" = "other",
    /** HTTP status from ElevenLabs, when there was a response (429 = rate limited, not out of credits). */
    readonly status?: number,
  ) {
    super(message);
  }
}

/** One MP3 clip from Edge's read-aloud service. */
export function edgeTts(
  text: string,
  voice: string,
  opts: { ws?: WsFactory; now?: () => number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Buffer> {
  const now = opts.now ?? Date.now;
  const url = `${EDGE_URL}&ConnectionId=${noDash()}&Sec-MS-GEC=${secMsGec(now())}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`;
  const headers = {
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`,
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: `muid=${noDash().toUpperCase()};`,
  };
  return new Promise<Buffer>((resolve, reject) => {
    let ws: WsLike;
    try {
      ws = (opts.ws ?? nodeWebSocket)(url, headers);
    } catch (err) {
      reject(new TtsError(`Couldn't reach the free voices: ${(err as Error).message}`, "network"));
      return;
    }
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      try {
        ws.close();
      } catch {
        // already closed
      }
      if (err) reject(err);
      else if (!chunks.length) reject(new TtsError("The free voices sent no audio.", "other"));
      else resolve(Buffer.concat(chunks));
    };
    const onAbort = () => finish(new TtsError("Stopped.", "other"));
    opts.signal?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => finish(new TtsError("The free voices didn't answer in time.", "network")), opts.timeoutMs ?? 20_000);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      ws.send(
        `X-Timestamp:${jsDate(now())}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`,
      );
      ws.send(
        `X-RequestId:${noDash()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${jsDate(now())}Z\r\nPath:ssml\r\n\r\n` +
          `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'>` +
          `<prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`,
      );
    };
    // Binary frames may need an async read (Blob): keep messages in order with one queue.
    let queue: Promise<void> = Promise.resolve();
    ws.onmessage = (ev) => {
      const data = ev.data;
      queue = queue.then(async () => {
        if (typeof data === "string") {
          if (data.includes("Path:turn.end")) finish(null);
          return;
        }
        const buf = await bytesOf(data);
        if (!buf || buf.length < 2) return;
        // Binary frame: 2-byte big-endian header length, headers, then audio.
        const len = buf.readUInt16BE(0);
        const head = buf.subarray(2, 2 + len).toString("utf8");
        if (head.includes("Path:audio")) {
          const audio = buf.subarray(2 + len);
          if (audio.length) chunks.push(audio);
        }
      });
    };
    ws.onerror = (ev) => {
      const msg = (ev as { message?: string; error?: Error })?.error?.message ?? (ev as { message?: string })?.message ?? "connection failed";
      finish(new TtsError(`Couldn't reach the free voices: ${msg}`, "network"));
    };
    ws.onclose = (ev) => {
      void queue.then(() => {
        if (!settled) finish(chunks.length ? null : new TtsError(`The free voices closed the connection${ev?.code ? ` (${ev.code})` : ""}.`, "network"));
      });
    };
  });
}

// ---------------------------------------------------------------- ElevenLabs

export const ELEVEN_API = "https://api.elevenlabs.io";
/** Flash v2.5: Chinese and Japanese, half the credits per character of Multilingual v2. */
export const ELEVEN_MODEL = "eleven_flash_v2_5";

export async function elevenError(res: Response): Promise<TtsError> {
  let detail: { status?: string; message?: string } | string | undefined;
  try {
    const body = (await res.json()) as { detail?: unknown };
    detail = body?.detail as typeof detail;
  } catch {
    // not JSON
  }
  const status = typeof detail === "object" && detail ? (detail.status ?? "") : "";
  const message = typeof detail === "string" ? detail : typeof detail === "object" && detail?.message ? detail.message : `HTTP ${res.status}`;
  if (status === "quota_exceeded" || res.status === 402 || /quota|credits/i.test(message))
    return new TtsError("Your ElevenLabs credits for this month are used up.", "quota", res.status);
  if (res.status === 429) return new TtsError("ElevenLabs is busy or rate limited. Try again in a minute.", "quota", 429);
  if (res.status === 401 || res.status === 403) {
    if (/permission/i.test(message)) return new TtsError(`ElevenLabs: this key is missing a permission (${message}).`, "auth", res.status);
    return new TtsError("ElevenLabs didn't accept the API key.", "auth", res.status);
  }
  return new TtsError(`ElevenLabs: ${message}`, "other", res.status);
}

export function elevenFetch(fetchImpl: typeof fetch, path: string, key: string, init: RequestInit = {}): Promise<Response> {
  return fetchImpl(`${ELEVEN_API}${path}`, {
    ...init,
    headers: { "xi-api-key": key, Accept: "application/json", ...(init.headers as Record<string, string> | undefined) },
  }).catch((err: unknown) => {
    throw new TtsError(`Couldn't reach ElevenLabs: ${(err as Error)?.message ?? err}`, "network");
  });
}

/** The account's voices. Throws TtsError (auth) for a bad key. */
export async function elevenVoices(fetchImpl: typeof fetch, key: string): Promise<ElevenLabsVoice[]> {
  const res = await elevenFetch(fetchImpl, "/v1/voices", key);
  if (!res.ok) throw await elevenError(res);
  const body = (await res.json()) as { voices?: { voice_id?: string; name?: string; category?: string }[] };
  return (body.voices ?? [])
    .filter((v) => typeof v.voice_id === "string" && v.voice_id)
    .map((v) => ({ id: v.voice_id!, name: v.name || v.voice_id!, ...(v.category ? { category: v.category } : {}) }));
}

/** Premade voices first (free accounts can use them through the API), then the rest. */
export function defaultVoice(voices: ElevenLabsVoice[]): ElevenLabsVoice | undefined {
  return voices.find((v) => v.category === "premade") ?? voices[0];
}

export interface ElevenSubscription {
  tier?: string;
  used: number;
  limit: number;
  resetsAt?: number;
}

/** Credits used and allowed this month, or null when the key may not read the subscription. */
export async function elevenSubscription(fetchImpl: typeof fetch, key: string): Promise<ElevenSubscription | null> {
  try {
    const res = await elevenFetch(fetchImpl, "/v1/user/subscription", key);
    if (!res.ok) return null;
    const b = (await res.json()) as { tier?: string; character_count?: number; character_limit?: number; next_character_count_reset_unix?: number };
    if (typeof b.character_count !== "number" || typeof b.character_limit !== "number") return null;
    const out: ElevenSubscription = { used: b.character_count, limit: b.character_limit };
    if (b.tier) out.tier = b.tier;
    if (typeof b.next_character_count_reset_unix === "number") out.resetsAt = b.next_character_count_reset_unix * 1000;
    return out;
  } catch {
    return null;
  }
}

/** One MP3 clip from ElevenLabs. */
export async function elevenTts(
  fetchImpl: typeof fetch,
  key: string,
  /** `language` is passed as language_code; leave it out to let the model detect it (mixed-language text). */
  input: { text: string; voiceId: string; language?: Language; signal?: AbortSignal },
): Promise<Buffer> {
  const res = await elevenFetch(fetchImpl, `/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=mp3_44100_128`, key, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: input.text, model_id: ELEVEN_MODEL, ...(input.language ? { language_code: input.language } : {}) }),
    signal: input.signal,
  });
  if (!res.ok) throw await elevenError(res);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new TtsError("ElevenLabs sent no audio.", "other");
  return buf;
}
