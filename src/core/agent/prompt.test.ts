import assert from "node:assert/strict";
import { test } from "node:test";
import type { GrammarObservation } from "../../shared/records";
import { buildSystemPrompt, difficultyBlock, lastConversationVerdicts } from "./prompt";
import { makeHarness } from "./testkit";

test("system prompt: persona, level, learner, follow-ups (skipping focus), targets, catalogue, tool protocol", async () => {
  const h = makeHarness();
  await h.records.setProfile({ name: "Yu", about: "Likes robots.", goals: { zh: "Pass HSK 4" } });
  await h.library.importText({ title: "Me", text: "我是学生。", language: "zh", kind: "personal" });
  await h.records.upsertGrammarPoint({ id: "zh:chule-hai", language: "zh", pattern: "除了…还…", name: "besides A, also B", introduced: true });
  await h.records.upsertGrammarPoint({ id: "zh:ba", language: "zh", pattern: "把", name: "ba construction", introduced: true });
  await h.records.upsertGrammarPoint({ id: "zh:le", language: "zh", pattern: "了", name: "completed 了" });
  const sid = await h.newSession("practice", { focusGrammarId: "zh:ba" });
  const s0 = await h.records.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
  // 了: independent correct, then a recent miss → still a follow-up
  await h.records.recordObservations("zh", [
    { grammarId: "zh:le", sessionId: s0.id, messageId: "m1", span: "吃了", verdict: "correct", assistance: "independent", at: h.clock.t - 1000 },
    { grammarId: "zh:le", sessionId: s0.id, messageId: "m2", span: "去了了", verdict: "incorrect", assistance: "independent", at: h.clock.t - 500 },
  ]);
  await h.records.setTargets(sid, [
    { word: "猫", reason: "recent", status: "pending" },
    { word: "狗", reason: "recent", status: "used" },
  ]);
  const session = (await h.records.getSession(sid))!;
  const p = await buildSystemPrompt(h.deps, session);

  assert.match(p, /warm, curious tutor/);
  assert.match(p, /simplified characters/); // pack.promptNotes()
  assert.match(p, /Level: unknown\. Start simple/);
  assert.match(p, /Name: Yu/);
  assert.match(p, /Goal for Chinese: Pass HSK 4/);
  assert.match(p, /我是学生/);
  const follow = p.split("# Grammar to revisit")[1].split("\n\n")[0];
  assert.match(follow, /除了…还…/);
  assert.match(follow, /了 \(completed 了\)/);
  assert.doesNotMatch(follow, /ba construction/, "session focus is not a follow-up");
  assert.match(follow, /Never name the pattern/);
  // the recent miss leads, with the learner's own words and where it happened
  assert.match(follow, /\n1\. 了 \(completed 了\), .*Last missed in an earlier session \(under an hour ago\): "去了了"/);
  assert.match(follow, /Item 1 is the priority/);
  assert.match(follow, /refer back to the earlier session once/);
  assert.match(p, /exactly one natural question/);
  assert.match(p, /# Session: targeted practice\nFocus: 把 \(ba construction, id zh:ba\)/);
  assert.match(p, /- 猫/);
  assert.doesNotMatch(p, /- 狗/);
  assert.match(p, /Never list them/);
  assert.match(p, /zh:chule-hai \| 除了…还… \| besides A, also B/);
  assert.match(p, /Write your reply text FIRST/);
});

test("system prompt: level estimates and reading passage around the checkpoint", async () => {
  const h = makeHarness();
  const paras = Array.from({ length: 8 }, (_, i) => `第${i}段的内容。`).join("\n\n");
  const doc = await h.library.importText({ title: "小王子", text: paras, language: "zh", kind: "reader" });
  await h.library.setCheckpoint(doc.id, 3, 0);
  await h.records.recordLevel({ language: "zh", skill: "reading", level: "HSK 3", confidence: "medium", evidence: "", examples: [], at: 1, by: "self" });
  const sid = await h.newSession("reading", { docId: doc.id });
  const p = await buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  assert.match(p, /reading HSK 3 \(medium confidence\); recognition unknown; writing unknown/);
  assert.match(p, /# Session: reading "小王子"/);
  assert.match(p, /¶2 第2段/);
  assert.match(p, /¶3 \(checkpoint\) 第3段/);
  assert.match(p, /¶6 第6段/);
  assert.doesNotMatch(p, /¶1 第1段/);
  assert.doesNotMatch(p, /¶7 第7段/);
  assert.match(p, /update_checkpoint/);
  assert.match(p, /search_library/);
});

test("system prompt: placement lists the level scale; extensions add paragraphs", async () => {
  const h = makeHarness();
  h.deps.extensions = { tools: () => [], promptAdditions: (l) => [`EXT for ${l}`] };
  const sid = await h.newSession("placement");
  const p = await buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  assert.match(p, /5 to 7 exchanges/);
  assert.match(p, /HSK 1, HSK 2, HSK 3/);
  assert.match(p, /EXT for zh/);
});

test("follow-up verdicts ignore quiz evidence (S2-09)", () => {
  const base = { grammarId: "zh:chule-hai", language: "zh", messageId: "m", span: "x", assistance: "independent" } as const;
  const obs: GrammarObservation[] = [
    { ...base, id: "o1", sessionId: "s1", verdict: "incorrect", at: 1000 },
    { ...base, id: "o2", sessionId: "quiz:q1", messageId: "q1-1", verdict: "correct", assistance: "prompted", origin: "quiz", quizId: "q1", at: 2000 },
  ];
  const last = lastConversationVerdicts(obs);
  assert.deepEqual(last.get("zh:chule-hai"), { verdict: "incorrect", at: 1000 });
});

test("follow-ups: a later success hides the miss line; no earlier-session note without one", async () => {
  const h = makeHarness();
  await h.records.upsertGrammarPoint({ id: "zh:le", language: "zh", pattern: "了", name: "completed 了", introduced: true });
  const s0 = await h.records.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
  await h.records.recordObservations("zh", [
    { grammarId: "zh:le", sessionId: s0.id, messageId: "m1", span: "去了了", verdict: "incorrect", assistance: "independent", at: h.clock.t - 1000 },
    { grammarId: "zh:le", sessionId: s0.id, messageId: "m2", span: "吃了", verdict: "correct", assistance: "independent", at: h.clock.t - 500 },
  ]);
  const sid = await h.newSession("chat");
  const p = await buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  assert.doesNotMatch(p, /Last missed/);
  assert.doesNotMatch(p, /refer back to the earlier session/);
});

test("follow-ups: recent misses first, most recent first", async () => {
  const h = makeHarness();
  for (const [id, pattern] of [["zh:a", "A"], ["zh:b", "B"], ["zh:c", "C"]] as const) {
    await h.records.upsertGrammarPoint({ id, language: "zh", pattern, name: pattern, introduced: true });
  }
  const s0 = await h.records.createSession({ language: "zh", kind: "chat", feedbackMode: "inline" });
  await h.records.recordObservations("zh", [
    { grammarId: "zh:b", sessionId: s0.id, messageId: "m1", span: "b1", verdict: "incorrect", assistance: "independent", at: h.clock.t - 2000 },
    { grammarId: "zh:c", sessionId: s0.id, messageId: "m2", span: "c1", verdict: "incorrect", assistance: "independent", at: h.clock.t - 1000 },
  ]);
  const sid = await h.newSession("chat");
  const p = await buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  const items = p.split("# Grammar to revisit")[1].split("\n\n")[0].split("\n").filter((l) => /^\d\. /.test(l));
  assert.deepEqual(items.map((l) => l.slice(3, 4)), ["C", "B", "A"]);
});

test("difficulty: no block at the default; easier and harder add the learner's choice with a ceiling", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  const base = await buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  assert.doesNotMatch(base, /# Difficulty/);
  await h.records.updateSession(sid, { difficulty: 2 });
  const hard = await buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  assert.match(hard, /# Difficulty \(the learner's choice\)\nMuch harder/);
  assert.match(hard, /never more than about one level above/);
  await h.records.updateSession(sid, { difficulty: -1 });
  const easy = await buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  assert.match(easy, /\nEasier\. Stay at their level/);
  assert.equal(difficultyBlock({ session: { difficulty: 0 } as never }), "");
});
