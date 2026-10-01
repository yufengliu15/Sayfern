import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";

/**
 * Optional at-rest protection. In the Electron app this is backed by
 * `safeStorage`, whose key lives in the macOS Keychain. The CLI smoke test
 * passes no cipher and stores plain JSON in a gitignored dev folder.
 */
export interface Cipher {
  encrypt(plain: string): string;
  decrypt(encoded: string): string;
}

type FileShape = { v: 1; encrypted: boolean; data: string };

/**
 * A single-file CredentialStore. One process owns the file, so a promise chain
 * is enough to serialize writes (pi-ai relies on `modify` being serialized so
 * concurrent requests never double-refresh an OAuth token).
 */
export class FileCredentialStore implements CredentialStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly cipher?: Cipher,
  ) {}

  private async load(): Promise<Record<string, Credential>> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch {
      return {};
    }
    const file = JSON.parse(raw) as FileShape;
    const json = file.encrypted ? this.requireCipher().decrypt(file.data) : file.data;
    return JSON.parse(json) as Record<string, Credential>;
  }

  private async save(all: Record<string, Credential>): Promise<void> {
    const json = JSON.stringify(all);
    const file: FileShape = this.cipher
      ? { v: 1, encrypted: true, data: this.cipher.encrypt(json) }
      : { v: 1, encrypted: false, data: json };
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(file), { mode: 0o600 });
    await rename(tmp, this.path);
  }

  private requireCipher(): Cipher {
    if (!this.cipher) throw new Error("Credential file is encrypted but no cipher is available");
    return this.cipher;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return (await this.load())[providerId];
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const all = await this.load();
    return Object.entries(all).map(([providerId, c]) => ({ providerId, type: c.type }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.enqueue(async () => {
      const all = await this.load();
      const next = await fn(all[providerId]);
      if (next === undefined) return all[providerId];
      all[providerId] = next;
      await this.save(all);
      return next;
    });
  }

  delete(providerId: string): Promise<void> {
    return this.enqueue(async () => {
      const all = await this.load();
      delete all[providerId];
      await this.save(all);
    });
  }
}
