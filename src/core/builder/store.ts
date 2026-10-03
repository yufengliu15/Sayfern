// On-disk layout of builder features (S2-13), under <dataDir>/builder/:
//   features/<id>/feature.json           name, versions, approvals, conversation (kept by "Erase all data")
//   features/<id>/versions/<n>/…         one extension folder per version, sealed (immutable) once built
//   features/<id>/approved/<hash>/…      read-only copy of an approved full-access version (what the host loads)
//   data/<id>/storage.json, results.json what the feature's UI stored (learner data: erased)
import { chmod, cp, mkdir, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FeatureTurn, FeatureVersion } from "../../shared/stage2";
import type { Language } from "../../shared/records";
import { hashDir, readDirFiles } from "../extensions";
import { JsonFile } from "../records/io";
import { FEATURE_ID, normalizeFeaturePath } from "./paths";

export type StoredVersion = Omit<FeatureVersion, "approved">;

export interface FeatureRecord {
  id: string;
  name: string;
  description: string;
  language: Language;
  createdAt: number;
  updatedAt: number;
  /** Ascending by n. */
  versions: StoredVersion[];
  active?: number;
  enabled: boolean;
  draft?: number;
  approvals: { version: number; hash: string; at: number }[];
  turns: FeatureTurn[];
}

export function checkId(id: unknown): string {
  if (typeof id !== "string" || !FEATURE_ID.test(id)) throw new Error("Unknown feature.");
  return id;
}

export class FeatureStore {
  readonly featuresDir: string;
  readonly dataDir: string;
  private readonly files = new Map<string, JsonFile<FeatureRecord>>();

  constructor(readonly root: string) {
    this.featuresDir = join(root, "features");
    this.dataDir = join(root, "data");
  }

  featureDir(id: string): string {
    return join(this.featuresDir, checkId(id));
  }

  versionDir(id: string, n: number): string {
    if (!Number.isInteger(n) || n < 1) throw new Error("Unknown version.");
    return join(this.featureDir(id), "versions", String(n));
  }

  private file(id: string): JsonFile<FeatureRecord> {
    let f = this.files.get(id);
    if (!f) {
      f = new JsonFile<FeatureRecord>(join(this.featureDir(id), "feature.json"), () => {
        throw new Error("Unknown feature.");
      });
      this.files.set(id, f);
    }
    return f;
  }

  async ids(): Promise<string[]> {
    try {
      return (await readdir(this.featuresDir, { withFileTypes: true })).filter((d) => d.isDirectory() && FEATURE_ID.test(d.name)).map((d) => d.name);
    } catch {
      return [];
    }
  }

  async get(id: string): Promise<FeatureRecord | null> {
    if (typeof id !== "string" || !FEATURE_ID.test(id)) return null;
    try {
      return await this.file(id).get();
    } catch {
      this.files.delete(id);
      return null;
    }
  }

  async list(): Promise<FeatureRecord[]> {
    const out: FeatureRecord[] = [];
    for (const id of await this.ids()) {
      const r = await this.get(id);
      if (r) out.push(r);
    }
    return out;
  }

  async create(rec: FeatureRecord): Promise<void> {
    await mkdir(this.featureDir(rec.id), { recursive: true });
    const f = new JsonFile<FeatureRecord>(join(this.featureDir(rec.id), "feature.json"), () => structuredClone(rec));
    this.files.set(rec.id, f);
    await f.update(() => undefined);
  }

  update<R>(id: string, fn: (rec: FeatureRecord) => R): Promise<R> {
    return this.file(checkId(id)).update(fn);
  }

  async remove(id: string): Promise<void> {
    const f = this.files.get(id);
    this.files.delete(id);
    await f?.remove().catch(() => undefined);
    await setWritable(join(this.featureDir(id), "approved")).catch(() => undefined);
    await rm(this.featureDir(id), { recursive: true, force: true });
    await rm(join(this.dataDir, checkId(id)), { recursive: true, force: true });
  }

  // ------------------------------------------------------------ version files

  async readVersion(id: string, n: number): Promise<Map<string, string>> {
    const dir = this.versionDir(id, n);
    try {
      return new Map((await readDirFiles(dir)).map(([p, b]) => [p, b.toString("utf8")]));
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return new Map();
      throw err;
    }
  }

  /** Writes one file of a version folder. The caller checks the version is still being built. */
  async writeVersionFile(id: string, n: number, rawPath: string, text: string): Promise<string> {
    const path = normalizeFeaturePath(rawPath);
    const full = join(this.versionDir(id, n), ...path.split("/"));
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text, "utf8");
    return path;
  }

  async deleteVersionFile(id: string, n: number, rawPath: string): Promise<boolean> {
    const path = normalizeFeaturePath(rawPath);
    try {
      await unlink(join(this.versionDir(id, n), ...path.split("/")));
      return true;
    } catch {
      return false;
    }
  }

  async copyVersion(id: string, from: number, to: number): Promise<void> {
    const src = this.versionDir(id, from);
    const dst = this.versionDir(id, to);
    await this.createVersionDir(id, to); // claims the new folder exclusively
    if (!(await exists(src))) return;
    for (const e of await readdir(src)) await cp(join(src, e), join(dst, e), { recursive: true, errorOnExist: true, force: false });
  }

  /** Creates a new, empty version folder. Refuses (never reuses) an existing one. */
  async createVersionDir(id: string, n: number): Promise<void> {
    const dir = this.versionDir(id, n);
    await mkdir(dirname(dir), { recursive: true });
    try {
      await mkdir(dir);
    } catch (err) {
      if ((err as { code?: string }).code === "EEXIST") throw new Error(`Version ${n} already exists. Try again.`);
      throw err;
    }
  }

  approvedDir(id: string, hash: string): string {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("Bad approval hash.");
    return join(this.featureDir(id), "approved", hash);
  }

  /** Copies an approved version to approved/<hash>/ (read-only) and checks the copy still has that hash. */
  async freezeApproved(id: string, n: number, hash: string): Promise<string> {
    const dir = this.approvedDir(id, hash);
    if ((await exists(dir)) && (await hashDir(dir).catch(() => "")) === hash) return dir;
    await this.removeApproved(id, hash);
    const tmp = `${dir}.tmp-${process.pid}`;
    await rm(tmp, { recursive: true, force: true });
    await mkdir(dirname(dir), { recursive: true });
    await cp(this.versionDir(id, n), tmp, { recursive: true });
    if ((await hashDir(tmp)) !== hash) {
      await rm(tmp, { recursive: true, force: true });
      throw new Error("The version's files changed while approving it.");
    }
    await rename(tmp, dir);
    await setReadOnly(dir);
    return dir;
  }

  async removeApproved(id: string, hash: string): Promise<void> {
    const dir = this.approvedDir(id, hash);
    await setWritable(dir).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }

  async removeVersion(id: string, n: number): Promise<void> {
    await rm(this.versionDir(id, n), { recursive: true, force: true });
  }

  // ------------------------------------------------------------ per-feature learner data

  dataFile(id: string, name: "storage" | "results"): string {
    return join(this.dataDir, checkId(id), `${name}.json`);
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Files 0444, folders 0555. Not a security boundary (same user), but nothing in Sayfern writes there. */
async function setReadOnly(dir: string): Promise<void> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await setReadOnly(p);
    else await chmod(p, 0o444);
  }
  await chmod(dir, 0o555);
}

async function setWritable(dir: string): Promise<void> {
  await chmod(dir, 0o755);
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await setWritable(p);
    else await chmod(p, 0o644);
  }
}
