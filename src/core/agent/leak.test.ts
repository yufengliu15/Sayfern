import assert from "node:assert/strict";
import { test } from "node:test";
import { leakedCalls, leakStart, pendingTail, stripLeak } from "./leak";

// What gpt-6.1-sol wrote as its reply (owner screenshot, 2026-10-03).
const ARGS = {
  corrections: [{ original: "我去了北京昨天", corrected: "我昨天去了北京", explanation: "Put the time word 昨天 before the verb, usually after the subject.", kind: "grammar", grammar_id: "zh:time-before-verb" }],
  observations: [{ grammar_id: "zh:time-before-verb", pattern: "主语＋时间＋动词", name: "Time expressions before the verb", span: "我去了北京昨天", verdict: "incorrect", assistance: "independent" }],
};
const SOL = `北京不错！你在北京吃了什么？\n ك<|assistant to=functions.record_evidence قjsonStringify ı${JSON.stringify(ARGS)}ترلfunctions.record_evidence Int64انيةcommentary ɯgnŋRecorded.`;

test("leak: the reply keeps only the learner-facing text", () => {
  assert.ok(leakStart(SOL) > 0);
  assert.equal(stripLeak(SOL), "北京不错！你在北京吃了什么？");
  assert.equal(stripLeak("你好！"), "你好！");
  assert.equal(stripLeak("好的。<|channel|>commentary to=functions.x"), "好的。");
});

test("leak: the written call is salvaged with its arguments", () => {
  const calls = leakedCalls(SOL);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "record_evidence");
  assert.deepEqual(calls[0].args, ARGS);
  assert.deepEqual(leakedCalls('to=functions.record_evidence {"corrections": [ {"original": "a}b"'), [], "unbalanced JSON is dropped");
});

test("leak: the stream holds back what could be the start of a marker", () => {
  assert.equal(pendingTail("你好 <|assi"), 6);
  assert.equal(pendingTail("你好 to=fun"), 6);
  assert.equal(pendingTail("你好！"), 0);
  assert.equal(leakStart("1 < 2 and x=y"), -1);
});
