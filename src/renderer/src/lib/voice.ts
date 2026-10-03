// Stage 3 voice in the renderer: the voice status store, one shared player (tutor messages, words)
// and the microphone recorder. Audio comes from main as bytes (the renderer has no network).
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ChatMessage, Language } from "../../../shared/records";
import { RECORD_MAX_MS, VOICE_SLOW_RATE, type SpeakKind, type VoiceStatus } from "../../../shared/stage3";
import { api, errorText } from "../api";
import { msg } from "../i18n";

// ---------------------------------------------------------------- status

let status: VoiceStatus | null = null;
let loading: Promise<VoiceStatus | null> | null = null;
const statusListeners = new Set<() => void>();

export function setVoiceStatus(next: VoiceStatus): void {
  status = next;
  statusListeners.forEach((l) => l());
}

export function loadVoiceStatus(force = false): Promise<VoiceStatus | null> {
  if (loading && !force) return loading;
  loading = api
    .voiceStatus()
    .then((s) => {
      setVoiceStatus(s);
      return s;
    })
    .catch(() => status)
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Voice status, loaded on first use. Null until it arrives. */
export function useVoiceStatus(): VoiceStatus | null {
  const s = useSyncExternalStore(
    (cb) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    () => status,
  );
  if (!s && !loading) void loadVoiceStatus();
  return s;
}

// ---------------------------------------------------------------- playback

export interface PlaybackState {
  /** What is loading or playing (a message id, "w:<word>", ...). */
  key: string | null;
  phase: "loading" | "playing" | null;
  slow: boolean;
  /** Last failure, for the key that failed. */
  error?: { key: string; text: string };
  /** Shown once when ElevenLabs couldn't speak and the free voices did. */
  notice?: string;
}

let playback: PlaybackState = { key: null, phase: null, slow: false };
const playListeners = new Set<() => void>();
const setPlayback = (p: PlaybackState) => {
  playback = p;
  playListeners.forEach((l) => l());
};

let audio: HTMLAudioElement | null = null;
let url: string | null = null;
let token = 0;
let started = 0;
let trackSession: string | undefined;

function release(): void {
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
  }
  if (url) URL.revokeObjectURL(url);
  audio = null;
  url = null;
}

function reportListening(): void {
  if (trackSession && started) {
    const ms = performance.now() - started;
    if (ms > 300) void api.trackVoiceActivity(trackSession, ms).catch(() => undefined);
  }
  started = 0;
  trackSession = undefined;
}

export function stopPlayback(): void {
  token++;
  reportListening();
  release();
  if (playback.key) setPlayback({ ...playback, key: null, phase: null });
}

export interface PlayRequest {
  key: string;
  text: string;
  language: Language;
  kind: SpeakKind;
  slow?: boolean;
  /** Listening time counts toward this session's voice practice. */
  sessionId?: string;
}

/** Plays `req`; calling it again for the key that is playing stops it. */
export async function play(req: PlayRequest): Promise<void> {
  if (playback.key === req.key && !!req.slow === playback.slow && playback.phase) {
    stopPlayback();
    return;
  }
  stopPlayback();
  const mine = ++token;
  setPlayback({ key: req.key, phase: "loading", slow: !!req.slow, notice: playback.notice });
  try {
    const r = await api.speak({ text: req.text, language: req.language, kind: req.kind });
    if (mine !== token) return;
    url = URL.createObjectURL(new Blob([r.audio as BlobPart], { type: r.mime }));
    const el = new Audio(url);
    audio = el;
    el.preservesPitch = true;
    el.playbackRate = req.slow ? VOICE_SLOW_RATE : (status?.prefs.rate ?? 1);
    el.onended = () => {
      if (mine === token) stopPlayback();
    };
    el.onerror = () => {
      if (mine !== token) return;
      reportListening();
      release();
      setPlayback({ key: null, phase: null, slow: false, error: { key: req.key, text: msg("Couldn't play this clip.") } });
    };
    await el.play();
    if (mine !== token) return;
    started = performance.now();
    trackSession = req.sessionId;
    setPlayback({ key: req.key, phase: "playing", slow: !!req.slow, ...(r.fellBack ? { notice: r.fellBack } : playback.notice ? { notice: playback.notice } : {}) });
  } catch (err) {
    if (mine !== token) return;
    release();
    setPlayback({ key: null, phase: null, slow: false, error: { key: req.key, text: errorText(err) } });
  }
}

export function dismissVoiceNotice(): void {
  if (playback.notice) setPlayback({ ...playback, notice: undefined });
}

export function usePlayback(): PlaybackState {
  return useSyncExternalStore(
    (cb) => {
      playListeners.add(cb);
      return () => playListeners.delete(cb);
    },
    () => playback,
  );
}

// ---------------------------------------------------------------- recording

export interface Recording {
  audio: Uint8Array;
  mime: string;
  durationMs: number;
}

const PREFERRED = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

/** One microphone recording at a time. */
export class Recorder {
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private limit: number | undefined;
  private done: ((r: Recording | null) => void) | null = null;

  get active(): boolean {
    return !!this.rec;
  }

  /** Asks for the microphone (macOS prompts once) and starts recording. `onLimit` runs at RECORD_MAX_MS. */
  async start(onLimit: () => void): Promise<void> {
    if (this.rec) return;
    if (!(await api.requestMicrophone().catch(() => false))) throw new Error(msg("Sayfern can't use the microphone. Allow it in System Settings > Privacy & Security > Microphone."));
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error(msg("This window can't record audio."));
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      throw new Error(msg("Sayfern can't use the microphone. Allow it in System Settings > Privacy & Security > Microphone."));
    }
    const mimeType = PREFERRED.find((m) => MediaRecorder.isTypeSupported?.(m));
    const rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    rec.onstop = async () => {
      const mime = rec.mimeType || mimeType || "audio/webm";
      const durationMs = performance.now() - this.startedAt;
      const blob = new Blob(this.chunks, { type: mime });
      this.cleanup();
      const finish = this.done;
      this.done = null;
      finish?.(blob.size ? { audio: new Uint8Array(await blob.arrayBuffer()), mime, durationMs } : null);
    };
    this.rec = rec;
    this.startedAt = performance.now();
    rec.start();
    this.limit = window.setTimeout(onLimit, RECORD_MAX_MS);
  }

  /** Stops and returns the clip (null when nothing was recorded). */
  stop(): Promise<Recording | null> {
    const rec = this.rec;
    if (!rec) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.done = resolve;
      rec.stop();
    });
  }

  cancel(): void {
    const rec = this.rec;
    if (!rec) return;
    this.done = null;
    rec.onstop = () => this.cleanup();
    rec.stop();
  }

  elapsedMs(): number {
    return this.rec ? performance.now() - this.startedAt : 0;
  }

  private cleanup(): void {
    window.clearTimeout(this.limit);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
  }
}

/** A short line per language for "Play a sample" in Settings. */
export const VOICE_SAMPLES: Record<Language, string> = {
  zh: "你好！今天天气不错，我们去公园散散步吧。",
  ja: "こんにちは。今日はいい天気ですね。少し散歩しませんか。",
  ko: "안녕하세요. 오늘 날씨가 정말 좋네요. 같이 산책할까요?",
  en: "Hi there! The weather is lovely today. Shall we go for a walk?",
  es: "¡Hola! Hoy hace muy buen tiempo. ¿Damos un paseo?",
  fr: "Bonjour ! Il fait très beau aujourd'hui. On va se promener ?",
  de: "Hallo! Heute ist so schönes Wetter. Wollen wir spazieren gehen?",
  it: "Ciao! Oggi è proprio una bella giornata. Facciamo una passeggiata?",
  pt: "Oi! O dia está lindo hoje. Vamos dar uma volta?",
  ru: "Привет! Сегодня отличная погода. Пойдём погуляем?",
  vi: "Xin chào! Hôm nay trời đẹp quá. Mình đi dạo nhé?",
};

/**
 * Reads each new tutor reply aloud when the learner turned that on (Settings > Voice). Messages that
 * were already there when the session opened are left alone.
 */
export function useAutoSpeak(sessionId: string, messages: readonly ChatMessage[], language: Language, ready: boolean): void {
  const voice = useVoiceStatus();
  const auto = !!voice?.prefs.autoSpeak;
  const seen = useRef<{ session: string; id: string | null } | null>(null);
  useEffect(() => {
    if (!ready) return;
    let last: ChatMessage | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === "tutor" && m.text && !m.error) {
        last = m;
        break;
      }
    }
    const id = last?.id ?? null;
    if (!seen.current || seen.current.session !== sessionId) {
      seen.current = { session: sessionId, id };
      return;
    }
    if (id === seen.current.id) return;
    seen.current = { session: sessionId, id };
    if (auto && last) void play({ key: last.id, text: last.text, language, kind: "message", sessionId });
  }, [sessionId, messages, language, ready, auto]);
  useEffect(() => () => stopPlayback(), [sessionId]);
}
