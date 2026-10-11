import { msg } from "../shared/i18n";
import { createModels, type CredentialStore, type MutableModels, type Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { ModelInfo, ProviderInfo, Settings } from "../shared/types";
import { LOCAL_ENGINES } from "./local/engines";

/**
 * Stage 1 validation set. pi-ai ships ~40 providers; adding one here is a
 * one-line change once we've checked it behaves well for tutoring.
 */
const FACTORIES: (() => Provider)[] = [
  anthropicProvider,
  openaiProvider,
  deepseekProvider,
  openrouterProvider,
  googleProvider,
  opencodeProvider,
  opencodeGoProvider,
];

/** Friendlier sign-in button labels than the library defaults. */
// Shown through the renderer's t(): msg() marks them for the catalogs.
const LOGIN_LABELS: Record<string, string> = {
  anthropic: msg("Sign in with Claude Pro/Max"),
  openai: msg("Sign in with ChatGPT"),
};

/** Short product notes shown on the connect screen. */
const NOTES: Record<string, string> = {
  anthropic: msg("Claude. Sign in with Pro/Max (uses your plan's Agent SDK credit) or an API key."),
  openai: msg("GPT. Sign in with ChatGPT to use your subscription, or an API key."),
  deepseek: msg("DeepSeek API key."),
  openrouter: msg("One key for hundreds of models."),
  google: msg("Gemini API key."),
  opencode: msg("OpenCode Zen API key. Pay as you go."),
  "opencode-go": msg("OpenCode Go API key. A plan with 5-hour, weekly and monthly limits."),
};

export function createSayfernModels(credentials: CredentialStore): MutableModels {
  const models = createModels({ credentials });
  for (const make of FACTORIES) models.setProvider(make());
  return models;
}

export async function describeProviders(models: MutableModels, credentials: CredentialStore, localServers: Settings["localServers"] = {}): Promise<ProviderInfo[]> {
  const stored = new Map((await credentials.list()).map((c) => [c.providerId, c.type]));
  const out: ProviderInfo[] = [];
  for (const p of models.getProviders()) {
    if (p.id in LOCAL_ENGINES) continue;
    const check = await models.checkAuth(p.id).catch(() => undefined);
    out.push({
      id: p.id,
      name: p.name,
      note: NOTES[p.id] ?? "",
      canApiKey: !!p.auth.apiKey,
      oauthLabel: p.auth.oauth ? (LOGIN_LABELS[p.id] ?? p.auth.oauth.loginLabel ?? `Sign in (${p.auth.oauth.name})`) : undefined,
      oauthIsSubscription: !!p.auth.oauth?.isSubscription,
      connected: check ? check.type : null,
      connectedVia: check?.source ?? (stored.has(p.id) ? "stored" : undefined),
    });
  }
  // Local engines are always listed, connected or not (the connect screen needs the URL field).
  for (const engine of Object.values(LOCAL_ENGINES)) {
    const server = localServers[engine.id];
    out.push({
      id: engine.id,
      name: engine.name,
      note: engine.note,
      canApiKey: false,
      oauthIsSubscription: false,
      connected: server ? "api_key" : null,
      connectedVia: server?.baseUrl,
      local: { engine: engine.id, baseUrl: server?.baseUrl, defaultUrl: engine.defaultUrl, docsUrl: engine.docsUrl },
    });
  }
  return out;
}

export async function listAvailableModels(models: MutableModels): Promise<ModelInfo[]> {
  const available = await models.getAvailable();
  return available.map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name,
    reasoning: m.reasoning,
    input: [...m.input],
    contextWindow: m.contextWindow,
  }));
}
