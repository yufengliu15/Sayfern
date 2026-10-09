// Provider, model, auth and settings types shared by main, preload and renderer.
// Learning-record types live in ./records, language types in ./lang, the IPC API in ./api.
import type { UiLocale } from "./locales";
import type { Language } from "./records";
import type { VoicePrefs } from "./stage3/voice";
import type { Theme } from "./themes";

export type { Language } from "./records";
export type { UiLocale } from "./locales";

export interface ProviderInfo {
  id: string;
  name: string;
  note: string;
  canApiKey: boolean;
  /** Present when the provider supports OAuth sign-in. */
  oauthLabel?: string;
  oauthIsSubscription: boolean;
  /** How the provider is currently authenticated, or null. */
  connected: "api_key" | "oauth" | null;
  connectedVia?: string;
}

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
}

export interface ModelRef {
  provider: string;
  id: string;
}

export interface Settings {
  /** The language being learned right now (one of `languages`). */
  language: Language;
  /** Interface language, also the language the tutor explains in. Absent or "system" = follow the system. */
  uiLocale?: UiLocale | "system";
  model?: ModelRef;
  /** Colour theme (Settings > Appearance, welcome page). Absent = "light". */
  theme?: Theme;
  /** Stable per-install UUID; Sign in with ChatGPT registers it as the agent host. */
  deviceId?: string;
  /** Languages the learner has opted into, in picker order. */
  languages?: Language[];
  /** Show translations under tutor messages by default. */
  autoTranslate?: boolean;
  /** Onboarding finished (connect → language/level → optional extras). */
  onboarded?: boolean;
  /** Stage 2 (S2-16): the ElevenLabs voice for deck audio. The key itself is in credentials.json. */
  elevenLabsVoice?: { id: string; name: string };
  /**
   * Stage 3: the learner's ElevenLabs accounts, in the order Sayfern uses them. Each key is stored
   * encrypted in credentials.json under `credential` ("elevenlabs" for the first, as in v0.6).
   */
  elevenLabsAccounts?: { id: string; label: string; credential: string; keyHint: string; addedAt: number }[];
  /** Stage 3: voice preferences; DEFAULT_VOICE_PREFS fills what is missing. */
  voice?: Partial<VoicePrefs>;
  /** v0.1 sessions (<userData>/sessions) were imported into records once. */
  legacyImported?: boolean;
}

/** Mirrors pi-ai's AuthPrompt, minus the AbortSignal (not serializable). */
export type AuthPromptPayload =
  | { promptId: string; type: "text" | "secret" | "manual_code"; message: string; placeholder?: string }
  | { promptId: string; type: "select"; message: string; options: { id: string; label: string; description?: string }[] };

export type AuthEventPayload =
  | { type: "info"; message: string; links?: { url: string; label?: string }[] }
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; userCode: string; verificationUri: string }
  | { type: "progress"; message: string }
  | { type: "prompt_cancelled"; promptId: string };
