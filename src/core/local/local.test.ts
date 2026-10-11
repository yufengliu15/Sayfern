import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai";
import { FileCredentialStore } from "../credential-file-store";
import { SayfernApp } from "../app";
import { LOCAL_ENGINES } from "./engines";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake llama-server: `/v1/models` and `/props`. */
function fakeServer(opts: { up?: () => boolean; props?: unknown; ids?: string[] } = {}) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    if (opts.up && !opts.up()) throw new TypeError("fetch failed");
    if (url.endsWith("/v1/models")) return json({ data: (opts.ids ?? ["qwen3-8b"]).map((id) => ({ id })) });
    if (url.endsWith("/props")) return opts.props === undefined ? json({}, 404) : json(opts.props);
    return json({}, 404);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

async function makeApp(fetch: typeof globalThis.fetch, dir = mkdtempSync(join(tmpdir(), "sayfern-local-"))) {
  const credentials = new FileCredentialStore(join(dir, "credentials.json"));
  const models = createModels({ credentials });
  const app = new SayfernApp({ dataDir: dir, models, credentials, fetch, emit: () => {} });
  await app.init();
  return { app, dir, models, credentials };
}

const URL = "http://127.0.0.1:47823/v1";

test("llama.cpp lists models with the context size and vision from /props", async () => {
  const { fetch, calls } = fakeServer({ props: { default_generation_settings: { n_ctx: 16384 }, modalities: { vision: true } }, ids: ["a", "b"] });
  const list = await LOCAL_ENGINES.llamacpp.listModels(`${URL}/`, "secret", fetch);
  assert.deepEqual(list.map((m) => m.id), ["a", "b"]);
  assert.equal(list[0]!.contextWindow, 16384);
  assert.deepEqual(list[0]!.input, ["text", "image"]);
  assert.equal(list[0]!.provider, "llamacpp");
  assert.equal(list[0]!.baseUrl, URL);
  assert.deepEqual(calls.map((c) => c.url), [`${URL}/models`, "http://127.0.0.1:47823/props"]);
  assert.equal(calls[0]!.auth, "Bearer secret");
});

test("llama.cpp falls back when /props is missing", async () => {
  const list = await LOCAL_ENGINES.llamacpp.listModels(URL, undefined, fakeServer().fetch);
  assert.equal(list[0]!.contextWindow, 8192);
  assert.deepEqual(list[0]!.input, ["text"]);
});

test("describeProviders always lists llama.cpp", async () => {
  const { app } = await makeApp(fakeServer().fetch);
  const p = (await app.listProviders()).find((x) => x.id === "llamacpp")!;
  assert.equal(p.connected, null);
  assert.equal(p.canApiKey, false);
  assert.deepEqual(p.local, { engine: "llamacpp", baseUrl: undefined, defaultUrl: URL, docsUrl: LOCAL_ENGINES.llamacpp.docsUrl });
});

test("connectLocal saves the server and its models appear", async () => {
  const { app, dir } = await makeApp(fakeServer().fetch);
  const found = await app.connectLocal("llamacpp", ` ${URL} `);
  assert.deepEqual(found.map((m) => m.id), ["qwen3-8b"]);
  assert.deepEqual((await app.listModels()).map((m) => m.provider), ["llamacpp"]);
  const p = (await app.listProviders()).find((x) => x.id === "llamacpp")!;
  assert.equal(p.connected, "api_key");
  assert.equal(p.connectedVia, URL);
  assert.equal(p.local!.baseUrl, URL);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).localServers, { llamacpp: { baseUrl: URL } });
});

test("connectLocal rejects and saves nothing when the server is down", async () => {
  const { app } = await makeApp(fakeServer({ up: () => false }).fetch);
  await assert.rejects(app.connectLocal("llamacpp", URL));
  assert.equal((await app.getSettings()).localServers, undefined);
  assert.deepEqual(await app.listModels(), []);
  assert.equal((await app.listProviders()).find((x) => x.id === "llamacpp")!.connected, null);
});

test("saved servers load at startup, refresh on listModels and survive the server going down", async () => {
  const state = { up: true, ids: ["one"] };
  const dir = mkdtempSync(join(tmpdir(), "sayfern-local-"));
  const first = await makeApp(fakeServer().fetch, dir);
  await first.app.connectLocal("llamacpp", URL, "k");
  const fake = {
    fetch: (async (input: string | URL) => {
      if (!state.up) throw new TypeError("fetch failed");
      const url = String(input);
      return url.endsWith("/models") ? json({ data: state.ids.map((id) => ({ id })) }) : json({}, 404);
    }) as typeof globalThis.fetch,
  };
  const { app } = await makeApp(fake.fetch, dir);
  assert.deepEqual((await app.listModels()).map((m) => m.id), ["one"]);
  state.ids = ["one", "two"];
  assert.deepEqual((await app.listModels()).map((m) => m.id), ["one", "two"]);
  state.up = false;
  assert.deepEqual((await app.listModels()).map((m) => m.id), ["one", "two"]);
  assert.equal((await app.getSettings()).localServers!.llamacpp!.apiKey, "k");
});

test("a server that is down at startup gives no models and no error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sayfern-local-"));
  await (await makeApp(fakeServer().fetch, dir)).app.connectLocal("llamacpp", URL);
  const { app } = await makeApp(fakeServer({ up: () => false }).fetch, dir);
  assert.deepEqual(await app.listModels(), []);
  assert.equal((await app.listProviders()).find((x) => x.id === "llamacpp")!.connected, "api_key");
});

test("disconnectLocal and logout forget the server", async () => {
  const { app } = await makeApp(fakeServer().fetch);
  await app.connectLocal("llamacpp", URL);
  await app.disconnectLocal("llamacpp");
  assert.deepEqual(await app.listModels(), []);
  assert.deepEqual((await app.getSettings()).localServers, {});
  await app.connectLocal("llamacpp", URL);
  await app.logout("llamacpp");
  assert.deepEqual(await app.listModels(), []);
  assert.equal((await app.listProviders()).find((x) => x.id === "llamacpp")!.connected, null);
});

test("a turn streams from an OpenAI-compatible server", async () => {
  const bodies: any[] = [];
  const server = createServer((req, res) => {
    if (req.url === "/v1/models") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "m" }] }));
    if (req.url === "/v1/chat/completions") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        bodies.push(JSON.parse(raw));
        res.writeHead(200, { "content-type": "text/event-stream" });
        const chunk = (delta: object, finish: string | null = null) =>
          res.write(`data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
        chunk({ role: "assistant", content: "你好" });
        chunk({ content: "！" }, "stop");
        res.write(`data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", model: "m", choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })}\n\n`);
        res.end("data: [DONE]\n\n");
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const { app, models } = await makeApp(globalThis.fetch);
    await app.connectLocal("llamacpp", url);
    const model = models.getModel("llamacpp", "m")!;
    const reply = await models.complete(model, { systemPrompt: "Be brief.", messages: [{ role: "user", content: "hi", timestamp: 0 }] });
    assert.equal(reply.stopReason, "stop");
    assert.deepEqual(reply.content, [{ type: "text", text: "你好！" }]);
    assert.equal(bodies[0].model, "m");
  } finally {
    server.close();
  }
});
