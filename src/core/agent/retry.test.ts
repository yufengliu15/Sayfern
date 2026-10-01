import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { localRetryCheck, parseRetryJson } from "./retry";
import { makeHarness } from "./testkit";

const abort = () => new AbortController().signal;

async function withCorrection(grammarId?: string) {
  const h = makeHarness();
  const sid = await h.newSession();
  h.faux.setResponses([
    fauxAssistantMessage(
      [
        fauxText("你和谁一起去的？"),
        fauxToolCall("record_evidence", {
          corrections: [
            { original: "我去了北京昨天", corrected: "我昨天去了北京", explanation: "Time before the verb.", kind: "grammar", ...(grammarId ? { grammar_id: grammarId } : {}) },
          ],
        }),
      ],
      { stopReason: "toolUse" },
    ),
  ]);
  await h.tutor.runTurn({ sessionId: sid, text: "我去了北京昨天。", model: h.model, signal: abort(), onEvent: () => {} });
  const [c] = await h.records.listCorrections({ language: "zh", sessionId: sid });
  return { h, sid, c };
}

test("localRetryCheck and parseRetryJson", () => {
  const n = (s: string) => s.replace(/[\s，。！？,.!?]/g, "");
  assert.equal(localRetryCheck({ original: "我去了北京昨天", corrected: "我昨天去了北京" }, "我昨天去了北京。", n), true);
  assert.equal(localRetryCheck({ original: "我去了北京昨天", corrected: "我昨天去了北京" }, "我昨天去北京了", n), null);
  // corrected contains original: still ok once the corrected text is removed
  assert.equal(localRetryCheck({ original: "去", corrected: "去了" }, "我去了", n), true);
  assert.deepEqual(parseRetryJson('```json\n{"ok": true, "feedback": "Good."}\n```'), { ok: true, feedback: "Good." });
  assert.deepEqual(parseRetryJson('Sure: {"ok": false, "feedback": "Check word order."} thanks'), { ok: false, feedback: "Check word order." });
  assert.deepEqual(parseRetryJson('ok: false'), { ok: false, feedback: "" });
  assert.equal(parseRetryJson("no idea"), null);
});

test("checkRetry: local path needs no model call and records a corrected_retry observation", async () => {
  const { h, c } = await withCorrection("zh:time-before-verb");
  const calls = h.faux.state.callCount;
  const r = await h.tutor.checkRetry(c.id, "我昨天去了北京。", h.model);
  assert.equal(r.ok, true);
  assert.equal(h.faux.state.callCount, calls);
  assert.equal(r.correction.status, "retried_ok");
  assert.equal(r.correction.retries.length, 1);
  const obs = await h.records.listObservations({ language: "zh", grammarId: "zh:time-before-verb" });
  assert.equal(obs.length, 1);
  assert.equal(obs[0].assistance, "corrected_retry");
  assert.equal(obs[0].messageId, `${c.messageId}:retry1`);
});

test("checkRetry: model path parses JSON; wrong retries never reveal the answer", async () => {
  const { h, c } = await withCorrection("zh:time-before-verb");
  h.faux.setResponses([fauxAssistantMessage('{"ok": true, "feedback": "Yes, that word order works."}')]);
  const r1 = await h.tutor.checkRetry(c.id, "昨天我去了北京", h.model);
  assert.equal(r1.ok, true);
  assert.equal(r1.feedback, "Yes, that word order works.");

  h.faux.setResponses([fauxAssistantMessage('{"ok": false, "feedback": "Try: 我昨天去了北京"}')]);
  const r2 = await h.tutor.checkRetry(c.id, "我去北京昨天", h.model);
  assert.equal(r2.ok, false);
  assert.doesNotMatch(r2.feedback, /我昨天去了北京/);
  assert.equal(r2.correction.status, "retried_wrong");
  assert.deepEqual(r2.correction.retries.map((x) => x.ok), [true, false]);
  const obs = await h.records.listObservations({ language: "zh", grammarId: "zh:time-before-verb" });
  assert.deepEqual(obs.map((o) => [o.messageId.split(":").pop(), o.verdict]), [["retry1", "correct"], ["retry2", "incorrect"]]);
});

test("translate caches the translation on the message", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  h.faux.setResponses([fauxAssistantMessage("你好！"), fauxAssistantMessage("Hello!")]);
  const reply = await h.tutor.runTurn({ sessionId: sid, text: "hi", model: h.model, signal: abort(), onEvent: () => {} });
  assert.equal(await h.tutor.translate(sid, reply.id, h.model), "Hello!");
  assert.equal(h.faux.state.callCount, 2);
  assert.equal(await h.tutor.translate(sid, reply.id, h.model), "Hello!");
  assert.equal(h.faux.state.callCount, 2);
  const msgs = await h.records.getMessages(sid);
  assert.equal(msgs[1].translation, "Hello!");
});

test("endSession summarizes corrections, grammar, new words and targets", async () => {
  const h = makeHarness();
  // A word first used in an earlier session is not "new" here.
  const earlier = await h.newSession();
  h.faux.setResponses([fauxAssistantMessage("好。")]);
  await h.tutor.runTurn({ sessionId: earlier, text: "我", model: h.model, signal: abort(), onEvent: () => {} });

  const sid = await h.newSession();
  await h.records.setTargets(sid, [{ word: "猫", reason: "recent", status: "pending" }]);
  h.faux.setResponses([
    fauxAssistantMessage(
      [
        fauxText("你和谁一起去的？"),
        fauxToolCall("record_evidence", {
          corrections: [{ original: "我去了北京昨天", corrected: "我昨天去了北京", explanation: "Time before the verb.", kind: "grammar" }],
          observations: [{ grammar_id: "zh:le", pattern: "了", name: "completed 了", span: "去了", verdict: "correct", assistance: "independent" }],
        }),
      ],
      { stopReason: "toolUse" },
    ),
  ]);
  await h.tutor.runTurn({ sessionId: sid, text: "我去了北京昨天。", model: h.model, signal: abort(), onEvent: () => {} });
  h.clock.t += 60_000;
  const s = await h.tutor.endSession(sid);
  assert.equal(s.session.endedAt, h.clock.t);
  assert.equal(s.corrections.length, 1);
  assert.equal(s.grammar.length, 1);
  assert.equal(s.grammar[0].summary.point.id, "zh:le");
  assert.equal(s.grammar[0].observations.length, 1);
  assert.ok(s.newWords.length > 0);
  assert.ok(s.newWords.every((w) => w.firstSessionId === sid));
  assert.ok(!s.newWords.some((w) => w.word === "我"));
  assert.deepEqual(s.targets.map((t) => t.word), ["猫"]);
});
