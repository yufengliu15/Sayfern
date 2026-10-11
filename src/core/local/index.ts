import { createProvider, type Api, type Model, type MutableModels } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { LocalEngineId, Settings } from "../../shared/types";
import { LOCAL_ENGINES, NO_KEY } from "./engines";

export { LOCAL_ENGINES } from "./engines";

export type LocalServers = NonNullable<Settings["localServers"]>;

type Server = { baseUrl: string; apiKey?: string };
type Entries = [LocalEngineId, Server][];

const entries = (servers: LocalServers | undefined) => Object.entries(servers ?? {}).filter(([, v]) => v) as Entries;

function setProvider(models: MutableModels, engine: LocalEngineId, server: Server, list: Model<Api>[]) {
  const def = LOCAL_ENGINES[engine];
  models.setProvider(
    createProvider({
      id: def.id,
      name: def.name,
      baseUrl: server.baseUrl,
      auth: {
        apiKey: {
          name: `${def.name} server`,
          resolve: async () => ({ auth: { apiKey: server.apiKey || NO_KEY }, source: server.baseUrl }),
        },
      },
      models: list,
      api: openAICompletionsApi(),
    }),
  );
}

/** Registers (or replaces) the provider of a local engine with the models the server serves now. Rejects if the server cannot be reached. */
export async function registerLocal(models: MutableModels, engine: LocalEngineId, server: Server, fetch: typeof globalThis.fetch) {
  setProvider(models, engine, server, await LOCAL_ENGINES[engine].listModels(server.baseUrl, server.apiKey, fetch));
}

/**
 * Reads the models of every saved server again (new models show up without a restart).
 * A server that is down keeps its last list, or an empty one at startup: it never throws.
 */
export const refreshLocals = (models: MutableModels, servers: LocalServers | undefined, fetch: typeof globalThis.fetch) =>
  Promise.all(
    entries(servers).map(([engine, server]) =>
      registerLocal(models, engine, server, fetch).catch(() => {
        if (!models.getProvider(engine)) setProvider(models, engine, server, []);
      }),
    ),
  );
