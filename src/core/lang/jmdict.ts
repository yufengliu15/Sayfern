// JMdict (Japanese with English, German, Russian, Spanish, French or Dutch glosses), CC BY-SA 4.0
// (EDRDG), via scriptin/jmdict-simplified releases. English uses the "common words" file; the
// other gloss languages use their full files (much smaller, since fewer entries are translated).
import { gunzipSync } from "node:zlib";
import JSZip from "jszip";
import type { DictEntry } from "../../shared/lang";
import { download, StoredDictionary, type FetchFn, type ProgressFn } from "./dictionary";
import { toHiragana } from "./text";

export const JMDICT_RELEASE_API = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";
/** jmdict-simplified gloss language codes (ISO 639-2/B) by interface language. */
export const JMDICT_GLOSS: Record<string, string> = { en: "eng", de: "ger", ru: "rus", es: "spa", fr: "fre", nl: "dut" };
const assetPattern = (gloss: string): RegExp =>
  gloss === "eng" ? /^jmdict-eng-common-.*\.json\.(zip|tgz)$/ : new RegExp(`^jmdict-${gloss}-\\d.*\\.json\\.(zip|tgz)$`);

// Subset of the jmdict-simplified JSON format that we use.
interface JmWord {
  id?: string;
  kanji: { text: string; common?: boolean }[];
  kana: { text: string; common?: boolean }[];
  sense: { partOfSpeech?: string[]; misc?: string[]; gloss: { text: string; lang?: string }[] }[];
}
interface JmFile {
  version?: string;
  dictDate?: string;
  words: JmWord[];
}

/** Persisted row: [headword, variants, reading, common 0|1, senses [glosses, tags]]. */
export type JmdictRow = [string, string[], string, 0 | 1, [string[], string[]][]];

export function jmWordToRow(w: JmWord, gloss = "eng"): JmdictRow | null {
  const kanji = w.kanji ?? [];
  const kana = w.kana ?? [];
  if (!kanji.length && !kana.length) return null;
  const headword = kanji[0]?.text ?? kana[0].text;
  const reading = kana[0]?.text ?? headword;
  const forms = [...kanji.map((k) => k.text), ...kana.map((k) => k.text)];
  const variants = forms.filter((f, i) => f !== headword && f !== reading && forms.indexOf(f) === i);
  const common = kanji.some((k) => k.common) || kana.some((k) => k.common) ? 1 : 0;
  const senses: [string[], string[]][] = [];
  for (const s of w.sense ?? []) {
    const glosses = (s.gloss ?? []).filter((g) => (!g.lang && gloss === "eng") || g.lang === gloss).map((g) => g.text);
    if (!glosses.length) continue;
    senses.push([glosses, [...(s.partOfSpeech ?? []), ...(s.misc ?? [])]]);
  }
  if (!senses.length) return null;
  return [headword, variants, reading, common, senses];
}

export function parseJmdict(json: string, gloss = "eng"): { version?: string; rows: JmdictRow[] } {
  const data = JSON.parse(json) as JmFile;
  if (!Array.isArray(data.words)) throw new Error("Unexpected JMdict format: no words array");
  const rows: JmdictRow[] = [];
  for (const w of data.words) {
    const row = jmWordToRow(w, gloss);
    if (row) rows.push(row);
  }
  const version = [data.version, data.dictDate].filter(Boolean).join(" ") || undefined;
  return { version, rows };
}

/** Minimal tar reader: first regular file whose name matches. Handles ustar prefix, GNU long names, pax headers. */
export function readTarFile(tar: Uint8Array, match: (name: string) => boolean): Uint8Array | null {
  const dec = new TextDecoder();
  const str = (off: number, len: number) => {
    const b = tar.subarray(off, off + len);
    const end = b.indexOf(0);
    return dec.decode(end >= 0 ? b.subarray(0, end) : b);
  };
  let off = 0;
  let longName: string | undefined;
  while (off + 512 <= tar.length) {
    if (tar[off] === 0) break; // end-of-archive block
    let name = str(off, 100);
    const size = parseInt(str(off + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(tar[off + 156] || 48);
    const prefix = str(off + 257, 6).startsWith("ustar") ? str(off + 345, 155) : "";
    if (prefix) name = `${prefix}/${name}`;
    const dataStart = off + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    if (type === "L") longName = dec.decode(data).replace(/\0.*$/s, "");
    else if (type === "x" || type === "g") {
      const m = /\d+ path=([^\n]*)\n/.exec(dec.decode(data));
      if (m && type === "x") longName = m[1];
    } else {
      const fullName = longName ?? name;
      longName = undefined;
      if ((type === "0" || type === "\0") && match(fullName)) return data;
    }
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return null;
}

export class JmdictProvider extends StoredDictionary<JmdictRow> {
  private readonly apiUrl: string;
  private readonly gloss: string;
  private rows: JmdictRow[] = [];
  private byForm = new Map<string, number[]>();

  /** `gloss`: jmdict-simplified language code ("eng", "ger", "rus", "spa", "fre"). */
  constructor(opts: { dir: string; fetch?: FetchFn; releaseApiUrl?: string; gloss?: string; glossName?: string }) {
    const gloss = opts.gloss ?? "eng";
    const name = gloss === "eng" ? "JMdict (common words)" : `JMdict (${opts.glossName ?? gloss})`;
    const mb = { eng: 4, ger: 8, rus: 4, spa: 2, fre: 1, dut: 4 }[gloss] ?? 4;
    super(opts.dir, { language: "ja", name, license: "CC BY-SA 4.0 (EDRDG)", downloadMb: mb }, "jmdict.json", opts.fetch);
    this.apiUrl = opts.releaseApiUrl ?? JMDICT_RELEASE_API;
    this.gloss = gloss;
  }

  protected async fetchRows(onProgress: ProgressFn) {
    onProgress({ language: "ja", phase: "download", fraction: 0, message: "Finding latest JMdict release" });
    const res = await this.fetchFn(this.apiUrl, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Sayfern" } });
    if (!res.ok) throw new Error(`Could not read JMdict release info (${res.status} ${res.statusText})`);
    const release = (await res.json()) as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
    const pattern = assetPattern(this.gloss);
    const assets = (release.assets ?? []).filter((a) => pattern.test(a.name));
    const asset = assets.find((a) => a.name.endsWith(".zip")) ?? assets[0];
    if (!asset) throw new Error(`No jmdict-${this.gloss} JSON asset in the latest jmdict-simplified release`);
    const bytes = await download(this.fetchFn, asset.browser_download_url, (fraction) =>
      onProgress({ language: "ja", phase: "download", fraction, message: asset.name }),
    );
    onProgress({ language: "ja", phase: "parse", message: `Unpacking ${asset.name}` });
    let json: string;
    if (asset.name.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(bytes);
      const file = Object.values(zip.files).find((f) => !f.dir && f.name.endsWith(".json"));
      if (!file) throw new Error(`${asset.name} contains no JSON file`);
      json = await file.async("string");
    } else {
      const data = readTarFile(gunzipSync(bytes), (n) => n.endsWith(".json"));
      if (!data) throw new Error(`${asset.name} contains no JSON file`);
      json = new TextDecoder().decode(data);
    }
    onProgress({ language: "ja", phase: "parse", message: "Parsing JMdict" });
    const parsed = parseJmdict(json, this.gloss);
    if (!parsed.rows.length) throw new Error("JMdict download contained no entries");
    return { version: parsed.version ?? release.tag_name, rows: parsed.rows };
  }

  protected buildIndex(rows: JmdictRow[]): void {
    this.rows = rows;
    this.byForm = new Map();
    rows.forEach((row, i) => {
      for (const form of new Set([row[0], row[2], ...row[1]])) {
        const list = this.byForm.get(form);
        if (list) list.push(i);
        else this.byForm.set(form, [i]);
      }
    });
  }

  protected find(word: string): DictEntry[] {
    let idx = this.byForm.get(word);
    if (!idx) {
      const hira = toHiragana(word);
      if (hira !== word) idx = this.byForm.get(hira);
    }
    if (!idx) return [];
    // Headword matches first, then common words, then dictionary order.
    const ranked = [...idx].sort((a, b) => {
      const ra = this.rows[a];
      const rb = this.rows[b];
      const ha = ra[0] === word ? 0 : 1;
      const hb = rb[0] === word ? 0 : 1;
      return ha - hb || rb[3] - ra[3] || a - b;
    });
    return ranked.map((i) => {
      const [headword, variants, reading, common, senses] = this.rows[i];
      const entry: DictEntry = {
        headword,
        reading,
        senses: senses.map(([glosses, tags]) => (tags.length ? { glosses, tags } : { glosses })),
        source: "JMdict",
      };
      if (variants.length) entry.variants = variants;
      if (common) entry.common = true;
      return entry;
    });
  }
}
