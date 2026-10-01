// Recording proxy for the Anthropic Messages API. Both harnesses are pointed at
// it (Claude Code via ANTHROPIC_BASE_URL, Sayfern via the provider base URL), so
// every model request is measured the same way, whatever either harness does
// internally. Auth headers pass through untouched and are never written to disk.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { join } from "node:path";
import type { Phase, WireRecord } from "./types";
import { parseJsonResponse, parseRequest, SseParser } from "./wire";

export interface ProxyOptions {
  upstream: string;
  /** JSONL file for WireRecords. */
  logFile: string;
  /** Directory for raw request/response bodies (may contain personal data). Omit to skip. */
  bodiesDir?: string;
  /** Run a count_tokens probe on the first model request of each (arm, scenario). */
  probe?: boolean;
}

const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "host", "content-length", "accept-encoding"]);

export class RecordingProxy {
  private server?: http.Server;
  private seq = 0;
  private phase: Phase | null = null;
  private probed = new Set<string>();
  private pending = new Set<Promise<unknown>>();
  readonly records: WireRecord[] = [];
  port = 0;

  constructor(private readonly opts: ProxyOptions) {
    if (opts.bodiesDir) mkdirSync(opts.bodiesDir, { recursive: true });
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  setPhase(p: Phase | null): void {
    this.phase = p ? { ...p } : null;
  }

  async start(port = 0): Promise<void> {
    this.server = http.createServer((req, res) => {
      const task = this.handle(req, res).catch((err) => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "bench_proxy_error", message: String(err?.message ?? err) } }));
      });
      this.track(task);
    });
    await new Promise<void>((resolve) => this.server!.listen(port, "127.0.0.1", resolve));
    this.port = (this.server.address() as { port: number }).port;
  }

  /** Waits for in-flight exchanges and probes. */
  async drain(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  async stop(): Promise<void> {
    await this.drain();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.pending.add(p);
    p.finally(() => this.pending.delete(p)).catch(() => undefined);
    return p;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const path = req.url ?? "/";
    const pathname = path.split("?")[0];
    const kind: WireRecord["kind"] = /\/v1\/messages\/?$/.test(pathname)
      ? "messages"
      : /count_tokens/.test(pathname)
        ? "count_tokens"
        : "other";
    const rec: WireRecord = {
      seq: ++this.seq,
      phase: this.phase ? { ...this.phase } : null,
      method: req.method ?? "GET",
      path: pathname,
      kind,
      status: 0,
      t0: Date.now(),
      toolUses: [],
      textChars: 0,
      thinkingChars: 0,
      rateLimit: {},
    };
    const bodyText = body.toString("utf8");
    if (kind === "messages" && req.method === "POST") rec.req = parseRequest(bodyText);

    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !HOP.has(k.toLowerCase())) headers[k] = v;
    headers["accept-encoding"] = "identity";
    if (body.length) headers["content-length"] = String(body.length);

    const up = await this.forward(req.method ?? "GET", path, headers, body);
    rec.status = up.statusCode ?? 0;
    for (const [k, v] of Object.entries(up.headers)) {
      if (/^anthropic-ratelimit-|^retry-after$/i.test(k) && v !== undefined) rec.rateLimit[k] = Array.isArray(v) ? v.join(",") : v;
    }
    const outHeaders: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(up.headers)) if (v !== undefined && !HOP.has(k.toLowerCase())) outHeaders[k] = v;
    res.writeHead(rec.status, outHeaders);

    const isSse = String(up.headers["content-type"] ?? "").includes("text/event-stream");
    const sse = isSse ? new SseParser() : null;
    const resChunks: Buffer[] = [];
    for await (const c of up) {
      const buf = c as Buffer;
      if (rec.firstByteMs === undefined) rec.firstByteMs = Date.now() - rec.t0;
      res.write(buf);
      resChunks.push(buf);
      if (sse) sse.push(buf.toString("utf8"));
    }
    res.end();
    rec.totalMs = Date.now() - rec.t0;
    const resText = Buffer.concat(resChunks).toString("utf8");
    if (kind === "messages") {
      const parsed = sse ? sse.end() : parseJsonResponse(resText);
      rec.model = parsed.model;
      rec.usage = parsed.usage;
      rec.stopReason = parsed.stopReason;
      rec.toolUses = parsed.toolUses;
      rec.textChars = parsed.textChars;
      rec.thinkingChars = parsed.thinkingChars;
      if (parsed.error) rec.error = parsed.error;
    }
    if (rec.status >= 400 && !rec.error) rec.error = resText.slice(0, 300);

    if (this.opts.bodiesDir && kind !== "other") {
      writeFileSync(join(this.opts.bodiesDir, `${rec.seq}.req.json`), bodyText);
      writeFileSync(join(this.opts.bodiesDir, `${rec.seq}.res.${isSse ? "sse" : "json"}`), resText);
    }

    const probeKey = rec.phase ? `${rec.phase.arm}|${rec.phase.scenario}` : "";
    if (this.opts.probe && kind === "messages" && rec.status === 200 && rec.phase && !this.probed.has(probeKey)) {
      this.probed.add(probeKey);
      // Headers stay in memory only for the probe.
      await this.track(this.probeOverhead(rec, bodyText, headers));
    }
    this.records.push(rec);
    appendFileSync(this.opts.logFile, JSON.stringify(rec) + "\n");
  }

  private forward(method: string, path: string, headers: Record<string, string | string[]>, body: Buffer): Promise<http.IncomingMessage> {
    const base = new URL(this.opts.upstream);
    const target = new URL(path, base);
    const lib = target.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const r = lib.request(target, { method, headers: { ...headers, host: target.host } }, resolve);
      r.on("error", reject);
      if (body.length) r.write(body);
      r.end();
    });
  }

  /**
   * Exact token counts for the fixed part of the context (system prompt + tool
   * definitions), via the free count_tokens endpoint with the same auth.
   */
  private async probeOverhead(rec: WireRecord, bodyText: string, headers: Record<string, string | string[]>): Promise<void> {
    try {
      const j = JSON.parse(bodyText) as Record<string, unknown>;
      const msg = [{ role: "user", content: "." }];
      const count = async (payload: Record<string, unknown>): Promise<number> => {
        const b = Buffer.from(JSON.stringify(payload));
        const h = { ...headers, "content-length": String(b.length), "content-type": "application/json" };
        const r = await this.forward("POST", "/v1/messages/count_tokens", h, b);
        const parts: Buffer[] = [];
        for await (const c of r) parts.push(c as Buffer);
        const t = Buffer.concat(parts).toString("utf8");
        if ((r.statusCode ?? 0) >= 400) throw new Error(`count_tokens HTTP ${r.statusCode}: ${t.slice(0, 200)}`);
        const n = (JSON.parse(t) as { input_tokens?: number }).input_tokens;
        if (typeof n !== "number") throw new Error("count_tokens: no input_tokens");
        return n;
      };
      const base = { model: j.model, messages: msg };
      const empty = await count(base);
      const tools = j.tools ? await count({ ...base, tools: j.tools }) : empty;
      const all = await count({ ...base, ...(j.system ? { system: j.system } : {}), ...(j.tools ? { tools: j.tools } : {}) });
      rec.probe = { empty, tools: tools - empty, systemAndTools: all - empty };
    } catch (err) {
      rec.probe = { error: String((err as Error)?.message ?? err).slice(0, 300) };
    }
  }
}
