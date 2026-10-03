// The read-only "builder kit" (S2-10): docs, the SDK reference, Sayfern's public extension types and
// the example extensions. The model reads it through list_kit / read_kit_file. The kit root is the repo
// (dev, tests) or a copy shipped with the app; only the paths below are readable.
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { normalizeFeaturePath } from "./paths";

/** Single files, relative to the kit root. Missing ones are skipped. */
export const KIT_FILES = [
  "docs/feature-builder.md",
  "docs/feature-sdk.d.ts",
  "docs/extensions.md",
  "src/core/contracts.ts",
  "src/core/extensions/index.ts",
  "src/shared/records.ts",
  "src/shared/lang.ts",
] as const;

/** Folders whose files are all readable. */
export const KIT_DIRS = ["examples/extensions"] as const;

const MARKER = "docs/feature-builder.md";
export const KIT_READ_LIMIT = 40_000;

/** Finds the kit root by walking up from `start` (the repo in dev and tests, the app folder when packaged). */
export function findKitRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, MARKER))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

export interface KitFile {
  path: string;
  bytes: number;
}

export class BuilderKit {
  constructor(readonly root: string | undefined) {}

  async list(): Promise<KitFile[]> {
    if (!this.root) return [];
    const out: KitFile[] = [];
    for (const p of KIT_FILES) {
      try {
        const s = await stat(join(this.root, p));
        if (s.isFile()) out.push({ path: p, bytes: s.size });
      } catch {
        // not shipped
      }
    }
    for (const d of KIT_DIRS) out.push(...(await walk(this.root, d)));
    return out;
  }

  /** Reads one kit file (only listed paths). Long files are cut at KIT_READ_LIMIT characters. */
  async read(rawPath: unknown): Promise<string> {
    if (!this.root) throw new Error("The builder kit isn't available in this build.");
    if (typeof rawPath !== "string") throw new Error("path is required");
    const path = rawPath.trim().replace(/^\.\//, "");
    const listed = await this.list();
    if (!listed.some((f) => f.path === path)) {
      throw new Error(`Not in the kit: ${path}. Call list_kit to see what you can read.`);
    }
    const text = await readFile(join(this.root, path), "utf8");
    return text.length > KIT_READ_LIMIT ? `${text.slice(0, KIT_READ_LIMIT)}\n… (cut at ${KIT_READ_LIMIT} characters)` : text;
  }
}

async function walk(root: string, rel: string, depth = 0): Promise<KitFile[]> {
  if (depth > 5) return [];
  let entries;
  try {
    entries = await readdir(join(root, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: KitFile[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = `${rel}/${e.name}`;
    if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") out.push(...(await walk(root, p, depth + 1)));
    else if (e.isFile()) {
      try {
        normalizeFeaturePath(p.slice(rel.length + 1));
      } catch {
        continue; // binaries and odd names stay out of the kit
      }
      out.push({ path: p, bytes: (await stat(join(root, p))).size });
    }
  }
  return out;
}
