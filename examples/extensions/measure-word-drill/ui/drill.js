// Pure drill logic: no DOM, no SDK. test.js imports this file.

/** Common nouns and their measure word. */
export const MEASURE_WORDS = {
  书: "本", 杂志: "本", 词典: "本", 本子: "本",
  桌子: "张", 纸: "张", 床: "张", 照片: "张", 票: "张", 地图: "张",
  狗: "只", 猫: "只", 鸟: "只", 手: "只",
  衣服: "件", 事: "件", 毛衣: "件", 衬衫: "件",
  鱼: "条", 裤子: "条", 河: "条", 路: "条", 裙子: "条",
  车: "辆", 自行车: "辆", 汽车: "辆",
  椅子: "把", 雨伞: "把", 伞: "把", 刀: "把", 钥匙: "把",
  电脑: "台", 电视: "台", 冰箱: "台",
  鞋: "双", 筷子: "双", 袜子: "双",
  公司: "家", 饭馆: "家", 商店: "家", 医院: "家",
  咖啡: "杯", 茶: "杯", 水: "杯",
  人: "个", 苹果: "个", 问题: "个",
};

/** One-line reason per measure word, for feedback. */
export const WHY = {
  本: "bound things like books",
  张: "flat things like tables, paper and photos",
  只: "many animals, and one of a pair",
  件: "clothes on the upper body, and matters",
  条: "long, thin things like fish, roads and trousers",
  辆: "vehicles",
  把: "things you hold by a handle",
  台: "machines",
  双: "pairs",
  家: "businesses and institutions",
  杯: "cups of a drink",
  个: "people and many everyday things",
};

const FALLBACK = ["书", "桌子", "狗", "衣服", "鱼", "自行车", "雨伞", "电脑", "鞋", "咖啡", "照片", "公司"];

/** Small seeded random generator, so a round can be replayed in tests. */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rand) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Nouns to drill: Anki words we know a measure word for (hardest first), topped up with common
 * nouns when the deck has fewer than `min`. Returns { nouns, fromAnki } where fromAnki counts deck words.
 */
export function pickNouns(ankiWords, max = 10, min = 4) {
  const seen = new Set();
  const nouns = [];
  const sorted = (ankiWords || []).slice().sort((a, b) => (b.struggle || 0) - (a.struggle || 0));
  for (const w of sorted) {
    if (!w || typeof w.word !== "string" || !MEASURE_WORDS[w.word] || seen.has(w.word)) continue;
    seen.add(w.word);
    nouns.push({ word: w.word, reading: w.reading || "" });
  }
  const fromAnki = nouns.length;
  if (nouns.length < min) {
    for (const word of FALLBACK) {
      if (nouns.length >= max) break;
      if (!seen.has(word)) {
        seen.add(word);
        nouns.push({ word, reading: "" });
      }
    }
  }
  return { nouns: nouns.slice(0, max), fromAnki: Math.min(fromAnki, max) };
}

/** A question: the noun, its measure word and four shuffled choices (the answer plus three others). */
export function makeQuestion(noun, rand) {
  const answer = MEASURE_WORDS[noun.word];
  if (!answer) throw new Error(`No measure word for ${noun.word}`);
  const others = shuffle([...new Set(Object.values(MEASURE_WORDS))].filter((m) => m !== answer), rand).slice(0, 3);
  return { noun: noun.word, reading: noun.reading, answer, choices: shuffle([answer, ...others], rand) };
}

export function makeRound(nouns, rand, count = 10) {
  return shuffle(nouns, rand).slice(0, count).map((n) => makeQuestion(n, rand));
}

export function check(question, choice) {
  const correct = choice === question.answer;
  const why = WHY[question.answer] ? ` ${question.answer} is for ${WHY[question.answer]}.` : "";
  return {
    correct,
    feedback: correct ? `Right.${why}` : `Not quite. ${question.noun} takes ${question.answer}.${why}`,
  };
}

/** Score of a finished round, counted from the answers. */
export function score(answers) {
  const right = answers.filter((a) => a.correct).length;
  return { right, total: answers.length };
}
