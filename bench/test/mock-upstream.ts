// Offline stand-in for the Anthropic Messages API, for the benchmark selftest.
// Streams plausible SSE with usage (including cache fields), answers
// count_tokens, and sends utilization headers, so every part of the capture
// and report pipeline is exercised without a network or a subscription.
import http from "node:http";

export async function startMockUpstream(): Promise<{ url: string; stop(): Promise<void>; requests: number }> {
  let util = 0.1;
  const state = { requests: 0 };
  const server = http.createServer(async (req, res) => {
    const parts: Buffer[] = [];
    for await (const c of req) parts.push(c as Buffer);
    const raw = Buffer.concat(parts).toString("utf8");
    const body = raw ? JSON.parse(raw) : {};
    const tokens = Math.ceil(Buffer.byteLength(raw) / 4);
    if (req.url?.includes("count_tokens")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ input_tokens: tokens }));
      return;
    }
    state.requests++;
    util += 0.001 * Math.ceil(tokens / 1000);
    const tools: string[] = (body.tools ?? []).map((t: { name: string }) => t.name);
    const msgs = body.messages ?? [];
    const last = [...msgs].reverse().find((m: { role: string }) => m.role === "user" || m.role === "assistant");
    const lastIsToolResult = Array.isArray(last?.content) && last.content.some((b: { type: string }) => b.type === "tool_result");
    const cached = JSON.stringify(body.system ?? "").includes("cache_control") || JSON.stringify(body.messages ?? "").includes("cache_control");
    const usage = cached
      ? { input_tokens: 20, cache_read_input_tokens: Math.floor(tokens * 0.8), cache_creation_input_tokens: tokens - 20 - Math.floor(tokens * 0.8) }
      : { input_tokens: tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "anthropic-ratelimit-unified-5h-utilization": util.toFixed(4),
      "anthropic-ratelimit-unified-5h-reset": "1790000000",
      "anthropic-ratelimit-unified-status": "allowed",
    });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send("message_start", { type: "message_start", message: { id: `msg_${state.requests}`, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, usage: { ...usage, output_tokens: 1 } } });
    let idx = 0;
    const text = (t: string) => {
      send("content_block_start", { type: "content_block_start", index: idx, content_block: { type: "text", text: "" } });
      for (const piece of t.match(/.{1,6}/gsu) ?? []) send("content_block_delta", { type: "content_block_delta", index: idx, delta: { type: "text_delta", text: piece } });
      send("content_block_stop", { type: "content_block_stop", index: idx++ });
    };
    const tool = (name: string, input: unknown) => {
      send("content_block_start", { type: "content_block_start", index: idx, content_block: { type: "tool_use", id: `toolu_${state.requests}_${idx}`, name, input: {} } });
      send("content_block_delta", { type: "content_block_delta", index: idx, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } });
      send("content_block_stop", { type: "content_block_stop", index: idx++ });
    };
    let stop = "end_turn";
    if (tools.includes("record_evidence") && !lastIsToolResult) {
      // Sayfern-shaped turn: reply first, then one recording call.
      text("听起来不错！你昨天在图书馆学习了多久？");
      const learner =
        typeof last?.content === "string"
          ? last.content
          : (last?.content ?? []).map((b: { type: string; text?: string }) => (b.type === "text" ? (b.text ?? "") : "")).join("");
      const m = learner.match(/我去了(.+?)昨天/);
      tool("record_evidence", m ? { corrections: [{ original: `我去了${m[1]}昨天`, corrected: `我昨天去了${m[1]}`, explanation: "Time words come before the verb.", kind: "grammar" }] } : {});
      stop = "tool_use";
    } else if (tools.includes("Read") && !lastIsToolResult && msgs.length < 3) {
      // Claude-Code-shaped first turn: invoke the skill before answering.
      tool("Skill", { skill: "selftest-skill" });
      stop = "tool_use";
    } else {
      text("好的！我们开始吧。你今天过得怎么样？");
    }
    send("message_delta", { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 40 } });
    send("message_stop", { type: "message_stop" });
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    get requests() {
      return state.requests;
    },
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}
