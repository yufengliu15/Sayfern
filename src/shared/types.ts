// Provider, model, auth and settings types shared by main, preload and renderer.
// Learning-record types live in ./records, language types in ./lang, the IPC API in ./api.
import type { Language } from "./records";

export type { Language } from "./records";

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
  language: Language;
  model?: ModelRef;
  /** Stable per-install UUID; Sign in with ChatGPT registers it as the agent host. */
  deviceId?: string;
  /** Languages the learner has opted into, in picker order. */
  languages?: Language[];
  /** Default feedback timing for new sessions. */
  feedbackMode?: "inline" | "end";
  /** Show translations under tutor messages by default. */
  autoTranslate?: boolean;
  /** Onboarding finished (connect → language/level → optional extras). */
  onboarded?: boolean;
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
