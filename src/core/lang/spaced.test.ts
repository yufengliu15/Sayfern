import assert from "node:assert/strict";
import test from "node:test";
import { lemmatize } from "./lemma";
import { KoreanPack, SpacedPack, VietnamesePack, type WordIndex } from "./spaced";
import { mergeRows, parseKaikki, parseKengdic, wikdictRows } from "./wordlists";

function index(words: string[]): WordIndex {
  const set = new Set(words);
  return { hasIndex: () => true, load: async () => undefined, has: (w) => set.has(w) };
}

test("lemma: irregular forms resolve without a dictionary", () => {
  assert.equal(lemmatize("en", "went"), "go");
  assert.equal(lemmatize("es", "fue"), "ser");
  assert.equal(lemmatize("fr", "suis"), "être");
  assert.equal(lemmatize("de", "bin"), "sein");
  assert.equal(lemmatize("ru", "шла"), "идти");
  assert.equal(lemmatize("es", "casa"), undefined);
});

test("lemma: suffix rules are checked against the dictionary", () => {
  const has = (words: string[]) => (w: string) => words.includes(w);
  assert.equal(lemmatize("es", "hablé", has(["hablar"])), "hablar");
  assert.equal(lemmatize("es", "puedo", has(["poder"])), "poder");
  assert.equal(lemmatize("en", "stopped", has(["stop"])), "stop");
  assert.equal(lemmatize("en", "cities", has(["city"])), "city");
  assert.equal(lemmatize("fr", "parlons", has(["parler"])), "parler");
  assert.equal(lemmatize("it", "parliamo", has(["parlare"])), "parlare");
  assert.equal(lemmatize("pt", "falamos", has(["falar"])), "falar");
  assert.equal(lemmatize("de", "Tische", has(["Tisch"])), "Tisch");
  assert.equal(lemmatize("de", "Bücher", has(["Buch"])), "Buch");
  assert.equal(lemmatize("de", "gemacht", has(["machen"])), "machen");
  assert.equal(lemmatize("ru", "говорила", has(["говорить"])), "говорить");
  assert.equal(lemmatize("ru", "книги", has(["книга"])), "книга");
  assert.equal(lemmatize("ru", "учился", has(["учиться"])), "учиться");
  assert.equal(lemmatize("ko", "학교에", has(["학교"])), "학교");
  assert.equal(lemmatize("ko", "먹었어요", has(["먹다"])), "먹다");
  assert.equal(lemmatize("ko", "공부해요", has(["공부하다"])), "공부하다");
  // The word itself is a headword: nothing to change. A guess the dictionary doesn't know is never returned.
  assert.equal(lemmatize("es", "casa", has(["casa"])), undefined);
  assert.equal(lemmatize("es", "xyzzé", has(["hablar"])), undefined);
});

test("SpacedPack: words, punctuation, elision, lemmas and learner words", async () => {
  const fr = new SpacedPack("fr", index(["homme", "aimer", "le"]));
  await fr.ready();
  const toks = fr.segment("L’homme aime Paris.");
  assert.deepEqual(
    toks.map((t) => [t.text, t.isWord]),
    [
      ["L’", true],
      ["homme", true],
      [" ", false],
      ["aime", true],
      [" ", false],
      ["Paris", true],
      [".", false],
    ],
  );
  assert.equal(toks.find((t) => t.text === "aime")?.lemma, "aimer");
  assert.equal(toks.map((t) => t.text).join(""), "L’homme aime Paris.");
  assert.deepEqual(fr.learnerWords("L’homme aime Paris."), ["le", "homme", "aimer", "paris"]);
  assert.equal(fr.normalize("C'est ÇA !"), fr.normalize("c est ça"));

  const en = new SpacedPack("en");
  assert.equal(en.segment("3.5 cats")[0].isWord, false);
  assert.match(en.promptNotes(), /CEFR/);
});

test("KoreanPack and VietnamesePack", async () => {
  const ko = new KoreanPack(index(["학교", "가다"]));
  const toks = ko.segment("학교에 가요");
  assert.equal(toks[0].lemma, "학교");
  assert.equal(toks[2].lemma, "가다");
  assert.match(ko.promptNotes(), /TOPIK/);

  const vi = new VietnamesePack(index(["học sinh", "tiếng Việt"]));
  const words = vi.segment("Tôi là học sinh, tôi học tiếng Việt.").filter((t) => t.isWord).map((t) => t.text);
  assert.deepEqual(words, ["Tôi", "là", "học sinh", "tôi", "học", "tiếng Việt"]);
  const plain = new VietnamesePack();
  assert.equal(plain.segment("học sinh").filter((t) => t.isWord).length, 2);
});

test("wordlists: WikDict, Kengdic and kaikki rows", () => {
  const w = wikdictRows([
    { written_rep: "casa", trans_list: "house | home", importance: 5 },
    { written_rep: "casa", trans_list: "home | house", importance: 4 },
    { written_rep: '"[[cuantos más, mejor]]"', trans_list: "the more the merrier", importance: 0.1 },
  ]);
  assert.deepEqual(w[0], ["casa", "", [[["house", "home"], []], [["home", "house"], []]], 5]);
  assert.equal(w[1][0], "cuantos más, mejor");

  const k = parseKengdic("id\tsurface\thanja\tgloss\n1\t학교\t學校\tschool\n2\t학교\t\tacademy; college\n");
  assert.deepEqual(k, [["학교", "", [[["school"], ["學校"]], [["academy", "college"], []]], 1]]);

  const v = parseKaikki(
    [
      JSON.stringify({ word: "học sinh", pos: "noun", lang_code: "vi", senses: [{ glosses: ["pupil", "student"] }] }),
      JSON.stringify({ word: "chó", pos: "noun", lang_code: "vi", senses: [{ glosses: ["dog"] }] }),
      "not json",
      JSON.stringify({ word: "dog", pos: "noun", lang_code: "en", senses: [{ glosses: ["chó"] }] }),
    ].join("\n"),
    "vi",
  );
  assert.deepEqual(
    v.map((r) => [r[0], r[2][0][0][0]]),
    [
      ["học sinh", "student"],
      ["chó", "dog"],
    ],
  );
  assert.equal(mergeRows([["a", "", [[["x"], []]], 1], ["a", "", [[["x"], []]], 2]])[0][3], 2);
});

test("wordlists: WikDict gloss markup is cleaned", async () => {
  const { cleanGloss } = await import("./wordlists");
  assert.equal(cleanGloss("B<u>ü</u>cher"), "Bücher");
  assert.equal(cleanGloss("Buch  - s"), "Buch");
  assert.equal(cleanGloss("[[es geht]] um"), "es geht um");
});
