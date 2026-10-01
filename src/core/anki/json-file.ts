import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const queues = new Map<string, Promise<unknown>>();

/** Atomic JSON write (temp file + rename), serialized per path. */
export function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const prev = queues.get(path) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify(value, null, 2));
        await rename(tmp, path);
      } catch (err) {
        await rm(tmp, { force: true }).catch(() => undefined);
        throw err;
      }
    });
  queues.set(path, next);
  void next
    .finally(() => {
      if (queues.get(path) === next) queues.delete(path);
    })
    .catch(() => undefined);
  return next;
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}
