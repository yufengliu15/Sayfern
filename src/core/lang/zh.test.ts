import assert from "node:assert/strict";
import { test } from "node:test";
import { assertCovers, SAMPLES } from "./testutil";
import { ChinesePack } from "./zh";

function fakeDict(words: string[]) {
  const set = new Set(words);
  return {
    longestMatch(text: string, index: number) {
      for (let len = Math.min(8, text.length - index); len >= 1; len--) if (set.has(text.slice(index, index + len))) return len;
      return 0;
    },
  };
}

test("zh: tokens cover input exactly (segmenter and dictionary modes)", async () => {
  const packs = [new ChinesePack(), new ChinesePack({ dictionary: fakeDict(["今天", "北京", "烤鸭", "北京烤鸭", "除了", "喜欢"]) })];
  for (const pack of packs) {
    await pack.ready();
    for (const s of SAMPLES) assertCovers(s, pack.segment(s));
  }
});

test("zh: non-Han runs are non-words; latin words are single tokens", () => {
  const tokens = new ChinesePack().segment("Hello 世界, ok!");
  assert.deepEqual(
    tokens.filter((t) => !t.isWord).map((t) => t.text),
    ["Hello", " ", ",", " ", "ok", "!"],
  );
  assert.ok(tokens.filter((t) => t.isWord).every((t) => /\p{Script=Han}/u.test(t.text)));
});

test("zh: pinyin readings with tone marks, joined, context aware", () => {
  const pack = new ChinesePack();
  const reading = (text: string, word: string) => pack.segment(text).find((t) => t.text === word)?.reading;
  assert.equal(reading("烤鸭", "烤鸭"), "kǎoyā");
  assert.equal(reading("除了", "除了"), "chúle");
  const standalone = pack.segment("了")[0].reading;
  assert.ok(standalone === "le" || standalone === "liǎo", standalone);
  // In context: 吃了 → le, whether 了 is its own token or part of 吃了.
  const dictPack = new ChinesePack({ dictionary: fakeDict(["吃", "了", "饭"]) });
  const toks = dictPack.segment("我吃了饭");
  assert.deepEqual(toks.map((t) => t.text), ["我", "吃", "了", "饭"]);
  assert.equal(toks[2].reading, "le");
  assert.equal(reading("我吃了", "吃了"), "chīle"); // Intl.Segmenter keeps 吃了 together
  // No readings on non-words.
  assert.ok(pack.segment("abc，123").every((t) => t.reading === undefined));
});

test("zh: forward maximum matching with a dictionary", () => {
  const pack = new ChinesePack({ dictionary: fakeDict(["北京", "烤鸭", "北京烤鸭", "今天", "我们", "研究", "研究生", "生命", "起源"]) });
  assert.deepEqual(pack.segment("我们今天吃北京烤鸭").map((t) => t.text), ["我们", "今天", "吃", "北京烤鸭"]);
  assert.deepEqual(pack.segment("研究生命起源").map((t) => t.text), ["研究生", "命", "起源"]); // FMM is greedy
  assert.equal(pack.segment("北京烤鸭")[0].reading, "běijīngkǎoyā");
});

test("zh: dictionary not loaded yet → Intl.Segmenter fallback", () => {
  const dict = { ...fakeDict(["北京烤鸭"]), hasIndex: () => false };
  const tokens = new ChinesePack({ dictionary: dict }).segment("北京烤鸭");
  assert.ok(tokens.length >= 1);
  assertCovers("北京烤鸭", tokens);
});

test("zh: learnerWords and normalize", () => {
  const pack = new ChinesePack({ dictionary: fakeDict(["今天", "烤鸭", "好吃"]) });
  assert.deepEqual(pack.learnerWords("今天，烤鸭 very 好吃！"), ["今天", "烤鸭", "好吃"]);
  assert.equal(pack.normalize(" 你好，世界！ Ｈｉ. "), "你好世界Hi");
  assert.equal(pack.normalize("「我」、（你）。"), "我你");
  assert.match(pack.promptNotes(), /simplified/);
  assert.match(pack.promptNotes(), /HSK/);
  assert.equal(pack.info.levels.length, 7);
});
