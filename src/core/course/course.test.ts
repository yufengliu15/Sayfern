import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { buildCourseView, COURSES, courseFor, findUnit, isBeta } from "../../shared/course";
import { LANGUAGE_META } from "../../shared/languages";
import type { GrammarSummary, Language, LevelEstimate } from "../../shared/records";
import { LANGUAGES } from "../../shared/records";
import { buildSystemPrompt } from "../agent/prompt";
import { makeHarness, userBlocks } from "../agent/testkit";
import { canonicalGrammarId } from "../agent/text";
import { turnTools } from "../agent/tools";
import { overviewText, unitText } from "./index";

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

test("full-syllabus courses: every source point once, at its own level", () => {
  const covered = (lang: "zh" | "en", prefix: string) => {
    const refs = courseFor(lang)!.units.flatMap((u) => u.grammar.map((g) => g.ref ?? ""));
    assert.equal(new Set(refs).size, refs.length, `${lang}: a source point appears twice`);
    return new Set(refs.map((r) => Number(r.slice(prefix.length))));
  };
  const zhRefs = covered("zh", "HSK 3.0 #");
  const enRefs = covered("en", "EGP ");
  for (let n = 1; n <= 573; n++) assert.ok(zhRefs.has(n), `HSK 3.0 #${n} missing`);
  for (let n = 1; n <= 1239; n++) assert.ok(enRefs.has(n), `EGP ${n} missing`);
  assert.equal(zhRefs.size, 573);
  assert.equal(enRefs.size, 1239);
  // Spot checks of the source levels: HSK 3.0 #49 (可能/可以) is level 2, #573 is 7-9; EGP 818 (present perfect) is A2.
  const levelOf = (lang: "zh" | "en", ref: string) => courseFor(lang)!.units.find((u) => u.grammar.some((g) => g.ref === ref))!.level;
  assert.equal(levelOf("zh", "HSK 3.0 #49"), "HSK 2");
  assert.equal(levelOf("zh", "HSK 3.0 #573"), "HSK 7-9");
  assert.equal(levelOf("en", "EGP 818"), "A2");
  assert.ok(findUnit("zh-hsk30-1-08")!.unit.grammar.some((g) => g.id === "zh:bi-comparison"), "old grammar ids are reused");
  assert.ok(courseFor("en")!.units.some((u) => u.grammar.some((g) => g.id === "en:present-perfect")));
});

test("course overview: capped, the learner's level first", () => {
  const en = courseFor("en")!;
  const levels = LANGUAGE_META.en.levels;
  const text = overviewText(en, buildCourseView("en", levels, [], level("B1")), levels);
  const rows = text.split("\n").filter((l) => l.startsWith("en-egp-"));
  assert.equal(rows.length, 40);
  assert.match(rows[0], /^en-egp-b1-01 \| B1 \|/);
  assert.match(text, /more units at these levels/);
});

test("Beta: languages without a course", () => {
  assert.equal(isBeta("zh"), false);
  for (const lang of ["ja", "ko", "fr", "es", "en", "it", "de", "pt"] as const) assert.equal(isBeta(lang), false, lang);
  assert.equal(isBeta("ru"), true);
  assert.equal(isBeta("vi"), true);
  const view = buildCourseView("ru" as Language, LANGUAGE_META.ru.levels, [], {});
  assert.equal(view.available, false);
  assert.deepEqual(view.levels, []);
});

test("courses after Chinese: next unit at the learner's level, words listed per script", () => {
  for (const lang of ["ja", "ko", "fr", "es", "en", "it", "de", "pt"] as const) {
    const course = courseFor(lang)!;
    const levels = LANGUAGE_META[lang].levels;
    assert.equal(buildCourseView(lang, levels, [], {}).nextUnitId, course.units[0].id, lang);
    const mid = levels[2];
    const first = course.units.find((u) => u.level === mid)!;
    assert.equal(buildCourseView(lang, levels, [], level(mid)).nextUnitId, first.id, `${lang} ${mid}`);
    const done = first.grammar.map((g) => solid(g.id));
    const second = course.units[course.units.indexOf(first) + 1];
    assert.equal(buildCourseView(lang, levels, done, level(mid)).nextUnitId, second.id, `${lang}: skips a done unit`);
  }
  assert.match(unitText(findUnit("ja-n5-01")!.unit, new Map()), /Core words: わたし、なまえ/);
  assert.match(unitText(findUnit("fr-a1-01")!.unit, new Map()), /Core words: bonjour, nom, /);
  assert.match(unitText(findUnit("ko-topik1-01")!.unit, new Map()), /Core words: 안녕하세요, 이름, /);
  assert.match(unitText(findUnit("es-a1-01")!.unit, new Map()), /Core words: hola, nombre, /);
  assert.match(unitText(findUnit("de-a1-01")!.unit, new Map()), /Core words: Hallo, Name, /);
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
  const ru = await h.records.createSession({ language: "ru", kind: "chat", feedbackMode: "inline" });
  assert.ok(!turnTools(h.deps, { ...turn, session: ru }).some((t) => t.name === "course"));

  const ctx = { sessionId: sid, language: "zh" as const, records: h.records, library: h.library, anki: h.anki, lang: h.lang };
  const overview = await tool.execute({ action: "overview" }, ctx);
  assert.match(overview.content, /Learner level: unknown/);
  assert.match(overview.content, new RegExp(`Next unit: ${zh.units[0].id}`));
  assert.equal(overview.activity, "Looked at the course");

  const { unit } = findUnit("zh-hsk30-3-07")!;
  await h.records.upsertGrammarPoint({ id: "zh:chule-hai", language: "zh", pattern: "除了…还…", name: "besides", introduced: true });
  const one = await tool.execute({ action: "unit", unit_id: unit.id }, ctx);
  assert.match(one.content, /zh:chule-hai \| 除了 A（以外），还 .* Learner: introduced, not used correctly yet\./);
  assert.match(one.content, /zh:yue-yue .* Learner: not seen yet\./);
  assert.match(one.content, /Topic ideas: /);
  assert.equal(one.activity, `Opened course unit: ${unit.title}`);
  const missing = await tool.execute({ action: "unit", unit_id: "zh-nope" }, ctx);
  assert.match(missing.content, /No unit zh-nope/);
});

test("unit session (More practice): the tutor opens it and the prompt carries the unit", async () => {
  const h = makeHarness();
  const s = await h.records.createSession({ language: "zh", kind: "practice", feedbackMode: "inline", unitId: "zh-hsk30-1-08" });
  h.faux.setResponses([fauxAssistantMessage([fauxText("你和你朋友谁高？"), fauxToolCall("record_evidence", {} as never)], { stopReason: "toolUse" })]);
  const reply = await h.tutor.runOpening({ sessionId: s.id, model: h.model, signal: new AbortController().signal, onEvent: () => {} });
  assert.equal(reply.topicStart, true);
  const transcript = await h.records.getTranscript(s.id);
  assert.match(userBlocks(transcript[0])[0], /started a course unit for more practice/);
  const prompt = await buildSystemPrompt(h.deps, s);
  assert.match(prompt, /# Session: course unit \(more practice\)\nUnit zh-hsk30-1-08 \(HSK 1\): Special sentence patterns/);
  assert.doesNotMatch(prompt, /# Sample dialogue/, "no sample dialogue, even for a beginner");
  assert.match(prompt, /treat its grammar as known/);
  assert.doesNotMatch(prompt, /explain it first/, "a beginner is not told to explain each point first");
  assert.match(prompt, /zh:bi-comparison \| A 比 B \+ Adj/);
  assert.doesNotMatch(prompt, /# Course \(/, "no course block inside a unit session");
  assert.doesNotMatch(prompt, /quick overview/, "no overview unless the learner asked for it");
});

test("unit session with a grammar overview: the opening gives a short summary first", async () => {
  const h = makeHarness();
  const s = await h.records.createSession({ language: "ja", kind: "practice", feedbackMode: "inline", unitId: "ja-n5-04", openWith: "explain" });
  h.faux.setResponses([fauxAssistantMessage([fauxText("い形容詞：高いです。…どんな町ですか？"), fauxToolCall("record_evidence", {} as never)], { stopReason: "toolUse" })]);
  await h.tutor.runOpening({ sessionId: s.id, model: h.model, signal: new AbortController().signal, onEvent: () => {} });
  const transcript = await h.records.getTranscript(s.id);
  assert.match(userBlocks(transcript[0])[0], /started a course unit and asked for a quick overview of its grammar first/);
  const prompt = await buildSystemPrompt(h.deps, s);
  assert.match(prompt, /# Session: course unit\nUnit ja-n5-04 \(N5\)/);
  assert.match(prompt, /quick overview of this unit's grammar/);
  assert.match(prompt, /does not replace their textbook/);
});
