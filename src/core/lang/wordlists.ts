// Downloadable dictionaries for the languages added in v0.7:
//   - WikDict (wikdict.com, Wiktionary via DBnary, CC BY-SA): bilingual SQLite files for pairs among
//     English, Spanish, French, German, Italian, Portuguese, Russian and Japanese glosses.
//   - Kengdic (Korean-English, Joe Speigle via garfieldnate/kengdic, MPL 2.0 / LGPL).
//   - Wiktionary (English Wiktionary's Vietnamese entries, via kaikki.org/wiktextract, CC BY-SA).
// All three are stored as compact rows (SimpleRow) and looked up by exact headword, case-folded.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DictEntry } from "../../shared/lang";
import type { Language } from "../../shared/records";
import { download, StoredDictionary, type DictionaryInfo, type FetchFn, type ProgressFn } from "./dictionary";

/** [headword, reading, senses [glosses, tags], importance]. */
export type SimpleRow = [string, string, [string[], string[]][], number];

/** Rows looked up by exact headword, then lower case. Also a WordIndex for the language packs. */
export abstract class SimpleDictionary extends StoredDictionary<SimpleRow> {
  private rows: SimpleRow[] = [];
  private byWord = new Map<string, number[]>();
  private byLower = new Map<string, number[]>();

  constructor(
    dir: string,
    info: DictionaryInfo,
    private readonly sourceName: string,
    fetchFn?: FetchFn,
  ) {
    super(dir, info, "words.json", fetchFn);
  }

  protected buildIndex(rows: SimpleRow[]): void {
    this.rows = rows;
    this.byWord = new Map();
    this.byLower = new Map();
    const add = (map: Map<string, number[]>, key: string, i: number) => {
      const list = map.get(key);
      if (list) list.push(i);
      else map.set(key, [i]);
    };
    rows.forEach((row, i) => {
      add(this.byWord, row[0], i);
      add(this.byLower, row[0].toLocaleLowerCase(), i);
    });
  }

  /** Exact headword (or its lower case) is in the dictionary. Sync; false until loaded. */
  has(word: string): boolean {
    return this.byWord.has(word) || this.byLower.has(word.toLocaleLowerCase());
  }

  protected find(word: string): DictEntry[] {
    const idx = this.byWord.get(word) ?? this.byLower.get(word.toLocaleLowerCase()) ?? [];
    return [...idx]
      .sort((a, b) => this.rows[b][3] - this.rows[a][3] || a - b)
      .map((i) => {
        const [headword, reading, senses] = this.rows[i];
        return {
          headword,
          reading,
          senses: senses.map(([glosses, tags]) => (tags.length ? { glosses, tags } : { glosses })),
          source: this.sourceName,
        };
      });
  }
}

/** Groups rows with the same headword into one row (senses in order), keeping the best importance. */
export function mergeRows(rows: SimpleRow[]): SimpleRow[] {
  const byKey = new Map<string, SimpleRow>();
  for (const r of rows) {
    const key = `${r[0]}\u0000${r[1]}`;
    const cur = byKey.get(key);
    if (!cur) byKey.set(key, [r[0], r[1], [...r[2]], r[3]]);
    else {
      for (const s of r[2]) if (!cur[2].some((c) => c[0].join("|") === s[0].join("|"))) cur[2].push(s);
      cur[3] = Math.max(cur[3], r[3]);
    }
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------- WikDict

export const WIKDICT_BASE = "https://download.wikdict.com/dictionaries/sqlite/2";
/** Languages WikDict publishes pairs for, among the ones Sayfern uses. */
export const WIKDICT_LANGS = new Set(["en", "es", "fr", "de", "it", "pt", "ru", "ja"]);
const MAX_GLOSSES = 6;

/** Rough download sizes (MB) for the common pairs; others default to 8. */
const WIKDICT_MB: Record<string, number> = { "es-en": 11, "en-es": 14, "fr-en": 18, "de-en": 22, "it-en": 12, "pt-en": 8, "ru-en": 14, "en-fr": 16, "en-de": 18 };

/** WikDict glosses carry some wiki markup: <u>, [[links]], stray "- s" plural hints. */
export function cleanGloss(g: string): string {
  return g
    .replace(/<[^>]+>/g, "")
    .replace(/\[\[|\]\]/g, "")
    .replace(/\s+-\s+\S{1,3}$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rows from WikDict's `translation` table: written_rep, trans_list ("house | home"), importance. */
export function wikdictRows(records: Iterable<{ written_rep: unknown; trans_list: unknown; importance?: unknown; score?: unknown }>): SimpleRow[] {
  const out: SimpleRow[] = [];
  for (const r of records) {
    const head = typeof r.written_rep === "string" ? r.written_rep.replace(/^"|"$/g, "").replace(/\[\[|\]\]/g, "").trim() : "";
    const list = typeof r.trans_list === "string" ? r.trans_list : "";
    if (!head || !list || head.length > 60) continue;
    const glosses = [...new Set(list.split("|").map(cleanGloss).filter((g) => g && g.length <= 80))].slice(0, MAX_GLOSSES);
    if (!glosses.length) continue;
    const importance = typeof r.importance === "number" ? r.importance : typeof r.score === "number" ? r.score / 100 : 0;
    out.push([head, "", [[glosses, []]], importance]);
  }
  return mergeRows(out);
}

export class WikdictProvider extends SimpleDictionary {
  private readonly url: string;

  constructor(opts: { dir: string; language: Language; gloss: string; glossName: string; targetName: string; fetch?: FetchFn; baseUrl?: string }) {
    const pair = `${opts.language}-${opts.gloss}`;
    super(
      opts.dir,
      { language: opts.language, name: `WikDict ${opts.targetName}–${opts.glossName}`, license: "CC BY-SA 3.0 (Wiktionary, DBnary)", downloadMb: WIKDICT_MB[pair] ?? 8 },
      "WikDict",
      opts.fetch,
    );
    this.url = `${opts.baseUrl ?? WIKDICT_BASE}/${pair}.sqlite3`;
  }

  protected async fetchRows(onProgress: ProgressFn) {
    const language = this.info.language;
    onProgress({ language, phase: "download", fraction: 0 });
    const bytes = await download(this.fetchFn, this.url, (fraction) => onProgress({ language, phase: "download", fraction }));
    onProgress({ language, phase: "parse", message: `Reading ${this.info.name}` });
    // node:sqlite reads from a file: write the download to a temporary folder, read, delete.
    const tmp = await mkdtemp(path.join(tmpdir(), "sayfern-wikdict-"));
    try {
      const file = path.join(tmp, "dict.sqlite3");
      await writeFile(file, bytes);
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        const records = db.prepare("SELECT written_rep, trans_list, importance, score FROM translation").all() as {
          written_rep: unknown;
          trans_list: unknown;
          importance: unknown;
          score: unknown;
        }[];
        const rows = wikdictRows(records);
        if (!rows.length) throw new Error(`${this.info.name} contained no entries`);
        return { version: new Date().toISOString().slice(0, 10), rows };
      } finally {
        db.close();
      }
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------- Kengdic (Korean)

export const KENGDIC_URL = "https://raw.githubusercontent.com/garfieldnate/kengdic/master/kengdic.tsv";

/** Rows from kengdic.tsv: id, surface, hanja, gloss, level, created, source. */
export function parseKengdic(tsv: string): SimpleRow[] {
  const out: SimpleRow[] = [];
  const lines = tsv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const surface = (cols[1] ?? "").replace(/\s+/g, " ").trim();
    const hanja = (cols[2] ?? "").trim();
    const gloss = (cols[3] ?? "").replace(/\s+/g, " ").trim();
    if (!surface || !gloss) continue;
    const glosses = gloss
      .split(/\s*;\s*/)
      .map((g) => g.trim())
      .filter(Boolean)
      .slice(0, MAX_GLOSSES);
    // Shorter entries (single words) rank above phrases.
    out.push([surface, "", [[glosses, hanja ? [hanja] : []]], surface.includes(" ") ? 0 : 1]);
  }
  return mergeRows(out);
}

export class KengdicProvider extends SimpleDictionary {
  private readonly url: string;

  constructor(opts: { dir: string; fetch?: FetchFn; url?: string }) {
    super(opts.dir, { language: "ko", name: "Kengdic (Korean–English)", license: "MPL 2.0 / LGPL 2.0", downloadMb: 12 }, "Kengdic", opts.fetch);
    this.url = opts.url ?? KENGDIC_URL;
  }

  protected async fetchRows(onProgress: ProgressFn) {
    onProgress({ language: "ko", phase: "download", fraction: 0 });
    const bytes = await download(this.fetchFn, this.url, (fraction) => onProgress({ language: "ko", phase: "download", fraction }));
    onProgress({ language: "ko", phase: "parse", message: "Reading Kengdic" });
    const rows = parseKengdic(new TextDecoder().decode(bytes));
    if (!rows.length) throw new Error("Kengdic download contained no entries");
    return { rows };
  }
}

// ---------------------------------------------------------------- Wiktionary via kaikki.org (Vietnamese)

export const KAIKKI_VI_URL = "https://kaikki.org/dictionary/Vietnamese/kaikki.org-dictionary-Vietnamese.jsonl";

interface KaikkiEntry {
  word?: string;
  pos?: string;
  lang_code?: string;
  senses?: { glosses?: string[]; tags?: string[] }[];
}

/** Rows from a kaikki.org JSONL file (one wiktextract entry per line), for one language code. */
export function parseKaikki(jsonl: string, langCode: string): SimpleRow[] {
  const out: SimpleRow[] = [];
  let start = 0;
  while (start < jsonl.length) {
    let end = jsonl.indexOf("\n", start);
    if (end < 0) end = jsonl.length;
    const line = jsonl.slice(start, end).trim();
    start = end + 1;
    if (!line) continue;
    let e: KaikkiEntry;
    try {
      e = JSON.parse(line) as KaikkiEntry;
    } catch {
      continue;
    }
    if (!e.word || (e.lang_code && e.lang_code !== langCode)) continue;
    const senses: [string[], string[]][] = [];
    for (const s of e.senses ?? []) {
      const g = (s.glosses ?? []).map((x) => x.trim()).filter(Boolean);
      if (!g.length || (s.tags ?? []).includes("form-of")) continue;
      senses.push([[g[g.length - 1]], e.pos ? [e.pos] : []]);
      if (senses.length >= MAX_GLOSSES) break;
    }
    if (senses.length) out.push([e.word, "", senses, e.pos === "name" ? 0 : 1]);
  }
  return mergeRows(out);
}

export class KaikkiProvider extends SimpleDictionary {
  private readonly url: string;
  private readonly langCode: string;

  constructor(opts: { dir: string; language: Language; name: string; url: string; downloadMb: number; fetch?: FetchFn }) {
    super(opts.dir, { language: opts.language, name: opts.name, license: "CC BY-SA 4.0 (Wiktionary, via kaikki.org)", downloadMb: opts.downloadMb }, "Wiktionary", opts.fetch);
    this.url = opts.url;
    this.langCode = opts.language;
  }

  protected async fetchRows(onProgress: ProgressFn) {
    const language = this.info.language;
    onProgress({ language, phase: "download", fraction: 0 });
    // The server sends this file gzip-encoded; fetch decodes it.
    const bytes = await download(this.fetchFn, this.url, (fraction) => onProgress({ language, phase: "download", fraction }));
    onProgress({ language, phase: "parse", message: `Reading ${this.info.name}` });
    const rows = parseKaikki(new TextDecoder().decode(bytes), this.langCode);
    if (!rows.length) throw new Error(`${this.info.name} download contained no entries`);
    return { version: new Date().toISOString().slice(0, 10), rows };
  }
}
