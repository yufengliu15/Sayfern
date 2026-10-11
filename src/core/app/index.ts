// SayfernApp: every core service wired together behind the SayfernApi surface
// (docs/stage1.md). Plain Node: Electron main constructs it and routes IPC to it;
// the smoke script and tests use it directly.
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Api, AuthInteraction, AuthPrompt, CredentialStore, Model, MutableModels } from "@earendil-works/pi-ai";
import type {
  AnkiStatus,
  ApiMethod,
  ChatEvent,
  EndSummary,
  EVENT_CHANNELS,
  GrammarDetail,
  HomeView,
  NewSessionOptions,
  RetryResult,
  SaveWordInput,
  SayfernApi,
  SessionView,
} from "../../shared/api";
import type { DictionaryStatus, LanguageInfo, LookupResult, Token } from "../../shared/lang";
import { pickDefaultModel } from "../../shared/models";
import type {
  AnkiConfig,
  AnkiOverview,
  ChatMessage,
  Correction,
  DocKind,
  Difficulty,
  GrammarObservation,
  GrammarSummary,
  Language,
  LearnerProfile,
  LevelBand,
  LevelEstimate,
  LibraryDoc,
  LibraryHit,
  LibraryParagraph,
  PracticeTarget,
  ProgressRange,
  ProgressStats,
  SavedWord,
  SessionKind,
  SessionMeta,
  Skill,
  Verdict,
} from "../../shared/records";
import { SKILLS } from "../../shared/records";
import { LANGUAGE_META } from "../../shared/languages";
import { buildCourseView, findUnit, type CourseView } from "../../shared/course";
import { findScenario } from "../../shared/scenarios";
import type { AuthEventPayload, AuthPromptPayload, ModelInfo, ModelRef, ProviderInfo, Settings, UiLocale } from "../../shared/types";
import { SayfernTutor } from "../agent";
import { lastConversationVerdicts, pickFollowUps } from "../agent/prompt";
import { TARGET_COUNT } from "../agent/turn";
import { stripPasted } from "../agent/text";
import { AnkiConnectService } from "../anki";
import type { TutorEvent } from "../contracts";
import { DefaultLanguageService } from "../lang";
import { FileLibraryService } from "../library";
import { describeProviders, listAvailableModels } from "../providers";
import { JsonRecordsStore } from "../records";
import { QuizService } from "../quiz";
import { DeckService } from "../decks";
import { ReviewService } from "../review";
import { bindSlot, type Stage2Deps } from "../stage2";
import { ElevenLabsAccounts, VoiceService } from "../voice";
import { VOICE_METHODS, type VoiceApi } from "../../shared/stage3";
import { DECK_METHODS, QUIZ_METHODS, REVIEW_METHODS, type DeckApi, type QuizApi, type ReviewApi } from "../../shared/stage2";
import { SettingsStore } from "./settings";

export { SettingsStore, DEFAULT_SETTINGS } from "./settings";

export type AppEventChannel = keyof typeof EVENT_CHANNELS;

export interface SayfernAppDeps {
  dataDir: string;
  models: MutableModels;
  credentials: CredentialStore;
  fetch?: typeof fetch;
  /** Fetch used for AnkiConnect (localhost). Defaults to `fetch`. Main passes Node's global fetch. */
  ankiFetch?: typeof fetch;
  now?: () => number;
  emit: (channel: AppEventChannel, payload: unknown) => void;
  newId?: () => string;
  /** Opens sign-in pages (auth_url, device codes) in the browser. */
  openExternal?: (url: string) => void;
  /** Override the kuromoji dictionary directory (packaged app). */
  kuromojiDicPath?: string;
  /** The OS's preferred languages, in order (main: app.getPreferredSystemLanguages). Picks the default interface language. */
  systemLocales?: () => readonly string[];
}

/** Methods that need Electron (dialogs, shell): main implements these itself. */
export type ElectronOnlyMethod = "importDocs" | "exportData" | "eraseAllData" | "openExternal" | "requestMicrophone";

/**
 * What "Erase all data" removes, relative to dataDir. Kept: dict/ (downloaded dictionaries, not learner data).
 * credentials.json goes too unless sign-ins are kept.
 */
export const ERASE_PATHS = ["records", "library", "anki", "sessions", "settings.json"] as const;
export type CoreApi = Pick<SayfernApi, Exclude<ApiMethod, ElectronOnlyMethod>>;

type ChatEventBody = ChatEvent extends infer E ? (E extends ChatEvent ? Omit<E, "requestId" | "sessionId"> : never) : never;

/** Bump when learnerWords changes what counts as the target language: stored words are recounted once. */
const WORD_FILTER_VERSION = 1;

const OPENING_KINDS: ReadonlySet<SessionKind> = new Set(["practice", "reading", "placement"]);
const RECENT_COUNT = 5;
/** Background Anki refresh: sync when the snapshot is older than this. */
export const ANKI_MAX_AGE_MS = 6 * 60 * 60 * 1000;


export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Stage 2 slot methods are bound onto SayfernApp at construction (see bindSlot in core/stage2.ts). */
export interface SayfernApp extends ReviewApi, QuizApi, DeckApi, VoiceApi {}

export class SayfernApp implements CoreApi {
  readonly dataDir: string;
  readonly models: MutableModels;
  readonly credentials: CredentialStore;
  readonly records: JsonRecordsStore;
  readonly lang: DefaultLanguageService;
  readonly library: FileLibraryService;
  readonly anki: AnkiConnectService;
  readonly tutor: SayfernTutor;
  readonly settings: SettingsStore;
  readonly review: ReviewService;
  readonly quizzes: QuizService;
  readonly decks: DeckService;
  readonly voice: VoiceService;

  private readonly emitEvent: SayfernAppDeps["emit"];
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly openUrl?: (url: string) => void;

  private readonly inflight = new Map<string, AbortController>();
  /** Sessions with an opening turn in flight (never start two). */
  private readonly openings = new Set<string>();
  private readonly running = new Set<Promise<void>>();
  /** Background Anki refreshes (ensureFresh), per language. */
  private readonly ankiRefresh = new Map<Language, Promise<void>>();
  /** messageId → sessionId, for translate(messageId). */
  private readonly messageSessions = new Map<string, string>();
  private readonly pendingPrompts = new Map<string, (value: string | null) => void>();
  private loginAbort: AbortController | null = null;
  /** The background dictionary downloads, chained so only one runs at a time. */
  private dictionaryCheck: Promise<void> = Promise.resolve();

  constructor(deps: SayfernAppDeps) {
    this.dataDir = deps.dataDir;
    this.models = deps.models;
    this.credentials = deps.credentials;
    this.emitEvent = deps.emit;
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
    this.openUrl = deps.openExternal;
    const now = this.now;

    this.settings = new SettingsStore(join(this.dataDir, "settings.json"), deps.systemLocales);
    this.records = new JsonRecordsStore({ dataDir: join(this.dataDir, "records"), now });
    // AnkiConnect is on localhost: use Node's fetch (deps.ankiFetch) rather than Chromium's net stack,
    // so system proxy/PAC settings can never intercept 127.0.0.1.
    this.anki = new AnkiConnectService({ dataDir: join(this.dataDir, "anki"), fetch: deps.ankiFetch ?? deps.fetch, now });
    this.library = new FileLibraryService({ dataDir: join(this.dataDir, "library"), now });
    this.lang = new DefaultLanguageService({
      dataDir: join(this.dataDir, "dict"),
      fetch: deps.fetch,
      kuromojiDicPath: deps.kuromojiDicPath,
      glossLocale: () => this.settings.locale(),
      wordUsage: (language, word) => this.records.getWordUsage(language, word),
      ankiCard: async (language, word) => ((await this.anki.getConfig()).enabled ? this.anki.findCard(language, word) : null),
    });
    this.tutor = new SayfernTutor({
      models: this.models,
      records: this.records,
      lang: this.lang,
      library: this.library,
      anki: this.anki,
      now,
      newId: this.newId,
      explanationLanguage: () => this.settings.explanationLanguage(),
      translator: () => this.settings.translator(),
    });

    // Stage 2 services: one shared deps object; their slot methods become SayfernApp methods.
    const stage2: Stage2Deps = {
      dataDir: this.dataDir,
      models: this.models,
      records: this.records,
      anki: this.anki,
      library: this.library,
      lang: this.lang,
      settings: this.settings,
      resolveModel: (ref) => this.resolveModel(ref),
      emit: (channel, payload) => this.emitEvent(channel, payload),
      now,
      newId: this.newId,
      fetch: deps.fetch,
      credentials: this.credentials,
    };
    // One ElevenLabs account pool for deck audio and voice.
    stage2.eleven = new ElevenLabsAccounts({
      credentials: this.credentials,
      settings: this.settings,
      fetch: () => deps.fetch ?? globalThis.fetch.bind(globalThis),
      now,
      newId: this.newId,
    });
    this.review = new ReviewService(stage2);
    this.quizzes = new QuizService(stage2);
    bindSlot(this, this.review, REVIEW_METHODS);
    bindSlot(this, this.quizzes, QUIZ_METHODS);
    this.decks = new DeckService(stage2);
    bindSlot(this, this.decks, DECK_METHODS);
    this.voice = new VoiceService(stage2);
    bindSlot(this, this.voice, VOICE_METHODS);
  }

  /** One-time setup: v0.1 session import (once). Call before serving requests. */
  async init(): Promise<void> {
    const s = await this.settings.get();
    if (!s.legacyImported) {
      try {
        await this.records.importLegacySessions(join(this.dataDir, "sessions"));
        await this.settings.update({ legacyImported: true });
      } catch (err) {
        console.error("Legacy session import failed:", errorText(err));
      }
    }
    for (const info of this.lang.languages()) this.refreshAnki(info.id);
    this.recountWords(this.lang.languages().map((l) => l.id));
    this.ensureDictionaries();
  }

  /**
   * Dictionaries are required (ADR 31): downloads, one at a time and in the background, the missing
   * dictionary of each language the learner learns. Runs after onboarding, at startup, and when the
   * languages or the interface language change. A failed download stays on the dictionary's status
   * (Settings > Dictionaries offers a retry) and is tried again at the next startup.
   */
  private ensureDictionaries(): Promise<void> {
    this.dictionaryCheck = this.dictionaryCheck.then(async () => {
      const s = await this.settings.get();
      if (!s.onboarded) return;
      for (const language of s.languages ?? [s.language]) {
        const status = await this.lang.dictionaryStatus(language).catch(() => null);
        // downloadMb 0: no dictionary exists for this pair; the built-in word lists stay.
        if (!status || status.installed || status.installing || status.downloadMb === 0) continue;
        await this.installDictionary(language).catch(() => undefined);
      }
    });
    return this.dictionaryCheck;
  }

  /** Resolves when the background dictionary downloads are done (tests). */
  whenDictionariesReady(): Promise<void> {
    return this.dictionaryCheck;
  }

  /**
   * Recounts stored learner words with the current target-language filter (ADR 30), in the background.
   * Skips, without loading its pack, a language whose filter key (filter version + dictionary) has not
   * changed or that has no stored learner words.
   */
  private recountWords(languages: Language[]): void {
    const task = (async () => {
      for (const language of languages) {
        try {
          const dict = await this.lang.dictionaryStatus(language).catch(() => null);
          const key = `${WORD_FILTER_VERSION}|${dict?.installed ? dict.name : "none"}`;
          // Loading a pack costs memory (dictionary, kuromoji): only when there is work to do.
          if (!(await this.records.needsRecount(language, key))) continue;
          const pack = this.lang.pack(language);
          await pack.ready();
          await this.records.recountLearnerWords(language, key, (m) => pack.learnerWords(stripPasted(m.text, m.pastedSpans)));
        } catch (err) {
          console.error(`Recounting ${language} learner words failed:`, errorText(err));
        }
      }
    })();
    this.running.add(task);
    void task.finally(() => this.running.delete(task));
  }

  /**
   * Sync a language's Anki snapshot in the background if it is older than 6 hours
   * (startup, session start). Never blocks the caller and never throws.
   */
  refreshAnki(language: Language): void {
    if (this.ankiRefresh.has(language)) return;
    const task = this.anki
      .ensureFresh(language, ANKI_MAX_AGE_MS)
      .then(() => undefined, () => undefined)
      .finally(() => this.ankiRefresh.delete(language));
    this.ankiRefresh.set(language, task);
  }

  /** Resolves when no background Anki refresh is running (tests). */
  async whenAnkiFresh(): Promise<void> {
    while (this.ankiRefresh.size) await Promise.allSettled([...this.ankiRefresh.values()]);
  }

  /** Resolves when no tutor turn is running (tests, shutdown). */
  async whenIdle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  // ============================================================ settings, providers, auth

  getSettings(): Promise<Settings> {
    return this.settings.get();
  }

  async setSettings(patch: Partial<Settings>): Promise<Settings> {
    const next = await this.settings.update(patch);
    // A new language or interface language can need a new dictionary.
    if (patch.languages || patch.language || patch.uiLocale || patch.onboarded) void this.ensureDictionaries();
    return next;
  }

  async systemLocale(): Promise<UiLocale> {
    return this.settings.systemLocale();
  }

  listProviders(): Promise<ProviderInfo[]> {
    return describeProviders(this.models, this.credentials);
  }

  listModels(): Promise<ModelInfo[]> {
    return listAvailableModels(this.models);
  }

  async setApiKey(providerId: string, key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) throw new Error("Paste a key first.");
    await this.credentials.modify(providerId, async () => ({ type: "api_key", key: trimmed }));
  }

  /** Stable per-install id (Sign in with ChatGPT registers it as the agent host). */
  async getDeviceId(): Promise<string> {
    const { deviceId } = await this.settings.get();
    if (deviceId) return deviceId;
    return (await this.settings.update({ deviceId: randomUUID() })).deviceId!;
  }

  async login(providerId: string): Promise<void> {
    this.loginAbort?.abort();
    const ctrl = new AbortController();
    this.loginAbort = ctrl;
    try {
      const deviceId = await this.getDeviceId();
      await this.models.login(providerId, "oauth", this.authInteraction(ctrl.signal), { getDeviceId: () => deviceId });
    } finally {
      if (this.loginAbort === ctrl) this.loginAbort = null;
    }
  }

  async cancelLogin(): Promise<void> {
    this.loginAbort?.abort();
    for (const finish of [...this.pendingPrompts.values()]) finish(null);
  }

  logout(providerId: string): Promise<void> {
    return this.models.logout(providerId);
  }

  async answerAuthPrompt(promptId: string, value: string | null): Promise<void> {
    this.pendingPrompts.get(promptId)?.(value);
  }

  /** Forwards pi-ai's sign-in interaction to the renderer (authEvent / authPrompt). */
  authInteraction(signal: AbortSignal): AuthInteraction {
    const emit = this.emitEvent;
    return {
      signal,
      notify: (event) => {
        if (event.type === "auth_url") {
          // pi-ai names itself on OpenAI's consent screen; show Sayfern instead.
          event = { ...event, url: event.url.replace(/([?&]agent_name_hint=)Pi(?=&|$)/, "$1Sayfern") };
          this.openUrl?.(event.url);
        }
        if (event.type === "device_code") this.openUrl?.(event.verificationUri);
        emit("authEvent", event as AuthEventPayload);
      },
      prompt: (p: AuthPrompt) => {
        const promptId = randomUUID();
        const payload: AuthPromptPayload =
          p.type === "select"
            ? { promptId, type: "select", message: p.message, options: [...p.options] }
            : { promptId, type: p.type, message: p.message, placeholder: p.placeholder };
        return new Promise<string>((resolve, reject) => {
          const finish = (value: string | null) => {
            this.pendingPrompts.delete(promptId);
            if (value === null) reject(new Error("Cancelled"));
            else resolve(value);
          };
          this.pendingPrompts.set(promptId, finish);
          // manual_code prompts race a local callback server; pi-ai aborts the prompt when the browser wins.
          p.signal?.addEventListener("abort", () => {
            if (!this.pendingPrompts.has(promptId)) return;
            this.pendingPrompts.delete(promptId);
            emit("authEvent", { type: "prompt_cancelled", promptId } satisfies AuthEventPayload);
            reject(new Error("Prompt superseded"));
          });
          emit("authPrompt", payload);
        });
      },
    };
  }

  // ============================================================ languages & home

  async listLanguages(): Promise<LanguageInfo[]> {
    return this.lang.languages();
  }

  async getHome(language: Language): Promise<HomeView> {
    const { records } = this;
    const sessions = await records.listSessions(language);

    let resume: HomeView["resume"];
    for (const meta of sessions) {
      if (meta.endedAt) continue;
      const messages = await records.getMessages(meta.id);
      if (!messages.length) continue;
      const lastTutor = [...messages].reverse().find((m) => m.role === "tutor" && m.text.trim());
      resume = lastTutor ? { session: meta, lastTutorLine: lastTutor.text } : { session: meta };
      break;
    }

    const [grammar, observations, levels, week, reading, targets] = await Promise.all([
      records.listGrammar(language),
      records.listObservations({ language }),
      records.getLevels(language),
      records.getProgress(language, "week", await this.ankiSnapshotIfEnabled(language)),
      this.readingSpot(language),
      this.homeTargets(language, sessions[0]),
    ]);

    const lastAssessed = lastConversationVerdicts(observations);

    const home: HomeView = {
      language,
      followUps: pickFollowUps(grammar, lastAssessed, this.now()),
      targets,
      week: {
        activeMs: week.activeMs,
        wordsWritten: week.wordsWritten,
        distinctWords: week.distinctWords,
        firstUsed: week.firstUsed.length,
        daily: week.daily.slice(-7),
      },
      recent: sessions.slice(0, RECENT_COUNT),
      levels: levels.current,
      needsPlacement: Object.keys(levels.current).length === 0,
    };
    if (resume) home.resume = resume;
    if (reading) home.reading = reading;
    return home;
  }

  private async readingSpot(language: Language): Promise<HomeView["reading"]> {
    const docs = (await this.library.listDocs(language)).filter((d) => d.checkpoint && d.paragraphCount > 0);
    docs.sort((a, b) => b.checkpoint!.at - a.checkpoint!.at);
    const doc = docs[0];
    if (!doc) return undefined;
    const paragraph = Math.min(Math.max(0, doc.checkpoint!.paragraph), doc.paragraphCount - 1);
    const [p] = await this.library.getParagraphs(doc.id, paragraph, 1);
    return { doc, paragraph, preview: p?.text ?? "" };
  }

  private async homeTargets(language: Language, latest: SessionMeta | undefined): Promise<PracticeTarget[]> {
    const config = await this.anki.getConfig();
    if (!config.enabled) return [];
    if (latest) {
      const existing = await this.records.getTargets(latest.id);
      if (existing.length) return existing;
    }
    return this.anki
      .selectTargets(language, TARGET_COUNT, async (word) => (await this.records.getWordUsage(language, word))?.count ?? 0)
      .catch(() => []);
  }

  private async ankiSnapshotIfEnabled(language: Language) {
    if (!(await this.anki.getConfig()).enabled) return null;
    return this.anki.snapshot(language).catch(() => null);
  }

  // ============================================================ sessions

  listSessions(language: Language): Promise<SessionMeta[]> {
    return this.records.listSessions(language);
  }

  async getSession(id: string): Promise<SessionView | null> {
    const { records } = this;
    const meta = await records.getSession(id);
    if (!meta) return null;
    const language = meta.language;
    const [messages, corrections, observations, targets] = await Promise.all([
      records.getMessages(id),
      records.listCorrections({ language, sessionId: id }),
      records.listObservations({ language, sessionId: id }),
      records.getTargets(id),
    ]);
    for (const m of messages) this.messageSessions.set(m.id, id);

    const ids: string[] = [];
    const add = (g?: string) => g && !ids.includes(g) && ids.push(g);
    add(meta.focusGrammarId);
    for (const o of observations) add(o.grammarId);
    for (const c of corrections) add(c.grammarId);
    const grammarInPlay: GrammarSummary[] = [];
    for (const g of ids) {
      const s = await records.getGrammarSummary(g);
      if (s) grammarInPlay.push(s);
    }

    const view: SessionView = { meta, messages, corrections, targets, grammarInPlay };
    if (meta.docId) {
      const doc = await this.library.getDoc(meta.docId);
      if (doc) view.doc = doc;
    }
    return view;
  }

  async newSession(opts: NewSessionOptions): Promise<SessionView> {
    const kind = opts.kind ?? "chat";
    if (kind === "reading") {
      if (!opts.docId) throw new Error("Pick a document to read first.");
      return this.openReading(opts.docId);
    }
    if (kind === "practice" && opts.unitId) return this.startUnit(opts.unitId);
    if (kind === "practice" && opts.focusGrammarId) return this.practiseGrammar(opts.focusGrammarId);
    if (kind === "placement") return this.startPlacement(opts.language);
    const scenario = kind === "chat" ? findScenario(opts.scenarioId) : undefined;
    if (scenario) {
      const tr = await this.settings.translator();
      return this.createAndOpen({ language: opts.language, kind, scenarioId: scenario.id, title: tr.t(scenario.title) });
    }
    return this.createAndOpen({ language: opts.language, kind, focusGrammarId: opts.focusGrammarId });
  }

  private async createAndOpen(input: {
    language: Language;
    kind: SessionKind;
    title?: string;
    focusGrammarId?: string;
    openWith?: "explain";
    unitId?: string;
    docId?: string;
    levelBand?: LevelBand;
    scenarioId?: string;
  }): Promise<SessionView> {
    const meta = await this.records.createSession({ ...input, feedbackMode: "inline" });
    this.refreshAnki(meta.language);
    return this.viewWithOpening(meta.id);
  }

  /** Returns the view; for practice/reading/placement and role-play sessions with nothing said yet, starts the tutor's opening. */
  private async viewWithOpening(sessionId: string): Promise<SessionView> {
    const view = await this.getSession(sessionId);
    if (!view) throw new Error(`Session not found: ${sessionId}`);
    const needsOpening =
      (OPENING_KINDS.has(view.meta.kind) || !!view.meta.scenarioId) &&
      !view.meta.endedAt &&
      !view.messages.some((m) => m.role === "user" || !m.error) &&
      !this.openings.has(sessionId);
    if (needsOpening) {
      const model = await this.defaultModel();
      if (model) {
        this.openings.add(sessionId);
        this.startRequest(sessionId, (signal, onEvent) => {
          // An empty delta right away: the renderer starts following the turn (thinking dots, composer busy)
          // before the model's first token arrives.
          onEvent({ type: "delta", text: "" });
          return this.tutor.runOpening({ sessionId, model, signal, onEvent }).finally(() => this.openings.delete(sessionId));
        });
      }
    }
    return view;
  }

  /** The model the renderer would pick: the saved one if still available, else the default pick. */
  private async defaultModel(): Promise<Model<Api> | undefined> {
    const [settings, available] = await Promise.all([this.settings.get(), listAvailableModels(this.models).catch(() => [])]);
    const saved = settings.model && available.find((m) => m.provider === settings.model!.provider && m.id === settings.model!.id);
    const chosen = saved || pickDefaultModel(available);
    return chosen ? this.models.getModel(chosen.provider, chosen.id) : undefined;
  }

  renameSession(id: string, title: string): Promise<SessionMeta> {
    const t = title.trim();
    if (!t) throw new Error("Give the session a name.");
    return this.records.updateSession(id, { title: t });
  }

  async deleteSession(id: string): Promise<void> {
    await this.records.deleteSession(id);
  }

  async setDifficulty(sessionId: string, difficulty: Difficulty): Promise<SessionMeta> {
    const n = Math.round(Number(difficulty)) || 0;
    const level = Math.max(-2, Math.min(2, n)) as Difficulty;
    return this.records.updateSession(sessionId, { difficulty: level });
  }

  /** "New topic": a tutor turn with a hidden kickoff, like an opening, mid-session. */
  async newTopic(sessionId: string, ref: ModelRef): Promise<{ requestId: string }> {
    const session = await this.records.getSession(sessionId);
    if (!session) throw new Error("This session no longer exists.");
    if (this.openings.has(sessionId)) throw new Error("The tutor is still starting this session. Try again in a moment.");
    const model = this.resolveModel(ref);
    this.openings.add(sessionId);
    const requestId = this.startRequest(sessionId, (signal, onEvent) => {
      onEvent({ type: "delta", text: "" });
      return this.tutor.runOpening({ sessionId, model, signal, onEvent, newTopic: true }).finally(() => this.openings.delete(sessionId));
    });
    return { requestId };
  }

  async send(sessionId: string, input: { text: string; pastedSpans?: string[]; spoken?: boolean }, ref: ModelRef): Promise<{ requestId: string }> {
    const session = await this.records.getSession(sessionId);
    if (!session) throw new Error("This session no longer exists.");
    const text = input.text?.trim();
    if (!text) throw new Error("Type a message first.");
    if (this.openings.has(sessionId)) throw new Error("The tutor is still starting this session. Try again in a moment.");
    const model = this.resolveModel(ref);
    const requestId = this.startRequest(sessionId, (signal, onEvent) =>
      this.tutor.runTurn({ sessionId, text: input.text, pastedSpans: input.pastedSpans, spoken: input.spoken === true, model, signal, onEvent }),
    );
    return { requestId };
  }

  async abort(requestId: string): Promise<void> {
    this.inflight.get(requestId)?.abort();
  }

  private resolveModel(ref: ModelRef): Model<Api> {
    const model = ref && this.models.getModel(ref.provider, ref.id);
    if (!model) throw new Error(`Unknown model ${ref?.provider}/${ref?.id}. Pick another one in the model menu.`);
    return model;
  }

  /**
   * Runs a tutor turn detached and streams it as ChatEvents. The final event is
   * `done` (with the canonical view) or `error`, which always carries a fresh
   * view when the session still exists.
   */
  private startRequest(
    sessionId: string,
    run: (signal: AbortSignal, onEvent: (e: TutorEvent) => void) => Promise<ChatMessage>,
  ): string {
    const requestId = this.newId();
    const ctrl = new AbortController();
    this.inflight.set(requestId, ctrl);
    const chat = (body: ChatEventBody) => {
      try {
        this.emitEvent("chat", { requestId, sessionId, ...body } as ChatEvent);
      } catch (err) {
        console.error("chat event listener failed:", errorText(err));
      }
    };
    const task = (async () => {
      try {
        const message = await run(ctrl.signal, (e) => chat(e));
        this.messageSessions.set(message.id, sessionId);
        const view = await this.getSession(sessionId).catch(() => null);
        if (message.error || !view) {
          const aborted = message.error === "Stopped" || ctrl.signal.aborted;
          chat({ type: "error", message: message.error ?? "This session no longer exists.", aborted, ...(view ? { view } : {}) });
        } else {
          chat({ type: "done", message, view });
        }
      } catch (err) {
        const view = await this.getSession(sessionId).catch(() => null);
        chat({ type: "error", message: errorText(err), aborted: ctrl.signal.aborted, ...(view ? { view } : {}) });
      } finally {
        this.inflight.delete(requestId);
      }
    })();
    this.running.add(task);
    void task.finally(() => this.running.delete(task));
    return requestId;
  }

  async translate(messageId: string, ref: ModelRef): Promise<string> {
    const model = this.resolveModel(ref);
    const sessionId = await this.findMessageSession(messageId);
    if (!sessionId) throw new Error("That message no longer exists.");
    return this.tutor.translate(sessionId, messageId, model);
  }

  private async findMessageSession(messageId: string): Promise<string | undefined> {
    const known = this.messageSessions.get(messageId);
    if (known) return known;
    for (const info of this.lang.languages()) {
      for (const meta of await this.records.listSessions(info.id)) {
        const messages = await this.records.getMessages(meta.id);
        for (const m of messages) this.messageSessions.set(m.id, meta.id);
        if (messages.some((m) => m.id === messageId)) return meta.id;
      }
    }
    return undefined;
  }

  endSession(sessionId: string): Promise<EndSummary> {
    return this.tutor.endSession(sessionId);
  }

  async trackActivity(sessionId: string, ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms <= 0) return;
    // Renderer reports small increments; cap one report at 10 minutes to be safe.
    await this.records.addActiveTime(sessionId, Math.min(ms, 10 * 60 * 1000));
  }

  // ============================================================ corrections

  checkRetry(correctionId: string, text: string, ref: ModelRef): Promise<RetryResult> {
    return this.tutor.checkRetry(correctionId, text, this.resolveModel(ref));
  }

  revealCorrection(correctionId: string): Promise<Correction> {
    return this.records.updateCorrection(correctionId, { status: "revealed" });
  }

  disputeCorrection(correctionId: string, note: string): Promise<Correction> {
    return this.records.updateCorrection(correctionId, { status: "disputed", disputeNote: note.trim() });
  }

  // ============================================================ lookup & vocabulary

  annotate(language: Language, text: string): Promise<Token[]> {
    return this.lang.annotate(language, text);
  }

  lookup(language: Language, word: string): Promise<LookupResult> {
    return this.lang.lookup(language, word);
  }

  dictionaryStatus(language: Language): Promise<DictionaryStatus> {
    return this.lang.dictionaryStatus(language);
  }

  async installDictionary(language: Language): Promise<DictionaryStatus> {
    const status = await this.lang.installDictionary(language, (p) => this.emitEvent("dictionaryProgress", p));
    // A dictionary tells target words from own-language words better than the built-in lists.
    if (status.installed) this.recountWords([language]);
    return status;
  }

  saveWord(input: SaveWordInput): Promise<SavedWord> {
    const word: Omit<SavedWord, "id" | "createdAt"> = {
      language: input.language,
      word: input.word,
      sentence: input.sentence,
      source: input.source,
    };
    if (input.reading) word.reading = input.reading;
    if (input.definition) word.definition = input.definition;
    return this.records.saveWord(word);
  }

  listSavedWords(language: Language): Promise<SavedWord[]> {
    return this.records.listSavedWords(language);
  }

  deleteSavedWord(id: string): Promise<void> {
    return this.records.deleteSavedWord(id);
  }

  // ============================================================ grammar

  listGrammar(language: Language): Promise<GrammarSummary[]> {
    return this.records.listGrammar(language);
  }

  async getGrammar(id: string): Promise<GrammarDetail | null> {
    const summary = await this.records.getGrammarSummary(id);
    if (!summary) return null;
    const language = summary.point.language;
    const [observations, corrections] = await Promise.all([
      this.records.listObservations({ language, grammarId: id }),
      this.records.listCorrections({ language, grammarId: id }),
    ]);
    const sorted: GrammarObservation[] = [...observations].sort((a, b) => b.at - a.at);
    const sessionIds = [...new Set([...sorted.map((o) => o.sessionId), ...corrections.map((c) => c.sessionId)])];
    const sessions: SessionMeta[] = [];
    for (const sid of sessionIds) {
      const meta = await this.records.getSession(sid);
      if (meta) sessions.push(meta);
    }
    return { summary, observations: sorted, corrections, sessions };
  }

  async disputeObservation(observationId: string, verdict: Verdict, note: string): Promise<GrammarDetail | null> {
    const o = await this.records.disputeObservation(observationId, verdict, note.trim());
    return this.getGrammar(o.grammarId);
  }

  async practiseGrammar(grammarId: string, opts: { explain?: boolean } = {}): Promise<SessionView> {
    const point = await this.records.getGrammarPoint(grammarId);
    if (!point) throw new Error("That grammar point no longer exists.");
    return this.createAndOpen({
      language: point.language,
      kind: "practice",
      focusGrammarId: grammarId,
      ...(opts.explain ? { openWith: "explain" as const } : {}),
      title: `${LANGUAGE_META[point.language]?.titles.practice ?? "Practice"} ${point.pattern}`,
    });
  }

  // ============================================================ course

  async getCourse(language: Language): Promise<CourseView> {
    const [grammar, levels, sessions] = await Promise.all([
      this.records.listGrammar(language),
      this.records.getLevels(language),
      this.records.listSessions(language),
    ]);
    const opened = new Set(sessions.flatMap((s) => (s.unitId ? [s.unitId] : [])));
    return buildCourseView(language, this.lang.pack(language).info.levels, grammar, levels.current, opened);
  }

  async startUnit(unitId: string, opts: { explain?: boolean } = {}): Promise<SessionView> {
    const found = findUnit(unitId);
    if (!found) throw new Error("That course unit no longer exists.");
    const { course, unit } = found;
    const language = course.language;
    const tr = await this.settings.translator();
    return this.createAndOpen({
      language,
      kind: "practice",
      unitId,
      ...(opts.explain ? { openWith: "explain" as const } : {}),
      title: `${LANGUAGE_META[language]?.titles.practice ?? "Practice"} · ${tr.t(unit.title)}`,
    });
  }

  // ============================================================ library

  listDocs(language: Language): Promise<LibraryDoc[]> {
    return this.library.listDocs(language);
  }

  /** Imports files chosen in main's dialog. Throws only when nothing could be imported or some files failed. */
  async importFiles(language: Language, kind: DocKind, paths: string[]): Promise<LibraryDoc[]> {
    const added: LibraryDoc[] = [];
    const failed: string[] = [];
    for (const p of paths) {
      try {
        added.push(await this.library.importFile(p, language, kind));
      } catch (err) {
        failed.push(errorText(err));
      }
    }
    if (failed.length) {
      const prefix = added.length ? `Added ${added.length === 1 ? added[0].title : `${added.length} files`}. ` : "";
      throw new Error(prefix + failed.join(" "));
    }
    return added;
  }

  getDoc(docId: string): Promise<LibraryDoc | null> {
    return this.library.getDoc(docId);
  }

  getParagraphs(docId: string, from: number, count: number): Promise<LibraryParagraph[]> {
    return this.library.getParagraphs(docId, from, count);
  }

  setCheckpoint(docId: string, paragraph: number, offset: number): Promise<LibraryDoc> {
    return this.library.setCheckpoint(docId, paragraph, offset);
  }

  renameDoc(docId: string, title: string): Promise<LibraryDoc> {
    return this.library.renameDoc(docId, title);
  }

  deleteDoc(docId: string): Promise<void> {
    return this.library.deleteDoc(docId);
  }

  searchLibrary(language: Language, query: string): Promise<LibraryHit[]> {
    return this.library.search(language, query);
  }

  async openReading(docId: string): Promise<SessionView> {
    const doc = await this.library.getDoc(docId);
    if (!doc) throw new Error("That document is no longer in your library.");
    const existing = (await this.records.listSessions(doc.language)).find(
      (s) => s.kind === "reading" && s.docId === docId && !s.endedAt,
    );
    if (existing) {
      this.refreshAnki(doc.language);
      return this.viewWithOpening(existing.id);
    }
    return this.createAndOpen({ language: doc.language, kind: "reading", docId, title: doc.title });
  }

  // ============================================================ progress

  async getProgress(language: Language, range: ProgressRange): Promise<ProgressStats> {
    return this.records.getProgress(language, range, await this.ankiSnapshotIfEnabled(language));
  }

  // ============================================================ anki

  async ankiStatus(): Promise<AnkiStatus> {
    const [config, ping] = await Promise.all([this.anki.getConfig(), this.anki.ping()]);
    const status: AnkiStatus = { config, connected: ping.connected, snapshots: {} };
    if (ping.version !== undefined) status.version = ping.version;
    if (ping.error) status.error = ping.error;
    if (ping.reason) status.reason = ping.reason;
    if (ping.detail) status.detail = ping.detail;
    status.url = config.url;
    for (const info of this.lang.languages()) {
      const snap = await this.anki.snapshot(info.id).catch(() => null);
      if (snap) {
        status.snapshots[info.id] = {
          syncedAt: snap.syncedAt,
          matureCount: snap.matureCount,
          reviewedToday: snap.reviewedToday,
          cards: snap.cards.length,
        };
      }
    }
    return status;
  }

  async ankiSetConfig(config: AnkiConfig): Promise<AnkiStatus> {
    await this.anki.setConfig(config);
    return this.ankiStatus();
  }

  ankiDecks(): Promise<string[]> {
    return this.anki.deckNames();
  }

  ankiFields(deck: string): Promise<string[]> {
    return this.anki.fieldNames(deck);
  }

  async ankiSync(language: Language): Promise<AnkiStatus> {
    await this.anki.sync(language);
    return this.ankiStatus();
  }

  ankiOverview(language: Language): Promise<AnkiOverview | null> {
    return this.anki.overview(language);
  }

  // ============================================================ profile & level

  getProfile(): Promise<LearnerProfile> {
    return this.records.getProfile();
  }

  setProfile(patch: Partial<LearnerProfile>): Promise<LearnerProfile> {
    return this.records.setProfile(patch);
  }

  getLevels(language: Language): Promise<{ current: Partial<Record<Skill, LevelEstimate>>; history: LevelEstimate[] }> {
    return this.records.getLevels(language);
  }

  async setSelfLevel(language: Language, level: string): Promise<void> {
    const value = level.trim();
    if (!value) throw new Error("Pick a level.");
    const at = this.now();
    for (const skill of SKILLS) {
      await this.records.recordLevel({
        language,
        skill,
        level: value,
        confidence: "medium",
        evidence: "Self-rated",
        examples: [],
        at,
        by: "self",
      });
    }
  }

  startPlacement(language: Language, band?: LevelBand): Promise<SessionView> {
    return this.createAndOpen({ language, kind: "placement", title: LANGUAGE_META[language].titles.placement, ...(band ? { levelBand: band } : {}) });
  }

  // ============================================================ data

  /**
   * Stops all work (turns, openings, sign-in, Anki refreshes) and deletes the learner's data from disk.
   * The instance keeps stale caches afterwards: the caller must discard it and build a new SayfernApp
   * (main does this in its eraseAllData handler). `keepSignIns` keeps credentials.json and the device id.
   */
  async eraseData(opts: { keepSignIns: boolean }): Promise<void> {
    const deviceId = opts.keepSignIns ? (await this.settings.get()).deviceId : undefined;
    for (const ctrl of this.inflight.values()) ctrl.abort();
    this.quizzes.abortAll();
    await this.decks.abortAll();
    await this.cancelLogin();
    await this.whenIdle();
    await this.whenAnkiFresh();
    const paths: string[] = [...ERASE_PATHS];
    if (!opts.keepSignIns) paths.push("credentials.json");
    for (const p of paths) await rm(join(this.dataDir, p), { recursive: true, force: true });
    // Signed-in ChatGPT registrations are tied to the device id: keep it with the sign-ins.
    if (deviceId) await writeFile(join(this.dataDir, "settings.json"), JSON.stringify({ deviceId }, null, 2));
  }

  /** F-11: one JSON file with records, library list and settings (no credentials, no device id). */
  async exportTo(path: string): Promise<{ path: string }> {
    const settings: Partial<Settings> = await this.settings.get();
    delete settings.deviceId;
    delete settings.legacyImported;
    const library: LibraryDoc[] = [];
    for (const info of this.lang.languages()) library.push(...(await this.library.listDocs(info.id)));
    const data = {
      app: "Sayfern",
      format: 1,
      exportedAt: new Date(this.now()).toISOString(),
      settings,
      records: await this.records.exportAll(),
      quizzes: await this.quizzes.exportAll(),
      library,
      anki: await this.anki.getConfig(),
    };
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, path);
    return { path };
  }

  /** Default export file name: sayfern-export-YYYY-MM-DD.json (local date). */
  exportFileName(): string {
    const d = new Date(this.now());
    const pad = (n: number) => String(n).padStart(2, "0");
    return `sayfern-export-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
  }
}
