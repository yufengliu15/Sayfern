import assert from "node:assert/strict";
import { test } from "node:test";
import type { GrammarObservation } from "../../shared/records";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { buildSystemPrompt, computePacing, difficultyBlock, lastConversationVerdicts, lengthRule, MOVE_ON_TURNS } from "./prompt";
import { languageInfo } from "../../shared/languages";
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

test("pacing: counts learner replies since the last topic start and the clean streak before the latest", () => {
  const m = (id: string, role: "user" | "tutor", text = "好", topicStart?: boolean) => ({ id, role, text, ...(topicStart ? { topicStart } : {}) });
  const msgs = [m("t0", "tutor", "开始", true), m("u1", "user"), m("t1", "tutor"), m("u2", "user", "很好吃"), m("t2", "tutor", "新话题", true), m("u3", "user", "还可以"), m("t3", "tutor"), m("u4", "user", "我也是"), m("t4", "tutor"), m("u5", "user", "对")];
  assert.deepEqual(computePacing(msgs, new Set()), { turnsOnTopic: 3, cleanStreak: 2, recentLength: 2 });
  assert.equal(computePacing(msgs, new Set(["u4"])).cleanStreak, 0);
  assert.equal(computePacing(msgs, new Set(["u5"])).cleanStreak, 2, "the latest reply is judged this turn");
  assert.equal(computePacing([m("u1", "user")], new Set()).turnsOnTopic, 1, "no topic start: count from the session start");
});

test("pacing block: rules always, move-on nudge once the topic is used up", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  const say = async (i: number) => {
    await h.records.appendMessage({ id: `u${i}`, sessionId: sid, role: "user", text: "还可以。", at: h.clock.t + i });
    await h.records.appendMessage({ id: `t${i}`, sessionId: sid, role: "tutor", text: "好。", at: h.clock.t + i });
  };
  const fresh = await buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  assert.doesNotMatch(fresh, /# Pacing/, "no pacing block before the learner says anything");
  await say(1);
  const early = await buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  assert.match(early, /# Pacing\nAlways answer what the learner just said first/);
  assert.match(early, /This topic has run for 1 of the learner's replies/);
  assert.match(early, /set topic_change to true/);
  assert.doesNotMatch(early, /The topic is used up/);
  for (let i = 2; i <= MOVE_ON_TURNS; i++) await say(i);
  const late = await buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  assert.match(late, new RegExp(`run for ${MOVE_ON_TURNS} of the learner's replies`));
  assert.match(late, /previous replies had no mistakes/);
  assert.match(late, /The topic is used up: unless they are clearly invested, move on in this reply\./);
});

test("reply length grows with the level", () => {
  const info = languageInfo("zh");
  const at = (level?: string) => lengthRule({ info, levels: level ? { writing: { level } as never } : {} });
  assert.match(at(), /1 to 3 short sentences/);
  assert.match(at("HSK 1"), /1 or 2 short sentences/);
  assert.match(at("HSK 3"), /2 or 3 sentences/);
  assert.match(at("HSK 6"), /2 to 4 sentences/);
  assert.match(lengthRule({ info: languageInfo("es"), levels: { writing: { level: "B2" } as never } }), /2 to 4 sentences/);
});

test("course block: next unit and its open points in chat; Beta languages say there is no course", async () => {
  const h = makeHarness();
  await h.records.recordLevel({ language: "zh", skill: "writing", level: "HSK 3", confidence: "medium", evidence: "", examples: [], at: 1, by: "self" });
  const sid = await h.newSession();
  const p = await buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  assert.match(p, /# Course \(HSK 3.0 grammar syllabus: all 573 points/);
  assert.match(p, /Up next for them: unit zh-hsk30-3-01 "Verbs" \(HSK 3\)/);
  assert.match(p, /- 敢 \+ V \(dare with 敢, id zh:gan-dare\)/);
  assert.match(p, /Write 2 or 3 sentences/);
  const practice = await h.newSession("practice");
  assert.doesNotMatch(await buildSystemPrompt(h.deps, (await h.records.getSession(practice))!), /# Course/);
  const ko = await h.records.createSession({ language: "ko", kind: "chat", feedbackMode: "inline" });
  assert.match(await buildSystemPrompt(h.deps, ko), /Up next for them: unit ko-topik1-01 "Say who you are" \(TOPIK 1\)/);
  const es = await h.records.createSession({ language: "es", kind: "chat", feedbackMode: "inline" });
  assert.match(await buildSystemPrompt(h.deps, es), /Up next for them: unit es-a1-01 "Say who you are" \(A1\)/);
  const ru = await h.records.createSession({ language: "ru", kind: "chat", feedbackMode: "inline" });
  assert.match(await buildSystemPrompt(h.deps, ru), /# Course\nThere is no level-by-level course for Russian/);
});

test("topic_change in record_evidence marks the reply as a topic start", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  const turn = (text: string, args: Record<string, unknown>) => {
    h.faux.setResponses([fauxAssistantMessage([fauxText(text), fauxToolCall("record_evidence", args as never)], { stopReason: "toolUse" })]);
    return h.tutor.runTurn({ sessionId: sid, text: "对。", model: h.model, signal: new AbortController().signal, onEvent: () => {} });
  };
  assert.equal((await turn("好的。你周末做什么？", {})).topicStart, undefined);
  assert.equal((await turn("说到周末，你去过长城吗？", { topic_change: true })).topicStart, true);
  const p = await buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  assert.doesNotMatch(p, /# Pacing/, "the new topic has no learner replies yet");
});
