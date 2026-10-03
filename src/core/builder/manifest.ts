// Reads a feature's package.json: name, description, surfaces (sandboxed UI) and the optional
// main-side entry (full app access). Pure: takes the version's files as a map.
import type { FeatureSurface, FeatureSurfaceKind } from "../../shared/stage2";
import { LANGUAGES, type Language } from "../../shared/records";
import { extensionOf, importSpecifiers, normalizeFeaturePath, resolveRelative } from "./paths";

export interface FeatureManifest {
  name: string;
  description: string;
  version: string;
  surfaces: FeatureSurface[];
  /** Main-side entry (runs with full access), resolved like the extension host does. */
  main?: string;
}

const KINDS: readonly FeatureSurfaceKind[] = ["tab", "activity"];
const LANGS: readonly Language[] = LANGUAGES;
export const MAX_SURFACES = 8;

/** Parses and validates package.json against the files present. Returns readable problems instead of throwing. */
export function readManifest(files: ReadonlyMap<string, string>): { manifest?: FeatureManifest; problems: string[] } {
  const problems: string[] = [];
  const raw = files.get("package.json");
  if (raw == null) return { problems: ["package.json is missing."] };
  let pkg: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    pkg = parsed as Record<string, unknown>;
  } catch (err) {
    return { problems: [`package.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const name = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim().slice(0, 60) : "";
  if (!name) problems.push(`package.json needs a "name".`);
  const description = typeof pkg.description === "string" ? pkg.description.trim().slice(0, 300) : "";
  const version = typeof pkg.version === "string" ? pkg.version : "0.0.0";
  if (pkg.type !== "module") problems.push(`package.json needs "type": "module".`);

  let main: string | undefined;
  if (pkg.main !== undefined) {
    try {
      main = normalizeFeaturePath(pkg.main);
      if (![".js", ".mjs"].includes(extensionOf(main))) problems.push(`"main" must be a .js file.`);
      else if (!files.has(main)) problems.push(`"main" points to ${main}, which doesn't exist.`);
    } catch (err) {
      problems.push(`"main": ${err instanceof Error ? err.message : String(err)}`);
      main = undefined;
    }
  } else if (files.has("index.js")) {
    main = "index.js";
  }

  const surfaces: FeatureSurface[] = [];
  const block = pkg.sayfern;
  if (block !== undefined && (typeof block !== "object" || block === null || Array.isArray(block))) {
    problems.push(`"sayfern" must be an object.`);
  }
  const list = block && typeof block === "object" ? (block as { surfaces?: unknown }).surfaces : undefined;
  if (list !== undefined && !Array.isArray(list)) problems.push(`"sayfern.surfaces" must be an array.`);
  if (Array.isArray(list)) {
    if (list.length > MAX_SURFACES) problems.push(`At most ${MAX_SURFACES} surfaces.`);
    list.slice(0, MAX_SURFACES).forEach((s, i) => {
      const where = `sayfern.surfaces[${i}]`;
      if (!s || typeof s !== "object") return void problems.push(`${where} must be an object.`);
      const o = s as Record<string, unknown>;
      if (!KINDS.includes(o.kind as FeatureSurfaceKind)) return void problems.push(`${where}.kind must be "tab" or "activity".`);
      const title = typeof o.title === "string" ? o.title.trim() : "";
      if (!title || title.length > 40) return void problems.push(`${where}.title must be 1 to 40 characters.`);
      let entry: string;
      try {
        entry = normalizeFeaturePath(o.entry);
      } catch (err) {
        return void problems.push(`${where}.entry: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (extensionOf(entry) !== ".html") return void problems.push(`${where}.entry must be an .html file.`);
      if (!files.has(entry)) return void problems.push(`${where}.entry points to ${entry}, which doesn't exist.`);
      const surface: FeatureSurface = { kind: o.kind as FeatureSurfaceKind, title, entry };
      if (typeof o.description === "string" && o.description.trim()) surface.description = o.description.trim().slice(0, 120);
      if (o.languages !== undefined) {
        if (!Array.isArray(o.languages) || o.languages.some((l) => !LANGS.includes(l as Language))) {
          return void problems.push(`${where}.languages must list language codes Sayfern teaches: ${LANGS.map((l) => `"${l}"`).join(", ")}.`);
        }
        if (o.languages.length) surface.languages = [...new Set(o.languages as Language[])];
      }
      surfaces.push(surface);
    });
  }
  if (surfaces.length === 0 && !main) problems.push(`The feature has no surfaces in "sayfern.surfaces" and no "main" entry, so it does nothing.`);
  return { manifest: { name: name || "Untitled feature", description, version, surfaces, main }, problems };
}

/** Files that run with full access: the main entry and every module it imports (relative imports only). */
export function mainSideFiles(files: ReadonlyMap<string, string>, main: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!main || !files.has(main)) return out;
  const queue = [main];
  while (queue.length) {
    const f = queue.pop()!;
    if (out.has(f)) continue;
    out.add(f);
    for (const spec of importSpecifiers(files.get(f) ?? "")) {
      const target = resolveRelative(f, spec);
      if (target && files.has(target) && !out.has(target)) queue.push(target);
    }
  }
  return out;
}

/** Code patterns that load or build code at run time, so what was reviewed might not be what runs. */
const DYNAMIC_CODE: [RegExp, string][] = [
  [/\bimport\s*\(\s*(?!(["'])[^"'\n]*\1\s*\))/, "import() with a computed path"],
  [/\brequire\s*\(/, "require()"],
  [/\bcreateRequire\b/, "createRequire"],
  [/\bimport\.meta\.resolve\b/, "import.meta.resolve"],
  [/\beval\s*\(/, "eval()"],
  [/\bnew\s+Function\b|\bFunction\s*\(/, "new Function()"],
  [/\bprocess\.dlopen\b/, "process.dlopen"],
  [/\bvm\.(?:runIn|Script|SourceTextModule|compileFunction)/, "node:vm"],
];

/**
 * Review-gate rules for code that runs with full access (S2-12): every module the main entry can load is
 * reachable by static, literal, relative imports inside the version folder (or node: built-ins), and none
 * of it builds or loads code at run time. Then the approved hash covers everything that runs.
 */
export function checkMainSideCode(files: ReadonlyMap<string, string>, main: string | undefined): string[] {
  if (!main) return [];
  const problems: string[] = [];
  for (const f of mainSideFiles(files, main)) {
    const src = files.get(f) ?? "";
    for (const spec of importSpecifiers(src)) {
      if (spec.startsWith("node:")) continue;
      const target = resolveRelative(f, spec);
      if (!target) problems.push(`${f} imports ${JSON.stringify(spec)}: full-access code may only import the feature's own files (./…) and node: built-ins.`);
      else if (!files.has(target)) problems.push(`${f} imports ${JSON.stringify(spec)}, which isn't a file of this version.`);
    }
    for (const [re, what] of DYNAMIC_CODE) {
      if (re.test(src)) problems.push(`${f} uses ${what}. Full-access code must import everything statically so the review covers what runs.`);
    }
  }
  return problems;
}

/**
 * Files the review sheet flags as full access: with a main entry, every .js/.mjs outside ui/ plus anything
 * the main entry imports (test.js only when imported).
 */
export function fullAccessFiles(files: ReadonlyMap<string, string>, main: string | undefined): Set<string> {
  const out = mainSideFiles(files, main);
  if (!main) return out;
  for (const p of files.keys()) {
    if (p === "test.js" || p.startsWith("ui/")) continue;
    if ([".js", ".mjs"].includes(extensionOf(p))) out.add(p);
  }
  return out;
}
