import { msg } from "../../shared/i18n";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { LocalEngineId } from "../../shared/types";

/**
 * A local inference engine Sayfern can connect to. To support another engine:
 *   1. add its id to `LocalEngineId` (src/shared/types.ts),
 *   2. add one entry to `LOCAL_ENGINES` below (`listModels` returns pi-ai models for the server),
 *   3. add its connect-screen text to the catalogs (name stays as is, `note` is a msg()).
 * Everything else (settings, provider registration, connect/disconnect, the connect screen) follows the table.
 */
export interface LocalEngine {
  id: LocalEngineId;
  /** Display name, also the provider name. */
  name: string;
  /** Pre-filled in the URL field. */
  defaultUrl: string;
  docsUrl: string;
  /** Shown on the connect screen (translated by the renderer). */
  note: string;
  /** Reads the models the server serves. Rejects if the server cannot be reached or answers with an error. */
  listModels(baseUrl: string, apiKey: string | undefined, fetch: typeof globalThis.fetch): Promise<Model<Api>[]>;
}

/** Sent when the server needs no key: the OpenAI client refuses an empty one. */
export const NO_KEY = "sayfern-local";

const FALLBACK_CONTEXT = 8192;
const MAX_REPLY_TOKENS = 8192;

const trimSlash = (url: string) => url.replace(/\/+$/, "");

function headers(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function getJson(fetch: typeof globalThis.fetch, url: string, apiKey: string | undefined) {
  const res = await fetch(url, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(`${url} answered ${res.status} ${res.statusText}`.trim());
  return (await res.json()) as any;
}

/** llama-server: OpenAI-compatible `/v1/models`, plus `/props` (outside `/v1`) for the context size and vision. */
async function listLlamaCpp(baseUrl: string, apiKey: string | undefined, fetch: typeof globalThis.fetch) {
  const base = trimSlash(baseUrl);
  const list = await getJson(fetch, `${base}/models`, apiKey);
  const props = await getJson(fetch, `${base.replace(/\/v1$/, "")}/props`, apiKey).catch(() => undefined);
  const contextWindow: number = props?.default_generation_settings?.n_ctx || FALLBACK_CONTEXT;
  const vision = !!props?.modalities?.vision;
  const ids: string[] = (list?.data ?? []).map((m: { id: string }) => m.id);
  return ids.map(
    (id): Model<Api> => ({
      id,
      name: id,
      api: "openai-completions",
      provider: "llamacpp",
      baseUrl: base,
      // Reasoning stays off: Sayfern then sends no thinking parameters, which llama-server may reject.
      reasoning: false,
      input: vision ? ["text", "image"] : ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens: Math.min(contextWindow, MAX_REPLY_TOKENS),
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsStrictMode: false,
        supportsUsageInStreaming: true,
        maxTokensField: "max_tokens",
      },
    }),
  );
}

export const LOCAL_ENGINES: Record<LocalEngineId, LocalEngine> = {
  llamacpp: {
    id: "llamacpp",
    name: "llama.cpp",
    defaultUrl: "http://127.0.0.1:47823/v1",
    docsUrl: "https://github.com/ggml-org/llama.cpp/tree/master/tools/server",
    note: msg("Runs a model on this computer with llama-server. Start the server first."),
    listModels: listLlamaCpp,
  },
};
