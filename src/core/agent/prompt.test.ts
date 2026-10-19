import assert from "node:assert/strict";
import { test } from "node:test";
import type { GrammarObservation } from "../../shared/records";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { buildSystemPrompt, computePacing, difficultyBlock, lastConversationVerdicts, lengthRule, renderSystemPrompt, type PromptData } from "./prompt";
import { TUNING } from "./tuning";
import { bandLevels, languageInfo } from "../../shared/languages";
import { makeHarness, type Harness } from "./testkit";
import { turnTools } from "./tools";
import { EVIDENCE_NUDGE } from "./turn";
import { courseFor, findUnit, grammarStates, nextUnit } from "../../shared/course";
import type { SessionMeta } from "../../shared/records";

/** record_evidence as the model reads it: description, every parameter description and the evidence-pass nudge. */
function evidenceToolText(h: Harness, session: SessionMeta) {
  const tool = turnTools(h.deps, { session, emit() {}, sources: [], emittedCorrections: new Set() }).find((t) => t.name === "record_evidence")!;
  return `${tool.description}\n${JSON.stringify(tool.parameters)}\n${EVIDENCE_NUDGE}`;
}

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
  assert.match(p, /Never name a pattern/);
  // the recent miss leads, with the learner's own words and where it happened
  assert.match(follow, /\n1\. 了 \(completed 了\), .*Last missed in an earlier session \(under an hour ago\): "去了了"/);
  assert.match(follow, /Item 1 is the priority/);
  assert.match(follow, /refer back to the earlier session once/);
  assert.match(p, /exactly one natural question/);
  assert.match(p, /# Session: targeted practice\nFocus: 把 \(ba construction, id zh:ba\)/);
  assert.match(p, /- 猫/);
  assert.doesNotMatch(p, /- 狗/);
  assert.match(p, /list or drill targets/);
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

test("system prompt: placement lists the level scale", async () => {
  const h = makeHarness();
  const sid = await h.newSession("placement");
  const p = await buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  assert.match(p, /5 to 7 exchanges/);
  assert.match(p, /HSK 1, HSK 2, HSK 3/);
  assert.doesNotMatch(p, /To bring in a target/, "placement has no targets, even in a course language");
  const chat = await buildSystemPrompt(h.deps, (await h.records.getSession(await h.newSession("chat")))!);
  assert.match(chat, /Up next for them/);
  assert.match(chat, /To bring in a target/, "course points are targets in chat");
});

test("level bands follow each exam's own beginner, intermediate and advanced split", () => {
  assert.deepEqual(bandLevels(languageInfo("es").levels, "beginner"), ["A1", "A2"]);
  assert.deepEqual(bandLevels(languageInfo("es").levels, "advanced"), ["C1", "C2"]);
  assert.deepEqual(bandLevels(languageInfo("ja").levels, "intermediate"), ["N3", "N2"]);
  assert.deepEqual(bandLevels(languageInfo("ja").levels, "advanced"), ["N1"]);
  assert.deepEqual(bandLevels(languageInfo("zh").levels, "beginner"), ["HSK 1", "HSK 2", "HSK 3"]);
  assert.deepEqual(bandLevels(languageInfo("zh").levels, "advanced"), ["HSK 7-9"]);
  assert.deepEqual(bandLevels(languageInfo("ko").levels, "beginner"), ["TOPIK 1", "TOPIK 2"]);
});

test("placement: the picked band sets where the diagnostic starts; beginners may use their own language", async () => {
  const h = makeHarness();
  const prompt = async (levelBand: "beginner" | "intermediate" | "advanced") =>
    buildSystemPrompt(h.deps, (await h.records.getSession(await h.newSession("placement", { levelBand })))!);

  const beginner = await prompt("beginner");
  assert.match(beginner, /# Session: placement \(the learner says they are a beginner\)/);
  assert.match(beginner, /Start at the very bottom \(HSK 1, HSK 2, HSK 3\)/);
  assert.match(beginner, /stop after 2 or 3 tasks/);
  assert.match(beginner, /record HSK 1 for all three skills/);
  assert.match(beginner, /they may write in English when they lack the Chinese words/);
  assert.doesNotMatch(beginner, /invite them to try saying it/);

  const intermediate = await prompt("intermediate");
  assert.match(intermediate, /says they are intermediate\. Start around HSK 4, HSK 5, HSK 6/);
  assert.match(intermediate, /invite them to try saying it/, "only beginners are told writing in English is welcome");

  assert.match(await prompt("advanced"), /says they are advanced\. Start around HSK 7-9/);
});

test("beginner rule follows the level estimate outside placement", async () => {
  const h = makeHarness();
  const sid = await h.newSession("chat");
  const p = async () => buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  assert.doesNotMatch(await p(), /They are a beginner/, "unknown level: no beginner rule");
  for (const skill of ["reading", "recognition", "writing"] as const)
    await h.records.recordLevel({ language: "zh", skill, level: "HSK 1", confidence: "low", evidence: "", examples: [], at: 1, by: "self" });
  const beginner = await p();
  assert.match(beginner, /They are a beginner/);
  assert.match(beginner, /short English gloss in brackets/);
  assert.doesNotMatch(beginner, /Add no translations/);
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

test("pacing: rules always, numbers in the notes, move-on nudge once the topic is used up", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  const say = async (i: number) => {
    await h.records.appendMessage({ id: `u${i}`, sessionId: sid, role: "user", text: "还可以。", at: h.clock.t + i });
    await h.records.appendMessage({ id: `t${i}`, sessionId: sid, role: "tutor", text: "好。", at: h.clock.t + i });
  };
  const fresh = await buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  assert.match(fresh, /# Pacing\nAlways answer what the learner just said first/, "the rules are in the system prompt all session");
  assert.doesNotMatch(fresh, /# Pacing now/, "no pacing numbers before the learner says anything");
  await say(1);
  const early = await buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  assert.match(early, /# Pacing\nAlways answer what the learner just said first/);
  assert.match(early, /This topic has run for 1 of the learner's replies/);
  assert.doesNotMatch(early, /The topic is used up/);
  for (let i = 2; i <= TUNING.moveOnTurns; i++) await say(i);
  const late = await buildSystemPrompt(h.deps, (await h.records.getSession(sid))!);
  assert.match(late, new RegExp(`run for ${TUNING.moveOnTurns} of the learner's replies`));
  assert.match(late, /previous replies had no grammar mistakes/);
  assert.match(late, /The topic is used up: unless they are clearly invested, move on in this reply\./);
});

test("pacing: only grammar corrections keep a topic going; the prompt teaches the three kinds", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  for (let i = 1; i <= TUNING.moveOnTurns; i++) {
    await h.records.appendMessage({ id: `u${i}`, sessionId: sid, role: "user", text: "还可以。", at: h.clock.t + i });
    await h.records.appendMessage({ id: `t${i}`, sessionId: sid, role: "tutor", text: "好。", at: h.clock.t + i });
    await h.records.addCorrection({ sessionId: sid, messageId: `u${i}`, original: "可以", corrected: "可以。", explanation: "x", kind: i % 2 ? "typo" : "speaking" });
  }
  const session = (await h.records.getSession(sid))!;
  const p = await buildSystemPrompt(h.deps, session);
  assert.match(p, /previous replies had no grammar mistakes/, "typo and speaking are not struggle signals");
  const tool = evidenceToolText(h, session);
  assert.match(tool, /does the sentence make grammatical sense\? grammar = no/);
  assert.match(tool, /typo = yes, but it would look wrong written out/);
  assert.match(tool, /speaking = a spoken message only/);
  assert.match(tool, /A spoken message never gets typo/);
  assert.doesNotMatch(p, /grammatical sense/, "the kind definition lives in the tool only");
  const grammar = await h.records.addCorrection({ sessionId: sid, messageId: `u${TUNING.moveOnTurns - 1}`, original: "还", corrected: "很", explanation: "x", kind: "grammar" });
  assert.doesNotMatch(await buildSystemPrompt(h.deps, session), /previous replies had no grammar mistakes/);
  await h.records.updateCorrection(grammar.id, { status: "disputed" });
  assert.match(await buildSystemPrompt(h.deps, session), /previous replies had no grammar mistakes/, "a disputed correction is not a mistake (countableCorrection)");
});

test("reply length grows with the level", () => {
  const info = languageInfo("zh");
  const at = (level?: string) => lengthRule({ info, levels: level ? { writing: { level } as never } : {} });
  assert.match(at(), /1 to 3 short sentences/);
  assert.match(at("HSK 1"), /1 or 2 short sentences/);
  assert.match(at("HSK 3"), /2 or 3 sentences/);
  assert.match(at("HSK 6"), /2 to 4 sentences/);
  assert.match(lengthRule({ info: languageInfo("es"), levels: { writing: { level: "B2" } as never } }), /2 to 4 sentences/);
  // More room only to set up a target, with a hard cap that also grows with the level.
  assert.match(at(), /up to 5 sentences in all/);
  assert.match(at("HSK 1"), /up to 4 sentences in all/);
  assert.match(at("HSK 3"), /up to 6 sentences in all/);
  assert.match(at("HSK 6"), /up to 8 sentences in all/);
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
  assert.doesNotMatch(p, /# Pacing now/, "the new topic has no learner replies yet");
});

// Prompt snapshot guard. Every tutor rule is written once; this test fails when a rule is duplicated,
// dropped or a prompt grows. When a legitimate change moves a number, update BUDGET and say why in the commit.
const NOW = 1_800_000_000_000;
const estimates = (level: string) => Object.fromEntries(["reading", "recognition", "writing"].map((skill) => [skill, { skill, level, confidence: "medium", evidence: "", examples: [], at: 1, by: "self" }]));

function situations(h: Harness) {
  const base = (language: "zh" | "ja" | "en", over: Omit<Partial<PromptData>, "session"> & { session?: Partial<SessionMeta> } = {}) => {
    const { session, ...rest } = over;
    return {
      session: { id: "s1", language, kind: "chat", title: "", createdAt: 0, updatedAt: 0, feedbackMode: "inline", activeMs: 0, usage: {}, ...session },
      info: languageInfo(language),
      promptNotes: h.lang.pack(language).promptNotes(),
      levels: {},
      profile: { name: "Yu", about: "Likes robots.", goals: {} },
      personalContext: "",
      followUps: [],
      lastMisses: new Map(),
      now: NOW,
      targets: [],
      catalogue: [{ id: "zh:ba", language, pattern: "把", name: "ba construction" }],
      explain: "English",
      ...rest,
    } as PromptData;
  };
  const withCourse = (d: PromptData) => {
    const course = courseFor("zh")!;
    const next = nextUnit(course, d.info.levels, grammarStates([]), "HSK 3");
    return { ...d, course: { course, ...(next ? { next } : {}), points: (next?.grammar ?? []).slice(0, TUNING.courseNextPoints) } };
  };
  const point = (id: string, pattern: string, name: string, state: "introduced" | "with_help") => ({ point: { id, language: "zh", pattern, name }, state }) as never;
  const anki = {
    now: NOW,
    overview: { language: "zh", syncedAt: NOW - 3_600_000 * 5, counts: { known: 1200, learning: 80, new: 3000, suspended: 0 }, mature: 900, young: 300, newRemaining: 3000, struggling: 4, reviewedToday: 12, nextNew: [{ word: "咖啡" }, { word: "地铁" }], topStruggling: [{ word: "虽然", reasons: ["8 lapses"] }] },
  } as never;
  const unit = findUnit("zh-hsk30-3-01")!.unit;
  return {
    bare: base("zh"),
    chatFull: withCourse(
      base("zh", {
        levels: estimates("HSK 3"),
        followUps: [point("zh:le", "了", "completed 了", "with_help"), point("zh:chule-hai", "除了…还…", "besides A, also B", "introduced")],
        lastMisses: new Map([["zh:le", { sessionId: "s0", span: "去了了", at: NOW - 3_600_000 * 30 } as never]]),
        targets: [{ word: "咖啡", reading: "kāfēi", meaning: "coffee", reason: "recent", status: "pending" }],
        anki,
        pacing: { turnsOnTopic: TUNING.moveOnTurns, cleanStreak: TUNING.easyStreak, recentLength: 14 },
        session: { difficulty: 1 },
      }),
    ),
    unitExplain: {
      ...base("zh", { levels: estimates("HSK 3"), session: { kind: "practice", unitId: unit.id, openWith: "explain" }, pacing: { turnsOnTopic: 2, cleanStreak: 1, recentLength: 10 } }),
      unit: { unit, states: grammarStates([]) },
    },
    targeted: base("zh", {
      levels: estimates("HSK 3"),
      session: { kind: "practice", focusGrammarId: "zh:ba" },
      focus: { id: "zh:ba", language: "zh", pattern: "把", name: "ba construction" } as never,
      pacing: { turnsOnTopic: 2, cleanStreak: 0, recentLength: 10 },
    }),
    reading: base("zh", {
      levels: estimates("HSK 3"),
      session: { kind: "reading", docId: "d1" },
      reading: { doc: { id: "d1", title: "小王子" } as never, current: 1, paragraphs: [{ index: 0, text: "第零段。" }, { index: 1, text: "第一段。" }] as never },
    }),
    placementBeginner: withCourse(base("zh", { session: { kind: "placement", levelBand: "beginner" } })),
    roleplayGerman: base("en", { levels: estimates("B1"), explain: "German", session: { scenarioId: "restaurant" }, pacing: { turnsOnTopic: 3, cleanStreak: 1, recentLength: 20 } }),
    jaBeginner: base("ja", { levels: estimates("N5"), pacing: { turnsOnTopic: 1, cleanStreak: 0, recentLength: 6 } }),
  };
}

// Measured after the one-place-per-rule refactor: bare 3584, chatFull 7101, unitExplain 5851, targeted 4728, reading 3852,
// placementBeginner 4992, roleplayGerman 4422, jaBeginner 4550, tools 3169 chars. Budgets are those plus about 10%,
// so a duplicated rule or a new paragraph shows up here.
// ADR 39 split the prompt into a cached system prompt and per-reply notes: chat prompts now carry the pacing rules
// from the first turn and the notes rule, so bare grew to 4591 (system 4114, notes 475); the others stayed in budget.
const BUDGET = { bare: 5050, chatFull: 7800, unitExplain: 6450, targeted: 5200, reading: 4250, placementBeginner: 5500, roleplayGerman: 4870, jaBeginner: 5000, tools: 3490 };

test("prompt snapshot: size budget, no rule written twice, every rule group still present", async () => {
  const h = makeHarness();
  const all = situations(h);
  const session = all.bare.session;
  const tools = evidenceToolText(h, session);
  assert.ok(tools.length <= BUDGET.tools, `tool text is ${tools.length} chars`);

  // A phrase that says one rule: it may appear at most this many times in a whole prompt (prompt + tool text).
  const once: [string, RegExp][] = [
    ["original copied exactly", /copied exactly|exact substring/gi],
    ["record_evidence once", /record_evidence once|call it once/gi],
    ["bring in a target: use it yourself, then ask", /most natural answer|natural answer uses it/gi],
    ["never name a pattern / show the formula", /show (its|the) formula/gi],
    ["never list targets", /list or drill|never (list|drill)/gi],
    ["no romanization unless asked", /romanization/gi],
    ["corrections never in reply text", /never put corrections/gi],
    ["explanation language", /explanation language named|write correction explanations/gi],
    ["correction kind definition", /grammatical sense/gi],
    ["spoken is never a typo", /never gets typo|never record a "typo"/gi],
    ["move-on number", /about \d+ exchanges/gi],
    ["level target", /slightly above|one step above|i\+1|near their level/gi],
    ["after two misses, model it", /after two misses/gi],
    ["answer first", /answer what the learner just said first/gi],
  ];
  for (const [name, d] of Object.entries(all)) {
    const prompt = renderSystemPrompt(d);
    assert.ok(prompt.length <= BUDGET[name as keyof typeof BUDGET], `${name} is ${prompt.length} chars`);
    for (const [what, re] of once) {
      const n = `${prompt}\n${tools}`.match(re)?.length ?? 0;
      assert.ok(n <= 1, `${name}: "${what}" appears ${n} times`);
    }
  }

  // Rules that must survive any edit.
  const chat = `${renderSystemPrompt(all.chatFull)}\n${tools}`;
  const must: [string, RegExp][] = [
    ["bring in: use it yourself, ask the question that invites it", /use it yourself in a natural sentence, then ask the question whose most natural answer uses it/],
    ["never name the pattern or lecture", /Never name a pattern, show its formula, tell them to use it, lecture/],
    ["never list or drill targets", /list or drill targets/],
    ["no romanization unless asked", /no translations, romanization or readings unless the learner asks/i],
    ["move on from the constants", new RegExp(`about ${TUNING.moveOnTurns} exchanges`)],
    ["too easy streak", new RegExp(`${TUNING.easyStreak} replies in a row have no grammar mistakes`)],
    ["kind definition", /Ask first: does the sentence make grammatical sense\?/],
    ["original is an exact substring", /Exact substring of the learner's latest message/],
    ["record_evidence once, after the reply", /Write your reply text FIRST[^]*call record_evidence once/],
    ["never put corrections in the reply", /Never put corrections in your reply text/],
    ["explanation language", /write correction explanations and grammar names in English/],
    ["one question", /exactly one natural question/],
    ["no reply yet", /No reply text yet/],
    ["topic_change", /topic_change|moved to a new topic/],
    ["spoken marker", /\[spoken\] were spoken and transcribed/],
    ["taught", /Every pattern you taught or explained/],
    ["evidence nudge", /you replied without calling record_evidence/],
    ["miss is the latest verdict", /Item 1 is the priority/],
  ];
  for (const [what, re] of must) assert.match(chat, re, what);
  assert.match(renderSystemPrompt(all.unitExplain), /Move to the next point once they use the current one correctly twice/);
  assert.doesNotMatch(renderSystemPrompt(all.unitExplain), /Move on when the topic is used up/, "a unit session has one move-on rule");
  assert.doesNotMatch(renderSystemPrompt(all.roleplayGerman), /Move on when the topic is used up/, "a role-play ends with the scene");
  assert.match(renderSystemPrompt(all.targeted), /After two misses/);
  assert.match(renderSystemPrompt(all.jaBeginner), /No full translations, romanization or readings unless they ask/);
  assert.doesNotMatch(renderSystemPrompt(all.reading), /Never name a pattern/, "no targets, no bring-in rule");
});
