import assert from "node:assert/strict";
import { before, test } from "node:test";
import { JapanesePack } from "./ja";
import { assertCovers, SAMPLES } from "./testutil";

const pack = new JapanesePack();
before(() => pack.ready());

test("ja: segment before ready() throws a clear error", () => {
  assert.throws(() => new JapanesePack().segment("日本"), /ready\(\)/);
});

test("ja: ready() is cached", () => {
  assert.equal(pack.ready(), pack.ready());
});

test("ja: tokens cover input exactly", () => {
  for (const s of SAMPLES) assertCovers(s, pack.segment(s));
});

test("ja: hiragana readings, omitted for kana-only words", () => {
  const tokens = pack.segment("大きな桃");
  assert.deepEqual(
    tokens.map((t) => [t.text, t.reading]),
    [
      ["大きな", "おおきな"],
      ["桃", "もも"],
    ],
  );
  const kana = pack.segment("コーヒーをのむ");
  assert.ok(kana.every((t) => t.reading === undefined));
});

test("ja: verb + auxiliaries merged, lemma is dictionary form", () => {
  const tokens = pack.segment("大きな桃が流れてきました。");
  assert.deepEqual(tokens.map((t) => t.text), ["大きな", "桃", "が", "流れてきました", "。"]);
  const verb = tokens[3];
  assert.equal(verb.lemma, "流れる");
  assert.equal(verb.reading, "ながれてきました");
  assert.equal(verb.isWord, true);
  assert.equal(tokens[4].isWord, false);
  const t2 = pack.segment("本を読んでいた");
  assert.deepEqual(t2.map((t) => t.text), ["本", "を", "読んでいた"]);
  assert.equal(t2[2].lemma, "読む");
  const t3 = pack.segment("食べたくない");
  assert.equal(t3.length, 1);
  assert.equal(t3[0].lemma, "食べる");
});

test("ja: punctuation, numbers, latin are non-words", () => {
  const tokens = pack.segment("ABC 123、東京");
  const words = tokens.filter((t) => t.isWord).map((t) => t.text);
  assert.deepEqual(words, ["東京"]);
});

test("ja: learnerWords are lemmas of content words only", () => {
  const words = pack.learnerWords("私は静かな部屋で本を3冊読んでいました。");
  assert.deepEqual(words, ["私", "静か", "部屋", "本", "読む"]);
  for (const particle of ["は", "で", "を", "な", "いる", "ます", "た", "3", "。"]) assert.ok(!words.includes(particle), particle);
});

test("ja: normalize and info", () => {
  assert.equal(pack.normalize("「こんにちは」、 世界！"), "こんにちは世界");
  assert.equal(pack.info.nativeName, "日本語");
  assert.deepEqual(pack.info.levels, ["N5", "N4", "N3", "N2", "N1"]);
  assert.match(pack.promptNotes(), /JLPT/);
});
