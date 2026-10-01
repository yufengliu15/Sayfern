import { createModels, type CredentialStore, type MutableModels, type Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { fireworksProvider } from "@earendil-works/pi-ai/providers/fireworks";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { ModelInfo, ProviderInfo } from "../shared/types";

/**
 * Stage 1 validation set. pi-ai ships ~40 providers; adding one here is a
 * one-line change once we've checked it behaves well for tutoring.
 */
const FACTORIES: (() => Provider)[] = [
  anthropicProvider,
  openaiProvider,
  deepseekProvider,
  fireworksProvider,
  openrouterProvider,
  googleProvider,
];

/** Friendlier sign-in button labels than the library defaults. */
const LOGIN_LABELS: Record<string, string> = {
  anthropic: "Sign in with Claude Pro/Max",
  openai: "Sign in with ChatGPT",
};

/** Short product notes shown on the connect screen. */
const NOTES: Record<string, string> = {
  anthropic: "Claude. Sign in with Pro/Max (uses your plan's Agent SDK credit) or an API key.",
  openai: "GPT. Sign in with ChatGPT to use your subscription, or an API key.",
  deepseek: "DeepSeek API key.",
  fireworks: "Fireworks API key. Many open models.",
  openrouter: "One key for hundreds of models.",
  google: "Gemini API key.",
};

export function createSayfernModels(credentials: CredentialStore): MutableModels {
  const models = createModels({ credentials });
  for (const make of FACTORIES) models.setProvider(make());
  return models;
}

export async function describeProviders(models: MutableModels, credentials: CredentialStore): Promise<ProviderInfo[]> {
  const stored = new Map((await credentials.list()).map((c) => [c.providerId, c.type]));
  const out: ProviderInfo[] = [];
  for (const p of models.getProviders()) {
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
