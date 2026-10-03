// Deck project storage: one JSON file per project in records/decks/<id>.json (erased with
// records/), plus cached audio clips in records/deck-audio/<key>.mp3 so retries and later batches
// never pay for the same clip twice.
import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Language } from "../../shared/records";
import type { DeckBatchLog, DeckSpec, DeckStatus } from "../../shared/stage2";
import type { ModelRef } from "../../shared/types";
import { JsonFile } from "../records/io";
import type { StoredCard } from "./cards";

export type DeckWordStatus = "todo" | "added" | "duplicate" | "failed" | "skipped";

export interface DeckWord {
  word: string;
  hint?: string;
  status: DeckWordStatus;
  /** Why it was skipped or failed. */
  reason?: string;
  /** A card written ahead (the samples), used by the batch instead of asking again. */
  card?: StoredCard;
  noteId?: number;
  batch?: number;
}

export interface DeckFile {
  v: 1;
  id: string;
  language: Language;
  spec: DeckSpec;
  model: string;
  modelRef: ModelRef;
  status: DeckStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
  lastError?: string;
  activity?: string;
  guidance?: string;
  words: DeckWord[];
  /** Words left out while choosing because they are already in the learner's Anki. */
  knownSkipped: string[];
  /** The model ran out of new words: the deck ends smaller than asked. */
  exhausted?: boolean;
  samples: StoredCard[];
  recent: StoredCard[];
  batches: DeckBatchLog[];
  continuous?: boolean;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_KEY = /^[a-f0-9]{16,64}$/;

export class DeckStore {
  private index: Promise<Map<string, JsonFile<DeckFile>>> | null = null;

  constructor(
    readonly dir: string,
    readonly audioDir: string,
  ) {}

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private files(): Promise<Map<string, JsonFile<DeckFile>>> {
    if (!this.index) {
      this.index = (async () => {
        const map = new Map<string, JsonFile<DeckFile>>();
        let names: string[] = [];
        try {
          names = await readdir(this.dir);
        } catch {
          // No projects yet.
        }
        for (const n of names) {
          if (!n.endsWith(".json")) continue;
          const id = n.slice(0, -5);
          if (!SAFE_ID.test(id)) continue;
          map.set(
            id,
            new JsonFile<DeckFile>(this.path(id), () => {
              throw new Error(`Deck project file disappeared: ${id}`);
            }),
          );
        }
        return map;
      })();
    }
    return this.index;
  }

  async create(data: DeckFile): Promise<void> {
    if (!SAFE_ID.test(data.id)) throw new Error(`Bad deck project id: ${data.id}`);
    const index = await this.files();
    const file = new JsonFile<DeckFile>(this.path(data.id), () => data);
    index.set(data.id, file);
    await file.update(() => undefined);
  }

  async get(id: string): Promise<DeckFile | null> {
    const file = (await this.files()).get(id);
    if (!file) return null;
    try {
      return structuredClone(await file.get());
    } catch {
      return null;
    }
  }

  /** Serialized read-modify-write; null when the project doesn't exist. */
  async update<R>(id: string, fn: (d: DeckFile) => R): Promise<R | null> {
    const file = (await this.files()).get(id);
    if (!file) return null;
    return file.update(fn);
  }

  async remove(id: string): Promise<boolean> {
    const index = await this.files();
    const file = index.get(id);
    if (!file) return false;
    index.delete(id);
    await file.remove();
    return true;
  }

  async all(): Promise<DeckFile[]> {
    const out: DeckFile[] = [];
    for (const id of (await this.files()).keys()) {
      const d = await this.get(id);
      if (d) out.push(d);
    }
    return out;
  }

  // ------------------------------------------------------------ audio cache

  async readAudio(key: string): Promise<Buffer | null> {
    if (!SAFE_KEY.test(key)) return null;
    try {
      return await readFile(join(this.audioDir, `${key}.mp3`));
    } catch {
      return null;
    }
  }

  async writeAudio(key: string, data: Buffer): Promise<void> {
    if (!SAFE_KEY.test(key)) throw new Error("Bad audio key");
    await mkdir(this.audioDir, { recursive: true });
    const path = join(this.audioDir, `${key}.mp3`);
    const tmp = `${path}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, path);
  }
}
