import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import type { TutorEvent } from "../contracts";
import { makeHarness } from "./testkit";
import { kickoffText, NO_REPLY_YET } from "./turn";
import { SayfernTutor } from "./index";

const abort = () => new AbortController().signal;

const evidence = (args: Record<string, unknown>, id?: string) => fauxToolCall("record_evidence", args as never, id ? { id } : {});

test("plain reply streams deltas and saves both messages and the transcript", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  h.faux.setResponses([fauxAssistantMessage("你好！你今天做了什么？")]);
  const ev = h.events();
  const reply = await h.tutor.runTurn({ sessionId: sid, text: "你好", model: h.model, signal: abort(), onEvent: ev.onEvent });

  assert.equal(reply.error, undefined);
  assert.equal(reply.text, "你好！你今天做了什么？");
  assert.equal(ev.deltas(), reply.text);
  assert.equal(ev.list[0].type, "user_saved");
  assert.equal(reply.model, `${h.model.provider}/${h.model.id}`);
  assert.ok(reply.usage && reply.usage.output > 0);
  assert.equal(h.faux.state.callCount, 1);

  const msgs = await h.records.getMessages(sid);
  assert.deepEqual(msgs.map((m) => [m.role, m.text]), [["user", "你好"], ["tutor", reply.text]]);
  const transcript = await h.records.getTranscript(sid);
  assert.deepEqual(transcript.map((m) => m.role), ["user", "assistant"]);
  const meta = await h.records.getSession(sid);
  assert.ok(meta!.usage.output > 0);
});

test("S1-27: reply text + one record_evidence call makes exactly one model request", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  h.faux.setResponses([
    fauxAssistantMessage(
      [
        fauxText("听起来很好玩！你和谁一起去的？"),
        evidence({
          corrections: [
            { original: "我去了北京昨天", corrected: "我昨天去了北京", explanation: "Time words come before the verb.", kind: "grammar", grammar_id: "zh:time-before-verb" },
          ],
          observations: [
            { grammar_id: "zh:time-before-verb", pattern: "Subj + time + V", name: "time before verb", span: "我去了北京昨天", verdict: "incorrect", assistance: "independent" },
            { grammar_id: "zh:le-completed", pattern: "V + 了", name: "completed action 了", span: "去了", verdict: "correct", assistance: "independent" },
          ],
        }),
      ],
      { stopReason: "toolUse" },
    ),
  ]);
  const ev = h.events();
  const reply = await h.tutor.runTurn({ sessionId: sid, text: "我去了北京昨天。", model: h.model, signal: abort(), onEvent: ev.onEvent });

  assert.equal(h.faux.state.callCount, 1, "no follow-up request after a recording-only call");
  assert.equal(reply.text, "听起来很好玩！你和谁一起去的？");
  assert.equal(reply.error, undefined);

  const corrections = await h.records.listCorrections({ language: "zh", sessionId: sid });
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].original, "我去了北京昨天");
  assert.equal(corrections[0].grammarId, "zh:time-before-verb");
  const correctionEvents = ev.list.filter((e) => e.type === "correction");
  assert.equal(correctionEvents.length, 1);

  const obs = await h.records.listObservations({ language: "zh", sessionId: sid });
  assert.equal(obs.length, 2);
  const user = (await h.records.getMessages(sid))[0];
  assert.ok(obs.every((o) => o.messageId === user.id));
  const point = await h.records.getGrammarPoint("zh:le-completed");
  assert.equal(point?.name, "completed action 了");

  const toolEvents = ev.list.filter((e): e is Extract<TutorEvent, { type: "tool" }> => e.type === "tool");
  assert.equal(toolEvents.length, 1);
  assert.match(toolEvents[0].activity.summary, /Logged 1 correction, 2 observations/);
  assert.deepEqual(reply.toolActivity?.map((a) => a.name), ["record_evidence"]);

  // Transcript ends with the tool result; the next turn's user message follows it directly.
  const t1 = await h.records.getTranscript(sid);
  assert.deepEqual(t1.map((m) => m.role), ["user", "assistant", "toolResult"]);

  let seen: Message[] = [];
  h.faux.setResponses([
    (ctx) => {
      seen = ctx.messages;
      return fauxAssistantMessage("好的！");
    },
  ]);
  await h.tutor.runTurn({ sessionId: sid, text: "和朋友。", model: h.model, signal: abort(), onEvent: () => {} });
  const roles = seen.filter((m) => m.role !== "system").map((m) => m.role);
  assert.deepEqual(roles, ["user", "assistant", "toolResult", "user"]);
  assert.equal(h.faux.state.callCount, 2);
});

test("search_library first: a second request is made and sources are saved", async () => {
  const h = makeHarness();
  const doc = await h.library.importText({
    title: "课本 第三课",
    text: "第一段。\n\n除了苹果，我还喜欢香蕉。\n\n最后一段。",
    language: "zh",
    kind: "textbook",
  });
  const sid = await h.newSession();
  h.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("search_library", { query: "除了" })], { stopReason: "toolUse" }),
    (ctx) => {
      const last = ctx.messages[ctx.messages.length - 1];
      assert.equal(last.role, "toolResult");
      const body = last.role === "toolResult" ? last.content.map((c) => (c.type === "text" ? c.text : "")).join("") : "";
      assert.match(body, new RegExp(`\\[doc ${doc.id} ¶1\\] 课本 第三课`));
      return fauxAssistantMessage("你的课本里有：除了苹果，我还喜欢香蕉。你除了中文还学什么？");
    },
  ]);
  const ev = h.events();
  const reply = await h.tutor.runTurn({ sessionId: sid, text: "“除了”是什么意思？", model: h.model, signal: abort(), onEvent: ev.onEvent });

  assert.equal(h.faux.state.callCount, 2);
  assert.equal(reply.error, undefined);
  assert.equal(reply.sources?.length, 1);
  const src = reply.sources![0];
  assert.equal(src.kind, "library");
  assert.ok(src.kind === "library" && src.docId === doc.id && src.paragraph === 1 && src.title === "课本 第三课" && !!src.quote);
  assert.match(reply.toolActivity![0].summary, /Searched library: 除了/);
  const t = await h.records.getTranscript(sid);
  assert.deepEqual(t.map((m) => m.role), ["user", "assistant", "toolResult", "assistant"]);
});

test("repeated identical record_evidence calls dedupe", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  const args = {
    corrections: [{ original: "很好吃了", corrected: "很好吃", explanation: "No 了 after an adjective here.", kind: "grammar" }],
    observations: [{ grammar_id: "zh:hen-adj", pattern: "很 + adj", name: "很 + adjective", span: "很好吃了", verdict: "incorrect", assistance: "independent" }],
  };
  h.faux.setResponses([
    fauxAssistantMessage([fauxText("是吗？你喜欢吃什么菜？"), evidence(args, "a"), evidence(args, "b")], { stopReason: "toolUse" }),
  ]);
  const ev = h.events();
  await h.tutor.runTurn({ sessionId: sid, text: "饺子很好吃了。", model: h.model, signal: abort(), onEvent: ev.onEvent });

  assert.equal(h.faux.state.callCount, 1);
  assert.equal((await h.records.listObservations({ language: "zh", sessionId: sid })).length, 1);
  assert.equal((await h.records.listCorrections({ language: "zh", sessionId: sid })).length, 1);
  assert.equal(ev.list.filter((e) => e.type === "correction").length, 1);
  const acts = ev.list.filter((e): e is Extract<TutorEvent, { type: "tool" }> => e.type === "tool").map((e) => e.activity.summary);
  assert.equal(acts.length, 2);
  assert.match(acts[1], /Nothing new to log; skipped 1 repeated observation/);
});

test("recording tool before any text: a follow-up request is made for the reply", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  h.faux.setResponses([
    fauxAssistantMessage(
      [evidence({ observations: [{ grammar_id: "zh:shi-de", pattern: "是…的", name: "是…的 emphasis", span: "我是坐火车来的", verdict: "correct", assistance: "independent" }] })],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("坐火车很舒服吧？你坐了多长时间？"),
  ]);
  const ev = h.events();
  const reply = await h.tutor.runTurn({ sessionId: sid, text: "我是坐火车来的。", model: h.model, signal: abort(), onEvent: ev.onEvent });
  assert.equal(h.faux.state.callCount, 2);
  assert.equal(reply.text, "坐火车很舒服吧？你坐了多长时间？");
  assert.equal(ev.deltas(), reply.text);
  assert.equal((await h.records.listObservations({ language: "zh" })).length, 1);
  // The model is told it has not replied yet (thinking is hidden), so it does not end the turn empty.
  const result = (await h.records.getTranscript(sid)).find((m) => m.role === "toolResult");
  assert.ok(result && JSON.stringify(result.content).includes(NO_REPLY_YET));
});

test("record_evidence after reply text: the result has no reply nudge", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  h.faux.setResponses([fauxAssistantMessage([fauxText("好的！你呢？"), evidence({})], { stopReason: "toolUse" })]);
  await h.tutor.runTurn({ sessionId: sid, text: "我很好。", model: h.model, signal: abort(), onEvent: () => {} });
  const result = (await h.records.getTranscript(sid)).find((m) => m.role === "toolResult");
  assert.ok(result && !JSON.stringify(result.content).includes(NO_REPLY_YET));
});

test("text continues across iterations joined by a blank line", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  h.faux.setResponses([
    fauxAssistantMessage([fauxText("我查一下。"), fauxToolCall("anki_lookup", { word: "猫" })], { stopReason: "toolUse" }),
    fauxAssistantMessage("你最近在学“猫”这个词！你养猫吗？"),
  ]);
  h.anki.cards = [{ cardId: 1, noteId: 1, deck: "HSK", word: "猫", interval: 3, ease: 2300, lapses: 2, reps: 9 }];
  h.ankiOn.value = true; // Anki tools are offered only when Anki is on
  const ev = h.events();
  const reply = await h.tutor.runTurn({ sessionId: sid, text: "我喜欢动物", model: h.model, signal: abort(), onEvent: ev.onEvent });
  assert.equal(reply.text, "我查一下。\n\n你最近在学“猫”这个词！你养猫吗？");
  assert.equal(ev.deltas(), reply.text);
  assert.match(reply.toolActivity![0].summary, /Checked Anki: 猫/);
});

test("abort mid-stream saves a Stopped message and leaves no dangling user message in the transcript", async () => {
  const h = makeHarness({ tokensPerSecond: 200 });
  const sid = await h.newSession();
  h.faux.setResponses([fauxAssistantMessage("这是一个很长很长的回答，".repeat(20))]);
  const ctl = new AbortController();
  const ev = h.events();
  const reply = await h.tutor.runTurn({
    sessionId: sid,
    text: "你好",
    model: h.model,
    signal: ctl.signal,
    onEvent: (e) => {
      ev.onEvent(e);
      if (e.type === "delta") ctl.abort();
    },
  });
  assert.equal(reply.error, "Stopped");
  assert.ok(reply.text.length > 0, "keeps the partial text");
  const msgs = await h.records.getMessages(sid);
  assert.deepEqual(msgs.map((m) => m.role), ["user", "tutor"]);
  assert.equal(msgs[1].error, "Stopped");
  assert.deepEqual(await h.records.getTranscript(sid), []);
});

test("provider error is saved on the tutor message, transcript rolled back", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  h.faux.setResponses([fauxAssistantMessage("先说第一句。")]);
  await h.tutor.runTurn({ sessionId: sid, text: "你好", model: h.model, signal: abort(), onEvent: () => {} });
  const before = await h.records.getTranscript(sid);

  h.faux.setResponses([fauxAssistantMessage([], { stopReason: "error", errorMessage: "429 rate limited" })]);
  const reply = await h.tutor.runTurn({ sessionId: sid, text: "再见", model: h.model, signal: abort(), onEvent: () => {} });
  assert.equal(reply.error, "429 rate limited");
  assert.deepEqual(await h.records.getTranscript(sid), before);
  const msgs = await h.records.getMessages(sid);
  assert.deepEqual(msgs.map((m) => m.role), ["user", "tutor", "user", "tutor"]);
  assert.equal(msgs[3].error, "429 rate limited");
});

test("failure after a completed tool iteration keeps the completed part of the transcript", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  h.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("search_library", { query: "猫" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([], { stopReason: "error", errorMessage: "overloaded" }),
  ]);
  const reply = await h.tutor.runTurn({ sessionId: sid, text: "猫", model: h.model, signal: abort(), onEvent: () => {} });
  assert.equal(reply.error, "overloaded");
  const t = await h.records.getTranscript(sid);
  assert.deepEqual(t.map((m) => m.role), ["user", "assistant", "toolResult"]);
});

test("empty reply (all output spent thinking) is an error, not a blank bubble; transcript rolled back", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  h.faux.setResponses([fauxAssistantMessage([fauxThinking("Let me think about the level...")], { stopReason: "length" })]);
  const reply = await h.tutor.runTurn({ sessionId: sid, text: "你好", model: h.model, signal: abort(), onEvent: () => {} });
  assert.match(reply.error ?? "", /empty reply/);
  assert.deepEqual(await h.records.getTranscript(sid), []);
  const msgs = await h.records.getMessages(sid);
  assert.deepEqual(msgs.map((m) => [m.role, !!m.error]), [["user", false], ["tutor", true]]);
});

test("learner words exclude pasted spans", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  h.faux.setResponses([fauxAssistantMessage("对！")]);
  const pasted = "天气预报说明天下雨";
  await h.tutor.runTurn({ sessionId: sid, text: `我喜欢猫。${pasted}`, pastedSpans: [pasted], model: h.model, signal: abort(), onEvent: () => {} });
  const pack = h.lang.pack("zh");
  await pack.ready();
  const own = pack.learnerWords("我喜欢猫。");
  assert.ok(own.length > 0);
  for (const w of own) assert.ok(await h.records.getWordUsage("zh", w), `recorded ${w}`);
  for (const w of pack.learnerWords(pasted)) {
    if (own.includes(w)) continue;
    assert.equal(await h.records.getWordUsage("zh", w), null, `pasted word ${w} not recorded`);
  }
  const msgs = await h.records.getMessages(sid);
  assert.deepEqual(msgs[0].pastedSpans, [pasted]);
});

test("spoken messages are flagged and reach the model with the [spoken] marker", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  let seen = "";
  h.faux.setResponses([
    (ctx) => {
      const last = ctx.messages.filter((m) => m.role === "user").at(-1);
      seen = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
      return fauxAssistantMessage("好的！");
    },
  ]);
  await h.tutor.runTurn({ sessionId: sid, text: "我想去银行", spoken: true, model: h.model, signal: abort(), onEvent: () => {} });
  const msgs = await h.records.getMessages(sid);
  assert.equal(msgs[0].spoken, true);
  assert.equal(msgs[0].text, "我想去银行", "the display text has no marker");
  assert.equal(seen, "[spoken] 我想去银行");
});

test("Anki targets are selected once, marked asked from tutor text and used from learner words", async () => {
  const h = makeHarness();
  h.ankiOn.value = true;
  h.anki.targets = [
    { word: "猫", reason: "recent", status: "pending" },
    { word: "咖啡", reason: "difficult", meaning: "coffee", status: "pending" },
  ];
  const sid = await h.newSession();
  let prompt = "";
  h.faux.setResponses([
    (ctx) => {
      const sys = ctx.messages.find((m) => m.role === "system");
      prompt = sys && typeof sys.content === "string" ? sys.content : JSON.stringify(sys?.content ?? "");
      return fauxAssistantMessage("你早上喝咖啡吗？");
    },
  ]);
  await h.tutor.runTurn({ sessionId: sid, text: "早上好", model: h.model, signal: abort(), onEvent: () => {} });
  assert.match(prompt, /咖啡 \(coffee\)/);
  let targets = await h.records.getTargets(sid);
  assert.deepEqual(targets.map((t) => [t.word, t.status]), [["猫", "pending"], ["咖啡", "asked"]]);

  h.faux.setResponses([fauxAssistantMessage("真的吗？")]);
  await h.tutor.runTurn({ sessionId: sid, text: "我喜欢猫", model: h.model, signal: abort(), onEvent: () => {} });
  targets = await h.records.getTargets(sid);
  assert.equal(targets.find((t) => t.word === "猫")?.status, "used");
  assert.equal(h.anki.selectCalls, 1);
});

test("corrections: normalized match maps to the exact learner text; unknown text is skipped", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  h.faux.setResponses([
    fauxAssistantMessage(
      [
        fauxText("好的。"),
        evidence({
          corrections: [
            // learner wrote full-width punctuation; model dropped it and used a half-width comma
            { original: "我很喜欢,猫", corrected: "我非常喜欢猫", explanation: "More natural.", kind: "style" },
            { original: "不存在的句子", corrected: "x", explanation: "n/a", kind: "grammar" },
          ],
        }),
      ],
      { stopReason: "toolUse" },
    ),
  ]);
  const reply = await h.tutor.runTurn({ sessionId: sid, text: "嗯，我很喜欢，猫！", model: h.model, signal: abort(), onEvent: () => {} });
  const cs = await h.records.listCorrections({ language: "zh", sessionId: sid });
  assert.equal(cs.length, 1);
  assert.equal(cs[0].original, "我很喜欢，猫");
  assert.equal(cs[0].kind, "style");
  assert.match(reply.toolActivity![0].summary, /skipped 1 correction \(text not found/);
});

test("placement: level estimates recorded by placement; invalid level dropped", async () => {
  const h = makeHarness();
  const sid = await h.newSession("placement");
  h.faux.setResponses([
    fauxAssistantMessage(
      [
        fauxText("谢谢！你的阅读大概是HSK 3。"),
        evidence({
          level: [
            { skill: "reading", level: "HSK 3", confidence: "medium", evidence: "Read the passage easily." },
            { skill: "recognition", level: "hsk4", confidence: "low", evidence: "Knew most words." },
            { skill: "writing", level: "HSK 12", confidence: "high", evidence: "?" },
          ],
        }),
      ],
      { stopReason: "toolUse" },
    ),
  ]);
  const reply = await h.tutor.runTurn({ sessionId: sid, text: "我觉得这篇文章不难。", model: h.model, signal: abort(), onEvent: () => {} });
  const { current } = await h.records.getLevels("zh");
  assert.equal(current.reading?.level, "HSK 3");
  assert.equal(current.reading?.by, "placement");
  assert.equal(current.recognition?.level, "HSK 4");
  assert.equal(current.writing, undefined);
  assert.equal(current.reading?.examples[0]?.kind, "session");
  assert.match(reply.toolActivity![0].summary, /Logged 2 level estimates; skipped 1 level estimate/);
});

test("taught patterns are upserted as introduced", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  h.faux.setResponses([
    fauxAssistantMessage(
      [
        fauxText("“把”字句用来说怎么处理一个东西。你今天把房间打扫了吗？"),
        evidence({
          taught: [
            { grammar_id: "ba-construction", pattern: "把 + O + V", name: "把 construction", explanation: "Moves the object before the verb.", examples: [{ text: "我把书放在桌子上。", translation: "I put the book on the table." }] },
          ],
        }),
      ],
      { stopReason: "toolUse" },
    ),
  ]);
  await h.tutor.runTurn({ sessionId: sid, text: "“把”怎么用？", model: h.model, signal: abort(), onEvent: () => {} });
  const p = await h.records.getGrammarPoint("zh:ba-construction");
  assert.ok(p);
  assert.ok(p.introducedAt);
  assert.equal(p.examples.length, 1);
});

test("runOpening: hidden kickoff in the transcript only, no learner message", async () => {
  const h = makeHarness();
  const sid = await h.newSession("practice");
  h.faux.setResponses([fauxAssistantMessage("我们来聊聊周末吧！你周末一般做什么？")]);
  const ev = h.events();
  const reply = await h.tutor.runOpening({ sessionId: sid, model: h.model, signal: abort(), onEvent: ev.onEvent });
  assert.equal(reply.error, undefined);
  assert.ok(!ev.list.some((e) => e.type === "user_saved"));
  const msgs = await h.records.getMessages(sid);
  assert.deepEqual(msgs.map((m) => m.role), ["tutor"]);
  const t = await h.records.getTranscript(sid);
  assert.equal(t[0].role, "user");
  assert.equal(t[0].role === "user" && t[0].content, kickoffText((await h.records.getSession(sid))!));
});

test("unknown session never throws", async () => {
  const h = makeHarness();
  const reply = await h.tutor.runTurn({ sessionId: "nope", text: "hi", model: h.model, signal: abort(), onEvent: () => {} });
  assert.match(reply.error ?? "", /Session not found/);
});

test("evidence pass: a reply without record_evidence gets one tool-only request; corrections are recorded", async () => {
  const h = makeHarness();
  const tutor = new SayfernTutor({ ...h.deps, evidencePass: () => true });
  const sid = await h.newSession();
  h.faux.setResponses([
    fauxAssistantMessage("听起来很好玩！你和谁一起去的？"),
    fauxAssistantMessage(
      [
        evidence({
          corrections: [{ original: "我去了北京昨天", corrected: "我昨天去了北京", explanation: "Time words come before the verb.", kind: "grammar" }],
        }),
      ],
      { stopReason: "toolUse" },
    ),
  ]);
  const ev = h.events();
  const reply = await tutor.runTurn({ sessionId: sid, text: "我去了北京昨天。", model: h.model, signal: abort(), onEvent: ev.onEvent });

  assert.equal(reply.error, undefined);
  assert.equal(reply.text, "听起来很好玩！你和谁一起去的？");
  assert.equal(h.faux.state.callCount, 2);
  assert.equal(ev.list.filter((e) => e.type === "correction").length, 1);
  const corrections = await h.records.listCorrections({ language: "zh", sessionId: sid });
  assert.equal(corrections.length, 1);
  assert.deepEqual(reply.toolActivity?.map((a) => a.name), ["record_evidence"]);
  // The hidden nudge and the pass stay out of the transcript.
  const transcript = await h.records.getTranscript(sid);
  assert.deepEqual(transcript.map((m) => m.role), ["user", "assistant"]);
  assert.ok(!JSON.stringify(transcript).includes("Message from the app"));
});

test("evidence pass: skipped when record_evidence was called, for openings, and when disabled", async () => {
  const h = makeHarness();
  const tutor = new SayfernTutor({ ...h.deps, evidencePass: () => true });
  const sid = await h.newSession();
  h.faux.setResponses([fauxAssistantMessage([fauxText("好的！"), evidence({})], { stopReason: "toolUse" })]);
  await tutor.runTurn({ sessionId: sid, text: "你好", model: h.model, signal: abort(), onEvent: () => undefined });
  assert.equal(h.faux.state.callCount, 1);

  const pid = await h.newSession("practice");
  h.faux.setResponses([fauxAssistantMessage("我们开始吧。你周末做了什么？")]);
  await tutor.runOpening({ sessionId: pid, model: h.model, signal: abort(), onEvent: () => undefined });
  assert.equal(h.faux.state.callCount, 2);

  h.faux.setResponses([fauxAssistantMessage("很好！")]);
  await h.tutor.runTurn({ sessionId: sid, text: "谢谢", model: h.model, signal: abort(), onEvent: () => undefined });
  assert.equal(h.faux.state.callCount, 3, "harness default: no pass");
});

test("evidence pass: a failed pass leaves the reply intact", async () => {
  const h = makeHarness();
  const tutor = new SayfernTutor({ ...h.deps, evidencePass: () => true });
  const sid = await h.newSession();
  h.faux.setResponses([fauxAssistantMessage("你好！你今天怎么样？")]);
  const reply = await tutor.runTurn({ sessionId: sid, text: "你好", model: h.model, signal: abort(), onEvent: () => undefined });
  assert.equal(reply.error, undefined);
  assert.equal(reply.text, "你好！你今天怎么样？");
  const msgs = await h.records.getMessages(sid);
  assert.deepEqual(msgs.map((m) => m.role), ["user", "tutor"]);
});

test("record_evidence accepts corrections sent as JSON text", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  const list = JSON.stringify([{ original: "我去了北京昨天", corrected: "我昨天去了北京", explanation: "Time first.", kind: "grammar" }]);
  h.faux.setResponses([fauxAssistantMessage([fauxText("真好！"), evidence({ corrections: list })], { stopReason: "toolUse" })]);
  await h.tutor.runTurn({ sessionId: sid, text: "我去了北京昨天。", model: h.model, signal: abort(), onEvent: () => undefined });
  const corrections = await h.records.listCorrections({ language: "zh", sessionId: sid });
  assert.equal(corrections.length, 1);
});

test("new topic: a hidden kickoff asks for a fresh topic mid-session", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  h.faux.setResponses([fauxAssistantMessage("你好！"), fauxAssistantMessage("换个话题吧！你最近看了什么电影？")]);
  await h.tutor.runTurn({ sessionId: sid, text: "你好", model: h.model, signal: abort(), onEvent: () => undefined });
  const reply = await h.tutor.runOpening({ sessionId: sid, model: h.model, signal: abort(), onEvent: () => undefined, newTopic: true });
  assert.equal(reply.text, "换个话题吧！你最近看了什么电影？");
  const transcript = await h.records.getTranscript(sid);
  const kickoff = transcript[2];
  assert.equal(kickoff.role, "user");
  assert.match(String(kickoff.content), /New topic/);
  assert.equal(kickoff.content, kickoffText({ kind: "chat" } as never, { newTopic: true }));
  const msgs = await h.records.getMessages(sid);
  assert.deepEqual(msgs.map((m) => m.role), ["user", "tutor", "tutor"]);
});

test("leaked tool call in the reply text: hidden from the learner, salvaged as a real call, kept out of the transcript", async () => {
  const h = makeHarness({ tokensPerSecond: 2000 });
  const tutor = new SayfernTutor({ ...h.deps, evidencePass: () => true });
  const sid = await h.newSession();
  const args = { corrections: [{ original: "我去了北京昨天", corrected: "我昨天去了北京", explanation: "Time first.", kind: "grammar" }] };
  const leakedReply = `北京不错！你在北京吃了什么？\n ك<|assistant to=functions.record_evidence قjsonStringify ı${JSON.stringify(args)}ترلfunctions.record_evidence commentary Recorded.`;
  h.faux.setResponses([fauxAssistantMessage(leakedReply)]);
  const ev = h.events();
  const reply = await tutor.runTurn({ sessionId: sid, text: "我去了北京昨天。", model: h.model, signal: abort(), onEvent: ev.onEvent });

  assert.equal(reply.text, "北京不错！你在北京吃了什么？");
  assert.ok(!ev.deltas().includes("<|"), "the marker never streams");
  assert.ok(!ev.deltas().includes("functions"), "the call never streams");
  assert.equal(h.faux.state.callCount, 1, "salvaged evidence: no evidence pass");
  const corrections = await h.records.listCorrections({ language: "zh", sessionId: sid });
  assert.equal(corrections.length, 1);
  assert.equal(ev.list.filter((e) => e.type === "correction").length, 1);
  const transcript = await h.records.getTranscript(sid);
  assert.ok(!JSON.stringify(transcript).includes("functions."), "the transcript keeps no leak for the model to copy");
});
