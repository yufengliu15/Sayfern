import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { FileCredentialStore } from "../credential-file-store";
import { LIVE_TTL_MS, meterModels, USAGE_SOURCES, UsageLog, UsageService } from ".";
import { localDate } from "../records/dates";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const tmp = () => mkdtempSync(join(tmpdir(), "sayfern-usage-"));
const DAY = 86_400_000;

/** A fetch that answers one URL and records the headers it got. */
function fakeFetch(answer: (url: string) => Response) {
  const calls: { url: string; headers: Headers }[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return answer(String(input));
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

test("the usage log sums today and the last 30 days per provider, and drops old days", async () => {
  const dir = tmp();
  const clock = { t: new Date(2026, 9, 10, 12).getTime() };
  const log = new UsageLog(join(dir, "usage.json"), () => clock.t);
  clock.t -= 70 * DAY;
  await log.add("deepseek", { input: 10, output: 5, cost: 9 });
  clock.t += 40 * DAY;
  await log.add("deepseek", { input: 100, output: 50, cost: 0.5 });
  clock.t += 30 * DAY;
  await log.add("deepseek", { input: 1000, output: 500, cost: 0.25 });
  await log.add("deepseek", { input: 1000, output: 500, cost: 0.25 });
  await log.add("openai", { input: 1, output: 1, cost: 1 });

  const totals = await log.totals("deepseek");
  assert.deepEqual(totals.today, { requests: 2, tokens: 3000, cost: 0.5 });
  // The day 30 days back is outside the window; the 70-day-old day is gone from disk.
  assert.deepEqual(totals.last30Days, { requests: 2, tokens: 3000, cost: 0.5 });
  const onDisk = JSON.parse(readFileSync(join(dir, "usage.json"), "utf8"));
  assert.equal(Object.keys(onDisk).length, 2);
  assert.ok(!(localDate(clock.t - 70 * DAY) in onDisk));
  assert.deepEqual(await log.totals("google"), { today: { requests: 0, tokens: 0, cost: 0 }, last30Days: { requests: 0, tokens: 0, cost: 0 } });
});

test("the meter logs every API-key reply once, from streams and from completeSimple", async () => {
  const dir = tmp();
  const models = createModels({ credentials: new FileCredentialStore(join(dir, "credentials.json")) });
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  const log = new UsageLog(join(dir, "usage.json"), Date.now);
  const metered = meterModels(models, log);
  faux.setResponses([fauxAssistantMessage("好"), fauxAssistantMessage("好")]);
  const model = faux.getModel();

  await metered.completeSimple(model, { messages: [{ role: "user", content: "你好", timestamp: 0 }] });
  const stream = metered.streamSimple(model, { messages: [{ role: "user", content: "你好", timestamp: 0 }] });
  for await (const _ of stream);
  await new Promise((r) => setTimeout(r, 20));

  const { today } = await log.totals(model.provider);
  assert.equal(today.requests, 2);
  assert.ok(today.tokens > 0);
  // Everything else still reaches the real object.
  assert.equal(metered.getModel(model.provider, model.id), model);
});

test("Claude Pro/Max: 5-hour and weekly windows from the OAuth usage endpoint", async () => {
  const { fetch, calls } = fakeFetch(() =>
    json({ five_hour: { utilization: 37, resets_at: "2026-10-10T20:00:00Z" }, seven_day: { utilization: 82.5, resets_at: "2026-10-13T00:00:00Z" }, seven_day_opus: null }),
  );
  const live = await USAGE_SOURCES.anthropic.oauth!("tok", fetch);
  assert.deepEqual(live.windows, [
    { kind: "session", usedPercent: 37, resetsAt: Date.parse("2026-10-10T20:00:00Z") },
    { kind: "weekly", usedPercent: 82.5, resetsAt: Date.parse("2026-10-13T00:00:00Z") },
  ]);
  assert.equal(calls[0].url, "https://api.anthropic.com/api/oauth/usage");
  assert.equal(calls[0].headers.get("authorization"), "Bearer tok");
  assert.equal(calls[0].headers.get("anthropic-beta"), "oauth-2025-04-20");
});

test("Claude Pro/Max: a 5-hour window that has not started has no reset time", async () => {
  const { fetch } = fakeFetch(() => json({ five_hour: { utilization: 0, resets_at: null }, seven_day: { utilization: 3, resets_at: "2026-10-13T00:00:00Z" } }));
  const live = await USAGE_SOURCES.anthropic.oauth!("tok", fetch);
  assert.equal(live.windows?.[0].resetsAt, undefined);
});

test("Sign in with ChatGPT: windows named by their length, account id from the token", async () => {
  const claims = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } })).toString("base64url");
  const { fetch, calls } = fakeFetch(() =>
    json({
      plan_type: "plus",
      rate_limit: {
        // Weekly in the primary slot: OpenAI moves windows when it drops one.
        primary_window: { used_percent: 12, limit_window_seconds: 604800, reset_at: 1_760_400_000 },
        secondary_window: { used_percent: 55, limit_window_seconds: 18000, reset_at: 1_760_120_000 },
      },
    }),
  );
  const live = await USAGE_SOURCES.openai.oauth!(`h.${claims}.s`, fetch);
  assert.deepEqual(live.windows, [
    { kind: "weekly", usedPercent: 12, resetsAt: 1_760_400_000_000 },
    { kind: "session", usedPercent: 55, resetsAt: 1_760_120_000_000 },
  ]);
  assert.equal(calls[0].url, "https://chatgpt.com/backend-api/wham/usage");
  assert.equal(calls[0].headers.get("chatgpt-account-id"), "acct-1");
});

test("DeepSeek balance, OpenRouter key credit, OpenCode Go windows", async () => {
  const deepseek = fakeFetch(() => json({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" }] }));
  assert.deepEqual(await USAGE_SOURCES.deepseek.apiKey!("k", deepseek.fetch), { balance: { amount: 110, currency: "CNY" } });

  const capped = fakeFetch(() => json({ data: { usage: 2.5, limit: 10, limit_remaining: 7.5 } }));
  assert.deepEqual(await USAGE_SOURCES.openrouter.apiKey!("k", capped.fetch), { balance: { amount: 7.5, currency: "USD" } });
  const uncapped = fakeFetch(() => json({ data: { usage: 2.5, limit: null, limit_remaining: null } }));
  assert.deepEqual(await USAGE_SOURCES.openrouter.apiKey!("k", uncapped.fetch), {});

  const go = fakeFetch(() =>
    json({
      usage: {
        rolling: { status: "ok", percent: 4, resetsAt: "2026-10-10T18:00:00Z" },
        weekly: { status: "ok", percent: 21, resetsAt: "2026-10-14T00:00:00Z" },
        monthly: { status: "rate-limited", percent: 100, resetsAt: "2026-10-29T00:00:00Z" },
      },
    }),
  );
  const live = await USAGE_SOURCES["opencode-go"].apiKey!("k", go.fetch);
  assert.deepEqual(
    live.windows?.map((w) => [w.kind, w.usedPercent]),
    [
      ["session", 4],
      ["weekly", 21],
      ["monthly", 100],
    ],
  );
  assert.equal(go.calls[0].url, "https://opencode.ai/zen/go/v1/usage");
});

async function deepseekService(answer: (url: string) => Response) {
  const dir = tmp();
  const credentials = new FileCredentialStore(join(dir, "credentials.json"));
  await credentials.modify("deepseek", async () => ({ type: "api_key", key: "sk-test" }));
  const { deepseekProvider } = await import("@earendil-works/pi-ai/providers/deepseek");
  const models = createModels({ credentials });
  models.setProvider(deepseekProvider());
  const clock = { t: Date.now() };
  const log = new UsageLog(join(dir, "usage.json"), () => clock.t);
  const fake = fakeFetch(answer);
  const service = new UsageService({ models, log, fetch: fake.fetch, now: () => clock.t });
  return { service, log, clock, calls: fake.calls };
}

test("an API-key provider shows its balance, local spend and billing page; live answers are cached", async () => {
  const { service, log, clock, calls } = await deepseekService(() => json({ balance_infos: [{ currency: "USD", total_balance: "4.20" }] }));
  await log.add("deepseek", { input: 900, output: 100, cost: 0.002 });

  const usage = await service.forProvider("deepseek");
  assert.deepEqual(usage.balance, { amount: 4.2, currency: "USD" });
  assert.equal(usage.spent?.today.requests, 1);
  assert.equal(usage.billingUrl, "https://platform.deepseek.com/usage");
  assert.equal(calls[0].headers.get("authorization"), "Bearer sk-test");

  await service.forProvider("deepseek");
  assert.equal(calls.length, 1);
  clock.t += LIVE_TTL_MS + 1;
  await service.forProvider("deepseek");
  assert.equal(calls.length, 2);
  service.forget("deepseek");
  await service.forProvider("deepseek");
  assert.equal(calls.length, 3);
});

test("a failed live check comes back as an error with local spend, and is not cached", async () => {
  const { service, calls } = await deepseekService(() => json({ error: "nope" }, 401));
  const usage = await service.forProvider("deepseek");
  assert.match(usage.error ?? "", /401/);
  assert.equal(usage.spent?.today.requests, 0);
  await service.forProvider("deepseek");
  assert.equal(calls.length, 2);
});

test("a provider that is not connected has no usage", async () => {
  const dir = tmp();
  const models = createModels({ credentials: new FileCredentialStore(join(dir, "credentials.json")) });
  const { deepseekProvider } = await import("@earendil-works/pi-ai/providers/deepseek");
  models.setProvider(deepseekProvider());
  const service = new UsageService({ models, log: new UsageLog(join(dir, "usage.json"), Date.now), fetch: fakeFetch(() => json({})).fetch, now: Date.now });
  assert.deepEqual(await service.forProvider("deepseek"), {});
});
