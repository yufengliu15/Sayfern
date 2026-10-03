// Stage 3 · Voice (S3-01..S3-04): spoken replies, word and sentence playback, speech input.
// Owned by the voice feature. Types only (compiled by both node and web TS projects).
// Every invokable method added to VoiceApi must also be listed in VOICE_METHODS (compile-time check).
//
// Speech is split by job (S3-03): text to speech uses ElevenLabs (the learner's own accounts) or
// Microsoft Edge's free voices; speech to text uses ElevenLabs Scribe. The learner can connect
// several ElevenLabs accounts: Sayfern uses them in order and moves on to the next one when an
// account runs out of credits or rejects a request. Pronunciation assessment is not built yet.
import type { Language } from "../records";
import type { ElevenLabsVoice } from "../stage2/decks";

/** "elevenlabs": the learner's ElevenLabs accounts. "edge": Microsoft Edge's free online voices. */
export type TtsProvider = "elevenlabs" | "edge";

/** Health of one account, from the last request or credit check. */
export type ElevenLabsAccountState = "ok" | "quota" | "auth" | "error";

export interface ElevenLabsAccountView {
  id: string;
  /** The learner's name for it ("Personal", "Second account"). */
  label: string;
  addedAt: number;
  /** Last four characters of the key, to tell accounts apart. */
  keyHint: string;
  state: ElevenLabsAccountState;
  /** Readable problem when state isn't "ok". */
  error?: string;
  tier?: string;
  creditsLeft?: number;
  creditLimit?: number;
  /** When the monthly credits reset (ms). */
  resetsAt?: number;
}

export interface VoicePrefs {
  /** Which service reads text aloud. "elevenlabs" falls back to "edge" when no account can. */
  tts: TtsProvider;
  /** Read each new tutor reply aloud as it arrives. */
  autoSpeak: boolean;
  /** Send a transcribed message right away instead of leaving it in the box to check. */
  autoSend: boolean;
  /** Normal playback speed (VOICE_RATES). Slow playback is always VOICE_SLOW_RATE. */
  rate: number;
}

export const DEFAULT_VOICE_PREFS: VoicePrefs = { tts: "elevenlabs", autoSpeak: false, autoSend: false, rate: 1 };
export const VOICE_RATES = [0.8, 0.9, 1, 1.1, 1.25] as const;
export const VOICE_SLOW_RATE = 0.7;
/** Longest text sent to text to speech in one request (characters, after cleaning). */
export const SPEAK_MAX_CHARS = 1500;
/** Shortest and longest recording Sayfern transcribes. */
export const RECORD_MIN_MS = 400;
export const RECORD_MAX_MS = 120_000;

export interface VoiceStatus {
  /** In the order Sayfern tries them. */
  accounts: ElevenLabsAccountView[];
  /** Voices the learner can pick (premade voices work with every account). */
  voices: ElevenLabsVoice[];
  voiceId?: string;
  voiceName?: string;
  prefs: VoicePrefs;
  /** The service text to speech uses right now. */
  speaking: TtsProvider;
  /** At least one account can transcribe (speech input needs ElevenLabs). */
  canTranscribe: boolean;
  /** Credits left this month over all accounts, when known. */
  creditsLeft?: number;
}

/** "word": a dictionary headword. "sentence": one example. "message": a whole tutor message (cleaned first). */
export type SpeakKind = "word" | "sentence" | "message";

export interface SpeakRequest {
  text: string;
  language: Language;
  kind: SpeakKind;
}

export interface SpeakResult {
  /** MP3 bytes. */
  audio: Uint8Array;
  /** "audio/mpeg" from both services (the dev mock plays WAV). */
  mime: string;
  by: TtsProvider;
  /** Label of the ElevenLabs account that spoke it. */
  account?: string;
  cached: boolean;
  /** Set when ElevenLabs was wanted but the free voices spoke instead (readable reason). */
  fellBack?: string;
}

export interface TranscribeRequest {
  /** Recorded audio (webm/opus from the browser's MediaRecorder, or any format Scribe reads). */
  audio: Uint8Array;
  mime: string;
  /** The language being practised; Scribe is told to expect it. */
  language: Language;
  /** Counted as voice practice time for this session (S3-04). */
  sessionId?: string;
  durationMs?: number;
}

export interface TranscribeResult {
  text: string;
  /** Language Scribe heard (ISO 639), when it says. */
  heard?: string;
  /** Label of the account that transcribed it. */
  account: string;
}

export interface VoiceApi {
  voiceStatus(): Promise<VoiceStatus>;
  /** Checks the key with ElevenLabs and adds it after the others. Throws a readable error. */
  addElevenLabsAccount(apiKey: string, label?: string): Promise<VoiceStatus>;
  removeElevenLabsAccount(accountId: string): Promise<VoiceStatus>;
  /** Moves an account one place up (-1) or down (+1) in the order Sayfern tries them. */
  moveElevenLabsAccount(accountId: string, by: -1 | 1): Promise<VoiceStatus>;
  setVoicePrefs(patch: Partial<VoicePrefs> & { voiceId?: string }): Promise<VoiceStatus>;
  /** Text to speech (cached on disk). Falls back to the free voices when no ElevenLabs account can. */
  speak(req: SpeakRequest): Promise<SpeakResult>;
  /** Speech to text with ElevenLabs Scribe. Throws a readable error. */
  transcribe(req: TranscribeRequest): Promise<TranscribeResult>;
  /** S3-04: listening and speaking time, kept apart from text practice time. */
  trackVoiceActivity(sessionId: string, ms: number): Promise<void>;
}

export const VOICE_METHODS: Record<keyof VoiceApi, true> = {
  voiceStatus: true,
  addElevenLabsAccount: true,
  removeElevenLabsAccount: true,
  moveElevenLabsAccount: true,
  setVoicePrefs: true,
  speak: true,
  transcribe: true,
  trackVoiceActivity: true,
};
