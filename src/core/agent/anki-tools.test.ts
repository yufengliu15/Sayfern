import assert from "node:assert/strict";
import { test } from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { AnkiCard } from "../../shared/records";
import { ANKI_MAX_LIMIT } from "./anki-tools";
import { buildSystemPrompt } from "./prompt";
import { makeHarness, type Harness } from "./testkit";
import { toolContext, turnTools, type TurnState } from "./tools";
import { ankiReady } from "./turn";

const DAY = 86_400_000;
const abort = () => new AbortController().signal;

/** A big deck: 1000 known, 30 learning, 400 new, 5 suspended, 25 struggling. */
function bigDeck(now: number): AnkiCard[] {
  let id = 0;
  const card = (word: string, extra: Partial<AnkiCard>): AnkiCard => {
    id++;
    return { cardId: id, noteId: id, deck: "HSK", word, interval: 10, ease: 2500, lapses: 0, reps: 6, status: "review", stage: "review", recentReviews: 4, recentFails: 0, ...extra };
  };
  const cards: AnkiCard[] = [];
  for (let i = 0; i < 1000; i++) {
    cards.push(card(`熟${i}`, { reading: `shu${i}`, meaning: `known word number ${i} with a rather long meaning text`, interval: i % 2 ? 40 : 8, mature: i % 2 === 1, lastReviewAt: now - (i + 1) * 3_600_000 }));
  }
  for (let i = 0; i < 30; i++) cards.push(card(`学${i}`, { status: "learning", stage: "learning", interval: 0, ease: 0 }));
  for (let i = 0; i < 400; i++) {
    cards.push(card(`新${i}`, { reading: `xin${i}`, meaning: `new ${i}`, status: "new", stage: "new", reps: 0, ease: 0, interval: 0, recentReviews: 0, newPosition: 1000 + i }));
  }
  for (let i = 0; i < 5; i++) cards.push(card(`停${i}`, { status: "suspended", lapses: 9, leech: true }));
  for (let i = 0; i < 25; i++) {
    cards.push(card(`难${i}`, { reading: `nan${i}`, meaning: `hard ${i}`, lapses: 4 + i, ease: 1500, recentReviews: 9, recentFails: 4, lastReviewAt: now - DAY }));
  }
  return cards;
}

async function setup(opts: { on?: boolean; synced?: boolean } = {}) {
  const h = makeHarness();
  h.ankiOn.value = opts.on ?? true;
  h.anki.synced = opts.synced ?? true;
  h.anki.syncedAt = h.clock.t - 2 * 3_600_000;
  h.anki.cards = bigDeck(h.clock.t);
  const sid = await h.newSession();
  const session = (await h.records.getSession(sid))!;
  const turn: TurnState = { session, emit: () => {}, sources: [], emittedCorrections: new Set() };
  return { h, sid, session, turn };
}

async function run(h: Harness, turn: TurnState, name: string, args: Record<string, unknown> = {}) {
  const tool = turnTools(h.deps, turn, { anki: true }).find((t) => t.name === name);
  assert.ok(tool, `${name} offered`);
  assert.equal(tool.recordingOnly, false);
  return tool.execute(args, toolContext(h.deps, turn));
}

const wordLines = (content: string) => content.split("\n").filter((l) => l.includes(" · "));

test("anki tools are offered only when Anki is on and the language has a snapshot", async () => {
  const names = (anki: boolean, h: Harness, turn: TurnState) => turnTools(h.deps, turn, { anki }).map((t) => t.name);
  const on = await setup();
  assert.equal(await ankiReady(on.h.deps, "zh"), true);
  assert.deepEqual(
    names(true, on.h, on.turn).filter((n) => n.startsWith("anki_")),
    ["anki_overview", "anki_struggling", "anki_vocabulary", "anki_check_words", "anki_lookup"],
  );
  const off = await setup({ on: false });
  assert.equal(await ankiReady(off.h.deps, "zh"), false);
  assert.ok(!names(false, off.h, off.turn).some((n) => n.startsWith("anki_")));
  const unsynced = await setup({ synced: false });
  assert.equal(await ankiReady(unsynced.h.deps, "zh"), false);

  // End to end: with Anki off the model can't call them.
  off.h.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("anki_overview", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage("好的。"),
  ]);
  const reply = await off.h.tutor.runTurn({ sessionId: off.sid, text: "你好", model: off.h.model, signal: abort(), onEvent: () => {} });
  assert.equal(reply.toolActivity?.[0].ok, false);
  assert.match(reply.toolActivity![0].summary, /Unknown tool/);
});

test("anki_overview: counts, hardest words, next new words, sync time", async () => {
  const { h, turn } = await setup();
  const out = await run(h, turn, "anki_overview");
  assert.equal(out.activity, "Read Anki overview");
  assert.match(out.content, /^Anki snapshot from \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC \(2 h ago\)\./);
  assert.match(out.content, /1,025 known \(500 mature, 525 young\), 30 learning, 400 new \(not studied yet\), 5 suspended\. 25 struggling\./);
  assert.match(out.content, /Hardest right now:\n- 难24 · nan24 · hard 24 · known · 28 lapses/);
  const next = out.content.split("Next new words")[1].split("\n").slice(1);
  assert.equal(next.length, 20);
  assert.equal(next[0], "- 新0 · xin0 · new 0 · new");
  assert.equal(next[19], "- 新19 · xin19 · new 19 · new");
  assert.ok(out.content.length < 3000, `overview is compact (${out.content.length} chars)`);
});

test("anki_struggling: hardest first with reasons, capped, deck filter", async () => {
  const { h, turn } = await setup();
  const out = await run(h, turn, "anki_struggling", { limit: 3 });
  assert.equal(out.activity, "Read 3 struggling Anki words");
  assert.match(out.content, /synced|snapshot from/);
  assert.match(out.content, /25 struggling words; showing the 3 hardest\./);
  const lines = wordLines(out.content);
  assert.deepEqual(lines.map((l) => l.split(" · ")[0]), ["难24", "难23", "难22"]);
  assert.match(lines[0], /28 lapses, failed 4 of last 9, ease 150%/);
  const none = await run(h, turn, "anki_struggling", { deck: "Other" });
  assert.match(none.content, /0 struggling words in Other; showing the 0 hardest\.\nNone/);
  const def = await run(h, turn, "anki_struggling", {});
  assert.equal(wordLines(def.content).length, 20);
});

test("anki_vocabulary: paged lists per status, new in introduction order, capped at 100", async () => {
  const { h, turn } = await setup();
  const known = await run(h, turn, "anki_vocabulary", { status: "known", limit: 500 });
  assert.equal(wordLines(known.content).length, ANKI_MAX_LIMIT);
  assert.equal(known.activity, "Listed 100 known Anki words");
  assert.match(known.content, /Known words: 1,025 \(most recently reviewed first\); showing 1–100\./);
  assert.match(known.content, /More: offset 100\./);
  assert.match(wordLines(known.content)[0], /^熟0 · shu0 · known word number 0 with a rather long… · known$/); // meaning truncated

  const next = await run(h, turn, "anki_vocabulary", { status: "new", limit: 5, offset: 10 });
  assert.match(next.content, /New words: 400 \(not studied yet, in the order Anki will introduce them\); showing 11–15\./);
  assert.deepEqual(wordLines(next.content).map((l) => l.split(" · ")[0]), ["新10", "新11", "新12", "新13", "新14"]);

  const search = await run(h, turn, "anki_vocabulary", { status: "all", search: "xin39" });
  assert.equal(search.activity, "Searched all Anki words: xin39 (11)");
  assert.equal(wordLines(search.content)[0].split(" · ")[0], "新39");

  const def = await run(h, turn, "anki_vocabulary", { status: "bogus" });
  assert.match(def.content, /Known words: 1,025/);
  assert.equal(wordLines(def.content).length, 20);
});

test("anki_check_words: groups known / learning / new / not in Anki, max 50", async () => {
  const { h, turn } = await setup();
  const out = await run(h, turn, "anki_check_words", { words: ["熟1", "学2", "新3", "龙", "shu5", "停0"] });
  assert.equal(out.activity, "Checked 6 words in Anki");
  assert.match(out.content, /^Anki snapshot from .*\(2 h ago\)\./);
  assert.match(out.content, /\nKnown: 熟1, shu5\n/);
  assert.match(out.content, /\nLearning: 学2\n/);
  assert.match(out.content, /\nIn their deck, not studied yet: 新3\n/);
  assert.match(out.content, /\nSuspended: 停0\n/);
  assert.match(out.content, /\nNot in Anki: 龙$/);
  const many = await run(h, turn, "anki_check_words", { words: Array.from({ length: 60 }, (_, i) => `词${i}`) });
  assert.equal(many.activity, "Checked 50 words in Anki");
  assert.match(many.content, /10 words over the 50-word limit not checked/);
  assert.equal((await run(h, turn, "anki_check_words", { words: [] })).content, "Give at least one word.");
});

test("anki_lookup: card detail with the new fields", async () => {
  const { h, turn } = await setup();
  const out = await run(h, turn, "anki_lookup", { word: "难3" });
  assert.equal(out.activity, "Checked Anki: 难3");
  assert.match(out.content, /snapshot from/);
  assert.match(out.content, /难3 \[nan3\]: hard 3, status review, interval 10 days, ease 150%, lapses 7, reviews 6, last 90 days: 4 again of 9/);
  const fresh = await run(h, turn, "anki_lookup", { word: "新7" });
  assert.match(fresh.content, /status new, new-queue position 1007/);
  assert.equal((await run(h, turn, "anki_lookup", { word: "龙" })).content, "Not in the learner's Anki decks.");
});

test("a turn can call anki_check_words and gets the result back", async () => {
  const { h, sid } = await setup();
  h.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("anki_check_words", { words: ["熟1", "龙"] })], { stopReason: "toolUse" }),
    fauxAssistantMessage("你认识熟1吗？"),
  ]);
  const reply = await h.tutor.runTurn({ sessionId: sid, text: "你好", model: h.model, signal: abort(), onEvent: () => {} });
  assert.equal(reply.text, "你认识熟1吗？");
  assert.deepEqual(reply.toolActivity, [{ name: "anki_check_words", summary: "Checked 2 words in Anki", ok: true }]);
  const result = (await h.records.getTranscript(sid)).find((m) => m.role === "toolResult");
  assert.match(JSON.stringify(result), /Known: 熟1/);
});

test("prompt: compact Anki knowledge block only when Anki is on with a snapshot", async () => {
  const { h, session } = await setup();
  const p = await buildSystemPrompt(h.deps, session);
  const block = `# Anki knowledge${p.split("# Anki knowledge")[1].split("\n\n")[0]}`;
  assert.match(block, /^# Anki knowledge \(synced 2 h ago\)/);
  assert.match(block, /Vocabulary: 1,025 known \(500 mature\), 30 learning, 400 not studied yet\./);
  assert.match(block, /Hardest now: 难24 \(28 lapses\), 难23 \(27 lapses\), 难22 \(26 lapses\), 难21 \(25 lapses\), 难20 \(24 lapses\)\./);
  assert.match(block, /Next new words: 新0, 新1, 新2, 新3, 新4, 新5, 新6, 新7\./);
  assert.match(block, /anki_check_words/);
  assert.match(block, /at most one upcoming new word per reply/);
  assert.ok(block.length < 800, `block is ${block.length} chars`);

  const off = await setup({ on: false });
  assert.doesNotMatch(await buildSystemPrompt(off.h.deps, off.session), /Anki knowledge/);
  const unsynced = await setup({ synced: false });
  assert.doesNotMatch(await buildSystemPrompt(unsynced.h.deps, unsynced.session), /Anki knowledge/);
});
