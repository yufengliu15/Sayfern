import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { GrammarObservation, GrammarPoint } from "../../shared/records";
import type { QuizSpec } from "../../shared/stage2";
import { summarizeGrammar } from "../records/grammar";
import { quizSessionId } from "./index";
import { makeQuizHarness, seedChinese } from "./testkit";

const grammarSpec = (over: Partial<QuizSpec> = {}): QuizSpec => ({
  language: "zh",
  focus: "grammar",
  sources: [{ kind: "mistakes" }],
  level: { kind: "current" },
  format: "mixed",
  length: { questions: 4 },
  ...over,
});

// Slots for grammar + mixed + 4: cloze, multiple_choice, ordering, multiple_choice.
const GRAMMAR_ITEMS = {
  items: [
    { slot: 1, format: "cloze", prompt: "Fill the gap.", text: "除了数学课，我___有两门课。", answer: "还", explanation: "还 adds the extra item.", grammar_id: "zh:chule-hai" },
    { slot: 2, format: "multiple_choice", prompt: "Choose the word that fits.", text: "除了米饭，她 ___ 喜欢吃面条。", choices: ["还", "都", "就", "才"], answer: "还", explanation: "Besides A, also B uses 还.", grammar_id: "chule-hai" },
    { slot: 3, format: "ordering", prompt: "Put the words in order.", text: "Besides Chinese, I can also speak Japanese.", answer: "除了中文，我还会说日语。", explanation: "Subject before 还.", grammar_id: "zh:chule-hai" },
    { slot: 4, format: "multiple_choice", text: "broken item without an answer", choices: ["a", "b", "c"] },
  ],
};

async function readyQuiz(h: ReturnType<typeof makeQuizHarness>, spec = grammarSpec(), body: unknown = GRAMMAR_ITEMS) {
  h.reply(body);
  const started = await h.quizzes.startQuiz(spec, h.ref);
  assert.equal(started.status, "generating");
  const view = await h.quizzes.whenGenerated(started.id);
  assert.ok(view);
  return view;
}

describe("QuizService: generation", () => {
  it("gathers material, validates items, never sends keys before answering", async () => {
    const h = makeQuizHarness();
    const { correction } = await seedChinese(h);
    let prompt = "";
    h.faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context.messages.at(-1)?.content);
        return fauxAssistantMessage(JSON.stringify(GRAMMAR_ITEMS));
      },
    ]);
    const started = await h.quizzes.startQuiz(grammarSpec(), h.ref);
    const view = (await h.quizzes.whenGenerated(started.id))!;
    assert.equal(view.status, "ready");
    assert.equal(view.questions.length, 3, "the broken item is dropped");
    assert.match(prompt, new RegExp(`correction ${correction.id}`));
    assert.match(prompt, /zh:chule-hai/);
    assert.equal(view.title, "Grammar · my mistakes");
    assert.equal(view.generated, true);
    assert.match(view.provenance, /Not official exam material/);
    for (const q of view.questions) {
      assert.equal(q.answered, undefined);
      for (const k of ["answer", "accepted", "rubric", "explanation", "correctionId"]) assert.equal(k in q, false, `${k} leaked`);
      assert.equal(q.grammarId, "zh:chule-hai");
      assert.equal(q.grammarLabel, "除了…还…");
    }
    const ordering = view.questions.find((q) => q.format === "ordering")!;
    assert.ok(ordering.tiles && ordering.tiles.length >= 3);
    assert.equal(h.faux.state.callCount, 1, "one batched request");
  });

  it("fails readably when too few items survive, and on model errors", async () => {
    const h = makeQuizHarness();
    await seedChinese(h);
    const garbage = await readyQuiz(h, grammarSpec(), "Sorry, I can't do that.");
    assert.equal(garbage.status, "failed");
    assert.match(garbage.error!, /didn't return any usable questions/);

    h.faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "Rate limited. Try again in a minute." })]);
    const started = await h.quizzes.startQuiz(grammarSpec(), h.ref);
    const failed = (await h.quizzes.whenGenerated(started.id))!;
    assert.equal(failed.status, "failed");
    assert.equal(failed.error, "Rate limited. Try again in a minute.");
    assert.deepEqual(await h.quizzes.listQuizzes("zh"), [], "failed quizzes stay out of the list");
  });

  it("asks once more for missing slots", async () => {
    const h = makeQuizHarness();
    await seedChinese(h);
    const half = { items: GRAMMAR_ITEMS.items.slice(0, 2) };
    const topUp = { items: [{ slot: 3, format: "ordering", answer: "除了中文，我还会说日语。", explanation: "x" }, { slot: 4, format: "multiple_choice", text: "我比他 ___。", choices: ["高", "很高", "太高", "高高"], answer: "高", explanation: "No 很 after 比." }] };
    h.reply(half, topUp);
    const started = await h.quizzes.startQuiz(grammarSpec(), h.ref);
    const view = (await h.quizzes.whenGenerated(started.id))!;
    assert.equal(h.faux.state.callCount, 2);
    assert.equal(view.questions.length, 4);
    assert.deepEqual(
      view.questions.map((q) => q.format),
      ["cloze", "multiple_choice", "ordering", "multiple_choice"],
    );
  });

  it("can be cancelled while the model is writing", async () => {
    const h = makeQuizHarness();
    await seedChinese(h);
    h.faux.setResponses([
      (_c, options) =>
        new Promise((resolve) => {
          options?.signal?.addEventListener("abort", () => resolve(fauxAssistantMessage("", { stopReason: "aborted" })));
        }),
    ]);
    const started = await h.quizzes.startQuiz(grammarSpec(), h.ref);
    await h.quizzes.cancelQuizGeneration(started.id);
    assert.equal(await h.quizzes.whenGenerated(started.id), null);
    assert.deepEqual(await h.quizzes.listQuizzes("zh"), []);
  });

  it("rejects empty sources and unavailable models before creating anything", async () => {
    const h = makeQuizHarness();
    await seedChinese(h);
    await assert.rejects(h.quizzes.startQuiz(grammarSpec({ sources: [{ kind: "saved_words" }] }), h.ref), /haven't saved any words/);
    await assert.rejects(h.quizzes.startQuiz(grammarSpec(), { provider: "nope", id: "x" }), /Sign in/);
    assert.deepEqual(await h.quizzes.listQuizzes("zh"), []);
  });

  it("marks a quiz left generating by a previous run as failed", async () => {
    const h = makeQuizHarness();
    await h.quizzes.store.create({
      v: 1,
      id: "stale",
      language: "zh",
      title: "x",
      spec: grammarSpec(),
      status: "generating",
      createdAt: h.clock.t,
      alignment: "your level",
      provenance: "p",
      items: [],
      grammarLabels: {},
    });
    const v = (await h.quizzes.getQuiz("stale"))!;
    assert.equal(v.status, "failed");
    assert.match(v.error!, /Try again/);
  });
});

describe("QuizService: answering, scoring, evidence", () => {
  it("grades fixed formats locally, returns the key after answering, scores locally", async () => {
    const h = makeQuizHarness();
    await seedChinese(h);
    const view = await readyQuiz(h);
    const calls = h.faux.state.callCount;
    const [cloze, mc, ordering] = view.questions;

    let v = await h.quizzes.answerQuestion(view.id, cloze.id, "还。", null);
    assert.equal(v.questions[0].answered!.verdict, "correct");
    assert.equal(v.questions[0].answered!.gradedBy, "local");
    assert.equal(v.questions[0].answered!.answer, "还");

    v = await h.quizzes.answerQuestion(view.id, mc.id, "都", null);
    const a = v.questions[1].answered!;
    assert.equal(a.verdict, "incorrect");
    assert.equal(a.answer, "还");
    assert.equal(a.explanation, "Besides A, also B uses 还.");

    // Answering twice keeps the first answer.
    v = await h.quizzes.answerQuestion(view.id, mc.id, "还", null);
    assert.equal(v.questions[1].answered!.verdict, "incorrect");

    v = await h.quizzes.answerQuestion(view.id, ordering.id, ["除了", "中文", "我", "还", "会", "说", "日语"].join(""), null);
    assert.equal(v.questions[2].answered!.verdict, "correct");
    assert.equal(h.faux.state.callCount, calls, "no model calls for fixed formats");
    assert.deepEqual({ ...v.summary, grammar: undefined }, { total: 3, answered: 3, correct: 2, incorrect: 1, uncertain: 0, grammar: undefined, review: [mc.id] });
  });

  it("records quiz evidence on finish: prompted, apart from conversation, never independent", async () => {
    const h = makeQuizHarness();
    await seedChinese(h);
    const view = await readyQuiz(h);
    const [cloze, mc, ordering] = view.questions;
    await h.quizzes.answerQuestion(view.id, cloze.id, "还", null);
    await h.quizzes.answerQuestion(view.id, mc.id, "都", null);
    await h.quizzes.answerQuestion(view.id, ordering.id, "", null, { reveal: true });

    const done = await h.quizzes.finishQuiz(view.id);
    assert.equal(done.status, "finished");
    await h.quizzes.finishQuiz(view.id); // idempotent

    const obs = await h.records.listObservations({ language: "zh", grammarId: "zh:chule-hai" });
    assert.equal(obs.length, 2, "revealed answers are not evidence");
    for (const o of obs) {
      assert.equal(o.origin, "quiz");
      assert.equal(o.quizId, view.id);
      assert.equal(o.sessionId, quizSessionId(view.id));
      assert.equal(o.assistance, "prompted");
    }
    const byMsg = new Map(obs.map((o) => [o.messageId, o]));
    assert.equal(byMsg.get(cloze.id)!.span, "除了数学课，我还有两门课。");
    assert.equal(byMsg.get(cloze.id)!.verdict, "correct");
    assert.equal(byMsg.get(mc.id)!.verdict, "incorrect");

    const summary = (await h.records.getGrammarSummary("zh:chule-hai"))!;
    assert.deepEqual(summary.counts, { correct: 0, incorrect: 0, uncertain: 0, unassessed: 0 }, "conversation counts untouched");
    assert.equal(summary.rate, null);
    assert.equal(summary.lastUsedAt, undefined);
    assert.equal(summary.state, "with_help");
    assert.deepEqual(summary.quiz?.counts, { correct: 1, incorrect: 1, uncertain: 0, unassessed: 0 });
    assert.equal(summary.quiz?.rate, 0.5);

    // Quiz text never counts as learner words (S1-23).
    const progress = await h.records.getProgress("zh", "all");
    assert.equal(progress.wordsWritten, 0);

    const list = await h.quizzes.listQuizzes("zh");
    assert.equal(list.length, 1);
    assert.equal(list[0].correct, 1);
    assert.equal(list[0].total, 3);
    assert.equal(list[0].status, "finished");
  });

  it("grades written answers with the model, falling back to uncertain", async () => {
    const h = makeQuizHarness();
    await seedChinese(h);
    const written = {
      items: [1, 2, 3].map((slot) => ({
        slot,
        format: "written",
        prompt: "Write one sentence.",
        context: "Say two things you did last weekend with 除了…还….",
        answer: "除了爬山，我还看了电影。",
        rubric: "Uses 除了…还… with 还 after the subject.",
        explanation: "还 follows the subject.",
        grammar_id: "zh:chule-hai",
      })),
    };
    // Identical items dedupe: vary the context.
    written.items.forEach((it, i) => (it.context += ` (${i})`));
    written.items.forEach((it, i) => (it.answer = ["除了爬山，我还看了电影。", "除了做饭，我还打扫了房间。", "除了跑步，我还游泳了。"][i]));
    const view = await readyQuiz(h, grammarSpec({ format: "written", length: { questions: 3 } }), written);
    assert.equal(view.questions.length, 3);
    const [q1, q2, q3] = view.questions;

    h.reply({ verdict: "correct", feedback: "Nice use of 还.", better: "除了爬山以外，我还看了电影。" });
    let v = await h.quizzes.answerQuestion(view.id, q1.id, "除了爬山，我还看电影了。", h.ref);
    assert.deepEqual(
      { verdict: v.questions[0].answered!.verdict, by: v.questions[0].answered!.gradedBy, better: v.questions[0].answered!.better },
      { verdict: "correct", by: "model", better: "除了爬山以外，我还看了电影。" },
    );

    h.reply("I am not sure what you mean");
    v = await h.quizzes.answerQuestion(view.id, q2.id, "除了做饭，还我打扫房间。", h.ref);
    assert.equal(v.questions[1].answered!.verdict, "uncertain");
    assert.equal(v.questions[1].answered!.gradedBy, "fallback");
    assert.equal(v.questions[1].answered!.better, "除了做饭，我还打扫了房间。");

    v = await h.quizzes.answerQuestion(view.id, q3.id, "除了跑步，我还游泳。", null);
    assert.equal(v.questions[2].answered!.verdict, "uncertain", "no model: uncertain, never a guess");
    assert.deepEqual([v.summary.correct, v.summary.incorrect, v.summary.uncertain], [1, 0, 2]);

    await h.quizzes.finishQuiz(view.id);
    const s = (await h.records.getGrammarSummary("zh:chule-hai"))!;
    assert.deepEqual(s.quiz?.counts, { correct: 1, incorrect: 0, uncertain: 2, unassessed: 0 });
  });

  it("retries mistakes locally and deletes quiz evidence with the quiz", async () => {
    const h = makeQuizHarness();
    await seedChinese(h);
    const view = await readyQuiz(h);
    const [cloze, mc, ordering] = view.questions;
    await h.quizzes.answerQuestion(view.id, cloze.id, "也", null);
    await h.quizzes.answerQuestion(view.id, mc.id, "还", null);
    await h.quizzes.answerQuestion(view.id, ordering.id, "", null, { reveal: true });
    await h.quizzes.finishQuiz(view.id);
    const calls = h.faux.state.callCount;

    const retry = await h.quizzes.retryMistakes(view.id);
    assert.equal(h.faux.state.callCount, calls);
    assert.equal(retry.status, "ready");
    assert.equal(retry.retryOf, view.id);
    assert.equal(retry.title, "Retry · Grammar · my mistakes");
    assert.deepEqual(retry.questions.map((q) => q.format), ["cloze", "ordering"]);
    assert.ok(retry.questions.every((q) => !q.answered && q.id.startsWith(retry.id)));

    // Earlier wrong quiz answers count as mistakes for the next quiz.
    const opts = await h.quizzes.quizOptions("zh");
    assert.equal(opts.counts.mistakes, 2, "1 correction + 1 wrong quiz answer (revealed ones excluded)");

    assert.equal((await h.records.listObservations({ language: "zh" })).length, 2);
    await h.quizzes.deleteQuiz(view.id);
    assert.equal(await h.quizzes.getQuiz(view.id), null);
    assert.equal((await h.records.listObservations({ language: "zh" })).length, 0);
    assert.equal((await h.quizzes.listQuizzes("zh")).length, 1);
    await assert.rejects(h.quizzes.retryMistakes(retry.id), /No mistakes/);
  });
});

describe("QuizService: options and estimates", () => {
  it("counts sources locally and estimates length, minutes and provenance", async () => {
    const h = makeQuizHarness();
    await seedChinese(h);
    h.anki.cards = [
      { cardId: 1, noteId: 1, deck: "HSK", word: "推荐", reading: "tuījiàn", meaning: "to recommend", interval: 3, ease: 2100, lapses: 4, reps: 9, lastReviewAt: h.clock.t - 86400000, lastEase: 1, stage: "review", status: "review", recentReviews: 6, recentFails: 4 },
      { cardId: 2, noteId: 2, deck: "HSK", word: "排队", reading: "páiduì", meaning: "to queue", interval: 30, ease: 2600, lapses: 0, reps: 9, lastReviewAt: h.clock.t - 30 * 86400000, stage: "review", status: "review", mature: true },
    ];
    await h.records.saveWord({ language: "zh", word: "风景", sentence: "山上的风景特别美。", source: { kind: "session", sessionId: "s", messageId: "m" } });
    await h.records.recordLevel({ language: "zh", skill: "writing", level: "HSK 3", confidence: "high", evidence: "", examples: [], at: 1, by: "observed" });
    const o = await h.quizzes.quizOptions("zh");
    assert.equal(o.counts.mistakes, 1);
    assert.equal(o.counts.ankiRecent, 1);
    assert.equal(o.counts.ankiAll, 2);
    assert.equal(o.counts.savedWords, 1);
    assert.equal(o.counts.grammar, 2);
    assert.equal(o.currentLevel, "HSK 3");
    assert.deepEqual(o.exams.map((e) => e.exam), ["hsk2", "hsk3"]);

    const e = await h.quizzes.estimateQuiz(grammarSpec({ format: "multiple_choice", length: { minutes: 5 } }));
    assert.equal(e.questions, 10);
    assert.equal(e.minutes, 5);
    assert.equal(e.alignment, "your level (HSK 3)");
    const exam = await h.quizzes.estimateQuiz(grammarSpec({ level: { kind: "exam", exam: "hsk2", level: "HSK 4" } }));
    assert.equal(exam.provenance, "Generated in HSK 4 style (HSK 2.0 levels). Not official exam material.");
    assert.equal(exam.exam, "hsk2");
  });

  it("vocabulary quizzes from Anki put the words in the prompt", async () => {
    const h = makeQuizHarness();
    h.anki.cards = [{ cardId: 1, noteId: 1, deck: "HSK", word: "推荐", reading: "tuījiàn", meaning: "to recommend", interval: 3, ease: 2100, lapses: 4, reps: 9, lastReviewAt: h.clock.t - 86400000, lastEase: 1 }];
    let prompt = "";
    h.faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context.messages.at(-1)?.content);
        return fauxAssistantMessage(
          JSON.stringify({
            items: [1, 2, 3].map((slot) => ({ slot, format: "multiple_choice", text: `推荐 means? (${slot})`, choices: ["to recommend", "to queue", "roast duck", "scenery"], answer: "to recommend", explanation: "推荐 tuījiàn.", word: "推荐" })),
          }),
        );
      },
    ]);
    const started = await h.quizzes.startQuiz({ language: "zh", focus: "vocabulary", sources: [{ kind: "anki", anki: "recent" }], level: { kind: "exam", exam: "hsk3", level: "HSK 4" }, format: "multiple_choice", length: { questions: 3 } }, h.ref);
    const v = (await h.quizzes.whenGenerated(started.id))!;
    assert.equal(v.status, "ready");
    assert.match(prompt, /推荐/);
    assert.match(prompt, /HSK 4 \(HSK 3.0\)/);
    assert.equal(v.title, "HSK 4 style · multiple choice");
    assert.equal(v.alignment, "HSK 4 (HSK 3.0)");
    assert.equal(v.questions[0].word, "推荐");
  });
});

describe("grammar state rules with quiz evidence (S2-09)", () => {
  const point: GrammarPoint = { id: "zh:x", language: "zh", pattern: "x", name: "x", explanation: "", examples: [], sources: [], createdAt: 0, updatedAt: 0 };
  const ob = (over: Partial<GrammarObservation>): GrammarObservation => ({
    id: Math.random().toString(36),
    grammarId: "zh:x",
    language: "zh",
    sessionId: "s1",
    messageId: "m",
    span: "x",
    verdict: "correct",
    assistance: "independent",
    at: 1,
    ...over,
  });

  it("quiz successes never upgrade to independent, even if marked independent", () => {
    const s = summarizeGrammar(point, [ob({ origin: "quiz", sessionId: "quiz:q1" }), ob({ sessionId: "quiz:q2", at: 5 })]);
    assert.equal(s.state, "with_help");
    assert.deepEqual(s.counts, { correct: 0, incorrect: 0, uncertain: 0, unassessed: 0 });
    assert.equal(s.quiz?.counts.correct, 2);
    assert.equal(s.quiz?.lastAt, 5);
  });

  it("conversation use still makes a point independent; quiz misses don't change it", () => {
    const s = summarizeGrammar(point, [ob({ at: 2 }), ob({ origin: "quiz", sessionId: "quiz:q", verdict: "incorrect", at: 9 })]);
    assert.equal(s.state, "independent");
    assert.equal(s.rate, 1);
    assert.equal(s.lastUsedAt, 2);
    assert.equal(s.quiz?.rate, 0);
  });

  it("no quiz evidence: summary has no quiz field (shape unchanged)", () => {
    assert.equal("quiz" in summarizeGrammar(point, [ob({})]), false);
  });
});
