// Real-socket checks for AnkiConnect failure reasons (uses Node's fetch, like the app).
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AnkiConnectService, classifyFetchError } from "./index";

function service(url: string, timeoutMs = 300) {
  const s = new AnkiConnectService({ dataDir: mkdtempSync(join(tmpdir(), "anki-")), timeoutMs });
  return s.setConfig({ enabled: true, url, decks: [] }).then(() => s);
}

function serve(handler: http.RequestListener): Promise<{ url: string; close(): void }> {
  return new Promise((resolve) => {
    const srv = http.createServer(handler).listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => srv.close() });
    });
  });
}

test("connection refused → reason refused", async () => {
  const probe = await serve(() => {});
  probe.close(); // free port, nothing listening
  await new Promise((r) => setTimeout(r, 50));
  const p = await (await service(probe.url)).ping();
  assert.equal(p.connected, false);
  assert.equal(p.reason, "refused");
});

test("hung server → reason timeout", async () => {
  const srv = await serve(() => {}); // never responds
  const p = await (await service(srv.url, 200)).ping();
  srv.close();
  assert.equal(p.reason, "timeout");
});

test("403 → reason forbidden", async () => {
  const srv = await serve((_q, res) => {
    res.statusCode = 403;
    res.end();
  });
  const p = await (await service(srv.url)).ping();
  srv.close();
  assert.equal(p.reason, "forbidden");
});

test("non-AnkiConnect server → reason not_ankiconnect", async () => {
  const srv = await serve((_q, res) => res.end("<html>hi</html>"));
  const p = await (await service(srv.url)).ping();
  srv.close();
  assert.equal(p.reason, "not_ankiconnect");
});

test("working AnkiConnect → connected with version", async () => {
  const srv = await serve((_q, res) => res.end(JSON.stringify({ result: 6, error: null })));
  const p = await (await service(srv.url)).ping();
  srv.close();
  assert.deepEqual(p, { connected: true, version: 6 });
});

test("classifies Chromium net errors too", () => {
  assert.equal(classifyFetchError(new Error("net::ERR_CONNECTION_REFUSED")), "refused");
  assert.equal(classifyFetchError(new Error("net::ERR_TIMED_OUT")), "timeout");
  assert.equal(classifyFetchError(Object.assign(new Error("x"), { name: "TimeoutError" })), "timeout");
});

test("a deck without a word field is kept (v0.2.0 dropdown bug) and sync asks for the field", async () => {
  const s = new AnkiConnectService({ dataDir: mkdtempSync(join(tmpdir(), "anki-")), timeoutMs: 300 });
  const saved = await s.setConfig({ enabled: true, url: "http://127.0.0.1:9", decks: [{ language: "zh", deck: "Chinese::HSK3", wordField: "" }] });
  assert.equal(saved.decks.length, 1);
  assert.equal(saved.decks[0]!.deck, "Chinese::HSK3");
  await assert.rejects(() => s.sync("zh"), /which field holds the word/);
});
