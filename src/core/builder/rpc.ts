// What a sandboxed feature UI can ask Sayfern for (the SDK's postMessage calls, forwarded by the
// renderer host). Every method and argument is checked here again; results are plain JSON with only
// the fields a feature needs. Feature storage and results live in builder/data/<id>/ (erased with
// "Erase all data"). Sandboxed code never writes grammar evidence in this version.
import { LANGUAGES, type Language } from "../../shared/records";
import { FEATURE_LIMITS, FEATURE_RPC_METHODS, type FeatureCallContext, type FeatureRpcMethod } from "../../shared/stage2";
import type { AnkiService, LanguageService, RecordsStore } from "../contracts";
import { JsonFile } from "../records/io";
import { checkId, type FeatureStore } from "./store";

export interface FeatureRpcDeps {
  store: FeatureStore;
  anki: AnkiService;
  records: RecordsStore;
  lang: LanguageService;
  now(): number;
}

export class FeatureCallError extends Error {}

const ANKI_STATUSES = ["new", "learning", "known", "suspended", "struggling", "all"];

export interface StoredResult {
  at: number;
  version: number;
  language: Language;
  preview: boolean;
  item: string;
  correct?: boolean;
  answer?: string;
  expected?: string;
  score?: number;
  kind?: string;
}

function str(v: unknown, name: string, max: number, opts: { optional?: boolean; min?: number } = {}): string | undefined {
  if (v === undefined || v === null) {
    if (opts.optional) return undefined;
    throw new FeatureCallError(`${name} is required.`);
  }
  if (typeof v !== "string") throw new FeatureCallError(`${name} must be a string.`);
  if (v.length < (opts.min ?? 0) || v.length > max) throw new FeatureCallError(`${name} must be ${opts.min ?? 0} to ${max} characters.`);
  return v;
}

function int(v: unknown, name: string, min: number, max: number, dflt: number): number {
  if (v === undefined || v === null) return dflt;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new FeatureCallError(`${name} must be a whole number from ${min} to ${max}.`);
  return v;
}

function plainObject(v: unknown, name: string): Record<string, unknown> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new FeatureCallError(`${name} must be an object.`);
  return v as Record<string, unknown>;
}

export function isRpcMethod(m: unknown): m is FeatureRpcMethod {
  return typeof m === "string" && (FEATURE_RPC_METHODS as readonly string[]).includes(m);
}

export class FeatureRpc {
  private readonly storage = new Map<string, JsonFile<Record<string, unknown>>>();
  private readonly results = new Map<string, JsonFile<StoredResult[]>>();

  constructor(private readonly deps: FeatureRpcDeps) {}

  /** Drops cached data files of a deleted feature. */
  forget(id: string): void {
    this.storage.delete(id);
    this.results.delete(id);
  }

  async call(ctx: FeatureCallContext, method: unknown, args: unknown): Promise<unknown> {
    if (!ctx || typeof ctx !== "object") throw new FeatureCallError("Missing call context.");
    const id = checkId(ctx.featureId);
    const language = ctx.language;
    if (!(LANGUAGES as readonly string[]).includes(language)) throw new FeatureCallError("Unknown language.");
    if (!isRpcMethod(method)) throw new FeatureCallError(`Unknown method: ${String(method).slice(0, 40)}`);
    if (!Array.isArray(args)) throw new FeatureCallError("Arguments must be a list.");
    let size: number;
    try {
      size = JSON.stringify(args).length;
    } catch {
      throw new FeatureCallError("Arguments must be plain JSON.");
    }
    if (size > FEATURE_LIMITS.callArgsBytes) throw new FeatureCallError("Arguments are too large.");
    const rec = await this.deps.store.get(id);
    const version = rec?.versions.find((v) => v.n === ctx.version);
    if (!rec || !version) throw new FeatureCallError("Unknown feature.");
    const preview = ctx.preview === true;
    const { anki, records, lang } = this.deps;

    switch (method) {
      case "context":
        return { featureId: id, version: version.n, language, preview };

      case "anki.words": {
        const f = plainObject(args[0], "filter");
        const status = f.status === undefined ? "all" : f.status;
        if (typeof status !== "string" || !ANKI_STATUSES.includes(status)) throw new FeatureCallError(`filter.status must be one of ${ANKI_STATUSES.join(", ")}.`);
        const filter = {
          status: status as "all",
          search: str(f.search, "filter.search", 50, { optional: true }),
          deck: str(f.deck, "filter.deck", 200, { optional: true }),
          limit: int(f.limit, "filter.limit", 1, 200, 50),
          offset: int(f.offset, "filter.offset", 0, 100_000, 0),
        };
        if (!(await anki.getConfig()).enabled) return { total: 0, items: [], syncedAt: null };
        const page = await anki.words(language, filter);
        return {
          total: page.total,
          syncedAt: page.syncedAt,
          items: page.items.map((w) => ({
            word: w.word,
            reading: w.reading,
            meaning: w.meaning,
            status: w.status,
            mature: w.mature,
            lapses: w.lapses,
            struggle: w.struggle,
          })),
        };
      }

      case "grammar.list":
        return (await records.listGrammar(language)).map((g) => ({
          id: g.point.id,
          pattern: g.point.pattern,
          name: g.point.name,
          reading: g.point.reading,
          level: g.point.level,
          explanation: g.point.explanation,
          examples: g.point.examples.slice(0, 3),
          state: g.state,
          rate: g.rate,
          lastUsedAt: g.lastUsedAt,
        }));

      case "words.saved":
        return (await records.listSavedWords(language)).map((w) => ({
          word: w.word,
          reading: w.reading,
          definition: w.definition,
          sentence: w.sentence,
          savedAt: w.createdAt,
        }));

      case "lookup": {
        const word = str(args[0], "word", 40, { min: 1 })!;
        const r = await lang.lookup(language, word);
        return {
          query: r.query,
          needsDictionary: r.needsDictionary === true,
          entries: r.entries.slice(0, 8).map((e) => ({ headword: e.headword, reading: e.reading, senses: e.senses.slice(0, 6).map((s) => ({ glosses: s.glosses.slice(0, 6) })) })),
        };
      }

      case "annotate": {
        const text = str(args[0], "text", 5000)!;
        return (await lang.annotate(language, text)).map((t) => ({ text: t.text, start: t.start, end: t.end, isWord: t.isWord, reading: t.reading, lemma: t.lemma }));
      }

      case "storage.get": {
        const key = str(args[0], "key", 100, { min: 1 })!;
        const data = await this.storageFile(id).get();
        return Object.hasOwn(data, key) ? structuredClone(data[key]) : null;
      }

      case "storage.set": {
        const key = str(args[0], "key", 100, { min: 1 })!;
        const value = args[1] === undefined ? null : structuredClone(args[1]);
        return this.storageFile(id).update((data) => {
          const next = { ...data };
          if (value === null) delete next[key];
          else next[key] = value;
          if (JSON.stringify(next).length > FEATURE_LIMITS.storageBytes) {
            throw new FeatureCallError(`Storage is full (${Math.round(FEATURE_LIMITS.storageBytes / 1024)} KB per feature).`);
          }
          if (value === null) delete data[key];
          else data[key] = value;
          return true;
        });
      }

      case "results.record": {
        const r = plainObject(args[0], "result");
        const item = str(r.item, "result.item", 200, { min: 1 })!;
        if (r.correct !== undefined && typeof r.correct !== "boolean") throw new FeatureCallError("result.correct must be true or false.");
        if (r.score !== undefined && (typeof r.score !== "number" || !(r.score >= 0 && r.score <= 1))) throw new FeatureCallError("result.score must be a number from 0 to 1.");
        const row: StoredResult = { at: this.deps.now(), version: version.n, language, preview, item };
        if (r.correct !== undefined) row.correct = r.correct as boolean;
        if (r.score !== undefined) row.score = r.score as number;
        const answer = str(r.answer, "result.answer", 200, { optional: true });
        const expected = str(r.expected, "result.expected", 200, { optional: true });
        const kind = str(r.kind, "result.kind", 40, { optional: true });
        if (answer !== undefined) row.answer = answer;
        if (expected !== undefined) row.expected = expected;
        if (kind !== undefined) row.kind = kind;
        return this.resultsFile(id).update((list) => {
          list.push(row);
          if (list.length > FEATURE_LIMITS.results) list.splice(0, list.length - FEATURE_LIMITS.results);
          return true;
        });
      }

      case "results.list": {
        const limit = int(args[0], "limit", 1, 500, 100);
        const list = await this.resultsFile(id).get();
        return list.filter((r) => r.language === language).slice(-limit).reverse();
      }
    }
  }

  /** What a feature stored, for "Export your data". */
  async exportFeature(id: string): Promise<{ storage: unknown; results: unknown }> {
    return { storage: await this.storageFile(id).get(), results: await this.resultsFile(id).get() };
  }

  private storageFile(id: string): JsonFile<Record<string, unknown>> {
    let f = this.storage.get(id);
    if (!f) {
      f = new JsonFile<Record<string, unknown>>(this.deps.store.dataFile(id, "storage"), () => ({}));
      this.storage.set(id, f);
    }
    return f;
  }

  private resultsFile(id: string): JsonFile<StoredResult[]> {
    let f = this.results.get(id);
    if (!f) {
      f = new JsonFile<StoredResult[]>(this.deps.store.dataFile(id, "results"), () => []);
      this.results.set(id, f);
    }
    return f;
  }
}
