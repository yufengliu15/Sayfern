// settings.json (same file and shape as v0.1: language, model, deviceId, ...).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { LANGUAGES } from "../../shared/records";
import type { Settings } from "../../shared/types";

export const DEFAULT_SETTINGS: Settings = { language: "zh", languages: [...LANGUAGES] };

export class SettingsStore {
  private cache: Settings | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(readonly path: string) {}

  async get(): Promise<Settings> {
    if (!this.cache) {
      let stored: Partial<Settings> = {};
      try {
        const raw: unknown = JSON.parse(await readFile(this.path, "utf8"));
        if (raw && typeof raw === "object" && !Array.isArray(raw)) stored = raw as Partial<Settings>;
      } catch {
        // Missing or unreadable: defaults.
      }
      this.cache = { ...DEFAULT_SETTINGS, ...stored };
      if (!this.cache.languages?.length) this.cache.languages = [...LANGUAGES];
    }
    return structuredClone(this.cache);
  }

  /** Shallow merge; `undefined` values in the patch are ignored. Serialized. */
  update(patch: Partial<Settings>): Promise<Settings> {
    const task = async () => {
      const next: Settings = await this.get();
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) (next as unknown as Record<string, unknown>)[k] = structuredClone(v);
      }
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify(next, null, 2));
      await rename(tmp, this.path);
      this.cache = next;
      return structuredClone(next);
    };
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }
}
