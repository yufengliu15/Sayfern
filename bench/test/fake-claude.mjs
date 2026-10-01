#!/usr/bin/env node
// Minimal stand-in for `claude -p --output-format stream-json` used by the
// benchmark selftest. Talks to ANTHROPIC_BASE_URL like the real CLI would:
// a large cached system prompt, many tool definitions, a tool loop.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("0.0.0-fake (Claude Code stand-in)");
  process.exit(0);
}
const prompt = args[args.indexOf("-p") + 1];
const resume = args.includes("--resume") ? args[args.indexOf("--resume") + 1] : undefined;
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "claude-sonnet-5-5";
const dir = join(process.env.CLAUDE_CONFIG_DIR ?? process.cwd(), "fake-sessions");
mkdirSync(dir, { recursive: true });
const sessionId = resume ?? randomUUID();
const file = join(dir, `${sessionId}.json`);
const messages = resume && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
const out = (e) => process.stdout.write(JSON.stringify(e) + "\n");
const system = [{ type: "text", text: "You are Claude Code. ".repeat(1500), cache_control: { type: "ephemeral" } }];
const tools = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task", "WebFetch", "WebSearch", "TodoWrite", "Skill"].map((name) => ({
  name,
  description: `${name} tool. `.repeat(80),
  input_schema: { type: "object", properties: { x: { type: "string" } } },
}));
out({ type: "system", subtype: "init", session_id: sessionId, model, tools: tools.map((t) => t.name) });
messages.push({ role: "user", content: [{ type: "text", text: prompt }] });
if (!resume) {
  // Like the real CLI: a small side request on the "fast" model (session title etc.).
  const side = process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "claude-haiku-4-5";
  await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "fake", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: side, max_tokens: 50, stream: true, messages: [{ role: "user", content: `Title for: ${prompt}` }] }),
  }).then((r) => r.text());
}
let usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
let final = "";
for (let i = 0; i < 4; i++) {
  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages?beta=true`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "fake", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 32000, stream: true, system, tools, messages }),
  });
  const text = await res.text();
  const content = [];
  let cur = null;
  for (const block of text.split("\n\n")) {
    const data = block.split("\n").find((l) => l.startsWith("data:"));
    if (!data) continue;
    const e = JSON.parse(data.slice(5));
    if (e.type === "message_start") for (const k of Object.keys(usage)) usage[k] += e.message.usage[k] ?? 0;
    if (e.type === "message_delta") usage.output_tokens += e.usage.output_tokens ?? 0;
    if (e.type === "content_block_start") cur = { ...e.content_block, _json: "" };
    if (e.type === "content_block_delta" && cur) {
      if (e.delta.type === "text_delta") cur.text += e.delta.text;
      if (e.delta.type === "input_json_delta") cur._json += e.delta.partial_json;
    }
    if (e.type === "content_block_stop" && cur) {
      if (cur.type === "tool_use") cur.input = JSON.parse(cur._json || "{}");
      delete cur._json;
      content.push(cur);
      cur = null;
    }
  }
  messages.push({ role: "assistant", content });
  out({ type: "assistant", session_id: sessionId, message: { role: "assistant", content } });
  const calls = content.filter((b) => b.type === "tool_use");
  if (!calls.length) {
    final = content.filter((b) => b.type === "text").map((b) => b.text).join("");
    break;
  }
  const results = calls.map((c) => ({ type: "tool_result", tool_use_id: c.id, content: "File does not exist.", is_error: true }));
  messages.push({ role: "user", content: results });
  out({ type: "user", session_id: sessionId, message: { role: "user", content: results } });
}
writeFileSync(file, JSON.stringify(messages));
out({ type: "result", subtype: "success", is_error: false, result: final, session_id: sessionId, usage, total_cost_usd: 0.01, num_turns: 1, permission_denials: [] });
