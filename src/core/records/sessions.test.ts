import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { JsonRecordsStore } from "./store";
import { makeStore, msg, tempDir } from "./helpers.test-util";

const HOUR = 60 * 60 * 1000;

describe("sessions", () => {
  it("creates with defaults and reads back", async () => {
    const { store, clock } = makeStore();
    const zh = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    assert.equal(zh.title, "新对话");
    assert.deepEqual(zh.usage, { input: 0, output: 0, cost: 0 });
    assert.equal(zh.activeMs, 0);
    assert.equal(zh.createdAt, clock.t);
    assert.equal(zh.updatedAt, clock.t);
    const ja = await store.createSession({ language: "ja", kind: "reading", feedbackMode: "end", docId: "d1" });
    assert.equal(ja.title, "新しい会話");
    assert.equal(ja.docId, "d1");
    const named = await store.createSession({ language: "zh", kind: "practice", feedbackMode: "inline", title: "练习" });
    assert.equal(named.title, "练习");
    assert.deepEqual(await store.getSession(zh.id), zh);
    assert.equal(await store.getSession("nope"), null);
  });

  it("titles from the first user message only while the title is default", async () => {
    const { store } = makeStore();
    const s = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    await store.appendMessage(msg(s.id, "tutor", "你好！今天想聊什么？", 1));
    assert.equal((await store.getSession(s.id))!.title, "新对话");
    await store.appendMessage(msg(s.id, "user", "我昨天去了北京的一个很有意思的博物馆", 2));
    assert.equal((await store.getSession(s.id))!.title, "我昨天去了北京的一个很有意思…");
    await store.appendMessage(msg(s.id, "user", "第二条", 3));
    assert.equal((await store.getSession(s.id))!.title, "我昨天去了北京的一个很有意思…");

    const short = await store.createSession({ language: "ja", kind: "chat", feedbackMode: "inline" });
    await store.appendMessage(msg(short.id, "user", "  こんにちは  ", 4));
    assert.equal((await store.getSession(short.id))!.title, "こんにちは");

    const custom = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline", title: "自定" });
    await store.appendMessage(msg(custom.id, "user", "别改标题", 5));
    assert.equal((await store.getSession(custom.id))!.title, "自定");
  });

  it("lists newest first, hiding empty sessions older than a day", async () => {
    const { store, clock } = makeStore();
    const old = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    const oldEmpty = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    clock.t += HOUR;
    await store.appendMessage(msg(old.id, "user", "旧的", clock.t));
    clock.t += 30 * HOUR;
    const fresh = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    await store.createSession({ language: "ja", kind: "chat", feedbackMode: "inline" });
    const list = await store.listSessions("zh");
    assert.deepEqual(
      list.map((s) => s.id),
      [fresh.id, old.id],
    );
    assert.ok(!list.some((s) => s.id === oldEmpty.id));
    // Appending bumps updatedAt, moving the session to the top.
    clock.t += HOUR;
    await store.appendMessage(msg(old.id, "tutor", "回复", clock.t));
    assert.equal((await store.listSessions("zh"))[0]!.id, old.id);
    assert.equal((await store.listSessions("ja")).length, 1);
  });

  it("updates sessions without touching id/language/createdAt", async () => {
    const { store } = makeStore();
    const s = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    const u = await store.updateSession(s.id, { title: "新标题", endedAt: 5, ...({ language: "ja", id: "x" } as object) });
    assert.equal(u.title, "新标题");
    assert.equal(u.endedAt, 5);
    assert.equal(u.language, "zh");
    assert.equal(u.id, s.id);
    await assert.rejects(store.updateSession("missing", { title: "x" }), /Session not found/);
  });

  it("appends, upserts and updates messages; transcript and usage", async () => {
    const { store } = makeStore();
    const s = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    await store.appendMessage(msg(s.id, "user", "你好", 1, "u1"));
    await store.appendMessage(msg(s.id, "tutor", "你好！", 2, "t1"));
    await store.appendMessage({ ...msg(s.id, "tutor", "你好！！", 2, "t1"), model: "p/m" });
    let messages = await store.getMessages(s.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1]!.text, "你好！！");
    const updated = await store.updateMessage(s.id, "t1", { translation: "Hello!", id: "hijack" });
    assert.equal(updated.id, "t1");
    assert.equal(updated.translation, "Hello!");
    messages = await store.getMessages(s.id);
    assert.equal(messages[1]!.translation, "Hello!");
    assert.equal(messages[1]!.model, "p/m");
    await assert.rejects(store.updateMessage(s.id, "nope", { text: "x" }), /Message not found/);
    // Returned objects are copies.
    messages[0]!.text = "mutated";
    assert.equal((await store.getMessages(s.id))[0]!.text, "你好");

    await store.setTranscript(s.id, [{ role: "user", content: "你好", timestamp: 1 }]);
    assert.equal((await store.getTranscript(s.id)).length, 1);
    await store.addUsage(s.id, { input: 10, output: 5, cost: 0.01 });
    await store.addUsage(s.id, { input: 1, output: 1, cost: 0.02 });
    const meta = (await store.getSession(s.id))!;
    assert.equal(meta.usage.input, 11);
    assert.equal(meta.usage.output, 6);
    assert.ok(Math.abs(meta.usage.cost - 0.03) < 1e-9);
    assert.deepEqual(await store.getMessages("missing"), []);
    await assert.rejects(store.appendMessage(msg("missing", "user", "x", 1)), /Session not found/);
  });

  it("deletes a session and its rows but keeps word usage", async () => {
    const { store, dir } = makeStore();
    const s = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    const keep = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    await store.appendMessage(msg(s.id, "user", "我去学校", 1, "u1"));
    await store.addCorrection({ sessionId: s.id, messageId: "u1", original: "去", corrected: "去了", explanation: "x", kind: "grammar" });
    await store.addCorrection({ sessionId: keep.id, messageId: "k1", original: "a", corrected: "b", explanation: "x", kind: "typo" });
    await store.recordObservations("zh", [
      { grammarId: "zh:le", sessionId: s.id, messageId: "u1", span: "去", verdict: "incorrect", assistance: "independent" },
    ]);
    await store.recordLearnerWords({ language: "zh", sessionId: s.id, messageId: "u1", sentence: "我去学校", words: ["我", "去", "学校"], at: 1 });
    await store.setTargets(s.id, [{ word: "学校", reason: "recent", status: "pending" }]);
    assert.ok(existsSync(join(dir, "sessions", `${s.id}.json`)));

    await store.deleteSession(s.id);
    assert.equal(await store.getSession(s.id), null);
    assert.ok(!existsSync(join(dir, "sessions", `${s.id}.json`)));
    assert.equal((await store.listCorrections({ language: "zh" })).length, 1);
    assert.equal((await store.listObservations({ language: "zh" })).length, 0);
    assert.deepEqual(await store.getTargets(s.id), []);
    const progress = await store.getProgress("zh", "all");
    assert.equal(progress.wordsWritten, 0);
    assert.equal((await store.getWordUsage("zh", "学校"))!.firstSessionId, s.id);
    // Deleting twice is harmless.
    await store.deleteSession(s.id);
  });

  it("tracks active time per session and in the activity log", async () => {
    const { store } = makeStore();
    const s = await store.createSession({ language: "ja", kind: "chat", feedbackMode: "inline" });
    await store.addActiveTime(s.id, 1000);
    await store.addActiveTime(s.id, 500);
    await store.addActiveTime(s.id, -5);
    await store.addActiveTime("missing", 1000);
    assert.equal((await store.getSession(s.id))!.activeMs, 1500);
    const exp = (await store.exportAll()) as { activity: { date: string; ms: number; language: string }[] };
    assert.deepEqual(exp.activity, [{ date: "2026-09-30", language: "ja", sessionId: s.id, ms: 1500 }]);
  });

  it("persists across a fresh store instance", async () => {
    const { store, dir } = makeStore();
    const s = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    await store.appendMessage(msg(s.id, "user", "你好世界", 1, "u1"));
    await store.addCorrection({ sessionId: s.id, messageId: "u1", original: "你好", corrected: "您好", explanation: "polite", kind: "typo" });
    await store.upsertGrammarPoint({ id: "zh:le", language: "zh", pattern: "了", name: "completed action" });
    await store.recordLearnerWords({ language: "zh", sessionId: s.id, messageId: "u1", sentence: "你好世界", words: ["你好", "世界"], at: 1 });
    await store.setProfile({ about: "robotics student", goals: { zh: "HSK 4" } });
    await store.recordLevel({ language: "zh", skill: "reading", level: "HSK 3", confidence: "low", evidence: "self", examples: [], at: 1, by: "self" });
    await store.saveWord({ language: "zh", word: "世界", sentence: "你好世界", source: { kind: "session", sessionId: s.id, messageId: "u1" } });

    const again = new JsonRecordsStore({ dataDir: dir });
    assert.equal((await again.getSession(s.id))!.title, "你好世界");
    assert.equal((await again.getMessages(s.id))[0]!.text, "你好世界");
    assert.equal((await again.listCorrections({ language: "zh" })).length, 1);
    assert.equal((await again.getGrammarPoint("zh:le"))!.pattern, "了");
    assert.equal((await again.getWordUsage("zh", "世界"))!.count, 1);
    assert.deepEqual(await again.getProfile(), { about: "robotics student", goals: { zh: "HSK 4" } });
    assert.equal((await again.getLevels("zh")).current.reading!.level, "HSK 3");
    assert.equal((await again.listSavedWords("zh")).length, 1);
    // Human-readable JSON on disk.
    assert.match(readFileSync(join(dir, "corrections.json"), "utf8"), /\n {2}\{/);
  });

  it("loses nothing under 50 concurrent appends", async () => {
    const { store, dir } = makeStore();
    const s = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => store.appendMessage(msg(s.id, i % 2 ? "tutor" : "user", `消息${i}`, i, `c${i}`))),
    );
    assert.equal((await store.getMessages(s.id)).length, 50);
    const reloaded = new JsonRecordsStore({ dataDir: dir });
    const ids = new Set((await reloaded.getMessages(s.id)).map((m) => m.id));
    assert.equal(ids.size, 50);
  });

  it("handles concurrent writes across different files", async () => {
    const { store, dir } = makeStore();
    const s = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        Promise.all([
          store.addCorrection({ sessionId: s.id, messageId: `m${i}`, original: "x", corrected: "y", explanation: "", kind: "grammar" }),
          store.addActiveTime(s.id, 10),
          store.recordLearnerWords({ language: "zh", sessionId: s.id, messageId: `m${i}`, sentence: "s", words: [`w${i}`, "共"], at: i }),
        ]),
      ),
    );
    const reloaded = new JsonRecordsStore({ dataDir: dir });
    assert.equal((await reloaded.listCorrections({ language: "zh" })).length, 30);
    assert.equal((await reloaded.getSession(s.id))!.activeMs, 300);
    assert.equal((await reloaded.getWordUsage("zh", "共"))!.count, 30);
  });
});

describe("legacy import", () => {
  function writeLegacy(dir: string) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "abc.json"),
      JSON.stringify({
        v: 1,
        id: "abc",
        title: "旧会话",
        language: "zh",
        createdAt: 100,
        updatedAt: 200,
        transcript: [{ role: "user", content: "你好", timestamp: 100 }],
        display: [
          { role: "user", text: "你好", at: 100 },
          { role: "tutor", text: "你好！", model: "anthropic/claude", at: 150 },
          { role: "tutor", text: "", error: "Stopped", model: "anthropic/claude", at: 160 },
        ],
        usage: { input: 3, output: 4, cost: 0.5 },
      }),
    );
    writeFileSync(join(dir, "broken.json"), "{not json");
  }

  it("imports v0.1 sessions once", async () => {
    const legacyDir = join(tempDir(), "sessions");
    writeLegacy(legacyDir);
    const { store, dir } = makeStore();
    assert.equal(await store.importLegacySessions(legacyDir), 1);
    const meta = (await store.getSession("abc"))!;
    assert.equal(meta.kind, "chat");
    assert.equal(meta.feedbackMode, "inline");
    assert.equal(meta.title, "旧会话");
    assert.equal(meta.updatedAt, 200);
    assert.deepEqual(meta.usage, { input: 3, output: 4, cost: 0.5 });
    const messages = await store.getMessages("abc");
    assert.equal(messages.length, 3);
    assert.ok(messages.every((m) => typeof m.id === "string" && m.id && m.sessionId === "abc"));
    assert.equal(new Set(messages.map((m) => m.id)).size, 3);
    assert.equal(messages[1]!.model, "anthropic/claude");
    assert.equal(messages[2]!.error, "Stopped");
    assert.equal((await store.getTranscript("abc")).length, 1);

    assert.equal(await store.importLegacySessions(legacyDir), 0);
    const fresh = new JsonRecordsStore({ dataDir: dir });
    assert.equal(await JsonRecordsStore.migrateLegacy(fresh, legacyDir), 0);
    assert.equal((await fresh.getMessages("abc")).length, 3);
    assert.equal(await store.importLegacySessions(join(dir, "does-not-exist")), 0);
  });
});
