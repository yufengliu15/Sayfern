import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { DefaultLanguageService } from "../lang";
import { gradeLocal, parseGradeJson } from "./grade";
import { buildTiles, normalizeGaps, seededRandom, stripOptionLabel, validateItem, type QuizItem, type ValidateContext } from "./items";
import { extractJson } from "./json";
import { minutesFor, planFormats, questionCount, questionsForMinutes } from "./estimate";
import { examLabel, levelRank, resolveLevel } from "./levels";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const lang = new DefaultLanguageService({ dataDir: join(mkdtempSync(join(tmpdir(), "sayfern-quiz-lang-")), "dict") });
const zh = lang.pack("zh");
const ja = lang.pack("ja");
before(async () => {
  await zh.ready();
  await ja.ready();
});

function ctx(language: "zh" | "ja" = "zh"): ValidateContext {
  const pack = language === "zh" ? zh : ja;
  return {
    language,
    normalize: (s) => pack.normalize(s),
    segment: (s) => pack.segment(s),
    grammarIds: new Set(["zh:chule-hai"]),
    correctionIds: new Set(["c1"]),
    random: seededRandom("t"),
  };
}

function ok(v: ReturnType<typeof validateItem>) {
  assert.ok(v.ok, v.ok ? "" : v.problem);
  return v;
}

describe("validateItem: multiple choice", () => {
  it("keeps a clean item, shuffles options, links known grammar only", () => {
    const v = ok(
      validateItem(
        { format: "multiple_choice", text: "除了中文课，我 ___ 有三门课。", choices: ["还", "也", "都", "就"], answer: "还", explanation: "还 adds B.", grammar_id: "zh:chule-hai", correction_id: "nope" },
        "multiple_choice",
        ctx(),
      ),
    );
    assert.deepEqual([...v.item.choices!].sort(), ["也", "就", "还", "都"].sort());
    assert.equal(v.item.answer, "还");
    assert.equal(v.item.text, "除了中文课，我 ___ 有三门课。");
    assert.equal(v.item.grammarId, "zh:chule-hai");
    assert.equal(v.item.correctionId, undefined);
    assert.deepEqual(v.repairs, []);
  });

  it("repairs: letter answers, labels, duplicates, a missing key", () => {
    const v = ok(validateItem({ text: "Which fits?", choices: ["A. 还", "B. 也", "C. 都", "D. 都"], answer: "A", explanation: "x" }, "multiple_choice", ctx()));
    assert.equal(v.item.answer, "还");
    assert.equal(v.item.choices!.length, 3);
    assert.ok(v.repairs.includes("removed duplicate options"));

    const w = ok(validateItem({ text: "Which fits?", choices: ["也", "都", "就"], answer: "还", explanation: "x" }, "multiple_choice", ctx()));
    assert.equal(w.item.choices!.filter((c) => c === "还").length, 1);
    assert.ok(w.repairs.includes("answer was not among the options"));

    const english = ok(validateItem({ text: "推荐 means…", choices: ["To recommend", "to queue", "impression", "roast duck"], answer: "to recommend", explanation: "x" }, "multiple_choice", ctx()));
    assert.equal(english.item.choices!.length, 4, "answer matched case-insensitively, not appended");
  });

  it("drops a four-option item whose key isn't among the options (no overwrite, no two right answers)", () => {
    const v = validateItem({ text: "Which fits?", choices: ["也", "都", "就", "又"], answer: "还", explanation: "x" }, "multiple_choice", ctx());
    assert.equal(v.ok, false);
  });

  it("drops ambiguous or thin items", () => {
    const amb = validateItem({ text: "?", choices: ["还", "也", "都", "就"], answer: "还", accepted: ["也"], explanation: "x" }, "multiple_choice", ctx());
    assert.equal(amb.ok, false);
    const thin = validateItem({ text: "?", choices: ["还", "还"], answer: "还", explanation: "x" }, "multiple_choice", ctx());
    assert.equal(thin.ok, false);
    const noExpl = validateItem({ text: "?", choices: ["还", "也", "都"], answer: "还" }, "multiple_choice", ctx());
    assert.equal(noExpl.ok, false);
  });
});

describe("validateItem: cloze", () => {
  it("normalizes gap markers and keeps accepted alternatives", () => {
    const v = ok(validateItem({ format: "cloze", text: "我（ ）昨天去了北京。", answer: "是", accepted: ["是", "就是"], explanation: "x", hint: "is" }, undefined, ctx()));
    assert.equal(v.item.text, "我___昨天去了北京。");
    assert.deepEqual(v.item.accepted, ["就是"]);
    assert.equal(v.item.hint, "is");
  });

  it("makes the gap from the answer, rejects zero or two gaps", () => {
    const v = ok(validateItem({ text: "北京比上海冷。", answer: "比", explanation: "x" }, "cloze", ctx()));
    assert.equal(v.item.text, "北京___上海冷。");
    assert.equal(validateItem({ text: "北京上海冷。", answer: "比", explanation: "x" }, "cloze", ctx()).ok, false);
    assert.equal(validateItem({ text: "___比___冷。", answer: "北京", explanation: "x" }, "cloze", ctx()).ok, false);
    assert.equal(normalizeGaps("a ＿＿ b [ ] c").gaps, 2);
  });
});

describe("validateItem: ordering", () => {
  it("builds tiles locally that join to the answer, in a shuffled order", () => {
    const v = ok(validateItem({ format: "ordering", text: "Besides Chinese class I have three more.", answer: "除了中文课，我还有三门课。" }, undefined, ctx()));
    const tiles = v.item.tiles!;
    assert.ok(tiles.length >= 3 && tiles.length <= 8);
    assert.equal(zh.normalize([...tiles].join("")).length, zh.normalize(v.item.answer).length);
    const inOrder = buildTiles(v.item.answer, (s) => zh.segment(s))!;
    assert.notDeepEqual(tiles, inOrder);
    assert.deepEqual([...tiles].sort(), [...inOrder].sort());
    assert.equal(v.item.context, "Besides Chinese class I have three more.");
  });

  it("keeps model tiles that join exactly, rebuilds ones that don't", () => {
    const good = ok(validateItem({ answer: "ご飯を食べてから、出かけます。", tiles: ["ご飯を", "食べてから", "出かけます"], explanation: "x" }, "ordering", ctx("ja")));
    assert.deepEqual([...good.item.tiles!].sort(), ["ご飯を", "出かけます", "食べてから"].sort());
    const bad = ok(validateItem({ answer: "ご飯を食べてから、出かけます。", tiles: ["出かけます", "パンを", "食べてから"], explanation: "x" }, "ordering", ctx("ja")));
    assert.ok(bad.repairs.includes("rebuilt the tiles from the answer"));
    assert.equal(validateItem({ answer: "好。" }, "ordering", ctx()).ok, false);
  });

  it("only accepts alternatives made of the same characters", () => {
    const v = ok(validateItem({ answer: "我昨天去了北京。", accepted: ["昨天我去了北京。", "我去了上海。"], explanation: "x" }, "ordering", ctx()));
    assert.deepEqual(v.item.accepted, ["昨天我去了北京。"]);
  });
});

describe("validateItem: written and scenario", () => {
  it("needs a model answer; adds a default rubric", () => {
    const v = ok(validateItem({ format: "written", context: "Say what you did at the weekend using 除了…还….", answer: "除了爬山，我还看了电影。" }, undefined, ctx()));
    assert.ok(v.item.rubric);
    assert.ok(v.repairs.includes("added a default rubric"));
    assert.equal(validateItem({ format: "written", context: "x" }, undefined, ctx()).ok, false);
    assert.equal(validateItem({ format: "scenario", answer: "好的", rubric: "polite" }, undefined, ctx()).ok, false, "scenario needs a setup");
    ok(validateItem({ format: "scenario", context: "At a restaurant.", text: "您好，几位？", answer: "两位。", rubric: "Says how many people." }, undefined, ctx()));
  });
});

describe("local grading", () => {
  const item = (over: Partial<QuizItem>): QuizItem => ({ id: "q", format: "cloze", prompt: "", answer: "还", accepted: [], explanation: "", ...over });

  it("normalizes width, punctuation and spaces; accepts alternatives", () => {
    assert.equal(gradeLocal(item({}), " 还。", (s) => zh.normalize(s)), "correct");
    assert.equal(gradeLocal(item({}), "也", (s) => zh.normalize(s)), "incorrect");
    assert.equal(gradeLocal(item({}), "", (s) => zh.normalize(s)), "incorrect");
    assert.equal(gradeLocal(item({ accepted: ["也还"] }), "也还", (s) => zh.normalize(s)), "correct");
    assert.equal(gradeLocal(item({ answer: "ＡＢＣ" }), "abc", (s) => zh.normalize(s)), "correct", "width-folded and case-insensitive");
  });

  it("cloze accepts the whole sentence with the gap filled", () => {
    const it = item({ text: "除了中文课，我___有三门课。" });
    assert.equal(gradeLocal(it, "除了中文课，我还有三门课", (s) => zh.normalize(s)), "correct");
    assert.equal(gradeLocal(it, "除了中文课，我也有三门课", (s) => zh.normalize(s)), "incorrect");
  });

  it("ordering is an exact match (or a listed alternative)", () => {
    const it = item({ format: "ordering", answer: "我昨天去了北京。", accepted: ["昨天我去了北京。"] });
    assert.equal(gradeLocal(it, "我昨天去了北京", (s) => zh.normalize(s)), "correct");
    assert.equal(gradeLocal(it, "昨天我去了北京", (s) => zh.normalize(s)), "correct");
    assert.equal(gradeLocal(it, "我去了北京昨天", (s) => zh.normalize(s)), "incorrect");
  });
});

describe("parsing model output", () => {
  it("extracts JSON from fences, prose and truncated arrays", () => {
    assert.deepEqual(extractJson('```json\n{"items": [1]}\n```'), { items: [1] });
    assert.deepEqual(extractJson('Here you go: {"a": "b"} enjoy'), { a: "b" });
    const cut = '{"items": [{"slot": 1, "answer": "还"}, {"slot": 2, "answer": "也"}, {"slot": 3, "ans';
    assert.deepEqual(extractJson(cut), { items: [{ slot: 1, answer: "还" }, { slot: 2, answer: "也" }] });
    assert.equal(extractJson("nothing here"), null);
  });

  it("parses grader JSON", () => {
    assert.deepEqual(parseGradeJson('{"verdict": "Correct", "feedback": "Good use of 还.", "better": "除了爬山，我还看了电影。"}'), {
      verdict: "correct",
      feedback: "Good use of 还.",
      better: "除了爬山，我还看了电影。",
    });
    assert.equal(parseGradeJson('{"verdict": "partly"}')?.verdict, "uncertain");
    assert.equal(parseGradeJson("I think it's fine"), null);
  });

  it("strips option labels", () => {
    assert.equal(stripOptionLabel("(B) 也"), "也");
    assert.equal(stripOptionLabel("1. 还"), "还");
    assert.equal(stripOptionLabel("还"), "还");
  });
});

describe("length and duration", () => {
  it("plans formats and converts minutes to questions locally", () => {
    assert.deepEqual(planFormats("grammar", "cloze", 3), ["cloze", "cloze", "cloze"]);
    const mixed = planFormats("mixed", "mixed", 8);
    assert.equal(new Set(mixed).size, 5);
    assert.equal(minutesFor(["multiple_choice", "multiple_choice"]), 1);
    assert.equal(minutesFor(planFormats("grammar", "multiple_choice", 10)), 5);
    assert.equal(questionsForMinutes("grammar", "multiple_choice", 5), 10);
    assert.equal(questionsForMinutes("scenarios", "scenario", 5), 3, "never below the minimum");
    assert.equal(questionCount("vocabulary", "mixed", { questions: 99 }), 30);
    assert.equal(questionCount("vocabulary", "mixed", { questions: 1 }), 3);
    const n = questionCount("mixed", "mixed", { minutes: 10 });
    assert.ok(minutesFor(planFormats("mixed", "mixed", n)) <= 10);
  });
});

describe("levels and provenance", () => {
  it("labels exam versions and says it is not official", () => {
    assert.equal(examLabel("hsk2", "HSK 3"), "HSK 3 (HSK 2.0 levels)");
    assert.equal(examLabel("hsk3", "HSK 7-9"), "HSK 7-9 (HSK 3.0)");
    assert.equal(examLabel("jlpt", "N4"), "JLPT N4");
    const r = resolveLevel("zh", { kind: "exam", exam: "hsk2", level: "HSK 3" }, "HSK 2");
    assert.equal(r.provenance, "Generated in HSK 3 style (HSK 2.0 levels). Not official exam material.");
    assert.match(r.guidance, /600 words/);
    const cur = resolveLevel("ja", { kind: "current" }, "N4");
    assert.equal(cur.alignment, "your level (N4)");
    assert.match(cur.provenance, /Not official exam material/);
    // JLPT on Chinese is not valid: falls back to the current level.
    assert.equal(resolveLevel("zh", { kind: "exam", exam: "jlpt", level: "N4" }, null).exam, undefined);
    assert.equal(levelRank("ja", "N5"), 0);
    assert.equal(levelRank("zh", "HSK 4"), 3);
  });
});
