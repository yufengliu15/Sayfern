// Shared plumbing for downloadable dictionaries: persistence, lazy loading,
// single-flight install with progress, status.
import { promises as fsp } from "node:fs";
import path from "node:path";
import type { DictEntry, DictionaryProgress, DictionaryStatus } from "../../shared/lang";
import type { Language } from "../../shared/records";
import type { DictionaryProvider } from "../contracts";

export type FetchFn = typeof fetch;
export type ProgressFn = (p: DictionaryProgress) => void;

const FORMAT = 1;

interface Meta {
  format: number;
  version?: string;
  entries: number;
  installedAt: number;
}

export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** GET a URL into memory, reporting download progress when Content-Length is known. */
export async function download(
  fetchFn: FetchFn,
  url: string,
  onFraction: (fraction: number | undefined, bytes: number) => void,
  headers?: Record<string, string>,
): Promise<Uint8Array> {
  const res = await fetchFn(url, { headers });
  if (!res.ok) throw new Error(`Download failed (${res.status} ${res.statusText}) for ${url}`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onFraction(1, buf.length);
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onFraction(total ? Math.min(1, received / total) : undefined, received);
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export interface DictionaryInfo {
  language: Language;
  name: string;
  license: string;
  downloadMb: number;
}

/**
 * Base for dictionaries stored as `<dir>/<file>` (rows) + `<dir>/meta.json`.
 * meta.json is written last, so its presence means "installed".
 */
export abstract class StoredDictionary<Row> implements DictionaryProvider {
  protected readonly fetchFn: FetchFn;
  private meta: Meta | null | undefined;
  private metaPromise?: Promise<Meta | null>;
  private loadPromise?: Promise<boolean>;
  private installPromise?: Promise<DictionaryStatus>;
  private lastError?: string;
  private indexed = false;

  constructor(
    protected readonly dir: string,
    protected readonly info: DictionaryInfo,
    private readonly file: string,
    fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? ((...args) => globalThis.fetch(...args));
  }

  /** Download and parse the source into compact rows. */
  protected abstract fetchRows(onProgress: ProgressFn): Promise<{ version?: string; rows: Row[] }>;
  /** Build in-memory lookup structures from rows. */
  protected abstract buildIndex(rows: Row[]): void;
  /** Exact lookup against the in-memory index. */
  protected abstract find(word: string): DictEntry[];

  private get dataPath(): string {
    return path.join(this.dir, this.file);
  }

  private get metaPath(): string {
    return path.join(this.dir, "meta.json");
  }

  private readMeta(): Promise<Meta | null> {
    if (this.meta !== undefined) return Promise.resolve(this.meta);
    this.metaPromise ??= readJson<Meta>(this.metaPath).then((m) => {
      this.meta = m && m.format === FORMAT ? m : null;
      return this.meta;
    });
    return this.metaPromise;
  }

  /** True once the index is in memory (sync; used by segmentation). */
  hasIndex(): boolean {
    return this.indexed;
  }

  /** Load the persisted index if installed. Resolves to whether an index is available. */
  load(): Promise<boolean> {
    if (this.indexed) return Promise.resolve(true);
    this.loadPromise ??= (async () => {
      const meta = await this.readMeta();
      if (!meta) return false;
      const data = await readJson<{ format: number; rows: Row[] }>(this.dataPath);
      if (!data || data.format !== FORMAT) return false;
      this.buildIndex(data.rows);
      this.indexed = true;
      return true;
    })().finally(() => {
      this.loadPromise = undefined;
    });
    return this.loadPromise;
  }

  status(): Promise<DictionaryStatus> {
    return this.buildStatus(!!this.installPromise);
  }

  private async buildStatus(installing: boolean): Promise<DictionaryStatus> {
    const meta = await this.readMeta();
    return {
      language: this.info.language,
      name: this.info.name,
      license: this.info.license,
      installed: !!meta,
      entries: meta?.entries,
      version: meta?.version,
      downloadMb: this.info.downloadMb,
      installing: installing || undefined,
      error: this.lastError,
    };
  }

  install(onProgress: ProgressFn): Promise<DictionaryStatus> {
    if (this.installPromise) return this.installPromise;
    this.installPromise = this.runInstall(onProgress).finally(() => {
      this.installPromise = undefined;
    });
    return this.installPromise;
  }

  private async runInstall(onProgress: ProgressFn): Promise<DictionaryStatus> {
    const lang = this.info.language;
    const report: ProgressFn = (p) => {
      try {
        onProgress(p);
      } catch {
        // a broken progress listener must not break the install
      }
    };
    try {
      if (await this.readMeta()) {
        report({ language: lang, phase: "done", fraction: 1 });
        return await this.buildStatus(false);
      }
      this.lastError = undefined;
      const { version, rows } = await this.fetchRows(report);
      report({ language: lang, phase: "index", message: `Indexing ${rows.length} entries` });
      this.buildIndex(rows);
      this.indexed = true;
      await writeFileAtomic(this.dataPath, JSON.stringify({ format: FORMAT, rows }));
      const meta: Meta = { format: FORMAT, version, entries: rows.length, installedAt: Date.now() };
      await writeFileAtomic(this.metaPath, JSON.stringify(meta));
      this.meta = meta;
      report({ language: lang, phase: "done", fraction: 1 });
      return await this.buildStatus(false);
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      report({ language: lang, phase: "error", message: this.lastError });
      throw e;
    }
  }

  async lookup(word: string): Promise<DictEntry[]> {
    const q = word.trim();
    if (!q) return [];
    if (!(await this.load())) return [];
    return this.find(q);
  }
}
