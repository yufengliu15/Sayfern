import assert from "node:assert/strict";
import test from "node:test";
import { lemmatize } from "./lemma";
import { COMMON_WORDS } from "./common-words";
import { keepTarget, KoreanPack, SpacedPack, VietnamesePack, type WordIndex } from "./spaced";
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

/** A Spanish dictionary with English glosses: headwords, and the words its glosses use. */
function bilingual(heads: Record<string, string>): WordIndex {
  const glosses = new Map(Object.entries(heads).map(([h, g]) => [h, g.toLowerCase().split(/\W+/).filter(Boolean)]));
  const glossWords = new Set([...glosses.values()].flat());
  return {
    hasIndex: () => true,
    load: async () => undefined,
    has: (w) => glosses.has(w),
    ownWord: (w) => glossWords.has(w) || COMMON_WORDS.en.has(w),
    glossWordsOf: (w) => glosses.get(w) ?? [],
    ownLanguage: () => "en",
  };
}

test("learner words: the learner's own language never counts (dictionary)", async () => {
  const es = new SpacedPack(
    "es",
    bilingual({ querer: "want, love", café: "coffee", hotel: "hotel", chocolate: "chocolate", a: "to", no: "no, not", me: "me", i: "i", playa: "beach", ir: "go", hacer: "do, make" }),
  );
  await es.ready();
  // Own language only: dropped. Shared with the same meaning (hotel): counts. Target only: counts.
  assert.deepEqual(es.learnerWords("I want coffee"), []);
  // "hotel" is Spanish too, with the same meaning, so it counts even inside an English sentence.
  assert.deepEqual(es.learnerWords("Quiero un hotel. I want a hotel near the airport."), ["querer", "un", "hotel", "hotel"]);
  assert.deepEqual(es.learnerWords("No me gusta el chocolate."), ["no", "me", "gusta", "el", "chocolate"]);
  // Unclear words (in both with another meaning, or in neither) follow their clause.
  assert.deepEqual(es.learnerWords("I said no"), ["no"], "no means no in both languages: it counts; I and said do not");
  assert.deepEqual(es.learnerWords("voy a la playa"), ["ir", "a", "la", "playa"]);
  assert.deepEqual(es.learnerWords("I like the beach, pero hace calor"), ["pero", "hacer", "calor"]);
});

test("learner words: wrong script never counts; built-in lists work without a dictionary", async () => {
  assert.deepEqual(new KoreanPack().learnerWords("I want 안녕하세요"), ["안녕하세요"]);
  assert.deepEqual(new SpacedPack("ru").learnerWords("I want привет"), ["привет"]);
  // No dictionary: the common-word lists of both languages decide.
  const ownEnglish: WordIndex = { hasIndex: () => false, load: async () => undefined, has: () => false, ownWord: (w) => COMMON_WORDS.en.has(w), ownLanguage: () => "en" };
  const es = new SpacedPack("es", ownEnglish);
  assert.deepEqual(es.learnerWords("How do I say I wanted coffee? Quiero café, me llamo Juan."), ["querer", "café", "me", "llamo", "juan"]);
  assert.deepEqual(es.learnerWords("I don't know how to say this"), []);
});

test("keepTarget: unclear words count unless the clause leans to the own language", () => {
  assert.deepEqual(keepTarget(["a", "b"], ["target", "unclear"]), ["a", "b"]);
  assert.deepEqual(keepTarget(["a", "b"], ["own", "unclear"]), []);
  assert.deepEqual(keepTarget(["a", "b", "c"], ["target", "target", "own"]), ["a", "b"]);
  assert.deepEqual(keepTarget(["x"], ["unclear"]), ["x"]);
});
