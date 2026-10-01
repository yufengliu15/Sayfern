// CC-CEDICT (Chinese-English), CC BY-SA 4.0. https://www.mdbg.net/chinese/dictionary?page=cedict
import { gunzipSync } from "node:zlib";
import type { DictEntry, DictSense } from "../../shared/lang";
import { download, StoredDictionary, type FetchFn, type ProgressFn } from "./dictionary";
import { glossPinyin, numberedToMarks } from "./pinyin";

export const CEDICT_URL = "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz";
const MAX_WORD = 8;

export interface CedictLine {
  traditional: string;
  simplified: string;
  /** As in the file: "kao3 ya1". */
  pinyinNumbered: string;
  /** Tone marks: "kǎoyā". */
  reading: string;
  glosses: string[];
}

const LINE = /^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.*)\/\s*$/;

/** Parse one CC-CEDICT line; null for comments, blank or malformed lines. */
export function parseCedictLine(line: string): CedictLine | null {
  if (!line || line.startsWith("#")) return null;
  const m = LINE.exec(line.trim());
  if (!m) return null;
  const [, traditional, simplified, pinyinNumbered, rest] = m;
  const glosses = rest
    .split("/")
    .map((g) => g.trim())
    .filter(Boolean)
    .map(glossPinyin);
  return { traditional, simplified, pinyinNumbered, reading: numberedToMarks(pinyinNumbered), glosses };
}

/** Persisted row: [simplified, traditional variants joined by "|", reading, glosses]. */
export type CedictRow = [string, string, string, string[]];

/** Parse a whole CEDICT file, grouping lines per (simplified headword, pinyin). */
export function parseCedict(text: string): { version?: string; rows: CedictRow[] } {
  const version = /^#!\s*date=(\S+)/m.exec(text)?.[1];
  const groups = new Map<string, { head: string; variants: string[]; reading: string; glosses: string[] }>();
  for (const line of text.split(/\r?\n/)) {
    const p = parseCedictLine(line);
    if (!p) continue;
    const key = `${p.simplified}\t${p.pinyinNumbered}`;
    let g = groups.get(key);
    if (!g) {
      g = { head: p.simplified, variants: [], reading: p.reading, glosses: [] };
      groups.set(key, g);
    }
    if (p.traditional !== p.simplified && !g.variants.includes(p.traditional)) g.variants.push(p.traditional);
    for (const gl of p.glosses) if (!g.glosses.includes(gl)) g.glosses.push(gl);
  }
  const rows: CedictRow[] = [];
  for (const g of groups.values()) rows.push([g.head, g.variants.join("|"), g.reading, g.glosses]);
  return { version, rows };
}

function toEntry(row: CedictRow): DictEntry {
  const [headword, variants, reading, glosses] = row;
  const senses: DictSense[] = glosses.map((g) => (g.startsWith("CL:") ? { glosses: [g], tags: ["classifier"] } : { glosses: [g] }));
  const entry: DictEntry = { headword, reading, senses, source: "CC-CEDICT" };
  if (variants) entry.variants = variants.split("|");
  return entry;
}

export class CedictProvider extends StoredDictionary<CedictRow> {
  private rows: CedictRow[] = [];
  private bySimplified = new Map<string, number[]>();
  private byTraditional = new Map<string, number[]>();

  constructor(opts: { dir: string; fetch?: FetchFn; url?: string }) {
    super(opts.dir, { language: "zh", name: "CC-CEDICT", license: "CC BY-SA 4.0", downloadMb: 4 }, "cedict.json", opts.fetch);
    this.url = opts.url ?? CEDICT_URL;
  }

  private readonly url: string;

  protected async fetchRows(onProgress: ProgressFn) {
    onProgress({ language: "zh", phase: "download", fraction: 0 });
    const gz = await download(this.fetchFn, this.url, (fraction) => onProgress({ language: "zh", phase: "download", fraction }));
    onProgress({ language: "zh", phase: "parse", message: "Unpacking CC-CEDICT" });
    const text = gunzipSync(gz).toString("utf8");
    const parsed = parseCedict(text);
    if (parsed.rows.length === 0) throw new Error("CC-CEDICT download contained no entries");
    return parsed;
  }

  protected buildIndex(rows: CedictRow[]): void {
    this.rows = rows;
    this.bySimplified = new Map();
    this.byTraditional = new Map();
    const add = (map: Map<string, number[]>, key: string, i: number) => {
      const list = map.get(key);
      if (list) list.push(i);
      else map.set(key, [i]);
    };
    rows.forEach((row, i) => {
      add(this.bySimplified, row[0], i);
      if (row[1]) for (const t of row[1].split("|")) add(this.byTraditional, t, i);
    });
  }

  private exact(word: string): DictEntry[] {
    const idx = [...(this.bySimplified.get(word) ?? [])];
    for (const i of this.byTraditional.get(word) ?? []) if (!idx.includes(i)) idx.push(i);
    return idx.map((i) => toEntry(this.rows[i]));
  }

  protected find(word: string): DictEntry[] {
    const exact = this.exact(word);
    if (exact.length || [...word].length <= 1) return exact;
    // No entry for the whole word: fall back to its characters.
    const out: DictEntry[] = [];
    for (const ch of new Set(word)) out.push(...this.exact(ch));
    return out;
  }

  /** Length (UTF-16 units) of the longest dictionary word starting at `index`, or 0. Sync; 0 until loaded. */
  longestMatch(text: string, index: number): number {
    if (!this.hasIndex()) return 0;
    for (let len = Math.min(MAX_WORD, text.length - index); len >= 1; len--) {
      const w = text.slice(index, index + len);
      if (this.bySimplified.has(w) || this.byTraditional.has(w)) return len;
    }
    return 0;
  }
}
