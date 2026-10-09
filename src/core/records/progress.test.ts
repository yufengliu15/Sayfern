import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AnkiSnapshot } from "../../shared/records";
import { day, makeStore, msg } from "./helpers.test-util";

describe("learner words", () => {
  it("returns first-ever uses and counts repeats", async () => {
    const { store } = makeStore();
    const first = await store.recordLearnerWords({ language: "zh", sessionId: "s1", messageId: "m1", sentence: "我喜欢猫，我也喜欢狗", words: ["我", "喜欢", "猫", "我", "也", "喜欢", "狗"], at: 1 });
    assert.deepEqual(
      first.map((u) => u.word),
      ["我", "喜欢", "猫", "也", "狗"],
    );
    assert.equal(first[0]!.firstSentence, "我喜欢猫，我也喜欢狗");
    const second = await store.recordLearnerWords({ language: "zh", sessionId: "s1", messageId: "m2", sentence: "我喜欢鱼", words: ["我", "喜欢", "鱼"], at: 2 });
    assert.deepEqual(
      second.map((u) => u.word),
      ["鱼"],
    );
    const wo = (await store.getWordUsage("zh", "我"))!;
    assert.equal(wo.count, 3);
    assert.equal(wo.firstMessageId, "m1");
    assert.equal(wo.firstUsedAt, 1);
    // Same message again: no double counting.
    assert.deepEqual(await store.recordLearnerWords({ language: "zh", sessionId: "s1", messageId: "m2", sentence: "我喜欢鱼", words: ["我"], at: 2 }), []);
    assert.equal((await store.getWordUsage("zh", "我"))!.count, 3);
    // Languages are separate.
    const ja = await store.recordLearnerWords({ language: "ja", sessionId: "s2", messageId: "m3", sentence: "猫", words: ["猫"], at: 3 });
    assert.equal(ja.length, 1);
    assert.equal(await store.getWordUsage("ja", "狗"), null);
  });
});

describe("targets", () => {
  it("only upgrade status", async () => {
    const { store } = makeStore();
    const s = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    assert.deepEqual(await store.getTargets(s.id), []);
    await store.setTargets(s.id, [
      { word: "猫", reason: "recent", status: "pending" },
      { word: "狗", reason: "difficult", status: "pending", cardId: 7 },
    ]);
    let t = await store.markTargets(s.id, ["猫", "鸟"], "used");
    assert.deepEqual(
      t.map((x) => [x.word, x.status]),
      [
        ["猫", "used"],
        ["狗", "pending"],
      ],
    );
    t = await store.markTargets(s.id, ["猫", "狗"], "asked");
    assert.deepEqual(
      t.map((x) => x.status),
      ["used", "asked"],
    );
    t = await store.markTargets(s.id, ["狗"], "pending");
    assert.equal(t[1]!.status, "asked");
    assert.equal((await store.getTargets(s.id))[1]!.cardId, 7);
  });
});

describe("levels and profile", () => {
  it("keeps history and current per skill", async () => {
    const { store } = makeStore();
    const base = { language: "zh" as const, confidence: "medium" as const, evidence: "", examples: [], by: "observed" as const };
    await store.recordLevel({ ...base, skill: "reading", level: "HSK 2", at: 1 });
    await store.recordLevel({ ...base, skill: "writing", level: "HSK 1", at: 2 });
    await store.recordLevel({ ...base, skill: "reading", level: "HSK 3", at: 3 });
    await store.recordLevel({ ...base, language: "ja", skill: "reading", level: "N4", at: 4 });
    const zh = await store.getLevels("zh");
    assert.equal(zh.history.length, 3);
    assert.equal(zh.current.reading!.level, "HSK 3");
    assert.equal(zh.current.writing!.level, "HSK 1");
    assert.equal(zh.current.recognition, undefined);
  });

  it("defaults and merges the profile", async () => {
    const { store } = makeStore();
    assert.deepEqual(await store.getProfile(), { about: "", goals: {} });
    await store.setProfile({ name: "Yu", goals: { zh: "HSK 4" } });
    await store.setProfile({ goals: { ja: "N3" } });
    assert.deepEqual(await store.getProfile(), { about: "", name: "Yu", goals: { zh: "HSK 4", ja: "N3" } });
    await store.setProfile({ goals: { zh: "" }, about: "likes robots" });
    assert.deepEqual(await store.getProfile(), { about: "likes robots", name: "Yu", goals: { ja: "N3" } });
  });
});

describe("saved words", () => {
  it("saves, lists newest first and deletes", async () => {
    const { store, clock } = makeStore();
    const src = { kind: "session" as const, sessionId: "s", messageId: "m" };
    const a = await store.saveWord({ language: "zh", word: "猫", sentence: "我喜欢猫", source: src });
    clock.t += 1;
    const b = await store.saveWord({ language: "zh", word: "狗", sentence: "狗很好", source: src, definition: "dog" });
    assert.equal((await store.saveWord({ language: "zh", word: "猫", sentence: "我喜欢猫", source: src })).id, a.id);
    assert.deepEqual(
      (await store.listSavedWords("zh")).map((w) => w.id),
      [b.id, a.id],
    );
    await store.deleteSavedWord(a.id);
    assert.equal((await store.listSavedWords("zh")).length, 1);
  });
});

describe("progress", () => {
  async function seed() {
    const ctx = makeStore();
    const { store, clock } = ctx;
    const s1 = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    const s2 = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    const s3 = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    const sja = await store.createSession({ language: "ja", kind: "chat", feedbackMode: "inline" });

    // Today (s1), 5 days ago (s2), 20 days ago (s3), 100 days ago (s3).
    await store.addActiveTime(s1.id, 60_000, day(0));
    await store.addActiveTime(s1.id, 30_000, day(0, 11));
    await store.addActiveTime(s2.id, 120_000, day(5));
    await store.addActiveTime(s3.id, 240_000, day(20));
    await store.addActiveTime(s3.id, 480_000, day(100));
    await store.addActiveTime(sja.id, 999_000, day(0));

    await store.recordLearnerWords({ language: "zh", sessionId: s3.id, messageId: "d", sentence: "老", words: ["老"], at: day(100) });
    await store.recordLearnerWords({ language: "zh", sessionId: s3.id, messageId: "c", sentence: "你好你好", words: ["你好", "你好"], at: day(20) });
    await store.recordLearnerWords({ language: "zh", sessionId: s2.id, messageId: "b", sentence: "我喜欢狗", words: ["我", "喜欢", "狗"], at: day(5) });
    await store.recordLearnerWords({ language: "zh", sessionId: s1.id, messageId: "a", sentence: "我喜欢猫", words: ["我", "喜欢", "猫"], at: day(0) });

    // A learner message without word rows still counts the session (and only in range).
    const s4 = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    await store.appendMessage(msg(s4.id, "user", "嗯", day(2)));

    clock.t = day(8);
    await store.addCorrection({ sessionId: s2.id, messageId: "b", original: "x", corrected: "y", explanation: "", kind: "typo" });
    clock.t = day(1);
    await store.addCorrection({ sessionId: s1.id, messageId: "a", original: "x", corrected: "y", explanation: "", kind: "grammar" });
    await store.addCorrection({ sessionId: s1.id, messageId: "a", original: "z", corrected: "y", explanation: "", kind: "grammar" });

    await store.upsertGrammarPoint({ id: "zh:le", language: "zh", pattern: "了", name: "" });
    await store.recordObservations("zh", [
      { grammarId: "zh:ba", sessionId: s1.id, messageId: "a", span: "把", verdict: "correct", assistance: "independent", at: day(50) },
      { grammarId: "zh:bei", sessionId: s1.id, messageId: "a", span: "被", verdict: "correct", assistance: "prompted", at: day(0) },
    ]);
    clock.t = day(0, 15);
    return { ...ctx, s1, s2, s3, s4 };
  }

  it("week", async () => {
    const { store } = await seed();
    const p = await store.getProgress("zh", "week");
    assert.equal(p.range, "week");
    assert.equal(p.activeMs, 90_000 + 120_000);
    assert.equal(p.daily.length, 7);
    assert.equal(p.daily[0]!.date, "2026-09-24");
    assert.equal(p.daily[6]!.date, "2026-09-30");
    assert.equal(p.daily[6]!.activeMs, 90_000);
    assert.equal(p.daily[1]!.activeMs, 120_000); // 09-25 = 5 days ago
    assert.equal(p.sessions, 3); // s1, s2, s4
    assert.equal(p.wordsWritten, 6);
    assert.equal(p.distinctWords, 4);
    assert.deepEqual(
      p.firstUsed.map((u) => u.word),
      ["猫", "我", "喜欢", "狗"],
    );
    assert.equal(p.corrections.total, 2);
    assert.deepEqual(p.corrections.byKind, { grammar: 2, typo: 0, speaking: 0 });
    assert.deepEqual(p.grammar, { introduced: 1, with_help: 1, independent: 1 });
    assert.equal(p.anki, undefined);
  });

  it("month", async () => {
    const { store } = await seed();
    const p = await store.getProgress("zh", "month");
    assert.equal(p.daily.length, 30);
    assert.equal(p.daily[0]!.date, "2026-09-01");
    assert.equal(p.activeMs, 90_000 + 120_000 + 240_000);
    assert.equal(p.sessions, 4);
    assert.equal(p.wordsWritten, 8);
    assert.equal(p.distinctWords, 5);
    assert.equal(p.firstUsed.length, 5);
    assert.deepEqual(p.corrections.byKind, { grammar: 2, typo: 1, speaking: 0 });
  });

  it("all, with anki", async () => {
    const { store } = await seed();
    const snap: AnkiSnapshot = {
      language: "zh",
      syncedAt: 123,
      reviewedToday: 9,
      reviewsLast7d: 40,
      matureCount: 12,
      cards: [
        { cardId: 1, noteId: 1, deck: "d", word: "猫", interval: 30, ease: 2500, lapses: 0, reps: 5 },
        { cardId: 2, noteId: 2, deck: "d", word: "猫", interval: 30, ease: 2500, lapses: 0, reps: 5 },
        { cardId: 3, noteId: 3, deck: "d", word: "老", interval: 1, ease: 2500, lapses: 0, reps: 1 },
        { cardId: 4, noteId: 4, deck: "d", word: "鸟", interval: 1, ease: 2500, lapses: 0, reps: 1 },
      ],
    };
    const p = await store.getProgress("zh", "all", snap);
    assert.equal(p.daily.length, 90);
    assert.equal(p.daily[89]!.date, "2026-09-30");
    assert.equal(p.activeMs, 90_000 + 120_000 + 240_000 + 480_000);
    assert.equal(p.daily.reduce((s, d) => s + d.activeMs, 0), 90_000 + 120_000 + 240_000);
    assert.equal(p.wordsWritten, 9);
    assert.equal(p.distinctWords, 6);
    assert.equal(p.firstUsed[p.firstUsed.length - 1]!.word, "老");
    assert.deepEqual(p.anki, { matureCount: 12, usedInWriting: 2, reviewedToday: 9, syncedAt: 123 });
    assert.equal((await store.getProgress("ja", "all")).activeMs, 999_000);
  });
});

describe("export", () => {
  it("includes every record kind and omits transcripts", async () => {
    const { store } = makeStore();
    const s = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    await store.appendMessage(msg(s.id, "user", "你好", 1, "u1"));
    await store.setTranscript(s.id, [{ role: "user", content: "你好", timestamp: 1 }]);
    await store.recordLearnerWords({ language: "zh", sessionId: s.id, messageId: "u1", sentence: "你好", words: ["你好"], at: 1 });
    const out = await store.exportAll();
    for (const k of ["exportedAt", "version", "sessions", "corrections", "grammar", "observations", "savedWords", "wordUsage", "writing", "activity", "levels", "profile"]) {
      assert.ok(k in out, k);
    }
    assert.equal(out.version, 1);
    const sessions = out.sessions as { meta: { id: string }; messages: unknown[]; transcript?: unknown }[];
    assert.equal(sessions[0]!.meta.id, s.id);
    assert.equal(sessions[0]!.messages.length, 1);
    assert.equal(sessions[0]!.transcript, undefined);
    assert.equal((out.wordUsage as { zh: unknown[] }).zh.length, 1);
    assert.doesNotThrow(() => JSON.stringify(out));
  });
});

describe("recountLearnerWords", () => {
  it("recounts stored messages with a new filter once per key, and rebuilds first use", async () => {
    const { store } = makeStore();
    const s = await store.createSession({ language: "es", kind: "chat", feedbackMode: "inline" });
    const m1 = msg(s.id, "user", "I want coffee", 1, "u1");
    const m2 = msg(s.id, "user", "quiero café", 2, "u2");
    for (const m of [m1, m2]) {
      await store.appendMessage(m);
      // The old filter counted every word.
      await store.recordLearnerWords({ language: "es", sessionId: s.id, messageId: m.id, sentence: m.text, words: m.text.toLowerCase().split(" "), at: m.at });
    }
    assert.equal((await store.getWordUsage("es", "coffee"))!.count, 1);

    const english = new Set(["i", "want", "coffee"]);
    const wordsOf = (m: { text: string }) => m.text.toLowerCase().split(" ").filter((w) => !english.has(w));
    assert.equal(await store.recountLearnerWords("es", "v1|none", wordsOf), true);
    assert.equal(await store.getWordUsage("es", "coffee"), null);
    assert.equal(await store.getWordUsage("es", "want"), null);
    const cafe = (await store.getWordUsage("es", "café"))!;
    assert.deepEqual([cafe.count, cafe.firstMessageId, cafe.firstSentence], [1, "u2", "quiero café"]);
    // Same key: nothing to do. A new key (dictionary installed) runs again.
    assert.equal(await store.recountLearnerWords("es", "v1|none", wordsOf), false);
    assert.equal(await store.recountLearnerWords("es", "v1|WikDict", wordsOf), true);
    assert.equal((await store.getWordUsage("es", "café"))!.count, 1);
  });

  it("needsRecount: false for the same key, and for a language with no stored words (key saved)", async () => {
    const { store } = makeStore();
    assert.equal(await store.needsRecount("fr", "v1|none"), false);
    await store.recordLearnerWords({ language: "fr", sessionId: "s", messageId: "m", sentence: "bonjour", words: ["bonjour"], at: 1 });
    assert.equal(await store.needsRecount("fr", "v1|none"), false, "key was saved while there was nothing to recount");
    assert.equal(await store.needsRecount("fr", "v2|none"), true);
  });
});
