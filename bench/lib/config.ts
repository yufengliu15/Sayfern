// Benchmark configuration: bench.config.json (committed defaults) merged with
// bench.config.local.json (gitignored, personal overrides). Arms merge by id.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Price } from "./types";

export const BENCH_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = resolve(BENCH_DIR, "..");

export interface Rewrite {
  from: string;
  to: string;
}

export interface SayfernArmConfig {
  id: string;
  kind: "sayfern";
  label?: string;
  enabled?: boolean;
  /** Credentials file shared with `npm run smoke -- login anthropic`. Used in place (not copied) so token refreshes persist. */
  credentials: string;
  provider?: string;
}

export interface ClaudeCodeArmConfig {
  id: string;
  kind: "claude-code";
  label?: string;
  enabled?: boolean;
  command: string;
  /** Skill folder copied into the sandbox as a project skill. */
  skill: string;
  /** "clean": fresh CLAUDE_CONFIG_DIR, needs CLAUDE_CODE_OAUTH_TOKEN (or ANTHROPIC_API_KEY). "user": your normal ~/.claude. "auto": clean when a token is set. */
  isolation: "clean" | "user" | "auto";
  permissionMode?: string;
  allowedTools?: string[];
  extraArgs?: string[];
  /** Extra environment for every claude process. "{{MODEL}}" becomes the benchmark model. */
  env?: Record<string, string>;
  /** Literal substitutions applied to the skill's text files and to fixture text ({{ROOT}} = sandbox root). */
  rewrites: Rewrite[];
  prompts: { open: Record<string, string>; end: string };
  turnTimeoutSec?: number;
  languages?: string[];
}

export type ArmConfig = SayfernArmConfig | ClaudeCodeArmConfig;

export interface BenchConfig {
  model: string;
  upstream: string;
  fixtures: string;
  reps: number;
  saveBodies: boolean;
  probeOverhead: boolean;
  prices: Record<string, Price>;
  arms: ArmConfig[];
  judge: { enabled: boolean; command: string; model: string; timeoutSec: number };
  /** The simulated learner for scenario sessions with `learner` (outside the proxy, like the judge). */
  learner: { command: string; model: string; timeoutSec: number };
  resultsDir: string;
}

export function expandPath(p: string, base = BENCH_DIR): string {
  if (p === "~" || p.startsWith("~/")) return join(homedir(), p.slice(1));
  return isAbsolute(p) ? p : resolve(base, p);
}

function merge<T>(a: T, b: unknown): T {
  if (Array.isArray(a) || typeof a !== "object" || a === null || typeof b !== "object" || b === null || Array.isArray(b)) return (b ?? a) as T;
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
    if (k === "arms" && Array.isArray(v)) {
      const arms = [...((out.arms as ArmConfig[]) ?? [])];
      for (const arm of v as ArmConfig[]) {
        const i = arms.findIndex((x) => x.id === arm.id);
        if (i >= 0) arms[i] = merge(arms[i], arm);
        else arms.push(arm);
      }
      out.arms = arms;
    } else out[k] = merge(out[k], v);
  }
  return out as T;
}

export function loadConfig(file?: string): BenchConfig {
  const base = JSON.parse(readFileSync(join(BENCH_DIR, "bench.config.json"), "utf8")) as BenchConfig;
  const localPath = file ? expandPath(file, process.cwd()) : join(BENCH_DIR, "bench.config.local.json");
  const local = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf8")) : {};
  const cfg = merge(base, local);
  delete (cfg as unknown as Record<string, unknown>)["$comment"];
  return cfg;
}

export function priceFor(cfg: BenchConfig, model: string | undefined): Price {
  if (model) {
    // Longest matching prefix wins, so dated ids ("claude-haiku-4-5-20251001") match their alias.
    const key = Object.keys(cfg.prices)
      .filter((k) => k !== "default" && model.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (key) return cfg.prices[key];
  }
  return cfg.prices.default;
}
