// Tests run in a sandbox with test(), assert and a fake window.sayfern (sample learner data).
import { MEASURE_WORDS, WHY, check, makeQuestion, makeRound, pickNouns, random, score, shuffle } from "./ui/drill.js";

test("every measure word has an explanation", () => {
  assert.ok(Object.keys(MEASURE_WORDS).length >= 30);
  for (const m of new Set(Object.values(MEASURE_WORDS))) assert.ok(WHY[m], `no explanation for ${m}`);
});

test("random is repeatable for the same seed", () => {
  const a = random(42), b = random(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("shuffle keeps every item", () => {
  const list = ["本", "张", "只", "条"];
  assert.deepEqual(shuffle(list, random(1)).slice().sort(), list.slice().sort());
});

test("pickNouns keeps only Anki words with a known measure word", () => {
  const { nouns, fromAnki } = pickNouns([{ word: "书" }, { word: "打算" }, { word: "狗" }, { word: "桌子" }, { word: "鱼" }]);
  assert.deepEqual(nouns.map((n) => n.word).sort(), ["书", "桌子", "狗", "鱼"].sort());
  assert.equal(fromAnki, 4);
});

test("pickNouns puts the hardest words first", () => {
  const { nouns } = pickNouns([{ word: "书", struggle: 0.1 }, { word: "衣服", struggle: 0.6 }, { word: "狗", struggle: 0.3 }, { word: "鱼", struggle: 0.2 }]);
  assert.equal(nouns[0].word, "衣服");
});

test("pickNouns tops up a small deck with common nouns", () => {
  const { nouns, fromAnki } = pickNouns([{ word: "书" }], 10);
  assert.equal(fromAnki, 1);
  assert.ok(nouns.length >= 4);
  assert.equal(new Set(nouns.map((n) => n.word)).size, nouns.length, "no duplicates");
});

test("pickNouns handles an empty or missing deck", () => {
  assert.ok(pickNouns([]).nouns.length >= 4);
  assert.ok(pickNouns(undefined).nouns.length >= 4);
});

test("a question has four different choices including the answer", () => {
  const q = makeQuestion({ word: "书", reading: "shū" }, random(7));
  assert.equal(q.answer, "本");
  assert.equal(q.choices.length, 4);
  assert.equal(new Set(q.choices).size, 4);
  assert.ok(q.choices.includes("本"));
});

test("makeQuestion refuses a noun it doesn't know", () => {
  assert.throws(() => makeQuestion({ word: "打算" }, random(1)));
});

test("check explains right and wrong answers", () => {
  const q = makeQuestion({ word: "鱼" }, random(3));
  assert.equal(check(q, "条").correct, true);
  const wrong = check(q, "张");
  assert.equal(wrong.correct, false);
  assert.ok(wrong.feedback.includes("条"));
});

test("score counts right answers in code", () => {
  assert.deepEqual(score([{ correct: true }, { correct: false }, { correct: true }]), { right: 2, total: 3 });
});

test("a round uses nouns from the learner's Anki (fake SDK)", async () => {
  const page = await sayfern.anki.words({ status: "all", limit: 200 });
  const { nouns, fromAnki } = pickNouns(page.items, 10);
  assert.ok(fromAnki >= 4, `expected Anki nouns, got ${fromAnki}`);
  const round = makeRound(nouns, random(9), 10);
  assert.equal(round.length, nouns.length);
  for (const q of round) assert.equal(MEASURE_WORDS[q.noun], q.answer);
});
