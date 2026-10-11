import type { MutableModels } from "@earendil-works/pi-ai";
import type { ProviderUsage } from "../../shared/types";
import { USAGE_SOURCES } from "./live";
import { UsageLog } from "./log";

export { UsageLog } from "./log";
export { meterModels } from "./meter";
export { USAGE_SOURCES } from "./live";

/** Live checks are cached this long: Anthropic answers 429 when its usage endpoint is polled. */
export const LIVE_TTL_MS = 2 * 60 * 1000;

/** Where a subscription sign-in shows its own limits. */
const PLAN_URLS: Record<string, string> = {
  anthropic: "https://claude.ai/settings/usage",
  openai: "https://chatgpt.com/codex/settings/usage",
};

export interface UsageDeps {
  models: MutableModels;
  log: UsageLog;
  fetch: typeof globalThis.fetch;
  now: () => number;
}

/** The usage line beside each provider on the connect screen. */
export class UsageService {
  private readonly cache = new Map<string, { at: number; value: Pick<ProviderUsage, "windows" | "balance"> }>();

  constructor(private readonly deps: UsageDeps) {}

  async forProvider(providerId: string): Promise<ProviderUsage> {
    const { models, log, fetch, now } = this.deps;
    const source = USAGE_SOURCES[providerId] ?? {};
    const auth = await models.checkAuth(providerId);
    if (!auth) return {};
    const out: ProviderUsage = auth.type === "oauth" ? { billingUrl: PLAN_URLS[providerId] } : { billingUrl: source.billingUrl, spent: await log.totals(providerId) };
    if (source.free) out.free = true;
    const live = auth.type === "oauth" ? source.oauth : source.apiKey;
    if (!live) return out;

    const key = `${providerId}:${auth.type}`;
    const hit = this.cache.get(key);
    if (hit && now() - hit.at < LIVE_TTL_MS) return { ...out, ...hit.value };
    try {
      const token = (await models.getAuth(providerId))?.auth.apiKey;
      if (!token) return out;
      const value = await live(token, fetch);
      this.cache.set(key, { at: now(), value });
      return { ...out, ...value };
    } catch (err) {
      return { ...out, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** After sign-in, sign-out or a new key the old answer is wrong. */
  forget(providerId: string) {
    for (const key of this.cache.keys()) if (key.startsWith(`${providerId}:`)) this.cache.delete(key);
  }
}
