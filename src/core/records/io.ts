// JSON file persistence: lazy load, in-memory cache, serialized atomic writes.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface JsonCodec<T> {
  /** Parsed JSON → in-memory value. */
  decode(raw: unknown): T;
  /** In-memory value → JSON-serializable value. */
  encode(data: T): unknown;
}

let tmpCounter = 0;

/** Write JSON to a temp file next to `path`, then rename over it. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${++tmpCounter}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}

/**
 * One JSON file with an in-memory copy. Reads load lazily once. Every mutation
 * runs on a per-file promise queue (load → mutate → write), so concurrent
 * read-modify-write calls never lose updates.
 */
export class JsonFile<T> {
  private data: T | undefined;
  private loading: Promise<T> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private removed = false;

  constructor(
    readonly path: string,
    private readonly init: () => T,
    private readonly codec?: JsonCodec<T>,
  ) {}

  /** The cached value (loaded on first call). Callers must not mutate it outside update(). */
  get(): Promise<T> {
    if (this.data !== undefined) return Promise.resolve(this.data);
    if (!this.loading) {
      this.loading = this.load().then(
        (d) => {
          this.data = d;
          return d;
        },
        (err) => {
          this.loading = null;
          throw err;
        },
      );
    }
    return this.loading;
  }

  /** Serialized mutation. `fn` mutates the cached value in place; the file is rewritten after. */
  update<R>(fn: (data: T) => R): Promise<R> {
    const run = async (): Promise<R> => {
      if (this.removed) throw new Error(`File was removed: ${this.path}`);
      const data = await this.get();
      const result = fn(data);
      await writeJsonAtomic(this.path, this.codec ? this.codec.encode(data) : data);
      return result;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Deletes the file after pending writes finish; later updates fail. */
  remove(): Promise<void> {
    const run = async (): Promise<void> => {
      this.removed = true;
      await rm(this.path, { force: true });
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private async load(): Promise<T> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (err) {
      if (isNotFound(err)) return this.init();
      throw err;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      // Keep the unreadable file for manual recovery instead of overwriting it.
      await rename(this.path, `${this.path}.corrupt-${Date.now()}`).catch(() => undefined);
      return this.init();
    }
    return this.codec ? this.codec.decode(raw) : (raw as T);
  }
}
