import { test } from "node:test";
import assert from "node:assert/strict";
import { fauxAssistantMessage, type Message } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { notesOutOfCache, withNotes } from "./cache";
import { NOTES_HEADER } from "./prompt";
import { makeHarness, userBlocks } from "./testkit";

const notes = `${NOTES_HEADER}\nThis topic has run for 2 of the learner's replies.`;
const transcript: Message[] = [
  { role: "user", content: "你好", timestamp: 1 },
  { role: "assistant", content: [{ type: "text", text: "你好！" }], api: "anthropic-messages", provider: "anthropic", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 },
  { role: "user", content: [{ type: "text", text: "我很好" }], timestamp: 3 },
];

test("withNotes: the notes ride on one user message in a copy; the transcript is unchanged", () => {
  const out = withNotes(transcript, 2, notes);
  assert.deepEqual(userBlocks(out[2]), ["我很好", notes]);
  assert.deepEqual(userBlocks(transcript[2]), ["我很好"], "the stored transcript is not touched");
  assert.equal(out[0], transcript[0]);
  assert.deepEqual(userBlocks(withNotes(transcript, 0, notes)[0]), ["你好", notes], "string content becomes text blocks");
});

test("Anthropic request: the cache breakpoint sits on the learner's text, not on the notes", async () => {
  const model = anthropicProvider().getModels().find((m) => m.id === "claude-sonnet-5-5")!;
  let payload: unknown;
  const stream = streamSimple(
    model,
    { systemPrompt: "You are a tutor.", messages: withNotes(transcript, 2, notes) },
    {
      apiKey: "sk-ant-test",
      fetch: async () => new Response("{}", { status: 400 }),
      onPayload: (p) => {
        notesOutOfCache(p);
        payload = p;
        return undefined;
      },
    },
  );
  for await (const ev of stream) if (ev.type === "done" || ev.type === "error") break;
  const sent = payload as { messages: { role: string; content: { text?: string; cache_control?: unknown }[] }[] };
  const last = sent.messages.filter((m) => m.role === "user").at(-1)!;
  assert.equal(last.content[0].text, "我很好");
  assert.ok(last.content[0].cache_control, "the history up to the learner's text is cached");
  assert.equal(last.content[1].text, notes);
  assert.equal(last.content[1].cache_control, undefined, "the notes stay out of the cache entry");
});

test("the system prompt stays the same from turn to turn; the notes change", async () => {
  const h = makeHarness();
  const sid = await h.newSession();
  const seen: { system: string; notes: string }[] = [];
  // Providers get the system prompt as the transcript's system messages.
  const reply = () => (ctx: { messages: readonly Message[] }) => {
    const system = JSON.stringify(ctx.messages.filter((m) => m.role === "system"));
    seen.push({ system, notes: userBlocks(ctx.messages.filter((m) => m.role === "user").at(-1)).at(-1) ?? "" });
    return fauxAssistantMessage("好的。你呢？");
  };
  for (const text of ["我今天吃了面条。", "很好吃。", "还可以。"]) {
    h.faux.setResponses([reply()]);
    await h.tutor.runTurn({ sessionId: sid, text, model: h.model, signal: new AbortController().signal, onEvent: () => {} });
  }
  assert.equal(seen.length, 3);
  assert.match(seen[0].system, /# Pacing\\nAlways answer/, "the system prompt was captured");
  assert.equal(new Set(seen.map((s) => s.system)).size, 1, "one system prompt for the whole session");
  assert.match(seen[0].notes, /run for 1 of the learner's replies/);
  assert.match(seen[2].notes, /run for 3 of the learner's replies/);
  assert.doesNotMatch(seen[0].system, /run for \d+ of the learner's replies|Current level estimates|# Grammar ids/);
});
