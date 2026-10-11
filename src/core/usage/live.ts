import type { ProviderUsage, UsageWindow } from "../../shared/types";

type Live = Pick<ProviderUsage, "windows" | "balance">;
type Fetcher = (token: string, fetch: typeof globalThis.fetch) => Promise<Live>;

interface ProviderUsageSource {
  /** Subscription sign-in: plan limits. */
  oauth?: Fetcher;
  /** API key: balance or plan limits, when the provider has an endpoint for it. */
  apiKey?: Fetcher;
  billingUrl?: string;
  /** No limits the API reports: show requests and tokens instead of cost. */
  free?: boolean;
}

/** `T` is the part of the answer Sayfern reads; every field is optional because the endpoints are not all documented. */
async function getJson<T>(fetch: typeof globalThis.fetch, url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json", ...headers } });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

const ms = (iso: unknown) => (typeof iso === "string" && iso ? Date.parse(iso) : undefined);

/** Claude Pro/Max: the endpoint Claude Code's /usage reads (not documented by Anthropic). */
const claudePlan: Fetcher = async (token, fetch) => {
  type Window = { utilization?: number; resets_at?: string | null } | null;
  const body = await getJson<{ five_hour?: Window; seven_day?: Window }>(fetch, "https://api.anthropic.com/api/oauth/usage", {
    authorization: `Bearer ${token}`,
    "anthropic-beta": "oauth-2025-04-20",
  });
  const windows: UsageWindow[] = [];
  const add = (kind: UsageWindow["kind"], w: Window | undefined) => {
    if (w && typeof w.utilization === "number") windows.push({ kind, usedPercent: w.utilization, resetsAt: ms(w.resets_at) });
  };
  add("session", body.five_hour);
  add("weekly", body.seven_day);
  return { windows };
};

/** The ChatGPT account id is a claim in the OAuth access token. */
function chatgptAccount(token: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;
  } catch {
    return undefined;
  }
}

interface CodexWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
  reset_after_seconds?: number;
}

/** Sign in with ChatGPT: the endpoint Codex reads (not documented by OpenAI). */
const chatgptPlan: Fetcher = async (token, fetch) => {
  const account = chatgptAccount(token);
  const body = await getJson<{ rate_limit?: { primary_window?: CodexWindow | null; secondary_window?: CodexWindow | null } }>(fetch, "https://chatgpt.com/backend-api/wham/usage", {
    authorization: `Bearer ${token}`,
    ...(account ? { "chatgpt-account-id": account } : {}),
  });
  const slots: (CodexWindow | null | undefined)[] = [body.rate_limit?.primary_window, body.rate_limit?.secondary_window];
  const windows: UsageWindow[] = [];
  slots.forEach((w, i) => {
    if (!w || typeof w.used_percent !== "number") return;
    // Name the window by its length; the slots move when OpenAI drops one limit.
    const kind = w.limit_window_seconds ? (w.limit_window_seconds <= 6 * 3600 ? "session" : "weekly") : i === 0 ? "session" : "weekly";
    const resetsAt = w.reset_at ? w.reset_at * 1000 : w.reset_after_seconds !== undefined ? Date.now() + w.reset_after_seconds * 1000 : undefined;
    windows.push({ kind, usedPercent: w.used_percent, resetsAt });
  });
  return { windows };
};

const deepseekBalance: Fetcher = async (token, fetch) => {
  const body = await getJson<{ balance_infos?: { currency: string; total_balance: string }[] }>(fetch, "https://api.deepseek.com/user/balance", {
    authorization: `Bearer ${token}`,
  });
  const info = body.balance_infos?.[0];
  return info ? { balance: { amount: Number(info.total_balance), currency: info.currency } } : {};
};

/** OpenRouter: what is left of this key's credit limit. Keys without a limit spend the account's credit, which only management keys can read. */
const openrouterCredit: Fetcher = async (token, fetch) => {
  const body = await getJson<{ data?: { limit_remaining?: number | null } }>(fetch, "https://openrouter.ai/api/v1/key", { authorization: `Bearer ${token}` });
  const left = body.data?.limit_remaining;
  return typeof left === "number" ? { balance: { amount: left, currency: "USD" } } : {};
};

/** OpenCode Go: the 5-hour, weekly and monthly windows. Answers 403 for keys without a Go plan. */
const opencodeGoPlan: Fetcher = async (token, fetch) => {
  type Window = { percent?: number; resetsAt?: string };
  const body = await getJson<{ usage?: { rolling?: Window; weekly?: Window; monthly?: Window } }>(fetch, "https://opencode.ai/zen/go/v1/usage", {
    authorization: `Bearer ${token}`,
  });
  const windows: UsageWindow[] = [];
  const add = (kind: UsageWindow["kind"], w: Window | undefined) => {
    if (w && typeof w.percent === "number") windows.push({ kind, usedPercent: w.percent, resetsAt: ms(w.resetsAt) });
  };
  add("session", body.usage?.rolling);
  add("weekly", body.usage?.weekly);
  add("monthly", body.usage?.monthly);
  return { windows };
};

/** Providers without an entry show only local spend. */
export const USAGE_SOURCES: Record<string, ProviderUsageSource> = {
  anthropic: { oauth: claudePlan, billingUrl: "https://console.anthropic.com/settings/billing" },
  openai: { oauth: chatgptPlan, billingUrl: "https://platform.openai.com/settings/organization/billing/overview" },
  deepseek: { apiKey: deepseekBalance, billingUrl: "https://platform.deepseek.com/usage" },
  openrouter: { apiKey: openrouterCredit, billingUrl: "https://openrouter.ai/settings/credits" },
  google: { free: true, billingUrl: "https://aistudio.google.com/usage" },
  opencode: { billingUrl: "https://opencode.ai/auth" },
  "opencode-go": { apiKey: opencodeGoPlan, billingUrl: "https://opencode.ai/auth" },
};
