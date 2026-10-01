import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { correctionId, observationId } from "./ids";
import { makeStore } from "./helpers.test-util";
import type { ObservationInput } from "../contracts";

describe("ids", () => {
  it("are deterministic and distinct", () => {
    assert.equal(observationId("m1", "zh:le", "去了"), observationId("m1", "zh:le", "去了"));
    assert.notEqual(observationId("m1", "zh:le", "去了"), observationId("m1", "zh:le", "去"));
    assert.match(correctionId("m1", "去"), /^[0-9a-f]{16}$/);
    assert.notEqual(correctionId("m1", "去"), correctionId("m2", "去"));
  });
});

describe("corrections", () => {
  it("dedupes on (messageId, original) and updates", async () => {
    const { store } = makeStore();
    const s = await store.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
    const input = { sessionId: s.id, messageId: "u1", original: "我去学校昨天", corrected: "我昨天去了学校", explanation: "Time words go first.", kind: "grammar" as const, grammarId: "zh:time-order" };
    const a = await store.addCorrection(input);
    const b = await store.addCorrection({ ...input, corrected: "different" });
    assert.equal(a.id, correctionId("u1", "我去学校昨天"));
    assert.deepEqual(b, a);
    assert.equal(a.status, "open");
    assert.deepEqual(a.retries, []);
    assert.equal(a.language, "zh");
    assert.equal((await store.listCorrections({ language: "zh" })).length, 1);
    assert.equal((await store.listCorrections({ language: "zh", grammarId: "zh:time-order" })).length, 1);
    assert.equal((await store.listCorrections({ language: "zh", sessionId: "other" })).length, 0);
    assert.equal((await store.listCorrections({ language: "ja" })).length, 0);

    const u = await store.updateCorrection(a.id, { status: "retried_ok", retries: [{ text: "我昨天去了学校", ok: true, at: 5 }] });
    assert.equal(u.status, "retried_ok");
    assert.equal((await store.getCorrection(a.id))!.retries.length, 1);
    assert.equal(await store.getCorrection("nope"), null);
    await assert.rejects(store.updateCorrection("nope", { status: "revealed" }), /not found/);
    await assert.rejects(store.addCorrection({ ...input, sessionId: "missing" }), /Session not found/);
  });
});

describe("grammar", () => {
  it("upsert merges without wiping and sets introducedAt once", async () => {
    const { store, clock } = makeStore();
    const created = await store.upsertGrammarPoint({
      id: "zh:chule-hai",
      language: "zh",
      pattern: "除了…还…",
      name: "besides A, also B",
      explanation: "Adds to a list.",
      examples: [{ text: "除了中文，我还学日语。", translation: "Besides Chinese I also study Japanese." }],
      sources: [{ kind: "library", docId: "d1", paragraph: 3 }],
    });
    assert.equal(created.introducedAt, undefined);
    assert.equal(created.createdAt, clock.t);

    clock.t += 1000;
    const merged = await store.upsertGrammarPoint({
      id: "zh:chule-hai",
      language: "zh",
      pattern: "",
      name: "",
      explanation: "",
      examples: [],
      level: "HSK 3",
      sources: [
        { kind: "library", docId: "d1", paragraph: 3, quote: "dup" },
        { kind: "session", sessionId: "s1", messageId: "m1" },
      ],
      introduced: true,
    });
    assert.equal(merged.pattern, "除了…还…");
    assert.equal(merged.name, "besides A, also B");
    assert.equal(merged.explanation, "Adds to a list.");
    assert.equal(merged.examples.length, 1);
    assert.equal(merged.level, "HSK 3");
    assert.equal(merged.sources.length, 2);
    assert.equal(merged.introducedAt, clock.t);
    assert.equal(merged.updatedAt, clock.t);
    assert.equal(merged.createdAt, created.createdAt);

    const firstIntro = clock.t;
    clock.t += 1000;
    const again = await store.upsertGrammarPoint({ id: "zh:chule-hai", language: "zh", pattern: "除了…以外，还…", name: "besides", introduced: true });
    assert.equal(again.introducedAt, firstIntro);
    assert.equal(again.pattern, "除了…以外，还…");
  });

  it("records observations idempotently and stubs unknown points", async () => {
    const { store, clock } = makeStore();
    const obs: ObservationInput[] = [
      { grammarId: "ja:te-iru", sessionId: "s1", messageId: "m1", span: "食べている", verdict: "correct", assistance: "independent" },
      { grammarId: "ja:te-iru", sessionId: "s1", messageId: "m1", span: "食べている", verdict: "correct", assistance: "independent" },
      { grammarId: "ja:tara", sessionId: "s1", messageId: "m1", span: "行ったら", verdict: "uncertain", assistance: "prompted", note: "ambiguous", at: 42 },
    ];
    const first = await store.recordObservations("ja", obs);
    assert.equal(first.length, 2);
    assert.equal(first[0]!.id, observationId("m1", "ja:te-iru", "食べている"));
    assert.equal(first[0]!.at, clock.t);
    assert.equal(first[1]!.at, 42);
    assert.equal(first[1]!.note, "ambiguous");
    assert.deepEqual(await store.recordObservations("ja", obs), []);
    assert.equal((await store.listObservations({ language: "ja" })).length, 2);
    assert.equal((await store.listObservations({ language: "ja", grammarId: "ja:tara" })).length, 1);

    const stub = (await store.getGrammarPoint("ja:te-iru"))!;
    assert.equal(stub.pattern, "te-iru");
    assert.equal(stub.name, "");
    assert.equal(stub.explanation, "");
    assert.equal(stub.language, "ja");
    // A later upsert fills the stub in.
    const filled = await store.upsertGrammarPoint({ id: "ja:te-iru", language: "ja", pattern: "〜ている", name: "ongoing state" });
    assert.equal(filled.pattern, "〜ている");
  });

  it("derives state, counts and rate, honoring disputes", async () => {
    const { store } = makeStore();
    await store.upsertGrammarPoint({ id: "zh:le", language: "zh", pattern: "了", name: "completion", introduced: true });
    let sum = (await store.getGrammarSummary("zh:le"))!;
    assert.equal(sum.state, "introduced");
    assert.equal(sum.rate, null);
    assert.equal(sum.lastUsedAt, undefined);

    const base = { grammarId: "zh:le", sessionId: "s1" };
    await store.recordObservations("zh", [
      { ...base, messageId: "m1", span: "a", verdict: "incorrect", assistance: "independent", at: 10 },
      { ...base, messageId: "m2", span: "b", verdict: "unassessed", assistance: "independent", at: 20 },
    ]);
    sum = (await store.getGrammarSummary("zh:le"))!;
    assert.equal(sum.state, "introduced");
    assert.equal(sum.rate, 0);
    assert.deepEqual(sum.counts, { correct: 0, incorrect: 1, uncertain: 0, unassessed: 1 });

    await store.recordObservations("zh", [
      { ...base, messageId: "m3", span: "c", verdict: "correct", assistance: "corrected_retry", at: 30 },
    ]);
    sum = (await store.getGrammarSummary("zh:le"))!;
    assert.equal(sum.state, "with_help");
    assert.equal(sum.rate, 0.5);
    assert.equal(sum.lastUsedAt, 30);

    // Dispute the incorrect one → correct & independent.
    const incorrect = (await store.listObservations({ language: "zh" })).find((o) => o.verdict === "incorrect")!;
    const d1 = await store.disputeObservation(incorrect.id, "correct", "this is fine");
    assert.equal(d1.verdict, "correct");
    assert.deepEqual(d1.disputed!.originalVerdict, "incorrect");
    sum = (await store.getGrammarSummary("zh:le"))!;
    assert.equal(sum.state, "independent");
    assert.equal(sum.rate, 1);
    assert.deepEqual(sum.counts, { correct: 2, incorrect: 0, uncertain: 0, unassessed: 1 });

    // Second dispute keeps the first original verdict.
    const d2 = await store.disputeObservation(incorrect.id, "uncertain", "hmm");
    assert.equal(d2.disputed!.originalVerdict, "incorrect");
    assert.equal(d2.disputed!.note, "hmm");
    sum = (await store.getGrammarSummary("zh:le"))!;
    assert.equal(sum.state, "with_help");
    await assert.rejects(store.disputeObservation("nope", "correct", ""), /not found/);
    assert.equal(await store.getGrammarSummary("nope"), null);
  });

  it("lists grammar by last use, then updatedAt", async () => {
    const { store, clock } = makeStore();
    await store.upsertGrammarPoint({ id: "zh:a", language: "zh", pattern: "A", name: "a" });
    clock.t += 10;
    await store.upsertGrammarPoint({ id: "zh:b", language: "zh", pattern: "B", name: "b" });
    clock.t += 10;
    await store.upsertGrammarPoint({ id: "zh:c", language: "zh", pattern: "C", name: "c" });
    await store.upsertGrammarPoint({ id: "ja:x", language: "ja", pattern: "X", name: "x" });
    await store.recordObservations("zh", [
      { grammarId: "zh:a", sessionId: "s", messageId: "m1", span: "a", verdict: "correct", assistance: "independent", at: 100 },
      { grammarId: "zh:b", sessionId: "s", messageId: "m2", span: "b", verdict: "correct", assistance: "prompted", at: 200 },
    ]);
    const list = await store.listGrammar("zh");
    assert.deepEqual(
      list.map((g) => g.point.id),
      ["zh:b", "zh:a", "zh:c"],
    );
    assert.deepEqual(
      list.map((g) => g.state),
      ["with_help", "independent", "introduced"],
    );
  });
});
