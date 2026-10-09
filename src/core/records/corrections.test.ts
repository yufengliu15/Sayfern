import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { countableCorrection } from "../quiz/material";
import { makeStore, tempDir } from "./helpers.test-util";

const old = (id: string, kind: string) => ({
  id,
  language: "zh",
  sessionId: "s1",
  messageId: "m1",
  original: id,
  corrected: "y",
  explanation: "x",
  kind,
  createdAt: 1,
  status: "open",
  retries: [],
});

describe("correction kinds", () => {
  it("maps kinds from before v0.21.0 on read and keeps the new value on the next write", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "corrections.json"), JSON.stringify(["grammar", "vocabulary", "phrasing", "style", "typo", "speaking"].map((k) => old(`c-${k}`, k))));
    const { store } = makeStore(undefined, dir);
    const kinds = Object.fromEntries((await store.listCorrections({ language: "zh" })).map((c) => [c.id, c.kind]));
    assert.deepEqual(kinds, {
      "c-grammar": "grammar",
      "c-vocabulary": "grammar",
      "c-phrasing": "grammar",
      "c-style": "typo",
      "c-typo": "typo",
      "c-speaking": "speaking",
    });
    assert.equal(((await store.exportAll()).corrections as { kind: string }[]).some((c) => ["vocabulary", "phrasing", "style"].includes(c.kind)), false);
    await store.updateCorrection("c-style", { status: "disputed" });
    const saved = JSON.parse(readFileSync(join(dir, "corrections.json"), "utf8")) as { kind: string }[];
    assert.deepEqual([...new Set(saved.map((c) => c.kind))].sort(), ["grammar", "speaking", "typo"]);
  });

  it("quiz material counts only undisputed grammar corrections", () => {
    const c = (kind: string, status = "open") => ({ ...old("x", kind), status }) as never;
    assert.equal(countableCorrection(c("grammar")), true);
    assert.equal(countableCorrection(c("typo")), false);
    assert.equal(countableCorrection(c("speaking")), false);
    assert.equal(countableCorrection(c("grammar", "disputed")), false);
  });
});
