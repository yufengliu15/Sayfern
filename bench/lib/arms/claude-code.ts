// Claude Code arm: the `claude` CLI in print mode with a skill, one process per
// learner message, resuming the same session (as a person chatting would).
// Only documented CLI surface is used: -p, --output-format stream-json,
// --resume, --model, permissions flags, ANTHROPIC_BASE_URL, CLAUDE_CONFIG_DIR.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { expandPath, type ClaudeCodeArmConfig, type Rewrite } from "../config";
import { copyTree } from "../fixtures";
import { sessionUnit, type Scenario, type ScenarioSession } from "../scenarios";
import type { TurnOutput } from "../types";
import type { Arm, ArmContext } from "./arm";

interface StreamResult {
  sessionId?: string;
  text: string;
  isError: boolean;
  errorText?: string;
  usage?: Record<string, number>;
  costUsd?: number;
  numTurns?: number;
  permissionDenials: number;
  toolUses: string[];
  initTools?: number;
  rateLimitEvents: unknown[];
  exitCode: number | null;
  stderr: string;
}

const TEXT = new Set([".md", ".txt", ".py", ".json", ".yaml", ".yml", ".sh", ".js", ".ts"]);

/** Applies rewrites to every text file under dir; returns hit counts per rewrite. */
export function applyRewrites(dir: string, rewrites: Rewrite[], root: string): number[] {
  const hits = rewrites.map(() => 0);
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (TEXT.has(extname(name).toLowerCase())) {
        let s = readFileSync(p, "utf8");
        rewrites.forEach((r, i) => {
          const n = s.split(r.from).length - 1;
          if (n) {
            hits[i] += n;
            s = s.replaceAll(r.from, r.to.replaceAll("{{ROOT}}", root));
          }
        });
        writeFileSync(p, s);
      }
    }
  };
  walk(dir);
  return hits;
}

export function hashDir(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (name === ".DS_Store") continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(name).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest("hex").slice(0, 12);
}

export class ClaudeCodeArm implements Arm {
  readonly id: string;
  readonly label: string;
  private ctx!: ArmContext;
  private workspace = "";
  private configDir = "";
  private sessionId: string | undefined;
  private isolation: "clean" | "user" = "user";
  private skillHash = "";

  constructor(private readonly cfg: ClaudeCodeArmConfig) {
    this.id = cfg.id;
    this.label = cfg.label ?? "Claude Code + skill";
  }

  async version(): Promise<string> {
    const out = await this.exec(["--version"], {}, 30).catch((e) => ({ text: String(e), code: 1 }));
    const skill = this.skillHash ? ` · skill ${basename(expandPath(this.cfg.skill))}@${this.skillHash}` : "";
    return `claude ${out.text.trim()}${skill} · isolation ${this.isolation}`;
  }

  supports(s: Scenario): string | null {
    const langs = this.cfg.languages ?? ["zh"];
    return langs.includes(s.language) ? null : `the skill only covers ${langs.join(", ")}`;
  }

  resolveIsolation(): "clean" | "user" {
    const hasToken = !!(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
    if (this.cfg.isolation === "clean" && !hasToken) {
      throw new Error("claude-code isolation \"clean\" needs CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token`) or ANTHROPIC_API_KEY.");
    }
    return this.cfg.isolation === "user" ? "user" : this.cfg.isolation === "clean" || hasToken ? "clean" : "user";
  }

  async setup(ctx: ArmContext): Promise<void> {
    this.ctx = ctx;
    this.isolation = this.resolveIsolation();
    this.workspace = join(ctx.runDir, "workspace");
    this.configDir = join(ctx.runDir, "claude-config");
    const skillSrc = expandPath(this.cfg.skill);
    if (!existsSync(join(skillSrc, "SKILL.md"))) throw new Error(`Skill not found: ${skillSrc}/SKILL.md`);
    const skillName = basename(skillSrc);
    const skillDest = join(this.workspace, ".claude", "skills", skillName);
    this.skillHash = hashDir(skillSrc);
    copyTree(skillSrc, skillDest, ctx.sandbox.root);
    const hits = applyRewrites(skillDest, this.cfg.rewrites, ctx.sandbox.root);
    // The same rewrites apply to fixture text (a private snapshot of a real wiki keeps its real paths).
    applyRewrites(ctx.sandbox.root + "/wiki", this.cfg.rewrites, ctx.sandbox.root);
    const missed = this.cfg.rewrites.filter((_, i) => hits[i] === 0).map((r) => r.from);
    if (missed.length) ctx.log(`warning: skill rewrites matched nothing (the skill changed?): ${missed.join(" | ")}`);
    writeFileSync(join(ctx.runDir, "skill-info.json"), JSON.stringify({ source: skillSrc, hash: this.skillHash, rewrites: this.cfg.rewrites, hits }, null, 2));
    if (this.isolation === "clean") mkdirSync(this.configDir, { recursive: true });
    this.sessionId = undefined;
  }

  async open(session: ScenarioSession): Promise<TurnOutput | null> {
    this.sessionId = undefined; // each scenario session is a fresh Claude Code conversation
    return this.turn(session.prompt ?? this.openPrompt(session));
  }

  /** Unit sessions: the learner names the unit and lists its patterns, as they would from their textbook. No course in the skill. */
  private openPrompt(session: ScenarioSession): string {
    const open = this.cfg.prompts.open;
    const unit = sessionUnit(session);
    if (!unit) return open[session.mode] ?? open.chat;
    const template = (session.explain && open["unit-explain"]) || open.unit;
    if (!template) throw new Error('claude-code prompts.open needs "unit" (and "unit-explain") for unit sessions');
    return template
      .replaceAll("{{LEVEL}}", unit.level)
      .replaceAll("{{TITLE}}", unit.title)
      .replaceAll("{{POINTS}}", unit.grammar.map((g) => `- ${g.pattern} (${g.name})`).join("\n"));
  }

  send(text: string): Promise<TurnOutput> {
    return this.turn(text);
  }

  end(): Promise<TurnOutput | null> {
    return this.turn(this.cfg.prompts.end);
  }

  async teardown(): Promise<void> {}

  private command(): string {
    const c = this.cfg.command;
    return c.startsWith("~") || c.includes("/") ? expandPath(c, process.cwd()) : c;
  }

  private env(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ANTHROPIC_BASE_URL: this.ctx.proxyUrl, DISABLE_AUTOUPDATER: "1" };
    for (const [k, v] of Object.entries(this.cfg.env ?? {})) env[k] = v.replaceAll("{{MODEL}}", this.ctx.model);
    if (this.isolation === "clean") env.CLAUDE_CONFIG_DIR = this.configDir;
    return env;
  }

  private async turn(text: string): Promise<TurnOutput> {
    const args = ["-p", text, "--output-format", "stream-json", "--verbose", "--model", this.ctx.model];
    if (this.sessionId) args.push("--resume", this.sessionId);
    args.push("--add-dir", this.ctx.sandbox.root);
    if (this.cfg.permissionMode) args.push("--permission-mode", this.cfg.permissionMode);
    if (this.cfg.allowedTools?.length) args.push("--allowedTools", this.cfg.allowedTools.join(","));
    args.push(...(this.cfg.extraArgs ?? []));
    const t0 = Date.now();
    const r = await this.runStream(args);
    const wallMs = Date.now() - t0;
    if (r.sessionId) this.sessionId = r.sessionId;
    const u = r.usage;
    const out: TurnOutput = {
      reply: r.text,
      feedback: [],
      wallMs,
      reported: u
        ? {
            input: u.input_tokens,
            output: u.output_tokens,
            cacheRead: u.cache_read_input_tokens,
            cacheWrite: u.cache_creation_input_tokens,
            costUsd: r.costUsd,
          }
        : undefined,
      extra: {
        tools: r.toolUses,
        skillUsed: r.toolUses.includes("Skill"),
        permissionDenials: r.permissionDenials,
        numTurns: r.numTurns,
        initTools: r.initTools,
        rateLimitEvents: r.rateLimitEvents,
        sessionId: r.sessionId,
      },
    };
    if (r.isError || r.exitCode !== 0) out.error = r.errorText || `claude exited ${r.exitCode}: ${r.stderr.slice(-400)}`;
    return out;
  }

  private runStream(args: string[]): Promise<StreamResult> {
    const log = join(this.ctx.runDir, "claude-stream.jsonl");
    const res: StreamResult = { text: "", isError: false, permissionDenials: 0, toolUses: [], rateLimitEvents: [], exitCode: null, stderr: "" };
    return new Promise((resolve, reject) => {
      const child = spawn(this.command(), args, {
        cwd: this.workspace,
        env: this.env(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timer = setTimeout(() => child.kill("SIGTERM"), (this.cfg.turnTimeoutSec ?? 600) * 1000);
      let buf = "";
      const line = (l: string) => {
        if (!l.trim()) return;
        appendFileSync(log, l + "\n");
        let e: Record<string, unknown>;
        try {
          e = JSON.parse(l);
        } catch {
          return;
        }
        const type = String(e.type ?? "");
        if (typeof e.session_id === "string") res.sessionId = e.session_id;
        if (type === "system" && e.subtype === "init" && Array.isArray(e.tools)) res.initTools = e.tools.length;
        if (type.includes("rate_limit")) res.rateLimitEvents.push(e);
        if (type === "assistant") {
          const content = ((e.message as Record<string, unknown>)?.content ?? []) as Record<string, unknown>[];
          for (const b of content) if (b.type === "tool_use") res.toolUses.push(String(b.name));
        }
        if (type === "result") {
          res.text = typeof e.result === "string" ? e.result : "";
          res.isError = e.is_error === true || (typeof e.subtype === "string" && e.subtype !== "success");
          if (res.isError) res.errorText = `${e.subtype}: ${res.text || JSON.stringify(e.errors ?? "")}`.slice(0, 500);
          res.usage = e.usage as Record<string, number>;
          res.costUsd = typeof e.total_cost_usd === "number" ? e.total_cost_usd : undefined;
          res.numTurns = typeof e.num_turns === "number" ? e.num_turns : undefined;
          res.permissionDenials = Array.isArray(e.permission_denials) ? e.permission_denials.length : 0;
        }
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d: string) => {
        buf += d;
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          line(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (d: string) => (res.stderr += d));
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`Could not start ${this.cfg.command}: ${err.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (buf) line(buf);
        res.exitCode = code;
        resolve(res);
      });
    });
  }

  private exec(args: string[], env: NodeJS.ProcessEnv, timeoutSec: number): Promise<{ text: string; code: number | null }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command(), args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
      let text = "";
      child.stdout.on("data", (d) => (text += d));
      child.stderr.on("data", (d) => (text += d));
      const t = setTimeout(() => child.kill(), timeoutSec * 1000);
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(t);
        resolve({ text, code });
      });
    });
  }
}
