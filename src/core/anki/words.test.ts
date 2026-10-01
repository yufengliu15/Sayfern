import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AnkiCard, AnkiSnapshot } from "../../shared/records";
import { aggregateWords, checkWordsIn, foldReading, queryWords, STRUGGLE_THRESHOLD, struggleScore } from "./words";

const base = { lapses: 0, recentReviews: 0, recentFails: 0, relearning: false, leech: false };

let id = 1;
function c(word: string, extra: Partial<AnkiCard> = {}): AnkiCard {
  const n = id++;
  return { cardId: n, noteId: n, deck: "D", word, interval: 10, ease: 2500, lapses: 0, reps: 5, status: "review", stage: "review", ...extra };
}
const snap = (cards: AnkiCard[]): AnkiSnapshot => ({ language: "zh", syncedAt: 1, cards, reviewedToday: 0, reviewsLast7d: 0, matureCount: 0 });

describe("struggleScore", () => {
  it("is 0 for a clean record and stays within 0..1 at the extreme", () => {
    assert.deepEqual(struggleScore(base), { score: 0, reasons: [] });
    const worst = struggleScore({ lapses: 40, recentReviews: 50, recentFails: 50, ease: 1300, relearning: true, leech: true, avgAnswerMs: 30_000, medianAnswerMs: 3000 });
    assert.ok(worst.score > 0.99 && worst.score <= 1, `score ${worst.score}`);
    assert.deepEqual(worst.reasons, ["failed 50 of last 50", "40 lapses", "ease 130%", "relearning now", "leech", "slow answers (30 s)"]);
  });

  it("uses a small-sample prior: 1 fail of 1 review is not hard, 6 of 8 is", () => {
    const one = struggleScore({ ...base, recentReviews: 1, recentFails: 1 });
    assert.ok(one.score < STRUGGLE_THRESHOLD / 2, `score ${one.score}`);
    const many = struggleScore({ ...base, recentReviews: 8, recentFails: 6 });
    assert.ok(many.score > one.score * 2);
    assert.deepEqual(many.reasons, ["failed 6 of last 8"]);
    // Plenty of clean reviews pull a single fail back down.
    assert.ok(struggleScore({ ...base, recentReviews: 20, recentFails: 1 }).score < 0.01);
  });

  it("orders typical cases sensibly and explains them", () => {
    const leech = struggleScore({ ...base, lapses: 8, ease: 1500, leech: true, recentReviews: 9, recentFails: 4 });
    const lapsey = struggleScore({ ...base, lapses: 3, ease: 2300 });
    const slow = struggleScore({ ...base, recentReviews: 6, avgAnswerMs: 9000, medianAnswerMs: 3000 });
    const lowEase = struggleScore({ ...base, ease: 1700 });
    assert.ok(leech.score > STRUGGLE_THRESHOLD);
    assert.ok(leech.score > lapsey.score && lapsey.score > lowEase.score && lowEase.score > slow.score);
    assert.deepEqual(leech.reasons, ["8 lapses", "failed 4 of last 9", "ease 150%", "leech"]);
    assert.deepEqual(lapsey.reasons, ["3 lapses"]); // ease 230% too mild to mention
    assert.deepEqual(slow.reasons, ["slow answers (9.0 s)"]);
    // Slow needs 3+ answers and a median.
    assert.equal(struggleScore({ ...base, recentReviews: 2, avgAnswerMs: 9000, medianAnswerMs: 3000 }).score, 0);
  });
});

describe("aggregateWords", () => {
  it("merges recognition and production cards of one word", () => {
    const words = aggregateWords(
      snap([
        c("猫", { reading: "māo", interval: 30, recentReviews: 3, recentFails: 0, avgAnswerMs: 2000, lastReviewAt: 50 }),
        c("猫", { meaning: "cat", interval: 1, lapses: 4, ease: 1600, stage: "learning", status: "learning", relearning: true, recentReviews: 5, recentFails: 3, avgAnswerMs: 6000, lastReviewAt: 90, deck: "D::Prod" }),
      ]),
    );
    assert.equal(words.length, 1);
    const w = words[0];
    assert.deepEqual(
      [w.word, w.reading, w.meaning, w.status, w.mature, w.cards, w.lapses, w.recentReviews, w.recentFails, w.lastReviewAt],
      ["猫", "māo", "cat", "known", true, 2, 4, 8, 3, 90],
    );
    assert.deepEqual(w.decks, ["D", "D::Prod"]);
    assert.ok(w.reasons.includes("relearning now"));
    assert.ok(w.reasons.includes("4 lapses"));
  });

  it("derives word status from card statuses", () => {
    const words = aggregateWords(
      snap([
        c("学", { status: "learning", stage: "learning" }),
        c("学", { status: "new", stage: "new", newPosition: 4 }),
        c("新", { status: "new", stage: "new", newPosition: 9 }),
        c("新", { status: "suspended", stage: "new" }),
        c("停", { status: "suspended", stage: "review" }),
        c("停", { status: "suspended", stage: "learning" }),
        c("埋", { status: "buried", stage: "review" }),
        c("复", { status: "suspended", stage: "review" }),
        c("复", { status: "new", stage: "new", newPosition: 1 }),
      ]),
    );
    const s = Object.fromEntries(words.map((w) => [w.word, w.status]));
    assert.deepEqual(s, { 学: "learning", 新: "new", 停: "suspended", 埋: "known", 复: "new" });
    assert.equal(words.find((w) => w.word === "新")!.newPosition, 9);
    assert.equal(words.find((w) => w.word === "新")!.struggle, 0); // new words never "struggle"
  });

  it("filters by deck including subdecks, and folds readings for search and checks", () => {
    const words = aggregateWords(
      snap([
        c("日本", { deck: "日本語::N5", reading: "ニホン" }),
        c("猫", { deck: "日本語", reading: "ねこ" }),
        c("犬", { deck: "Other", reading: "いぬ" }),
        c("你好", { deck: "日本語x", reading: "nǐ hǎo" }),
      ]),
    );
    assert.deepEqual(queryWords(words, { deck: "日本語" }).items.map((w) => w.word).sort(), ["日本", "猫"].sort());
    assert.deepEqual(queryWords(words, { search: "にほん" }).items.map((w) => w.word), ["日本"]);
    assert.deepEqual(queryWords(words, { search: "nihao" }).items.map((w) => w.word), ["你好"]);
    assert.equal(foldReading("Nǐ Hǎo"), "nihao");
    assert.deepEqual(checkWordsIn(words, ["ねこ", "イヌ", "nǐhǎo", "鳥"]), { ねこ: "known", イヌ: "known", nǐhǎo: "known", 鳥: "unknown" });
  });

  it("caps limits and handles an empty snapshot", () => {
    assert.deepEqual(aggregateWords(null), []);
    const many = aggregateWords(snap(Array.from({ length: 30 }, (_, i) => c(`w${i}`))));
    assert.equal(queryWords(many, {}).items.length, 20);
    assert.equal(queryWords(many, { limit: 5000 }).items.length, 30);
    assert.equal(queryWords(many, { limit: -3 }).items.length, 20);
  });
});
