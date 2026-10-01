import { join } from "node:path";
import type { AnkiService } from "../contracts";
import type {
  AnkiCard,
  AnkiConfig,
  AnkiDeckMapping,
  AnkiOverview,
  AnkiSnapshot,
  AnkiWord,
  AnkiWordFilter,
  AnkiWordPage,
  AnkiWordStatus,
  Language,
  PracticeTarget,
} from "../../shared/records";
import { LANGUAGES } from "../../shared/records";
import { cleanField, furiganaReading } from "./clean";
import { readJson, writeJsonAtomic } from "./json-file";
import { aggregateWords, buildOverview, checkWordsIn, MATURE_DAYS, wordPage } from "./words";

export { cleanField, furiganaReading } from "./clean";
export * from "./words";

export const DEFAULT_ANKI_URL = "http://127.0.0.1:8765";
export const ANKI_UNREACHABLE =
  "Can't reach Anki. Make sure Anki is running and the AnkiConnect add-on (code 2055492159) is installed.";

const DAY_MS = 86_400_000;
const BATCH = 500;
/** Generous: Anki answers from its UI thread, which can be busy (sync, big deck browser open). */
const TIMEOUT_MS = 8_000;
/** Bulk calls (500 cards) can take a little longer on big collections. */
const BULK_TIMEOUT_MS = 20_000;
const OVERUSED = 3;
/** Review history pulled on sync (cardReviews). */
export const HISTORY_DAYS = 90;
/** Fallback history window for AnkiConnect versions without cardReviews (`rated:` searches). */
const FALLBACK_HISTORY_DAYS = 30;
/** Answers longer than this count as this long (the learner walked away). */
const MAX_ANSWER_MS = 60_000;
/** Minimum struggle score for a "difficult" practice target (lower than the struggling list: targets need candidates). */
const DIFFICULT_MIN = 0.1;

/** Why AnkiConnect couldn't be used. Drives the help shown in Settings. */
export type AnkiFailure = "refused" | "timeout" | "forbidden" | "not_ankiconnect" | "other";

const FAILURE_MESSAGE: Record<AnkiFailure, string> = {
  refused:
    "Nothing is answering on Anki's port. Open Anki. If you just installed AnkiConnect, quit and reopen Anki once so the add-on loads.",
  timeout:
    "Anki didn't answer in time. On macOS this usually means App Nap paused Anki while it's in the background.",
  forbidden: "AnkiConnect refused the request (HTTP 403). Check its webCorsOriginList setting in Anki's add-on config.",
  not_ankiconnect: "Something answered on Anki's port, but it isn't AnkiConnect.",
  other: ANKI_UNREACHABLE,
};

/** Thrown when AnkiConnect can't be reached (Anki closed, add-on missing, timeout). */
export class AnkiUnreachableError extends Error {
  readonly reason: AnkiFailure;
  constructor(reason: AnkiFailure = "other", detail?: string) {
    super(FAILURE_MESSAGE[reason]);
    this.name = "AnkiUnreachableError";
    this.reason = reason;
    if (detail) this.cause = detail;
  }
}

/** Map a fetch failure (Node undici or Chromium net) to a reason. */
export function classifyFetchError(err: unknown): AnkiFailure {
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
  const text = `${e?.name ?? ""} ${e?.message ?? ""} ${e?.code ?? ""} ${e?.cause?.code ?? ""} ${e?.cause?.message ?? ""}`;
  if (/TimeoutError|AbortError|timed? ?out|ETIMEDOUT|ERR_TIMED_OUT/i.test(text)) return "timeout";
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED|ECONNRESET|ERR_CONNECTION_RESET|EHOSTUNREACH|ERR_ADDRESS_UNREACHABLE/i.test(text)) return "refused";
  return "other";
}

export interface AnkiConnectServiceOptions {
  dataDir: string;
  fetch?: typeof fetch;
  /** Per-call timeout override (tests). */
  timeoutMs?: number;
  now?: () => number;
}

interface CardInfo {
  cardId: number;
  note: number;
  deckName: string;
  fields: Record<string, { value: string; order: number }>;
  interval: number;
  factor: number;
  lapses: number;
  reps: number;
  /** 0 new, 1 learning, 2 review, 3 relearning (missing on very old AnkiConnect). */
  type?: number;
  /** -3/-2 buried, -1 suspended, 0 new, 1 learning, 2 review, 3 day-learn, 4 preview. */
  queue?: number;
  /** New cards: position in the new queue. */
  due?: number;
}

interface NoteInfo {
  noteId: number;
  fields: Record<string, { value: string; order: number }>;
}

/** getReviewsOfCards entry (fallback for old AnkiConnect). */
interface ReviewEntry {
  /** Review time, ms epoch. */
  id: number;
  ease: number;
  time?: number;
  type?: number;
}

/** One answer from the review log. */
interface Answer {
  at: number;
  cardId: number;
  /** 1 again .. 4 easy. */
  ease: number;
  ms: number;
}

/** Plain AnkiConnect errors ("unsupported action") are recoverable; unreachable ones are not. */
function rethrowUnreachable(err: unknown): void {
  if (err instanceof AnkiUnreachableError) throw err;
}

/** Anki search: `deck:"name"` with quotes, backslashes and wildcards escaped. */
export function deckQuery(deck: string): string {
  return `deck:"${deck.replace(/[\\"*_]/g, (c) => `\\${c}`)}"`;
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function defaultConfig(): AnkiConfig {
  return { enabled: false, url: DEFAULT_ANKI_URL, decks: [] };
}

function normalizeConfig(input: Partial<AnkiConfig> | null | undefined): AnkiConfig {
  const base = defaultConfig();
  if (!input || typeof input !== "object") return base;
  const url = typeof input.url === "string" && input.url.trim() ? input.url.trim().replace(/\/+$/, "") : base.url;
  const decks: AnkiDeckMapping[] = [];
  for (const d of Array.isArray(input.decks) ? input.decks : []) {
    if (!d || !LANGUAGES.includes(d.language) || typeof d.deck !== "string" || !d.deck.trim()) continue;
    // Keep a deck even before its word field is chosen: the UI picks the deck first, then
    // the fields. (Dropping it here made the deck dropdown snap back, v0.2.0 bug.)
    const wordField = typeof d.wordField === "string" ? d.wordField.trim() : "";
    const m: AnkiDeckMapping = { language: d.language, deck: d.deck.trim(), wordField };
    if (typeof d.readingField === "string" && d.readingField.trim()) m.readingField = d.readingField.trim();
    if (typeof d.meaningField === "string" && d.meaningField.trim()) m.meaningField = d.meaningField.trim();
    decks.push(m);
  }
  return { enabled: input.enabled === true, url, decks };
}

function copyConfig(c: AnkiConfig): AnkiConfig {
  return { ...c, decks: c.decks.map((d) => ({ ...d })) };
}

/**
 * AnkiConnect client (add-on 2055492159). Config and per-language snapshots are
 * cached as JSON in `dataDir`, so practice targets still work while Anki is closed.
 */
export class AnkiConnectService implements AnkiService {
  private readonly dataDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs?: number;
  private config: AnkiConfig | null = null;
  private readonly snapshots = new Map<Language, AnkiSnapshot | null>();
  private readonly syncing = new Map<Language, Promise<AnkiSnapshot>>();
  private readonly wordCache = new WeakMap<AnkiSnapshot, AnkiWord[]>();

  constructor(opts: AnkiConnectServiceOptions) {
    this.dataDir = opts.dataDir;
    this.fetchImpl = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.now = opts.now ?? Date.now;
    this.timeoutMs = opts.timeoutMs;
  }

  // ------------------------------------------------------------ config

  async getConfig(): Promise<AnkiConfig> {
    if (!this.config) this.config = normalizeConfig(await readJson<AnkiConfig>(join(this.dataDir, "config.json")));
    return copyConfig(this.config);
  }

  async setConfig(config: AnkiConfig): Promise<AnkiConfig> {
    const next = normalizeConfig(config);
    await writeJsonAtomic(join(this.dataDir, "config.json"), next);
    this.config = next;
    return copyConfig(next);
  }

  // ------------------------------------------------------------ AnkiConnect

  private async call<T>(action: string, params?: Record<string, unknown>, timeoutMs = TIMEOUT_MS): Promise<T> {
    const { url } = await this.getConfig();
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params ? { action, version: 6, params } : { action, version: 6 }),
        signal: AbortSignal.timeout(this.timeoutMs ?? timeoutMs),
      });
    } catch (err) {
      throw new AnkiUnreachableError(classifyFetchError(err), (err as Error)?.message);
    }
    if (res.status === 403) throw new AnkiUnreachableError("forbidden", "HTTP 403");
    if (!res.ok) throw new AnkiUnreachableError("not_ankiconnect", `HTTP ${res.status}`);
    let body: { result?: unknown; error?: unknown };
    try {
      body = (await res.json()) as { result?: unknown; error?: unknown };
    } catch {
      throw new AnkiUnreachableError("not_ankiconnect", "response was not JSON");
    }
    if (body && typeof body === "object" && body.error) throw new Error(`AnkiConnect error: ${String(body.error)}`);
    if (!body || typeof body !== "object" || !("result" in body)) {
      throw new AnkiUnreachableError("not_ankiconnect", "unexpected response");
    }
    return body.result as T;
  }

  async ping(): Promise<{ connected: boolean; version?: number; error?: string; reason?: AnkiFailure; detail?: string }> {
    try {
      const version = await this.call<number>("version");
      return typeof version === "number" ? { connected: true, version } : { connected: true };
    } catch (err) {
      if (err instanceof AnkiUnreachableError) {
        const detail = typeof err.cause === "string" ? err.cause : undefined;
        return { connected: false, error: err.message, reason: err.reason, ...(detail ? { detail } : {}) };
      }
      return { connected: false, error: (err as Error)?.message || ANKI_UNREACHABLE, reason: "other" };
    }
  }

  async deckNames(): Promise<string[]> {
    const names = await this.call<string[]>("deckNames");
    return [...(names ?? [])].sort((a, b) => a.localeCompare(b));
  }

  async fieldNames(deck: string): Promise<string[]> {
    const ids = await this.call<number[]>("findNotes", { query: deckQuery(deck) });
    if (!ids?.length) return [];
    const [note] = await this.call<NoteInfo[]>("notesInfo", { notes: [ids[0]] });
    if (!note?.fields) return [];
    return Object.entries(note.fields)
      .sort((a, b) => (a[1]?.order ?? 0) - (b[1]?.order ?? 0))
      .map(([name]) => name);
  }

  // ------------------------------------------------------------ sync & snapshot

  async sync(language: Language): Promise<AnkiSnapshot> {
    // One sync per language at a time: a background refresh and "Sync now" share it.
    const running = this.syncing.get(language);
    if (running) return running;
    const task = this.pull(language).finally(() => this.syncing.delete(language));
    this.syncing.set(language, task);
    return task;
  }

  private async pull(language: Language): Promise<AnkiSnapshot> {
    const { decks } = await this.getConfig();
    const linked = decks.filter((d) => d.language === language);
    if (linked.length === 0) throw new Error("No Anki deck is linked to this language yet. Choose one in Settings.");
    const mappings = linked.filter((d) => d.wordField);
    if (mappings.length === 0) throw new Error("Choose which field holds the word for your Anki deck in Settings.");

    const now = this.now();
    const cards = new Map<number, AnkiCard>();
    const todayIds = new Set<number>();

    for (const m of mappings) {
      const q = deckQuery(m.deck);
      const ids = (await this.call<number[]>("findCards", { query: q })) ?? [];
      for (const batch of chunk(ids, BATCH)) {
        const infos = (await this.call<CardInfo[]>("cardsInfo", { cards: batch }, BULK_TIMEOUT_MS)) ?? [];
        for (const info of infos) {
          if (!info || typeof info.cardId !== "number" || cards.has(info.cardId)) continue;
          const card = toCard(info, m);
          if (card) cards.set(card.cardId, card);
        }
      }
      for (const id of (await this.call<number[]>("findCards", { query: `${q} rated:1` })) ?? []) todayIds.add(id);
      try {
        for (const id of (await this.call<number[]>("findCards", { query: `${q} tag:leech` })) ?? []) {
          const card = cards.get(id);
          if (card) card.leech = true;
        }
      } catch (err) {
        rethrowUnreachable(err);
      }
    }

    const history = await this.history(cards, mappings, now);
    let reviewsLast7d = 0;
    if (history) {
      const weekAgo = now - 7 * DAY_MS;
      const byCard = new Map<number, Answer[]>();
      for (const a of history.answers) {
        if (!cards.has(a.cardId)) continue;
        if (a.at >= weekAgo) reviewsLast7d++;
        const list = byCard.get(a.cardId);
        if (list) list.push(a);
        else byCard.set(a.cardId, [a]);
      }
      for (const card of cards.values()) {
        const answers = byCard.get(card.cardId) ?? [];
        card.recentReviews = answers.length;
        card.recentFails = answers.filter((a) => a.ease === 1).length;
        if (!answers.length) continue;
        const last = answers.reduce((a, b) => (b.at > a.at ? b : a));
        card.lastReviewAt = last.at;
        card.lastEase = last.ease;
        const timed = answers.filter((a) => a.ms > 0);
        if (timed.length) card.avgAnswerMs = Math.round(timed.reduce((t, a) => t + Math.min(a.ms, MAX_ANSWER_MS), 0) / timed.length);
      }
    }

    const list = [...cards.values()];
    const snap: AnkiSnapshot = {
      language,
      syncedAt: now,
      cards: list,
      reviewedToday: todayIds.size,
      reviewsLast7d,
      matureCount: list.filter((c) => c.interval >= MATURE_DAYS).length,
    };
    if (history) snap.historyDays = history.days;
    await writeJsonAtomic(this.snapshotPath(language), snap);
    this.snapshots.set(language, snap);
    return snap;
  }

  /**
   * Review log since HISTORY_DAYS ago: one cardReviews call per deck the cards live in
   * (cardReviews matches the exact deck, not subdecks). Old AnkiConnect without
   * cardReviews: getReviewsOfCards for cards answered in the last 30 days. null when
   * neither works; sync still succeeds without history.
   */
  private async history(
    cards: Map<number, AnkiCard>,
    mappings: AnkiDeckMapping[],
    now: number,
  ): Promise<{ answers: Answer[]; days: number } | null> {
    const since = now - HISTORY_DAYS * DAY_MS;
    try {
      const answers: Answer[] = [];
      for (const deck of new Set([...cards.values()].map((c) => c.deck))) {
        const rows = (await this.call<unknown[]>("cardReviews", { deck, startID: since }, BULK_TIMEOUT_MS)) ?? [];
        for (const row of rows) {
          if (!Array.isArray(row)) continue;
          // [reviewTime, cardID, usn, buttonPressed, newInterval, previousInterval, newFactor, reviewDuration, reviewType]
          const a = answer(Number(row[0]), Number(row[1]), Number(row[3]), Number(row[7]), row[8] === undefined ? undefined : Number(row[8]));
          if (a && a.at > since) answers.push(a);
        }
      }
      return { answers, days: HISTORY_DAYS };
    } catch (err) {
      rethrowUnreachable(err);
    }
    try {
      const fallbackSince = now - FALLBACK_HISTORY_DAYS * DAY_MS;
      const ids = new Set<number>();
      for (const m of mappings) {
        const found = (await this.call<number[]>("findCards", { query: `${deckQuery(m.deck)} rated:${FALLBACK_HISTORY_DAYS}` })) ?? [];
        for (const id of found) if (cards.has(id)) ids.add(id);
      }
      const answers: Answer[] = [];
      for (const batch of chunk([...ids], BATCH)) {
        const byCard = (await this.call<Record<string, ReviewEntry[]>>("getReviewsOfCards", { cards: batch }, BULK_TIMEOUT_MS)) ?? {};
        for (const [id, entries] of Object.entries(byCard)) {
          for (const e of entries ?? []) {
            const a = e && answer(Number(e.id), Number(id), Number(e.ease), Number(e.time), e.type);
            if (a && a.at >= fallbackSince) answers.push(a);
          }
        }
      }
      return { answers, days: FALLBACK_HISTORY_DAYS };
    } catch (err) {
      rethrowUnreachable(err);
      return null;
    }
  }

  async snapshot(language: Language): Promise<AnkiSnapshot | null> {
    if (!this.snapshots.has(language)) {
      this.snapshots.set(language, await readJson<AnkiSnapshot>(this.snapshotPath(language)));
    }
    return this.snapshots.get(language) ?? null;
  }

  async ensureFresh(language: Language, maxAgeMs: number): Promise<AnkiSnapshot | null> {
    let current: AnkiSnapshot | null = null;
    try {
      current = await this.snapshot(language);
      const config = await this.getConfig();
      if (!config.enabled || !config.decks.some((d) => d.language === language && d.wordField)) return current;
      if (current && this.now() - current.syncedAt < maxAgeMs) return current;
      return await this.sync(language);
    } catch {
      return current;
    }
  }

  /** Words of the cached snapshot, aggregated once per snapshot. */
  private async wordsOf(language: Language): Promise<{ snap: AnkiSnapshot | null; words: AnkiWord[] }> {
    const snap = await this.snapshot(language);
    if (!snap) return { snap: null, words: [] };
    let words = this.wordCache.get(snap);
    if (!words) {
      words = aggregateWords(snap);
      this.wordCache.set(snap, words);
    }
    return { snap, words };
  }

  async words(language: Language, filter: AnkiWordFilter = {}): Promise<AnkiWordPage> {
    const { snap, words } = await this.wordsOf(language);
    const page = wordPage(snap, words, filter);
    return { ...page, items: page.items.map(copyWord) };
  }

  async struggling(language: Language, limit = 20, opts: { deck?: string } = {}): Promise<AnkiWord[]> {
    return (await this.words(language, { status: "struggling", limit, deck: opts.deck })).items;
  }

  async checkWords(language: Language, words: string[]): Promise<Record<string, AnkiWordStatus | "unknown">> {
    return checkWordsIn((await this.wordsOf(language)).words, words);
  }

  async overview(language: Language): Promise<AnkiOverview | null> {
    const { snap, words } = await this.wordsOf(language);
    if (!snap) return null;
    const o = buildOverview(snap, words);
    return { ...o, counts: { ...o.counts }, nextNew: o.nextNew.map(copyWord), topStruggling: o.topStruggling.map(copyWord) };
  }

  async findCard(language: Language, word: string): Promise<AnkiCard | null> {
    const snap = await this.snapshot(language);
    const w = cleanField(word).normalize("NFC");
    if (!snap || !w) return null;
    const hit = snap.cards.find((c) => c.word === w) ?? snap.cards.find((c) => c.reading === w);
    return hit ? { ...hit } : null;
  }

  async selectTargets(
    language: Language,
    count: number,
    usageCount: (word: string) => Promise<number>,
  ): Promise<PracticeTarget[]> {
    const { snap, words } = await this.wordsOf(language);
    if (!snap || count <= 0) return [];
    const since = this.now() - 7 * DAY_MS;
    const studied = words.filter((w) => w.status === "known" || w.status === "learning");
    const recent = studied
      .filter((w) => w.lastReviewAt !== undefined && w.lastReviewAt >= since)
      .sort((a, b) => (b.lastReviewAt ?? 0) - (a.lastReviewAt ?? 0));
    const difficult = studied.filter((w) => w.struggle >= DIFFICULT_MIN).sort((a, b) => b.struggle - a.struggle);

    const out: PracticeTarget[] = [];
    const seen = new Set<string>();
    const consider = async (w: AnkiWord, reason: PracticeTarget["reason"]) => {
      if (seen.has(w.word)) return;
      seen.add(w.word);
      if ((await usageCount(w.word)) >= OVERUSED) return;
      const t: PracticeTarget = { word: w.word, reason, cardId: w.cardIds[0], status: "pending" };
      if (w.reading) t.reading = w.reading;
      if (w.meaning) t.meaning = w.meaning;
      out.push(t);
    };
    for (let i = 0; out.length < count && (i < recent.length || i < difficult.length); i++) {
      if (i < recent.length) await consider(recent[i], "recent");
      if (out.length >= count) break;
      if (i < difficult.length) await consider(difficult[i], "difficult");
    }
    return out.slice(0, count);
  }

  private snapshotPath(language: Language): string {
    return join(this.dataDir, `snapshot-${language}.json`);
  }
}

function toCard(info: CardInfo, m: AnkiDeckMapping): AnkiCard | null {
  const fields = info.fields ?? {};
  const rawWord = fields[m.wordField]?.value;
  const word = cleanField(rawWord).normalize("NFC");
  if (!word) return null;
  const card: AnkiCard = {
    cardId: info.cardId,
    noteId: info.note,
    deck: info.deckName,
    word,
    // Learning cards report a negative interval (seconds); treat as 0 days.
    interval: Math.max(0, Number(info.interval) || 0),
    ease: Number(info.factor) || 0,
    lapses: Number(info.lapses) || 0,
    reps: Number(info.reps) || 0,
  };
  const type = typeof info.type === "number" ? info.type : undefined;
  if (type !== undefined) {
    card.stage = type === 0 ? "new" : type === 2 ? "review" : "learning";
    if (type === 3) card.relearning = true;
    card.status = card.stage;
    card.mature = card.stage === "review" && card.interval >= MATURE_DAYS;
    if (card.stage === "new" && typeof info.due === "number") card.newPosition = info.due;
  }
  if (typeof info.queue === "number") {
    if (info.queue === -1) card.status = "suspended";
    else if (info.queue <= -2) card.status = "buried";
  }
  const reading = m.readingField ? cleanField(fields[m.readingField]?.value) : furiganaReading(rawWord);
  if (reading && reading !== word) card.reading = reading.normalize("NFC");
  const meaning = m.meaningField ? cleanField(fields[m.meaningField]?.value) : "";
  if (meaning) card.meaning = meaning;
  return card;
}

function answer(at: number, cardId: number, ease: number, ms: number, type: number | undefined): Answer | null {
  if (!Number.isFinite(at) || !Number.isFinite(cardId)) return null;
  // ease 0 = manual reschedule; review types 4+ = manual / rescheduled entries.
  if (!(ease >= 1 && ease <= 4)) return null;
  if (type !== undefined && Number.isFinite(type) && type >= 4) return null;
  return { at, cardId, ease, ms: Number.isFinite(ms) && ms > 0 ? ms : 0 };
}

function copyWord(w: AnkiWord): AnkiWord {
  return { ...w, cardIds: [...w.cardIds], decks: [...w.decks], reasons: [...w.reasons] };
}
