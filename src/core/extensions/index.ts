// User extensions (F-09). Each extension is a folder `<dir>/<id>/` with a
// package.json and an ESM entry that exports `activate(api)`. See docs/extensions.md.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { TSchema } from "@earendil-works/pi-ai";
import type { ExtensionInfo } from "../../shared/api";
import type { Language } from "../../shared/records";
import type { DictionaryProvider, ExtensionHost, LanguagePack, LanguageService, ToolContext, TutorTool } from "../contracts";

/** What an extension passes to `registerTool`. Looser than TutorTool: plain JSON schema is fine. */
export interface ExtensionToolInput {
  name: string;
  description: string;
  /** TypeBox schema or a plain JSON schema object. Default: no parameters. */
  parameters?: TSchema | Record<string, unknown>;
  /** True when the tool only stores data and the model needs no result (the turn ends after it). Default false. */
  recordingOnly?: boolean;
  /** Return a string (sent to the model) or `{ content, activity }` (activity = one line for the inspector). */
  execute(args: unknown, ctx: ToolContext): unknown;
}

/** The object passed to an extension's `activate(api)`. */
export interface ExtensionApi {
  /** Folder id of this extension. */
  readonly id: string;
  /** Absolute folder path, for reading bundled data files. */
  readonly path: string;
  registerTool(tool: ExtensionToolInput): void;
  addPromptAddition(fn: (language: Language) => string | undefined): void;
  registerLanguage(pack: LanguagePack, dictionary?: DictionaryProvider): void;
  log(...args: unknown[]): void;
}

export interface FileExtensionHostOptions {
  /** Folder holding one sub-folder per extension. */
  dir: string;
  /** Enabled flags. Default: `<dir>/../extensions.json`. */
  stateFile?: string;
  /** Needed for `registerLanguage`. */
  lang?: LanguageService;
  log?: (id: string, ...args: unknown[]) => void;
}

/**
 * An extension managed by the feature builder (S2-13): loaded from its version folder, not from `dir`.
 * Its main-side entry (full app access) is only imported when the folder's current hash was approved.
 */
export interface ManagedExtension {
  id: string;
  /** Folder of the version to load. */
  dir: string;
  enabled: boolean;
  /** Content hashes (hashDir) the learner approved after reading the code. */
  approvedHashes: string[];
}

export interface ManagedExtensionSource {
  list(): Promise<ManagedExtension[]>;
}

interface Loaded {
  managed?: boolean;
  info: ExtensionInfo;
  tools: TutorTool[];
  additions: ((language: Language) => string | undefined)[];
  deactivate?: () => unknown;
}

interface StateFile {
  enabled: Record<string, boolean>;
}

const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const EMPTY_PARAMS = { type: "object", properties: {} } as unknown as TSchema;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class FileExtensionHost implements ExtensionHost {
  readonly dir: string;
  private readonly stateFile: string;
  private readonly lang?: LanguageService;
  private readonly logFn: (id: string, ...args: unknown[]) => void;
  private loaded: Loaded[] = [];
  /** Bumped on every load so re-imports bypass the ESM module cache. */
  private generation = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private managed?: ManagedExtensionSource;

  constructor(opts: FileExtensionHostOptions) {
    this.dir = resolve(opts.dir);
    this.stateFile = opts.stateFile ?? join(dirname(this.dir), "extensions.json");
    this.lang = opts.lang;
    this.logFn = opts.log ?? ((id, ...args) => console.log(`[extension ${id}]`, ...args));
  }

  // ------------------------------------------------------------ ExtensionHost (consumed by the tutor)

  tools(): TutorTool[] {
    return this.loaded.filter((l) => l.info.enabled && !l.info.error).flatMap((l) => l.tools);
  }

  promptAdditions(language: Language): string[] {
    const out: string[] = [];
    for (const l of this.loaded) {
      if (!l.info.enabled || l.info.error) continue;
      for (const fn of l.additions) {
        try {
          const text = fn(language);
          if (typeof text === "string" && text.trim()) out.push(text.trim());
        } catch (err) {
          this.logFn(l.info.id, "prompt addition failed:", errorText(err));
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------ management

  /** Hand-installed extensions (the `extensions/` folder). */
  list(): ExtensionInfo[] {
    return this.loaded.filter((l) => !l.managed).map((l) => structuredClone(l.info));
  }

  /** Builder-made features as loaded by the host (errors include refused, unapproved code). */
  managedList(): ExtensionInfo[] {
    return this.loaded.filter((l) => l.managed).map((l) => structuredClone(l.info));
  }

  /** The feature builder registers its features here; they load after the folder's extensions on every (re)load. */
  setManagedSource(source: ManagedExtensionSource | undefined): void {
    this.managed = source;
  }

  /** (Re)loads every extension folder. Never throws for a broken extension. */
  load(): Promise<ExtensionInfo[]> {
    return this.enqueue(() => this.loadAll());
  }

  setEnabled(id: string, enabled: boolean): Promise<ExtensionInfo[]> {
    return this.enqueue(async () => {
      const state = await this.readState();
      state.enabled[id] = enabled;
      await this.writeState(state);
      return this.loadAll();
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async loadAll(): Promise<ExtensionInfo[]> {
    for (const l of this.loaded) {
      try {
        await l.deactivate?.();
      } catch (err) {
        this.logFn(l.info.id, "deactivate failed:", errorText(err));
      }
    }
    this.loaded = [];
    this.generation++;
    const state = await this.readState();
    let names: string[] = [];
    try {
      names = (await readdir(this.dir, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name)
        .sort();
    } catch {
      // No extensions folder yet.
    }
    const loaded: Loaded[] = [];
    for (const id of names) loaded.push(await this.loadOne(id, state.enabled[id] !== false));
    let managed: ManagedExtension[] = [];
    try {
      managed = (await this.managed?.list()) ?? [];
    } catch (err) {
      this.logFn("builder", "couldn't list features:", errorText(err));
    }
    for (const m of managed) {
      if (names.includes(m.id)) continue; // a hand-installed folder with the same id wins
      const l = await this.loadOne(m.id, m.enabled, { dir: resolve(m.dir), approvedHashes: m.approvedHashes });
      l.managed = true;
      loaded.push(l);
    }
    this.loaded = loaded;
    return this.list();
  }

  private async loadOne(id: string, enabled: boolean, managed?: { dir: string; approvedHashes: string[] }): Promise<Loaded> {
    const path = managed?.dir ?? join(this.dir, id);
    const info: ExtensionInfo = {
      id,
      name: id,
      description: "",
      version: "0.0.0",
      enabled,
      path,
      contributes: { tools: [], languages: [] },
    };
    const entry: Loaded = { info, tools: [], additions: [] };

    let pkg: { name?: unknown; version?: unknown; description?: unknown; main?: unknown };
    try {
      pkg = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
    } catch (err) {
      info.error = `Couldn't read package.json: ${errorText(err)}`;
      return entry;
    }
    if (typeof pkg.name === "string" && pkg.name.trim()) info.name = pkg.name.trim();
    if (typeof pkg.version === "string") info.version = pkg.version;
    if (typeof pkg.description === "string") info.description = pkg.description;
    if (!enabled) return entry;

    const main = typeof pkg.main === "string" && pkg.main.trim() ? pkg.main.trim() : "index.js";
    const file = resolve(path, main);
    if (file !== path && !file.startsWith(path + sep)) {
      info.error = `"main" must point inside the extension folder.`;
      return entry;
    }
    try {
      if (!(await stat(file)).isFile()) throw new Error("not a file");
    } catch {
      // A builder feature without a main entry is UI-only (sandboxed): nothing to import.
      if (managed && pkg.main === undefined) return entry;
      info.error = `Entry file not found: ${main}`;
      return entry;
    }
    if (managed) {
      // Review gate: builder-made code with full access runs only if this exact code was approved.
      let hash: string;
      try {
        hash = await hashDir(path);
      } catch (err) {
        info.error = `Couldn't check the feature's code: ${errorText(err)}`;
        return entry;
      }
      if (!managed.approvedHashes.includes(hash)) {
        info.error = "This version's code hasn't been approved, or changed after you approved it. Review it in Customize.";
        return entry;
      }
    }

    // Contributions are staged and only kept if activate() succeeds.
    const tools: TutorTool[] = [];
    const additions: Loaded["additions"] = [];
    const languages: { pack: LanguagePack; dictionary?: DictionaryProvider }[] = [];
    let active = true;
    const guard = (what: string) => {
      if (!active) throw new Error(`${what} is only available during activate()`);
    };
    const api: ExtensionApi = {
      id,
      path,
      registerTool: (t) => {
        guard("registerTool");
        tools.push(normalizeTool(t));
      },
      addPromptAddition: (fn) => {
        guard("addPromptAddition");
        if (typeof fn !== "function") throw new Error("addPromptAddition expects a function (language) => string");
        additions.push(fn);
      },
      registerLanguage: (pack, dictionary) => {
        guard("registerLanguage");
        if (!pack?.info?.id) throw new Error("registerLanguage expects a LanguagePack with info.id");
        languages.push({ pack, dictionary });
      },
      log: (...args) => this.logFn(id, ...args),
    };

    try {
      const mod = (await import(/* @vite-ignore */ `${pathToFileURL(file).href}?v=${this.generation}`)) as Record<string, unknown>;
      const def = mod.default as Record<string, unknown> | ((api: ExtensionApi) => unknown) | undefined;
      const activate =
        (typeof mod.activate === "function" ? mod.activate : undefined) ??
        (def && typeof def === "object" && typeof def.activate === "function" ? def.activate : undefined) ??
        (typeof def === "function" ? def : undefined);
      if (!activate) throw new Error("The entry file doesn't export an activate(api) function.");
      await (activate as (api: ExtensionApi) => unknown)(api);
      const deactivate =
        (typeof mod.deactivate === "function" ? mod.deactivate : undefined) ??
        (def && typeof def === "object" && typeof def.deactivate === "function" ? def.deactivate : undefined);
      if (deactivate) entry.deactivate = deactivate as () => unknown;
    } catch (err) {
      info.error = errorText(err);
      return entry;
    } finally {
      active = false;
    }

    for (const { pack, dictionary } of languages) {
      if (!this.lang) {
        this.logFn(id, `registerLanguage(${pack.info.id}) ignored: no language service`);
        continue;
      }
      try {
        this.lang.registerPack(pack, dictionary);
        info.contributes.languages.push(pack.info.id);
      } catch (err) {
        info.error = `registerLanguage failed: ${errorText(err)}`;
        return entry;
      }
    }
    entry.tools = tools;
    entry.additions = additions;
    info.contributes.tools = tools.map((t) => t.name);
    return entry;
  }

  private async readState(): Promise<StateFile> {
    try {
      const raw = JSON.parse(await readFile(this.stateFile, "utf8")) as Partial<StateFile>;
      return { enabled: raw && typeof raw.enabled === "object" && raw.enabled ? { ...raw.enabled } : {} };
    } catch {
      return { enabled: {} };
    }
  }

  private async writeState(state: StateFile): Promise<void> {
    await mkdir(dirname(this.stateFile), { recursive: true });
    const tmp = `${this.stateFile}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, this.stateFile);
  }
}

/** Default inspector line for an extension tool. English; the renderer translates the "Used {name}" pattern. */
const used = (name: string): string => `Used ${name}`;

function normalizeTool(t: ExtensionToolInput): TutorTool {
  if (!t || typeof t !== "object") throw new Error("registerTool expects a tool object");
  if (typeof t.name !== "string" || !TOOL_NAME.test(t.name)) {
    throw new Error(`Invalid tool name ${JSON.stringify(t.name)}: use letters, digits, _ or - (max 64).`);
  }
  if (typeof t.execute !== "function") throw new Error(`Tool ${t.name} has no execute function`);
  const parameters =
    t.parameters && typeof t.parameters === "object" ? (t.parameters as TSchema) : EMPTY_PARAMS;
  const execute = t.execute.bind(t);
  return {
    name: t.name,
    description: typeof t.description === "string" ? t.description : "",
    parameters,
    recordingOnly: t.recordingOnly === true,
    async execute(args, ctx) {
      const out = await execute(args, ctx);
      if (typeof out === "string") return { content: out, activity: used(t.name) };
      if (out && typeof out === "object") {
        const o = out as { content?: unknown; activity?: unknown };
        const content = typeof o.content === "string" ? o.content : JSON.stringify(out);
        return { content, activity: typeof o.activity === "string" && o.activity ? o.activity : used(t.name) };
      }
      return { content: out === undefined ? "Done." : String(out), activity: used(t.name) };
    },
  };
}

/** sha256 over sorted (path, bytes) pairs. The same files always give the same hash. */
export function hashFiles(files: Iterable<[path: string, data: string | Uint8Array]>): string {
  const h = createHash("sha256");
  const sorted = [...files].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [path, data] of sorted) {
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    h.update(`${path}\0${bytes.length}\0`);
    h.update(bytes);
  }
  return h.digest("hex");
}

/** Every regular file under `dir` (posix relative paths). Symlinks and other entries are refused. */
export async function readDirFiles(dir: string): Promise<[string, Buffer][]> {
  const out: [string, Buffer][] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) out.push([relative(dir, full).split(sep).join("/"), await readFile(full)]);
      else throw new Error(`Unexpected entry ${relative(dir, full)}`);
    }
  };
  await walk(dir);
  return out;
}

/** Content hash of a folder (see hashFiles). */
export async function hashDir(dir: string): Promise<string> {
  return hashFiles(await readDirFiles(dir));
}
