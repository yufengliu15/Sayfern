// Downloadable dictionaries for the languages added in v0.7:
//   - WikDict (wikdict.com, Wiktionary via DBnary, CC BY-SA): bilingual SQLite files for pairs among
//     English, Spanish, French, German, Italian, Portuguese, Russian and Japanese glosses.
//   - Kengdic (Korean-English, Joe Speigle via garfieldnate/kengdic, MPL 2.0 / LGPL).
//   - Wiktionary (English Wiktionary's Vietnamese entries, via kaikki.org/wiktextract, CC BY-SA).
//   - Open English WordNet (English definitions of English words, CC BY 4.0): English when no
//     bilingual WikDict pair exists for the interface language (and for an English interface).
// All four are stored as compact rows (SimpleRow) and looked up by exact headword, case-folded.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import JSZip from "jszip";
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
  /** Base code of the language the glosses are written in ("en", "zh"). */
  readonly glossLanguage: string = "en";
  /** Every word used in a gloss, lower case: words of the gloss language. Built on first use. */
  private glossWordSet: Set<string> | null = null;

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
    this.glossWordSet = null;
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

  /** The word (lower case) is used in some gloss, so it is a word of the gloss language. Sync; false until loaded. */
  glossWord(word: string): boolean {
    if (!this.glossWordSet) {
      this.glossWordSet = new Set();
      for (const row of this.rows) for (const [glosses] of row[2]) for (const g of glosses) for (const w of glossWords(g)) this.glossWordSet.add(w);
    }
    return this.glossWordSet.has(word);
  }

  /** The words (lower case) of every gloss of the headword. Sync; empty until loaded. */
  glossWordsOf(word: string): string[] {
    return this.find(word).flatMap((e) => e.senses.flatMap((s) => s.glosses.flatMap(glossWords)));
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

const GLOSS_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });

/** The words of a gloss, lower case. */
function glossWords(gloss: string): string[] {
  const out: string[] = [];
  for (const s of GLOSS_SEGMENTER.segment(gloss)) if (s.isWordLike) out.push(s.segment.toLocaleLowerCase());
  return out;
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
const WIKDICT_MB: Record<string, number> = { "en-zh": 5, "es-en": 11, "en-es": 14, "fr-en": 18, "de-en": 22, "it-en": 12, "pt-en": 8, "ru-en": 14, "en-fr": 16, "en-de": 18 };

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
  override readonly glossLanguage: string;

  constructor(opts: { dir: string; language: Language; gloss: string; glossName: string; targetName: string; fetch?: FetchFn; baseUrl?: string }) {
    const pair = `${opts.language}-${opts.gloss}`;
    super(
      opts.dir,
      { language: opts.language, name: `WikDict ${opts.targetName}–${opts.glossName}`, license: "CC BY-SA 3.0 (Wiktionary, DBnary)", downloadMb: WIKDICT_MB[pair] ?? 8 },
      "WikDict",
      opts.fetch,
    );
    this.url = `${opts.baseUrl ?? WIKDICT_BASE}/${pair}.sqlite3`;
    this.glossLanguage = opts.gloss;
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

// ---------------------------------------------------------------- Open English WordNet

export const OEWN_URL = "https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025-json.zip";

/** Senses kept per part of speech: lookups show 3, and every sense costs memory (128,000 words). */
const OEWN_SENSES = 3;

const OEWN_POS: Record<string, string> = { n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb" };

type OewnEntries = Record<string, Record<string, { sense?: { synset?: string }[] }>>;

/**
 * Rows from Open English WordNet's JSON release: `entries-*.json` (word → part of speech → senses in
 * frequency order) and the synset files (synset id → definition). One row per word, one sense per synset.
 */
export function parseOewn(definitions: ReadonlyMap<string, string>, entryFiles: Iterable<OewnEntries>): SimpleRow[] {
  const out: SimpleRow[] = [];
  for (const entries of entryFiles) {
    for (const [word, byPos] of Object.entries(entries)) {
      if (!word || word.length > 60) continue;
      const senses: [string[], string[]][] = [];
      let count = 0;
      // The part of speech with the most senses first (run: verb before noun).
      const groups = Object.entries(byPos).sort((x, y) => (y[1].sense?.length ?? 0) - (x[1].sense?.length ?? 0));
      for (const [pos, e] of groups) {
        count += e.sense?.length ?? 0;
        const defs = (e.sense ?? []).map((s) => (s.synset ? definitions.get(s.synset) : undefined)).filter((d): d is string => !!d);
        for (const def of [...new Set(defs)].slice(0, OEWN_SENSES)) senses.push([[def], OEWN_POS[pos] ? [OEWN_POS[pos]] : []]);
      }
      // More senses = a more common word: it ranks first among same-spelling rows.
      if (senses.length) out.push([word, "", senses, count]);
    }
  }
  return mergeRows(out);
}

export class OewnProvider extends SimpleDictionary {
  private readonly url: string;

  constructor(opts: { dir: string; fetch?: FetchFn; url?: string }) {
    super(opts.dir, { language: "en", name: "Open English WordNet", license: "CC BY 4.0", downloadMb: 9 }, "WordNet", opts.fetch);
    this.url = opts.url ?? OEWN_URL;
  }

  protected async fetchRows(onProgress: ProgressFn) {
    onProgress({ language: "en", phase: "download", fraction: 0 });
    const bytes = await download(this.fetchFn, this.url, (fraction) => onProgress({ language: "en", phase: "download", fraction }));
    onProgress({ language: "en", phase: "parse", message: `Reading ${this.info.name}` });
    const zip = await JSZip.loadAsync(bytes);
    const files = Object.values(zip.files).filter((f) => !f.dir && f.name.endsWith(".json"));
    const base = (name: string) => name.split("/").pop() ?? name;
    // Synset files first (only definitions are kept), then the word entries, one file at a time.
    const definitions = new Map<string, string>();
    for (const f of files) {
      const name = base(f.name);
      if (name.startsWith("entries-") || name === "frames.json") continue;
      const synsets = JSON.parse(await f.async("string")) as Record<string, { definition?: string[] }>;
      for (const [id, s] of Object.entries(synsets)) if (s.definition?.[0]) definitions.set(id, s.definition[0]);
    }
    const entryFiles = files.filter((f) => base(f.name).startsWith("entries-"));
    const rows: SimpleRow[] = [];
    for (const f of entryFiles) rows.push(...parseOewn(definitions, [JSON.parse(await f.async("string")) as OewnEntries]));
    if (!rows.length) throw new Error(`${this.info.name} contained no entries`);
    return { version: "2025", rows };
  }
}
