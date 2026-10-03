// The learner's ElevenLabs accounts (Stage 3): several API keys, tried in the learner's order.
// When an account runs out of credits it sits out until its credits reset; a rejected key or a
// missing permission sits out for a few minutes for that job only (text to speech or speech to
// text). Deck audio (S2-16) and voice (S3-01/02) share this pool.
//
// Keys live encrypted in credentials.json; settings.json keeps the order, names and a key hint.
// v0.6 stored a single key under the credential id "elevenlabs": it becomes the first account.
import type { CredentialStore } from "@earendil-works/pi-ai";
import type { SettingsStore } from "../app/settings";
import type { ElevenLabsVoice } from "../../shared/stage2";
import type { ElevenLabsAccountState, ElevenLabsAccountView } from "../../shared/stage3";
import type { Settings } from "../../shared/types";
import { msg } from "../../shared/i18n";
import { defaultVoice, elevenSubscription, elevenVoices, TtsError, type ElevenSubscription } from "../decks/tts";

/** v0.6's single ElevenLabs key; the first account still uses it. */
export const LEGACY_CREDENTIAL = "elevenlabs";
export const MAX_ACCOUNTS = 10;

export type ElevenJob = "tts" | "stt";
type Stored = NonNullable<Settings["elevenLabsAccounts"]>[number];

export interface ElevenAccount {
  id: string;
  label: string;
  key: string;
  credential: string;
}

interface Bench {
  until: number;
  state: Exclude<ElevenLabsAccountState, "ok">;
  error: string;
}

const VOICES_TTL = 10 * 60_000;
const CREDITS_TTL = 60_000;
const AUTH_BENCH_MS = 10 * 60_000;
const RATE_LIMIT_BENCH_MS = 60_000;
const QUOTA_BENCH_MS = 6 * 60 * 60_000;

export const keyHint = (key: string) => `…${key.slice(-4)}`;

export interface ElevenAccountsDeps {
  credentials?: CredentialStore;
  settings: SettingsStore;
  fetch(): typeof fetch;
  now(): number;
  newId(): string;
}

export class ElevenLabsAccounts {
  private readonly voices = new Map<string, { at: number; voices: ElevenLabsVoice[] }>();
  private readonly credits = new Map<string, { at: number; sub: ElevenSubscription | null }>();
  /** Keyed by account id (out of credits: every job) or `${id}:${job}` (that job only). */
  private readonly benched = new Map<string, Bench>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ElevenAccountsDeps) {}

  /** Account list edits are serialized (settings + credentials change together). */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async readKey(credential: string): Promise<string | null> {
    const cred = (await this.deps.credentials?.read(credential).catch(() => undefined)) as { type?: string; key?: string } | undefined;
    return cred?.type === "api_key" && cred.key ? cred.key : null;
  }

  private async stored(): Promise<Stored[]> {
    const s = await this.deps.settings.get();
    if (Array.isArray(s.elevenLabsAccounts)) return s.elevenLabsAccounts;
    // v0.6: one key under "elevenlabs", no account list yet.
    const key = await this.readKey(LEGACY_CREDENTIAL);
    if (!key) return [];
    const first: Stored = { id: this.deps.newId(), label: "ElevenLabs", credential: LEGACY_CREDENTIAL, keyHint: keyHint(key), addedAt: this.deps.now() };
    await this.deps.settings.update({ elevenLabsAccounts: [first] });
    return [first];
  }

  /** Accounts with their keys, in order. Accounts whose key went missing are left out. */
  async list(): Promise<ElevenAccount[]> {
    const out: ElevenAccount[] = [];
    for (const a of await this.stored()) {
      const key = await this.readKey(a.credential);
      if (key) out.push({ id: a.id, label: a.label, key, credential: a.credential });
    }
    return out;
  }

  async count(): Promise<number> {
    return (await this.list()).length;
  }

  /** Checks the key with ElevenLabs (throws a readable TtsError), then adds it last. */
  add(apiKey: string, label?: string): Promise<ElevenAccount> {
    return this.serial(async () => {
      const key = typeof apiKey === "string" ? apiKey.trim() : "";
      if (!key) throw new Error("Paste your ElevenLabs API key first.");
      if (!this.deps.credentials) throw new Error("Sayfern can't store keys here.");
      const stored = await this.stored();
      if (stored.length >= MAX_ACCOUNTS) throw new Error("That's the most ElevenLabs accounts Sayfern keeps. Remove one first.");
      for (const a of await this.list()) if (a.key === key) throw new Error("This ElevenLabs key is already connected.");
      const voices = await elevenVoices(this.deps.fetch(), key);
      const id = this.deps.newId();
      const legacyFree = !stored.some((a) => a.credential === LEGACY_CREDENTIAL) && !(await this.readKey(LEGACY_CREDENTIAL));
      const credential = legacyFree ? LEGACY_CREDENTIAL : `${LEGACY_CREDENTIAL}:${id}`;
      await this.deps.credentials.modify(credential, async () => ({ type: "api_key", key }) as never);
      const name = (label ?? "").trim().slice(0, 40) || (stored.length ? `ElevenLabs ${stored.length + 1}` : "ElevenLabs");
      const entry: Stored = { id, label: name, credential, keyHint: keyHint(key), addedAt: this.deps.now() };
      await this.deps.settings.update({ elevenLabsAccounts: [...stored, entry] });
      this.voices.set(id, { at: this.deps.now(), voices });
      return { id, label: name, key, credential };
    });
  }

  remove(id: string): Promise<void> {
    return this.serial(async () => {
      const stored = await this.stored();
      const gone = stored.find((a) => a.id === id);
      if (!gone) return;
      await this.deps.credentials?.delete(gone.credential);
      await this.deps.settings.update({ elevenLabsAccounts: stored.filter((a) => a.id !== id) });
      this.forget(id);
    });
  }

  removeAll(): Promise<void> {
    return this.serial(async () => {
      const stored = await this.stored();
      for (const a of stored) {
        await this.deps.credentials?.delete(a.credential);
        this.forget(a.id);
      }
      // A stray v0.6 key would otherwise come back as an account.
      await this.deps.credentials?.delete(LEGACY_CREDENTIAL);
      await this.deps.settings.update({ elevenLabsAccounts: [] });
    });
  }

  move(id: string, by: -1 | 1): Promise<void> {
    return this.serial(async () => {
      const stored = [...(await this.stored())];
      const i = stored.findIndex((a) => a.id === id);
      const j = i + (by < 0 ? -1 : 1);
      if (i < 0 || j < 0 || j >= stored.length) return;
      [stored[i], stored[j]] = [stored[j]!, stored[i]!];
      await this.deps.settings.update({ elevenLabsAccounts: stored });
    });
  }

  private forget(id: string): void {
    this.voices.delete(id);
    this.credits.delete(id);
    for (const k of [...this.benched.keys()]) if (k === id || k.startsWith(`${id}:`)) this.benched.delete(k);
  }

  // ------------------------------------------------------------ voices and credits

  async voicesOf(a: ElevenAccount): Promise<ElevenLabsVoice[]> {
    const hit = this.voices.get(a.id);
    if (hit && this.deps.now() - hit.at < VOICES_TTL) return hit.voices;
    const voices = await elevenVoices(this.deps.fetch(), a.key);
    this.voices.set(a.id, { at: this.deps.now(), voices });
    return voices;
  }

  /** Every account's voices, premade first, without duplicates (premade voice ids are the same everywhere). */
  async allVoices(): Promise<{ voices: ElevenLabsVoice[]; error?: string }> {
    const seen = new Map<string, ElevenLabsVoice>();
    let error: string | undefined;
    for (const a of await this.list()) {
      try {
        for (const v of await this.voicesOf(a)) if (!seen.has(v.id)) seen.set(v.id, v);
      } catch (err) {
        error ??= (err as Error).message;
      }
    }
    const voices = [...seen.values()].sort((x, y) => Number(y.category === "premade") - Number(x.category === "premade"));
    return error ? { voices, error } : { voices };
  }

  /** The voice to ask this account for: the wanted one when the account has it, else its default. */
  async voiceFor(a: ElevenAccount, wanted: string | undefined): Promise<string | undefined> {
    const voices = await this.voicesOf(a).catch(() => null);
    if (!voices) return wanted;
    if (wanted && voices.some((v) => v.id === wanted)) return wanted;
    return defaultVoice(voices)?.id ?? wanted;
  }

  async creditsOf(a: ElevenAccount, maxAgeMs = CREDITS_TTL): Promise<ElevenSubscription | null> {
    const hit = this.credits.get(a.id);
    if (hit && this.deps.now() - hit.at < maxAgeMs) return hit.sub;
    const sub = await elevenSubscription(this.deps.fetch(), a.key);
    this.credits.set(a.id, { at: this.deps.now(), sub });
    return sub;
  }

  private bench(a: ElevenAccount, job: ElevenJob): Bench | undefined {
    const now = this.deps.now();
    for (const k of [a.id, `${a.id}:${job}`]) {
      const b = this.benched.get(k);
      if (b && b.until > now) return b;
      if (b) this.benched.delete(k);
    }
    return undefined;
  }

  /** Views for Settings: names, credits, health. */
  async views(): Promise<ElevenLabsAccountView[]> {
    const stored = await this.stored();
    const accounts = await this.list();
    return Promise.all(
      stored
        .filter((s) => accounts.some((a) => a.id === s.id))
        .map(async (s) => {
          const a = accounts.find((x) => x.id === s.id)!;
          const view: ElevenLabsAccountView = { id: s.id, label: s.label, addedAt: s.addedAt, keyHint: s.keyHint, state: "ok" };
          const sub = await this.creditsOf(a).catch(() => null);
          if (sub) {
            view.creditsLeft = Math.max(0, sub.limit - sub.used);
            view.creditLimit = sub.limit;
            if (sub.resetsAt) view.resetsAt = sub.resetsAt;
            if (sub.tier) view.tier = sub.tier;
          }
          const b = this.bench(a, "tts") ?? this.bench(a, "stt");
          if (b) {
            view.state = b.state;
            view.error = b.error;
          } else if (sub && view.creditsLeft === 0) {
            view.state = "quota";
            view.error = "Your ElevenLabs credits for this month are used up.";
          }
          return view;
        }),
    );
  }

  /** True when some account isn't sitting out for this job. */
  async canDo(job: ElevenJob): Promise<boolean> {
    return (await this.list()).some((a) => !this.bench(a, job));
  }

  /**
   * Runs `fn` with the first account that can do `job`, moving on to the next when one is out of
   * credits, rate limited or refuses the key. Network failures stop right away (every account
   * would fail the same way). Throws the last readable error when no account managed.
   */
  async run<T>(job: ElevenJob, fn: (a: ElevenAccount) => Promise<T>, signal?: AbortSignal): Promise<{ value: T; account: ElevenAccount }> {
    const accounts = await this.list();
    if (!accounts.length) throw new TtsError(msg("No ElevenLabs account is connected."), "auth");
    let last: Error | undefined;
    for (const a of accounts) {
      const b = this.bench(a, job);
      if (b) {
        last ??= new TtsError(b.error, b.state === "quota" ? "quota" : "auth");
        continue;
      }
      try {
        const value = await fn(a);
        return { value, account: a };
      } catch (err) {
        if (signal?.aborted) throw err;
        if (!(err instanceof TtsError)) throw err;
        last = err;
        const now = this.deps.now();
        if (err.kind === "network") throw err;
        if (err.kind === "quota") {
          const resets = this.credits.get(a.id)?.sub?.resetsAt;
          const until = err.status === 429 ? now + RATE_LIMIT_BENCH_MS : resets && resets > now ? resets : now + QUOTA_BENCH_MS;
          this.benched.set(a.id, { until, state: "quota", error: err.message });
          this.credits.delete(a.id);
        } else if (err.kind === "auth") {
          this.benched.set(`${a.id}:${job}`, { until: now + AUTH_BENCH_MS, state: "auth", error: err.message });
        } else {
          this.benched.set(`${a.id}:${job}`, { until: now + RATE_LIMIT_BENCH_MS, state: "error", error: err.message });
        }
      }
    }
    throw last ?? new TtsError(msg("No ElevenLabs account could do this."), "other");
  }

  /** After the learner fixes something (a new key, a new permission): try every account again. */
  clearBench(): void {
    this.benched.clear();
    this.credits.clear();
  }
}
