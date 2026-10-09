// One-shot `claude -p` calls for the bench's own helpers (judge, simulated learner).
// They run outside the recording proxy, so they never count toward either harness.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ClaudeCall {
  command: string;
  model: string;
  timeoutSec: number;
}

export function runClaude(call: ClaudeCall, prompt: string): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), "sayfern-bench-cli-"));
  const env = { ...process.env };
  delete env.ANTHROPIC_BASE_URL; // never through the recording proxy
  for (const k of ["ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"]) {
    env[k] = call.model;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(call.command, ["-p", "--output-format", "json", "--model", call.model, "--max-turns", "1"], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => child.kill(), call.timeoutSec * 1000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(t);
      try {
        const j = JSON.parse(out) as { result?: string; is_error?: boolean };
        if (j.is_error) return reject(new Error(`${call.command} error: ${j.result ?? err}`));
        resolve(j.result ?? "");
      } catch {
        reject(new Error(`${call.command} exited ${code}: ${(err || out).slice(0, 300)}`));
      }
    });
    child.stdin.end(prompt);
  });
}
