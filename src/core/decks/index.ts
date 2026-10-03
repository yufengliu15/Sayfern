// Anki deck generator (S2-14..S2-16). Implements DeckApi.
//
// Flow: startDeckProject chooses the first words and writes DECK_SAMPLE_SIZE sample cards in the
// background (the renderer polls getDeckProject). After the learner approves the samples, each
// batch (DECK_BATCH_SIZE words) tops up the word list when needed, asks the model for the cards,
// checks them locally (cards.ts), records audio (tts.ts) and adds the notes through AnkiConnect.
// Everything is saved per batch, so a deck of any size can be finished over several sittings.
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { Language } from "../../shared/records";
import { LANGUAGES } from "../../shared/records";
import {
  DECK_BATCH_SIZE,
  DECK_BEGINNER,
  DECK_MAX_CARDS,
  DECK_MIN_CARDS,
  DECK_REQUEST_MAX,
  DECK_SAMPLE_SIZE,
  sharedDecksUrl,
  suggestDeckName,
  type DeckApi,
  type DeckAudioProvider,
  type DeckBatchLog,
  type DeckCardView,
  type DeckEstimate,
  type DeckListItem,
  type DeckOptions,
  type DeckProjectView,
  type DeckSpec,
  type ElevenLabsStatus,
} from "../../shared/stage2";
import type { ModelRef } from "../../shared/types";
import { AnkiUnreachableError } from "../anki";
import { type Stage2Deps, explanationFor } from "../stage2";
import { checkCard, MAX_ITEM_CHARS, noteFor, normWord, rawCard, VOCAB_NOTE_TYPE, type StoredCard } from "./cards";
import {
  ask,
  cardsSystemPrompt,
  cardsUserPrompt,
  cardTokens,
  DeckModelError,
  parseCards,
  parseWords,
  wordsSystemPrompt,
  wordsUserPrompt,
  wordTokens,
  type WordPick,
} from "./prompts";
import { DeckStore, type DeckFile, type DeckWord } from "./store";
import { defaultVoice, EDGE_VOICES, edgeTts, elevenTts, TtsError, type WsFactory } from "./tts";
import { ElevenLabsAccounts } from "../voice/accounts";
import { msg } from "../../shared/i18n";

export { DeckStore } from "./store";
export { VOCAB_NOTE_TYPE } from "./cards";

/** Credential id for the ElevenLabs key (stored next to the model sign-ins, encrypted). */
export const ELEVENLABS_CREDENTIAL = "elevenlabs";
const RECENT_MAX = 50;
/** Words asked for per request when choosing words. */
const WORDS_PER_REQUEST = 100;
/** Rough characters spoken per card (word + sentence). */
const SPOKEN_CHARS: Record<Language, number> = { zh: 16, ja: 21, ko: 24, en: 60, es: 64, fr: 66, de: 70, it: 64, pt: 64, ru: 64, vi: 52 };
const MINUTES_PER_BATCH = 1.5;
const AUDIO_CONCURRENCY = 4;

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function languageLevels(deps: Stage2Deps, language: Language): string[] {
  return deps.lang.languages().find((l) => l.id === language)?.levels ?? [];
}

/** Cleans a spec from the renderer. Throws on a bad language. */
export function sanitizeDeckSpec(raw: DeckSpec, levels: string[]): DeckSpec {
  if (!raw || !(LANGUAGES as readonly string[]).includes(raw.language)) throw new Error("Pick a language for the deck.");
  const level = raw.level === DECK_BEGINNER || levels.includes(raw.level) ? raw.level : DECK_BEGINNER;
  const request = typeof raw.request === "string" ? raw.request.replace(/\s+/g, " ").trim().slice(0, DECK_REQUEST_MAX) : "";
  const n = typeof raw.size === "number" && Number.isFinite(raw.size) ? Math.round(raw.size) : 100;
  const size = Math.max(DECK_MIN_CARDS, Math.min(DECK_MAX_CARDS, n));
  const deckName =
    (typeof raw.deckName === "string"
      ? raw.deckName
          .replace(/["\n\r\t]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 100)
      : "") || suggestDeckName(raw.language, level, request);
  return {
    language: raw.language,
    level,
    request,
    size,
    order: raw.order === "theme" ? "theme" : "frequency",
    deckName,
    skipKnown: raw.skipKnown !== false,
    audio: raw.audio === "elevenlabs" ? "elevenlabs" : "edge",
  };
}

function counts(d: DeckFile) {
  const c = { added: 0, duplicates: 0, failed: 0, skipped: d.knownSkipped.length, todo: 0 };
  for (const w of d.words) {
    if (w.status === "added") c.added++;
    else if (w.status === "duplicate") c.duplicates++;
    else if (w.status === "failed") c.failed++;
    else if (w.status === "skipped") c.skipped++;
    else c.todo++;
  }
  return c;
}

/** Cards still to add: the target size minus cards added, or the words left when the model ran out. */
function remainingOf(d: DeckFile): number {
  const c = counts(d);
  const wanted = Math.max(0, d.spec.size - c.added);
  return d.exhausted ? Math.min(wanted, c.todo) : wanted;
}

function cardView(c: StoredCard, audio?: DeckCardView["audio"]): DeckCardView {
  const { audioKeys: _k, audio: _a, ...rest } = c;
  const v: DeckCardView = structuredClone(rest);
  if (audio && (audio.word || audio.sentence)) v.audio = audio;
  return v;
}

export function toListItem(d: DeckFile): DeckListItem {
  const c = counts(d);
  return {
    id: d.id,
    language: d.language,
    deckName: d.spec.deckName,
    status: d.status,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    planned: d.words.length,
    added: c.added,
    remaining: remainingOf(d),
  };
}

function levelTag(level: string): string {
  return level === DECK_BEGINNER ? "beginner" : level.replace(/\s+/g, "");
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

interface AudioStats {
  /** Set when ElevenLabs stopped working this batch (quota or key): the rest uses the free voices. */
  elevenOff?: string;
  fallbacks: number;
}

export class DeckService implements DeckApi {
  readonly store: DeckStore;
  private readonly inflight = new Map<string, AbortController>();
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly ws?: WsFactory;
  private readonly eleven: ElevenLabsAccounts;

  constructor(
    private readonly deps: Stage2Deps,
    opts: { ws?: WsFactory } = {},
  ) {
    this.store = new DeckStore(join(deps.records.dataDir, "decks"), join(deps.records.dataDir, "deck-audio"));
    this.ws = opts.ws;
    this.eleven = deps.eleven ?? new ElevenLabsAccounts({ credentials: deps.credentials, settings: deps.settings, fetch: () => this.fetch, now: deps.now, newId: deps.newId });
  }

  /** The learner's interface language, which meanings and translations are written in. */
  private explain(): Promise<string> {
    return explanationFor(this.deps);
  }

  private get fetch(): typeof fetch {
    return this.deps.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // ------------------------------------------------------------ ElevenLabs
  // The accounts are the shared Stage 3 pool (src/core/voice/accounts.ts): several keys, used in order.

  /** Combined status over every connected account (credits added up). */
  async elevenLabsStatus(): Promise<ElevenLabsStatus> {
    const views = await this.eleven.views();
    if (!views.length) return { connected: false, voices: [] };
    const settings = await this.deps.settings.get();
    const status: ElevenLabsStatus = { connected: true, voices: [] };
    const { voices, error } = await this.eleven.allVoices();
    status.voices = voices;
    const chosen = voices.find((v) => v.id === settings.elevenLabsVoice?.id) ?? defaultVoice(voices);
    if (chosen) {
      status.voiceId = chosen.id;
      status.voiceName = chosen.name;
    } else if (settings.elevenLabsVoice) {
      status.voiceId = settings.elevenLabsVoice.id;
      status.voiceName = settings.elevenLabsVoice.name;
    }
    const known = views.filter((v) => v.creditLimit != null);
    if (known.length) {
      status.creditsLeft = known.reduce((n, v) => n + (v.creditsLeft ?? 0), 0);
      status.creditLimit = known.reduce((n, v) => n + (v.creditLimit ?? 0), 0);
      const resets = known.map((v) => v.resetsAt).filter((r): r is number => typeof r === "number");
      if (resets.length) status.resetsAt = Math.min(...resets);
      if (known[0]!.tier) status.tier = known[0]!.tier;
    }
    if (error && !voices.length) status.error = error;
    return status;
  }

  /** Adds an account (the first one, or one more). */
  async connectElevenLabs(apiKey: string): Promise<ElevenLabsStatus> {
    const added = await this.eleven.add(apiKey);
    this.eleven.clearBench();
    const voices = await this.eleven.voicesOf(added).catch(() => [] as ElevenLabsStatus["voices"]);
    const voice = defaultVoice(voices);
    if (!voice) throw new Error("This ElevenLabs account has no voices Sayfern can use.");
    const settings = await this.deps.settings.get();
    if (!settings.elevenLabsVoice) await this.deps.settings.update({ elevenLabsVoice: { id: voice.id, name: voice.name } });
    return this.elevenLabsStatus();
  }

  async setElevenLabsVoice(voiceId: string): Promise<ElevenLabsStatus> {
    const status = await this.elevenLabsStatus();
    const v = status.voices.find((x) => x.id === voiceId);
    if (!v) throw new Error("That voice isn't in your ElevenLabs account.");
    await this.deps.settings.update({ elevenLabsVoice: { id: v.id, name: v.name } });
    return this.elevenLabsStatus();
  }

  /** Removes every account (Settings > Voice removes them one at a time). */
  async disconnectElevenLabs(): Promise<ElevenLabsStatus> {
    await this.eleven.removeAll();
    return { connected: false, voices: [] };
  }

  // ------------------------------------------------------------ options

  private async currentLevel(language: Language): Promise<string | null> {
    const { current } = await this.deps.records.getLevels(language);
    return current.writing?.level ?? current.recognition?.level ?? current.reading?.level ?? null;
  }

  private async ankiState(language: Language): Promise<DeckOptions["anki"]> {
    const { anki } = this.deps;
    const config = await anki.getConfig();
    if (!config.enabled) return { enabled: false, connected: false, knownWords: null, syncedAt: null };
    const [ping, page] = await Promise.all([anki.ping(), anki.words(language, { status: "all", limit: 1 }).catch(() => null)]);
    return { enabled: true, connected: ping.connected, knownWords: page?.syncedAt != null ? page.total : null, syncedAt: page?.syncedAt ?? null };
  }

  async deckOptions(language: Language): Promise<DeckOptions> {
    if (!(LANGUAGES as readonly string[]).includes(language)) throw new Error("Unknown language.");
    const [level, profile, anki, dict, eleven] = await Promise.all([
      this.currentLevel(language),
      this.deps.records.getProfile(),
      this.ankiState(language),
      this.deps.lang.dictionaryStatus(language),
      this.elevenLabsStatus(),
    ]);
    const levels = languageLevels(this.deps, language);
    const goal = profile.goals?.[language]?.trim();
    const options: DeckOptions = {
      language,
      levels,
      currentLevel: level,
      anki,
      dictionary: { name: dict.name, installed: dict.installed, downloadMb: dict.downloadMb },
      elevenlabs: eleven,
      defaultDeckName: suggestDeckName(language, level && levels.includes(level) ? level : DECK_BEGINNER, ""),
      sharedDecksUrl: sharedDecksUrl(language),
    };
    if (goal) options.goal = goal;
    return options;
  }

  async estimateDeck(rawSpec: DeckSpec): Promise<DeckEstimate> {
    const spec = sanitizeDeckSpec(rawSpec, languageLevels(this.deps, rawSpec?.language));
    const batches = Math.ceil(spec.size / DECK_BATCH_SIZE);
    const audioCharacters = spec.size * SPOKEN_CHARS[spec.language];
    const out: DeckEstimate = { cards: spec.size, batches, minutes: Math.max(1, Math.round(batches * MINUTES_PER_BATCH)), audioCharacters };
    if (spec.audio === "elevenlabs") {
      const s = await this.elevenLabsStatus();
      if (s.creditsLeft != null) out.creditsAfter = s.creditsLeft - audioCharacters;
    }
    return out;
  }

  // ------------------------------------------------------------ views

  private async view(d: DeckFile): Promise<DeckProjectView> {
    const c = counts(d);
    const remaining = remainingOf(d);
    // Samples carry their audio as data: URLs so the preview can play them.
    const samples: DeckCardView[] = [];
    for (const s of d.samples) {
      const audio: DeckCardView["audio"] = {};
      for (const part of ["word", "sentence"] as const) {
        const key = s.audioKeys?.[part];
        const buf = key ? await this.store.readAudio(key) : null;
        if (buf) audio[part] = `data:audio/mpeg;base64,${buf.toString("base64")}`;
      }
      samples.push(cardView(s, audio));
    }
    const v: DeckProjectView = {
      id: d.id,
      language: d.language,
      spec: structuredClone(d.spec),
      model: d.model,
      modelRef: { ...d.modelRef },
      status: d.status,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      samples,
      recent: d.recent.map((r) => cardView(r)),
      batches: structuredClone(d.batches),
      progress: {
        planned: d.words.length,
        added: c.added,
        duplicates: c.duplicates,
        failed: c.failed,
        skipped: c.skipped,
        remaining,
        batchesLeft: Math.ceil(remaining / DECK_BATCH_SIZE),
      },
    };
    if (d.error) v.error = d.error;
    if (d.lastError) v.lastError = d.lastError;
    if (d.activity) v.activity = d.activity;
    if (d.guidance) v.guidance = d.guidance;
    if (d.continuous) v.continuous = true;
    return v;
  }

  async getDeckProject(projectId: string): Promise<DeckProjectView | null> {
    let d = await this.store.get(projectId);
    if (!d) return null;
    if ((d.status === "planning" || d.status === "generating") && !this.inflight.has(projectId)) {
      // The app quit mid-job: make the project usable again instead of spinning forever.
      d =
        (await this.store.update(projectId, (f) => {
          if (f.status === "planning") {
            if (f.samples.length) f.status = "preview";
            else {
              f.status = "failed";
              f.error = "Sayfern closed while choosing words. Start the deck again.";
            }
          } else if (f.status === "generating") {
            f.status = remainingOf(f) > 0 ? "ready" : "done";
            f.lastError = "Sayfern closed during a batch. Cards already in Anki are kept; run the batch again.";
          }
          delete f.activity;
          f.continuous = false;
          return structuredClone(f);
        })) ?? d;
    }
    return this.view(d);
  }

  async listDeckProjects(language?: Language): Promise<DeckListItem[]> {
    return (await this.store.all())
      .filter((d) => !language || d.language === language)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(toListItem);
  }

  async deleteDeckProject(projectId: string): Promise<void> {
    this.inflight.get(projectId)?.abort();
    this.inflight.delete(projectId);
    await this.jobs.get(projectId)?.catch(() => undefined);
    await this.store.remove(projectId);
  }

  /** Stops every running job and waits for them (erase, shutdown). */
  async abortAll(): Promise<void> {
    for (const ctrl of this.inflight.values()) ctrl.abort();
    await Promise.allSettled([...this.jobs.values()]);
  }

  /** Resolves when the running job (if any) has finished. For tests and shutdown. */
  async whenIdle(projectId: string): Promise<DeckProjectView | null> {
    await this.jobs.get(projectId);
    return this.getDeckProject(projectId);
  }

  // ------------------------------------------------------------ jobs

  private startJob(id: string, run: (signal: AbortSignal) => Promise<void>): void {
    const ctrl = new AbortController();
    this.inflight.set(id, ctrl);
    const job = run(ctrl.signal).finally(() => {
      if (this.inflight.get(id) === ctrl) this.inflight.delete(id);
      this.jobs.delete(id);
    });
    this.jobs.set(id, job);
  }

  private setActivity(id: string, activity: string): Promise<unknown> {
    return this.store.update(id, (f) => {
      f.activity = activity;
      f.updatedAt = this.deps.now();
    });
  }

  private async checkAudioChoice(spec: DeckSpec): Promise<void> {
    if (spec.audio === "elevenlabs" && !(await this.eleven.count())) throw new Error("Connect ElevenLabs first, or pick the free voices.");
  }

  async startDeckProject(rawSpec: DeckSpec, modelRef: ModelRef): Promise<DeckProjectView> {
    const spec = sanitizeDeckSpec(rawSpec, languageLevels(this.deps, rawSpec?.language));
    const model = this.deps.resolveModel(modelRef);
    await this.checkAudioChoice(spec);
    const now = this.deps.now();
    const file: DeckFile = {
      v: 1,
      id: this.deps.newId(),
      language: spec.language,
      spec,
      model: `${model.provider}/${model.id}`,
      modelRef: { provider: model.provider, id: model.id },
      status: "planning",
      createdAt: now,
      updatedAt: now,
      activity: "Choosing words",
      words: [],
      knownSkipped: [],
      samples: [],
      recent: [],
      batches: [],
    };
    await this.store.create(file);
    this.startJob(file.id, (signal) => this.plan(file.id, model, signal));
    return this.view(file);
  }

  private async plan(id: string, model: Model<Api>, signal: AbortSignal): Promise<void> {
    try {
      const d = (await this.store.get(id))!;
      await this.pickWords(id, model, Math.min(d.spec.size, WORDS_PER_REQUEST), signal);
      await this.writeSamples(id, model, signal);
    } catch (err) {
      if (signal.aborted) return;
      await this.store
        .update(id, (f) => {
          f.status = "failed";
          f.error = errText(err) || "Couldn't plan this deck.";
          delete f.activity;
          f.updatedAt = this.deps.now();
        })
        .catch(() => undefined);
    }
  }

  async redoDeckSamples(projectId: string, guidance: string, modelRef?: ModelRef): Promise<DeckProjectView> {
    const d = await this.store.get(projectId);
    if (!d) throw new Error("That deck project no longer exists.");
    if (this.inflight.has(projectId)) throw new Error("This deck is busy. Wait for it to finish.");
    if (d.status !== "preview" && d.status !== "failed") throw new Error("Samples can only be changed before the first batch.");
    const model = this.deps.resolveModel(modelRef ?? d.modelRef);
    const note = typeof guidance === "string" ? guidance.replace(/\s+/g, " ").trim().slice(0, 400) : "";
    await this.store.update(projectId, (f) => {
      if (note) f.guidance = note;
      f.modelRef = { provider: model.provider, id: model.id };
      f.model = `${model.provider}/${model.id}`;
      // Forget the old sample cards so the batch writes fresh ones too.
      for (const w of f.words) delete w.card;
      f.samples = [];
      f.status = "planning";
      f.activity = "Writing new samples";
      delete f.error;
      f.updatedAt = this.deps.now();
    });
    this.startJob(projectId, async (signal) => {
      try {
        const cur = (await this.store.get(projectId))!;
        if (!cur.words.some((w) => w.status === "todo")) await this.pickWords(projectId, model, Math.min(cur.spec.size, WORDS_PER_REQUEST), signal);
        await this.writeSamples(projectId, model, signal);
      } catch (err) {
        if (signal.aborted) return;
        await this.store.update(projectId, (f) => {
          f.status = "failed";
          f.error = errText(err);
          delete f.activity;
        });
      }
    });
    return (await this.getDeckProject(projectId))!;
  }

  async approveDeckSamples(projectId: string): Promise<DeckProjectView> {
    const d = await this.store.update(projectId, (f) => {
      if (f.status !== "preview") throw new Error("There are no samples waiting for approval.");
      f.status = remainingOf(f) > 0 ? "ready" : "done";
      f.updatedAt = this.deps.now();
      return structuredClone(f);
    });
    if (!d) throw new Error("That deck project no longer exists.");
    return this.view(d);
  }

  async runDeckBatch(projectId: string, modelRef?: ModelRef, opts: { continuous?: boolean } = {}): Promise<DeckProjectView> {
    const d = await this.store.get(projectId);
    if (!d) throw new Error("That deck project no longer exists.");
    if (this.inflight.has(projectId)) throw new Error("A batch is already running.");
    if (d.status === "preview") throw new Error("Approve the sample cards first.");
    if (d.status !== "ready") throw new Error(d.status === "done" ? "This deck is finished." : "This deck can't run a batch right now.");
    const model = this.deps.resolveModel(modelRef ?? d.modelRef);
    await this.checkAudioChoice(d.spec);
    await this.store.update(projectId, (f) => {
      f.status = "generating";
      f.activity = "Checking Anki";
      f.continuous = !!opts.continuous;
      f.modelRef = { provider: model.provider, id: model.id };
      f.model = `${model.provider}/${model.id}`;
      delete f.lastError;
      f.updatedAt = this.deps.now();
    });
    this.startJob(projectId, (signal) => this.runBatches(projectId, model, signal));
    return (await this.getDeckProject(projectId))!;
  }

  async stopDeckBatches(projectId: string): Promise<DeckProjectView> {
    const ctrl = this.inflight.get(projectId);
    if (ctrl) {
      ctrl.abort();
      await this.jobs.get(projectId)?.catch(() => undefined);
    }
    const v = await this.getDeckProject(projectId);
    if (!v) throw new Error("That deck project no longer exists.");
    return v;
  }

  // ------------------------------------------------------------ words

  /** Asks for words until `want` todo words are waiting (or the model runs out of new ones). */
  private async pickWords(id: string, model: Model<Api>, want: number, signal: AbortSignal): Promise<void> {
    const d = (await this.store.get(id))!;
    const { language, spec } = d;
    const profile = await this.deps.records.getProfile();
    const goal = profile.goals?.[language]?.trim();
    let knownSample: string[] = [];
    if (spec.skipKnown) {
      const page = await this.deps.anki.words(language, { status: "all", limit: 150 }).catch(() => null);
      knownSample = page?.items.map((w) => w.word) ?? [];
    }
    let todo = d.words.filter((w) => w.status === "todo").length;
    let empty = 0;
    for (let attempt = 0; attempt < 4 && todo < want && empty < 2; attempt++) {
      if (signal.aborted) throw new DeckModelError(msg("Stopped."));
      const cur = (await this.store.get(id))!;
      const chosen = new Set([...cur.words.map((w) => normWord(w.word)), ...cur.knownSkipped]);
      await this.setActivity(id, `Choosing words (${cur.words.length} so far)`);
      const ask_n = Math.min(WORDS_PER_REQUEST, want - todo + Math.ceil((want - todo) * 0.15) + 3);
      const reply = await ask(this.deps.models, model, {
        system: wordsSystemPrompt(language, await this.explain()),
        user: wordsUserPrompt({
          spec,
          count: ask_n,
          taken: cur.words.length + cur.knownSkipped.length,
          avoid: [...cur.words.map((w) => w.word).slice(-400), ...knownSample],
          goal,
          guidance: cur.guidance,
        }),
        maxTokens: wordTokens(ask_n),
        signal,
        now: this.deps.now,
      });
      const picks: WordPick[] = [];
      for (const p of parseWords(reply)) {
        const w = normWord(p.word);
        if (!w || chosen.has(w) || [...w].length > MAX_ITEM_CHARS) continue;
        chosen.add(w);
        picks.push({ ...p, word: w });
      }
      let known = new Set<string>();
      if (spec.skipKnown && picks.length) {
        const status = await this.deps.anki
          .checkWords(
            language,
            picks.map((p) => p.word),
          )
          .catch(() => ({}) as Record<string, string>);
        known = new Set(picks.filter((p) => status[p.word] && status[p.word] !== "unknown").map((p) => p.word));
      }
      const fresh = picks.filter((p) => !known.has(p.word));
      if (!fresh.length) empty++;
      todo += fresh.length;
      await this.store.update(id, (f) => {
        for (const k of known) if (!f.knownSkipped.includes(k)) f.knownSkipped.push(k);
        for (const p of fresh) f.words.push(p.hint ? { word: p.word, hint: p.hint, status: "todo" } : { word: p.word, status: "todo" });
        if (empty >= 2) f.exhausted = true;
        f.updatedAt = this.deps.now();
      });
    }
    if (todo === 0) {
      const cur = (await this.store.get(id))!;
      if (!cur.words.length) throw new DeckModelError("The model didn't suggest any usable words. Try again, or pick another model.");
    }
  }

  // ------------------------------------------------------------ cards

  private async dictionaryName(language: Language): Promise<string | null> {
    const s = await this.deps.lang.dictionaryStatus(language).catch(() => null);
    return s?.installed ? s.name : null;
  }

  /** Writes and checks cards for `words`. One top-up request for words the model skipped. */
  private async writeCards(
    d: DeckFile,
    model: Model<Api>,
    words: DeckWord[],
    signal: AbortSignal,
  ): Promise<{ cards: Map<string, StoredCard>; problems: Map<string, string> }> {
    const cards = new Map<string, StoredCard>();
    const problems = new Map<string, string>();
    const ctx = { language: d.language, lang: this.deps.lang, dictionary: await this.dictionaryName(d.language) };
    await this.deps.lang.pack(d.language).ready();
    let pending = words;
    for (let round = 0; round < 2 && pending.length; round++) {
      const reply = await ask(this.deps.models, model, {
        system: cardsSystemPrompt(d.language, await this.explain()),
        user: cardsUserPrompt({ spec: d.spec, words: pending.map((w) => ({ word: w.word, ...(w.hint ? { hint: w.hint } : {}) })), guidance: d.guidance }),
        maxTokens: cardTokens(pending.length),
        signal,
        now: this.deps.now,
      });
      const wanted = new Map(pending.map((w) => [normWord(w.word), w]));
      for (const item of parseCards(reply)) {
        const raw = rawCard(item);
        if (!raw) continue;
        const w = wanted.get(raw.word);
        if (!w || cards.has(w.word)) continue;
        const res = await checkCard({ ...raw, word: w.word }, ctx);
        if (res.ok) {
          cards.set(w.word, res.card);
          problems.delete(w.word);
        } else problems.set(w.word, res.problem);
      }
      // A second request only for the words the model skipped or got wrong.
      pending = pending.filter((w) => !cards.has(w.word));
    }
    for (const w of pending) if (!problems.has(w.word)) problems.set(w.word, "the model skipped it");
    return { cards, problems };
  }

  private async writeSamples(id: string, model: Model<Api>, signal: AbortSignal): Promise<void> {
    await this.setActivity(id, "Writing sample cards");
    const d = (await this.store.get(id))!;
    const words = d.words.filter((w) => w.status === "todo").slice(0, DECK_SAMPLE_SIZE);
    const { cards, problems } = await this.writeCards(d, model, words, signal);
    if (!cards.size)
      throw new DeckModelError(
        `The model didn't write any usable sample cards${problems.size ? ` (${[...problems.values()][0]})` : ""}. Try again, or pick another model.`,
      );
    await this.setActivity(id, "Recording sample audio");
    const stats: AudioStats = { fallbacks: 0 };
    const list = [...cards.values()];
    await this.recordAudio(d, list, stats, signal);
    if (signal.aborted) return;
    await this.store.update(id, (f) => {
      for (const w of f.words) {
        const c = cards.get(w.word);
        if (c) w.card = c;
        else if (problems.has(w.word) && w.status === "todo") {
          w.status = "failed";
          w.reason = problems.get(w.word);
        }
      }
      f.samples = list;
      f.status = "preview";
      delete f.activity;
      delete f.error;
      if (stats.elevenOff) f.lastError = `${stats.elevenOff} The samples use the free voices.`;
      f.updatedAt = this.deps.now();
    });
  }

  // ------------------------------------------------------------ audio

  private async clip(
    language: Language,
    provider: DeckAudioProvider,
    part: "word" | "sentence",
    text: string,
    stats: AudioStats,
    signal: AbortSignal,
  ): Promise<{ key: string; by: DeckAudioProvider } | { error: string }> {
    const useEleven = provider === "elevenlabs" && !stats.elevenOff && (await this.eleven.count()) > 0;
    const voiceId = useEleven ? (await this.deps.settings.get()).elevenLabsVoice?.id : undefined;
    if (useEleven && voiceId) {
      const key = sha(`elevenlabs|${voiceId}|${language}|${text}`);
      if (await this.store.readAudio(key)) return { key, by: "elevenlabs" };
      try {
        const { value } = await this.eleven.run(
          "tts",
          async (a) => elevenTts(this.fetch, a.key, { text, voiceId: (await this.eleven.voiceFor(a, voiceId)) ?? voiceId, language, signal }),
          signal,
        );
        await this.store.writeAudio(key, value);
        return { key, by: "elevenlabs" };
      } catch (err) {
        if (signal.aborted) return { error: msg("Stopped.") };
        // Every account is out of credits or refused: the rest of the batch uses the free voices.
        if (err instanceof TtsError && (err.kind === "quota" || err.kind === "auth")) stats.elevenOff = err.message;
        stats.fallbacks++;
      }
    } else if (provider === "elevenlabs") stats.fallbacks++;
    const voice = EDGE_VOICES[language][part];
    const key = sha(`edge|${voice}|${text}`);
    if (await this.store.readAudio(key)) return { key, by: "edge" };
    try {
      await this.store.writeAudio(key, await edgeTts(text, voice, { ws: this.ws, signal }));
      return { key, by: "edge" };
    } catch (err) {
      return { error: errText(err) };
    }
  }

  /** Records word and sentence audio for each card (cached), a few cards at a time. */
  private async recordAudio(d: DeckFile, cards: StoredCard[], stats: AudioStats, signal: AbortSignal, onProgress?: (done: number) => void): Promise<void> {
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < cards.length && !signal.aborted) {
        const card = cards[next++];
        const keys: StoredCard["audioKeys"] = {};
        const problems: string[] = [];
        for (const part of ["word", "sentence"] as const) {
          const r = await this.clip(d.language, d.spec.audio, part, card[part], stats, signal);
          if ("key" in r) {
            keys[part] = r.key;
            if (part === "word") card.audioBy = r.by;
          } else problems.push(r.error);
        }
        card.audioKeys = keys;
        if (problems.length && !signal.aborted) card.checks = [...card.checks.filter((c) => !c.startsWith("No audio")), `No audio: ${problems[0]}`];
        onProgress?.(++done);
      }
    };
    await Promise.all(Array.from({ length: Math.min(AUDIO_CONCURRENCY, cards.length) }, worker));
  }

  // ------------------------------------------------------------ batches

  private async runBatches(id: string, model: Model<Api>, signal: AbortSignal): Promise<void> {
    try {
      for (;;) {
        const log = await this.runOneBatch(id, model, signal);
        if (signal.aborted) break;
        const d = (await this.store.get(id))!;
        if (!d.continuous || d.status !== "generating" || !log || log.added === 0) break;
      }
    } catch (err) {
      if (!signal.aborted) {
        await this.store
          .update(id, (f) => {
            f.lastError = err instanceof AnkiUnreachableError ? err.message : errText(err);
          })
          .catch(() => undefined);
      }
    }
    await this.store
      .update(id, (f) => {
        if (f.status === "generating") f.status = remainingOf(f) > 0 ? "ready" : "done";
        f.continuous = false;
        delete f.activity;
        f.updatedAt = this.deps.now();
      })
      .catch(() => undefined);
  }

  /** One batch. Returns its log, or null when there was nothing to do. */
  private async runOneBatch(id: string, model: Model<Api>, signal: AbortSignal): Promise<DeckBatchLog | null> {
    const { anki } = this.deps;
    let d = (await this.store.get(id))!;
    const need = Math.min(DECK_BATCH_SIZE, remainingOf(d));
    if (need <= 0) {
      await this.store.update(id, (f) => {
        f.status = "done";
      });
      return null;
    }

    // Anki first, so no tokens or audio credits are spent while it's closed.
    await this.setActivity(id, "Checking Anki");
    const config = await anki.getConfig();
    if (!config.enabled) throw new Error("Anki is turned off. Turn it on in Settings > Anki, then run the batch again.");
    const ping = await anki.ping();
    if (!ping.connected) throw new AnkiUnreachableError(ping.reason ?? "other");

    // Enough words waiting?
    const todo = d.words.filter((w) => w.status === "todo").length;
    if (todo < need && !d.exhausted) {
      await this.pickWords(id, model, Math.min(need + DECK_BATCH_SIZE, remainingOf(d)), signal);
      d = (await this.store.get(id))!;
    }
    let batch = d.words.filter((w) => w.status === "todo").slice(0, need);
    if (!batch.length) {
      await this.store.update(id, (f) => {
        f.status = "done";
        if (f.exhausted) f.lastError = "The model ran out of new words for this deck, so it ends here.";
      });
      return null;
    }
    const n = d.batches.length + 1;

    // Words learned meanwhile (the snapshot may be newer than when they were chosen).
    let skipped = 0;
    if (d.spec.skipKnown) {
      const status = await anki
        .checkWords(
          d.language,
          batch.map((w) => w.word),
        )
        .catch(() => ({}) as Record<string, string>);
      const known = new Set(batch.filter((w) => status[w.word] && status[w.word] !== "unknown").map((w) => w.word));
      if (known.size) {
        skipped += known.size;
        await this.store.update(id, (f) => {
          for (const w of f.words)
            if (known.has(w.word) && w.status === "todo") Object.assign(w, { status: "skipped", reason: msg("Already in your Anki"), batch: n });
        });
        batch = batch.filter((w) => !known.has(w.word));
      }
    }

    // Cards: samples are already written; the rest in one request.
    await this.setActivity(id, `Batch ${n}: writing ${batch.length} cards`);
    const ready = new Map<string, StoredCard>();
    for (const w of batch) if (w.card) ready.set(w.word, structuredClone(w.card));
    const toWrite = batch.filter((w) => !ready.has(w.word));
    let problems = new Map<string, string>();
    if (toWrite.length) {
      const res = await this.writeCards(d, model, toWrite, signal);
      for (const [k, v] of res.cards) ready.set(k, v);
      problems = res.problems;
    }
    if (signal.aborted) return null;

    // Audio (cached clips are free).
    const cards = batch.map((w) => ready.get(w.word)).filter((c): c is StoredCard => !!c);
    const stats: AudioStats = { fallbacks: 0 };
    await this.setActivity(id, `Batch ${n}: recording audio`);
    await this.recordAudio(d, cards, stats, signal, (k) => void this.setActivity(id, `Batch ${n}: recording audio (${k} of ${cards.length})`));
    if (signal.aborted) return null;

    // Anki: deck, note type, media, notes.
    await this.setActivity(id, `Batch ${n}: adding to Anki`);
    try {
      await anki.ensureDeck(d.spec.deckName);
      await anki.ensureNoteType(VOCAB_NOTE_TYPE);
    } catch (err) {
      if (err instanceof AnkiUnreachableError) throw err;
      throw new Error(`Anki couldn't prepare the deck or the Sayfern Vocab note type: ${errText(err).replace(/^AnkiConnect error:\s*/, "")}`);
    }
    for (const c of cards) {
      c.audio = {};
      for (const part of ["word", "sentence"] as const) {
        const key = c.audioKeys?.[part];
        const buf = key ? await this.store.readAudio(key) : null;
        if (!buf) continue;
        try {
          c.audio[part] = await anki.storeMedia(`sayfern-${key}.mp3`, buf.toString("base64"));
        } catch (err) {
          if (err instanceof AnkiUnreachableError) throw err;
        }
      }
    }
    const tags = ["sayfern", "sayfern::deck", levelTag(d.spec.level)];
    const results = await anki.addNotes(cards.map((c) => noteFor(c, d.spec.deckName, tags)));
    const at = this.deps.now();
    const log: DeckBatchLog = { n, at, added: 0, duplicates: 0, failed: 0, skipped: skipped + problems.size };
    cards.forEach((c, i) => {
      const r = results[i];
      if (r?.status === "added") {
        c.status = "added";
        c.noteId = r.noteId;
        log.added++;
      } else if (r?.status === "duplicate") {
        c.status = "duplicate";
        log.duplicates++;
      } else {
        c.status = "failed";
        c.error = r?.status === "failed" ? r.error : "Anki didn't add it";
        log.failed++;
      }
    });
    if (stats.fallbacks) log.audioFallbacks = stats.fallbacks;
    const byWord = new Map(cards.map((c) => [c.word, c]));

    await this.store.update(id, (f) => {
      for (const w of f.words) {
        if (w.status !== "todo") continue;
        const c = byWord.get(w.word);
        if (c) {
          w.status = c.status === "added" ? "added" : c.status === "duplicate" ? "duplicate" : "failed";
          if (c.noteId) w.noteId = c.noteId;
          if (c.error) w.reason = c.error;
          w.batch = n;
          delete w.card;
        } else if (problems.has(w.word)) {
          w.status = "failed";
          w.reason = problems.get(w.word);
          w.batch = n;
          delete w.card;
        }
      }
      f.batches.push(log);
      f.recent = [...cards.map((c) => structuredClone(c)), ...f.recent].slice(0, RECENT_MAX);
      if (stats.elevenOff) f.lastError = `${stats.elevenOff} Batch ${n} used the free voices for ${stats.fallbacks} clips.`;
      f.updatedAt = this.deps.now();
      if (remainingOf(f) <= 0) f.status = "done";
    });

    // Let Sayfern follow the new deck so the tutor can practise its words.
    if (log.added > 0) await this.followDeck(d.language, d.spec.deckName).catch(() => undefined);
    return log;
  }

  private async followDeck(language: Language, deck: string): Promise<void> {
    const config = await this.deps.anki.getConfig();
    if (config.decks.some((m) => m.language === language && m.deck === deck)) return;
    await this.deps.anki.setConfig({
      ...config,
      decks: [...config.decks, { language, deck, wordField: "Word", readingField: "Reading", meaningField: "Definition" }],
    });
  }
}
