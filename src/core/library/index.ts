import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { LibraryService } from "../contracts";
import type { DocFormat, DocKind, Language, LibraryDoc, LibraryHit, LibraryParagraph } from "../../shared/records";
import { parseEpub } from "./epub";
import { parseHtml } from "./html";
import { readJson, writeJsonAtomic } from "./json-file";
import { parseMarkdown } from "./md";
import { parsePdf } from "./pdf";
import { buildIndex, phraseBonus, rankBm25, snippet, type DocIndex } from "./search";
import { charLength, decodeText, type ParsedDoc } from "./text";
import { parseTxt } from "./txt";

export { NO_TEXT_LAYER_WARNING } from "./pdf";

const FORMATS: Record<string, DocFormat> = {
  ".txt": "txt",
  ".md": "md",
  ".markdown": "md",
  ".html": "html",
  ".htm": "html",
  ".xhtml": "html",
  ".epub": "epub",
  ".pdf": "pdf",
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PARAGRAPH_CACHE_SIZE = 16;

export interface FileLibraryServiceOptions {
  dataDir: string;
  now?: () => number;
}

/** Parses file contents of a known format. Exported for tests and tools. */
export async function parseBytes(bytes: Uint8Array, format: DocFormat, language?: Language): Promise<ParsedDoc> {
  switch (format) {
    case "txt":
      return parseTxt(decodeText(bytes, language));
    case "md":
      return parseMarkdown(decodeText(bytes, language));
    case "html":
      return parseHtml(decodeText(bytes, language));
    case "epub":
      return parseEpub(bytes, language);
    case "pdf":
      return parsePdf(bytes);
  }
}

/**
 * Library documents stored as JSON under `dataDir/<docId>/`:
 * meta.json (LibraryDoc), paragraphs.json, index.json (search postings),
 * original.<ext>. meta.json is written last, so a folder without it is an
 * incomplete import and is ignored.
 */
export class FileLibraryService implements LibraryService {
  private readonly dataDir: string;
  private readonly now: () => number;
  private metas: Map<string, LibraryDoc> | null = null;
  private loading: Promise<Map<string, LibraryDoc>> | null = null;
  private readonly paragraphCache = new Map<string, LibraryParagraph[]>();
  private readonly indexCache = new Map<string, DocIndex>();

  constructor(opts: FileLibraryServiceOptions) {
    this.dataDir = opts.dataDir;
    this.now = opts.now ?? Date.now;
  }

  // ------------------------------------------------------------ import

  async importFile(path: string, language: Language, kind: DocKind): Promise<LibraryDoc> {
    const ext = extname(path).toLowerCase();
    const format = FORMATS[ext];
    if (!format) {
      throw new Error(
        `Sayfern can't import ${ext ? `"${ext}" files` : "files without an extension"} yet. Supported: .txt, .md, .html, .epub, .pdf.`,
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(path));
    } catch {
      throw new Error(`Couldn't read "${basename(path)}". Check that the file still exists and is readable.`);
    }
    const parsed = await parseBytes(bytes, format, language);
    const fallbackTitle = basename(path, extname(path)).trim() || "Untitled";
    return this.store({
      parsed,
      title: parsed.title?.trim() || fallbackTitle,
      language,
      kind,
      format,
      writeOriginal: (dir) => copyFile(path, join(dir, `original${ext}`)),
    });
  }

  async importText(input: { title: string; text: string; language: Language; kind: DocKind; format?: "txt" | "md" }): Promise<LibraryDoc> {
    const format = input.format ?? "txt";
    const parsed = format === "md" ? parseMarkdown(input.text) : parseTxt(input.text);
    return this.store({
      parsed,
      title: input.title.trim() || parsed.title?.trim() || "Untitled",
      language: input.language,
      kind: input.kind,
      format,
      writeOriginal: (dir) => writeFile(join(dir, `original.${format}`), input.text),
    });
  }

  private async store(args: {
    parsed: ParsedDoc;
    title: string;
    language: Language;
    kind: DocKind;
    format: DocFormat;
    writeOriginal: (dir: string) => Promise<void>;
  }): Promise<LibraryDoc> {
    const metas = await this.loadMetas();
    const id = randomUUID();
    const dir = this.docDir(id);
    const paragraphs: LibraryParagraph[] = args.parsed.paragraphs.map((p, index) =>
      p.heading ? { docId: id, index, text: p.text, heading: p.heading } : { docId: id, index, text: p.text },
    );
    const index = buildIndex(paragraphs);
    const doc: LibraryDoc = {
      id,
      language: args.language,
      title: args.title,
      kind: args.kind,
      format: args.format,
      addedAt: this.now(),
      paragraphCount: paragraphs.length,
      charCount: paragraphs.reduce((n, p) => n + charLength(p.text), 0),
      warnings: [...args.parsed.warnings],
    };
    try {
      await mkdir(dir, { recursive: true });
      await args.writeOriginal(dir);
      await writeJsonAtomic(join(dir, "paragraphs.json"), paragraphs);
      await writeJsonAtomic(join(dir, "index.json"), index);
      await writeJsonAtomic(join(dir, "meta.json"), doc);
    } catch (err) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(`Couldn't save the document to the library: ${(err as Error).message}`);
    }
    metas.set(id, doc);
    this.cacheParagraphs(id, paragraphs);
    this.indexCache.set(id, index);
    return { ...doc };
  }

  // ------------------------------------------------------------ read

  async listDocs(language: Language): Promise<LibraryDoc[]> {
    const metas = await this.loadMetas();
    return [...metas.values()]
      .filter((d) => d.language === language)
      .sort((a, b) => b.addedAt - a.addedAt)
      .map((d) => ({ ...d }));
  }

  async getDoc(docId: string): Promise<LibraryDoc | null> {
    const doc = (await this.loadMetas()).get(docId);
    return doc ? { ...doc } : null;
  }

  async getParagraphs(docId: string, from: number, count: number): Promise<LibraryParagraph[]> {
    const all = await this.paragraphs(docId);
    const start = Math.max(0, Math.floor(from) || 0);
    const n = Math.max(0, Math.floor(count) || 0);
    return all.slice(start, start + n).map((p) => ({ ...p }));
  }

  // ------------------------------------------------------------ update

  async setCheckpoint(docId: string, paragraph: number, offset: number): Promise<LibraryDoc> {
    const doc = await this.requireDoc(docId);
    if (!Number.isInteger(paragraph) || !Number.isInteger(offset) || paragraph < 0 || offset < 0) {
      throw new RangeError("Checkpoint paragraph and offset must be whole numbers, 0 or more.");
    }
    if (doc.paragraphCount === 0) {
      if (paragraph !== 0 || offset !== 0) throw new RangeError("This document has no text, so the checkpoint must be at the start.");
    } else {
      if (paragraph >= doc.paragraphCount) {
        throw new RangeError(`Paragraph ${paragraph} is out of range (the document has ${doc.paragraphCount}).`);
      }
      const [p] = await this.getParagraphs(docId, paragraph, 1);
      const max = p ? p.text.length : 0;
      if (offset > max) throw new RangeError(`Offset ${offset} is past the end of paragraph ${paragraph} (${max} characters).`);
    }
    doc.checkpoint = { paragraph, offset, at: this.now() };
    await writeJsonAtomic(join(this.docDir(docId), "meta.json"), doc);
    return { ...doc };
  }

  async renameDoc(docId: string, title: string): Promise<LibraryDoc> {
    const doc = await this.requireDoc(docId);
    const t = title.replace(/\s+/g, " ").trim();
    if (!t) throw new Error("A document title can't be empty.");
    doc.title = t;
    await writeJsonAtomic(join(this.docDir(docId), "meta.json"), doc);
    return { ...doc };
  }

  async deleteDoc(docId: string): Promise<void> {
    const metas = await this.loadMetas();
    if (!SAFE_ID.test(docId)) return;
    await rm(this.docDir(docId), { recursive: true, force: true });
    metas.delete(docId);
    this.paragraphCache.delete(docId);
    this.indexCache.delete(docId);
  }

  // ------------------------------------------------------------ search & context

  async search(language: Language, query: string, limit = 5): Promise<LibraryHit[]> {
    const q = query.trim();
    if (!q || limit <= 0) return [];
    const docs = await this.listDocs(language);
    const indexes: { docId: string; index: DocIndex }[] = [];
    for (const d of docs) {
      const index = await this.index(d.id);
      if (index) indexes.push({ docId: d.id, index });
    }
    const ranked = rankBm25(indexes, q).slice(0, Math.max(limit * 3, limit + 5));
    const titles = new Map(docs.map((d) => [d.id, d.title]));
    const hits: LibraryHit[] = [];
    for (const r of ranked) {
      const [p] = await this.getParagraphs(r.docId, r.paragraph, 1);
      if (!p) continue;
      const hit: LibraryHit = {
        docId: r.docId,
        title: titles.get(r.docId) ?? "",
        paragraph: r.paragraph,
        text: snippet(p.text, q),
        score: r.score * phraseBonus(p.text, q),
      };
      if (p.heading) hit.heading = p.heading;
      hits.push(hit);
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async personalContext(language: Language, maxChars: number): Promise<string> {
    const max = Math.max(0, Math.floor(maxChars));
    if (max === 0) return "";
    const docs = (await this.listDocs(language)).filter((d) => d.kind === "personal").sort((a, b) => a.addedAt - b.addedAt);
    let out = "";
    for (const d of docs) {
      const paras = await this.paragraphs(d.id);
      const block = `# ${d.title}\n\n${paras.map((p) => p.text).join("\n\n")}`;
      out = out ? `${out}\n\n${block}` : block;
      if (out.length > max) break;
    }
    if (out.length <= max) return out;
    let cut = out.slice(0, Math.max(0, max - 1));
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1); // don't split a surrogate pair
    return `${cut}…`;
  }

  // ------------------------------------------------------------ internals

  private docDir(docId: string): string {
    return join(this.dataDir, docId);
  }

  private async requireDoc(docId: string): Promise<LibraryDoc> {
    const doc = (await this.loadMetas()).get(docId);
    if (!doc) throw new Error("That document isn't in the library anymore.");
    return doc;
  }

  private loadMetas(): Promise<Map<string, LibraryDoc>> {
    if (this.metas) return Promise.resolve(this.metas);
    this.loading ??= (async () => {
      const map = new Map<string, LibraryDoc>();
      let names: string[] = [];
      try {
        names = await readdir(this.dataDir);
      } catch {
        // no library yet
      }
      for (const name of names) {
        if (!SAFE_ID.test(name)) continue;
        const meta = await readJson<LibraryDoc>(join(this.dataDir, name, "meta.json"));
        if (meta && meta.id === name) {
          meta.warnings ??= [];
          map.set(name, meta);
        }
      }
      this.metas = map;
      return map;
    })();
    return this.loading;
  }

  private async paragraphs(docId: string): Promise<LibraryParagraph[]> {
    const hit = this.paragraphCache.get(docId);
    if (hit) {
      // refresh LRU position
      this.paragraphCache.delete(docId);
      this.paragraphCache.set(docId, hit);
      return hit;
    }
    if (!(await this.loadMetas()).has(docId)) return [];
    const list = (await readJson<LibraryParagraph[]>(join(this.docDir(docId), "paragraphs.json"))) ?? [];
    this.cacheParagraphs(docId, list);
    return list;
  }

  private cacheParagraphs(docId: string, list: LibraryParagraph[]): void {
    this.paragraphCache.set(docId, list);
    while (this.paragraphCache.size > PARAGRAPH_CACHE_SIZE) {
      const oldest = this.paragraphCache.keys().next().value;
      if (oldest === undefined) break;
      this.paragraphCache.delete(oldest);
    }
  }

  private async index(docId: string): Promise<DocIndex | null> {
    const hit = this.indexCache.get(docId);
    if (hit) return hit;
    let index = await readJson<DocIndex>(join(this.docDir(docId), "index.json"));
    if (!index || index.v !== 1) {
      // Missing or outdated index: rebuild from paragraphs.
      const paras = await this.paragraphs(docId);
      if (paras.length === 0) return null;
      index = buildIndex(paras);
      await writeJsonAtomic(join(this.docDir(docId), "index.json"), index).catch(() => undefined);
    }
    this.indexCache.set(docId, index);
    return index;
  }
}
