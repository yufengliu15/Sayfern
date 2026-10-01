// Materializes a fixture set into a per-run sandbox. Both arms read the same
// sandbox: the Claude Code skill through files, Sayfern through its API and the
// fake AnkiConnect server.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { buildCollection, type FixtureDeck } from "./anki";
import { BENCH_DIR, expandPath } from "./config";

export interface SeedTurn {
  kind?: string;
  learner: string;
  reply: string;
  evidence: Record<string, unknown>;
}

export interface Manifest {
  language: string;
  /** Folders copied into the sandbox root (text files get {{ROOT}} replaced). */
  tree: string[];
  anki: {
    /** Either a synthetic deck JSON (built into a collection) or an existing collection file. */
    deckJson?: string;
    collection?: string;
    deck?: string;
    wordField: string;
    readingField?: string;
    meaningField?: string;
  };
  reader?: { path: string; kind: string; resumeAt?: string; title?: string };
  profile?: { name?: string; about?: string; goals?: Record<string, string> };
  selfLevel?: string;
  sayfernSeed?: SeedTurn[];
  gold: {
    struggling: string[];
    knownMature?: string[];
    wordStatus?: Record<string, string>;
  };
}

export interface Sandbox {
  root: string;
  manifest: Manifest;
  fixtureDir: string;
  collection: string;
  deck: string;
  reader?: string;
}

const TEXT = new Set([".md", ".txt", ".json", ".html", ".yaml", ".yml", ".py", ".csv"]);

export function fixtureDir(name: string): string {
  const direct = expandPath(name, join(BENCH_DIR, "fixtures"));
  if (existsSync(join(direct, "manifest.json"))) return direct;
  throw new Error(`Fixture set not found: ${name} (looked for ${direct}/manifest.json)`);
}

export function loadManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Manifest;
}

/** Copies a tree, replacing {{ROOT}} in text files. */
export function copyTree(src: string, dest: string, root: string): void {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (name === ".DS_Store") continue;
    const s = join(src, name);
    const d = join(dest, name);
    if (statSync(s).isDirectory()) copyTree(s, d, root);
    else if (TEXT.has(extname(name).toLowerCase())) writeFileSync(d, readFileSync(s, "utf8").replaceAll("{{ROOT}}", root));
    else cpSync(s, d);
  }
}

export async function materialize(fixtures: string, root: string): Promise<Sandbox> {
  const dir = fixtureDir(fixtures);
  const manifest = loadManifest(dir);
  mkdirSync(root, { recursive: true });
  for (const t of manifest.tree) copyTree(join(dir, t), join(root, t), root);
  mkdirSync(join(root, "anki"), { recursive: true });
  const collection = join(root, "anki", "collection.anki2");
  let deck = manifest.anki.deck ?? "";
  if (manifest.anki.deckJson) {
    const fx = JSON.parse(readFileSync(join(dir, manifest.anki.deckJson), "utf8")) as FixtureDeck;
    await buildCollection(collection, fx, Date.now());
    deck = fx.deck;
  } else if (manifest.anki.collection) {
    cpSync(join(dir, manifest.anki.collection), collection);
    for (const ext of ["-wal", "-shm"]) if (existsSync(join(dir, manifest.anki.collection + ext))) cpSync(join(dir, manifest.anki.collection + ext), collection + ext);
  } else throw new Error("manifest.anki needs deckJson or collection");
  if (!deck) throw new Error("manifest.anki.deck is required with a collection file");
  return { root, manifest, fixtureDir: dir, collection, deck, reader: manifest.reader ? join(root, manifest.reader.path) : undefined };
}
