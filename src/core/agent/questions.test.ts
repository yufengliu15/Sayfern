import { test } from "node:test";
import assert from "node:assert/strict";
import { CEFR_LEVELS, HSK_LEVELS, JLPT_LEVELS } from "../../shared/languages";
import { pickQuestion, questionLevel, TOPIC_QUESTIONS } from "./questions";

const at = (id: number) => CEFR_LEVELS.indexOf(TOPIC_QUESTIONS.find((q) => q.id === id)!.level);

test("questions: unique ids, every level used", () => {
  assert.equal(new Set(TOPIC_QUESTIONS.map((q) => q.id)).size, TOPIC_QUESTIONS.length);
  for (const level of CEFR_LEVELS) assert.ok(TOPIC_QUESTIONS.some((q) => q.level === level), level);
});

test("questionLevel maps each scale onto A1..C2, A2 when unknown", () => {
  assert.equal(questionLevel(CEFR_LEVELS, "B2"), 3);
  assert.equal(questionLevel(HSK_LEVELS, "HSK 1"), 0);
  assert.equal(questionLevel(HSK_LEVELS, "HSK 7-9"), 5);
  assert.equal(questionLevel(JLPT_LEVELS, "N3"), 3);
  assert.equal(questionLevel(JLPT_LEVELS, undefined), 1);
});

test("pickQuestion: at most two levels above, harder drops lower ones, easier lowers the ceiling", () => {
  for (let i = 0; i < 200; i++) {
    const random = () => i / 200;
    assert.ok(at(pickQuestion({ level: 0, asked: new Set(), random }).id) <= 2);
    assert.ok(at(pickQuestion({ level: 1, difficulty: -2, asked: new Set(), random }).id) <= 1);
    assert.ok(at(pickQuestion({ level: 2, difficulty: 1, asked: new Set(), random }).id) >= 2);
  }
});

test("pickQuestion skips asked questions until none are left", () => {
  const fits = TOPIC_QUESTIONS.filter((q) => q.level === "A1" || q.level === "A2" || q.level === "B1").map((q) => q.id);
  const asked = new Set(fits.slice(1));
  assert.equal(pickQuestion({ level: 0, asked, random: () => 0.99 }).id, fits[0]);
  assert.ok(fits.includes(pickQuestion({ level: 0, asked: new Set(fits), random: Math.random }).id));
});
