import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { buildCourseView, COURSES, courseFor, findUnit, isBeta } from "../../shared/course";
import { LANGUAGE_META } from "../../shared/languages";
import type { GrammarSummary, Language, LevelEstimate } from "../../shared/records";
import { LANGUAGES } from "../../shared/records";
import { buildSystemPrompt } from "../agent/prompt";
import { makeHarness } from "../agent/testkit";
import { canonicalGrammarId } from "../agent/text";
import { turnTools } from "../agent/tools";

const zh = courseFor("zh")!;
const scale = LANGUAGE_META.zh.levels;
const solid = (id: string) => ({ point: { id }, state: "independent" }) as GrammarSummary;
const level = (l: string) => ({ writing: { level: l } as LevelEstimate });

test("course data: unique ids, levels on the scale and in order, grammar ids the tutor can record", () => {
  for (const lang of LANGUAGES) {
    const course = COURSES[lang];
    if (!course) continue;
    const levels = LANGUAGE_META[lang].levels;
    const unitIds = new Set<string>();
    const grammarIds = new Set<string>();
    let last = 0;
    for (const u of course.units) {
      assert.ok(!unitIds.has(u.id), `duplicate unit ${u.id}`);
      unitIds.add(u.id);
      assert.ok(u.id.startsWith(`${lang}-`), u.id);
      const at = levels.indexOf(u.level);
      assert.ok(at >= 0, `${u.id}: level ${u.level} not on the scale`);
      assert.ok(at >= last, `${u.id}: levels go back`);
      last = at;
      assert.ok(u.title && u.goal && u.grammar.length && u.topics.length && u.words.length, u.id);
      for (const g of u.grammar) {
        assert.ok(!grammarIds.has(g.id), `duplicate grammar ${g.id}`);
        grammarIds.add(g.id);
        assert.equal(canonicalGrammarId(g.id, lang), g.id, `${g.id} is not canonical`);
      }
    }
    assert.ok(levels.every((l) => course.units.some((u) => u.level === l)), `${lang}: a level has no units`);
  }
});

test("Beta: languages without a course", () => {
  assert.equal(isBeta("zh"), false);
  assert.equal(isBeta("ko"), true);
  const view = buildCourseView("ko" as Language, LANGUAGE_META.ko.levels, [], {});
  assert.equal(view.available, false);
  assert.deepEqual(view.levels, []);
});

test("course view: next unit starts at the learner's level and skips done units", () => {
  const fresh = buildCourseView("zh", scale, [], {});
  assert.equal(fresh.nextUnitId, zh.units[0].id);
  assert.ok(fresh.levels.every((l) => l.units.every((u) => u.status === "new")));

  const hsk3 = zh.units.filter((u) => u.level === "HSK 3");
  const atLevel = buildCourseView("zh", scale, [], level("HSK 3"));
  assert.equal(atLevel.learnerLevel, "HSK 3");
  assert.equal(atLevel.nextUnitId, hsk3[0].id);

  const grammar = [...hsk3[0].grammar.map((g) => solid(g.id)), { point: { id: hsk3[1].grammar[0].id }, state: "with_help" } as GrammarSummary];
  const view = buildCourseView("zh", scale, grammar, level("HSK 3"), new Set([hsk3[2].id]));
  const units = view.levels.find((l) => l.level === "HSK 3")!.units;
  assert.equal(units[0].status, "done");
  assert.equal(units[0].solid, units[0].total);
  assert.equal(units[1].status, "started");
  assert.equal(units[1].next, true);
  assert.equal(units[2].status, "started", "a unit session counts as started");
  assert.equal(view.nextUnitId, hsk3[1].id);
});

test("course tool: offered for course languages only; overview and unit text", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  const session = (await h.records.getSession(sid))!;
  const turn = { session, emit: () => {}, sources: [], emittedCorrections: new Set<string>() };
  const tool = turnTools(h.deps, turn).find((t) => t.name === "course");
  assert.ok(tool);
  const ko = await h.records.createSession({ language: "ko", kind: "chat", feedbackMode: "inline" });
  assert.ok(!turnTools(h.deps, { ...turn, session: ko }).some((t) => t.name === "course"));

  const ctx = { sessionId: sid, language: "zh" as const, records: h.records, library: h.library, anki: h.anki, lang: h.lang };
  const overview = await tool.execute({ action: "overview" }, ctx);
  assert.match(overview.content, /Learner level: unknown/);
  assert.match(overview.content, new RegExp(`Next unit: ${zh.units[0].id}`));
  assert.equal(overview.activity, "Looked at the course");

  const { unit } = findUnit("zh-hsk3-02")!;
  await h.records.upsertGrammarPoint({ id: "zh:chule-hai", language: "zh", pattern: "除了…还…", name: "besides", introduced: true });
  const one = await tool.execute({ action: "unit", unit_id: unit.id }, ctx);
  assert.match(one.content, /zh:chule-hai \| 除了 A（以外），还 B .* Learner: introduced, not used correctly yet\./);
  assert.match(one.content, /zh:you-you .* Learner: not seen yet\./);
  assert.match(one.content, /Topic ideas: /);
  assert.equal(one.activity, `Opened course unit: ${unit.title}`);
  const missing = await tool.execute({ action: "unit", unit_id: "zh-nope" }, ctx);
  assert.match(missing.content, /No unit zh-nope/);
});

test("unit session: the tutor opens it and the prompt carries the unit", async () => {
  const h = makeHarness();
  const s = await h.records.createSession({ language: "zh", kind: "practice", feedbackMode: "inline", unitId: "zh-hsk2-04" });
  h.faux.setResponses([fauxAssistantMessage([fauxText("你和你朋友谁高？"), fauxToolCall("record_evidence", {} as never)], { stopReason: "toolUse" })]);
  const reply = await h.tutor.runOpening({ sessionId: s.id, model: h.model, signal: new AbortController().signal, onEvent: () => {} });
  assert.equal(reply.topicStart, true);
  const transcript = await h.records.getTranscript(s.id);
  assert.match(String(transcript[0].content), /started a course unit/);
  const prompt = await buildSystemPrompt(h.deps, s);
  assert.match(prompt, /# Session: course unit\nUnit zh-hsk2-04 \(HSK 2\): Compare things/);
  assert.match(prompt, /zh:bi-comparison \| A 比 B \+ Adj/);
  assert.doesNotMatch(prompt, /# Course \(/, "no course block inside a unit session");
});
