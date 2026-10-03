// Quiz storage: one JSON file per quiz in records/quizzes/<id>.json (erased with records/,
// included in the data export). Keys and rubrics live here and never go to the renderer unanswered.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Language } from "../../shared/records";
import type { ExamSystem, QuizSpec, QuizStatus } from "../../shared/stage2";
import { JsonFile } from "../records/io";
import type { QuizItem } from "./items";

export interface QuizFile {
  v: 1;
  id: string;
  language: Language;
  title: string;
  spec: QuizSpec;
  status: QuizStatus;
  createdAt: number;
  finishedAt?: number;
  error?: string;
  model?: string;
  alignment: string;
  provenance: string;
  exam?: ExamSystem;
  /** Resolved level on the language's own scale, when known. */
  level?: string;
  items: QuizItem[];
  /** grammarId → "pattern" for display, captured when the quiz was made. */
  grammarLabels: Record<string, string>;
  retryOf?: string;
  /** Grammar evidence was recorded by finishQuiz. */
  evidenceAt?: number;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export class QuizStore {
  private index: Promise<Map<string, JsonFile<QuizFile>>> | null = null;

  constructor(readonly dir: string) {}

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private files(): Promise<Map<string, JsonFile<QuizFile>>> {
    if (!this.index) {
      this.index = (async () => {
        const map = new Map<string, JsonFile<QuizFile>>();
        let names: string[] = [];
        try {
          names = await readdir(this.dir);
        } catch {
          // No quizzes yet.
        }
        for (const n of names) {
          if (!n.endsWith(".json")) continue;
          const id = n.slice(0, -5);
          if (!SAFE_ID.test(id)) continue;
          map.set(
            id,
            new JsonFile<QuizFile>(this.path(id), () => {
              throw new Error(`Quiz file disappeared: ${id}`);
            }),
          );
        }
        return map;
      })();
    }
    return this.index;
  }

  async create(data: QuizFile): Promise<void> {
    if (!SAFE_ID.test(data.id)) throw new Error(`Bad quiz id: ${data.id}`);
    const index = await this.files();
    const file = new JsonFile<QuizFile>(this.path(data.id), () => data);
    index.set(data.id, file);
    await file.update(() => undefined);
  }

  async get(id: string): Promise<QuizFile | null> {
    const file = (await this.files()).get(id);
    if (!file) return null;
    try {
      return structuredClone(await file.get());
    } catch {
      return null;
    }
  }

  /** Serialized read-modify-write; null when the quiz doesn't exist. */
  async update<R>(id: string, fn: (q: QuizFile) => R): Promise<R | null> {
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

  async all(): Promise<QuizFile[]> {
    const out: QuizFile[] = [];
    for (const id of (await this.files()).keys()) {
      const q = await this.get(id);
      if (q) out.push(q);
    }
    return out;
  }
}
