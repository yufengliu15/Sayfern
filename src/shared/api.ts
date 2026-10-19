// The renderer ↔ main contract, exposed as `window.sayfern` by the preload script.
// Every method maps 1:1 to an ipcMain.handle channel named in IPC below.
import type { DictionaryProgress, DictionaryStatus, LanguageInfo, LookupResult, Token } from "./lang";
import type {
  AnkiConfig,
  AnkiOverview,
  AnkiSnapshot,
  ChatMessage,
  Correction,
  DocKind,
  Difficulty,
  GrammarObservation,
  GrammarSummary,
  Language,
  LearnerProfile,
  LevelEstimate,
  LibraryDoc,
  LibraryHit,
  LibraryParagraph,
  PracticeTarget,
  ProgressRange,
  ProgressStats,
  SavedWord,
  LevelBand,
  SessionKind,
  SessionMeta,
  Skill,
  SourceRef,
  ToolActivity,
  Verdict,
  WordUsage,
} from "./records";
import { DECK_METHODS, QUIZ_METHODS, REVIEW_METHODS, type DeckApi, type QuizApi, type ReviewApi } from "./stage2";
import type { CourseView } from "./course";
import type { AuthEventPayload, AuthPromptPayload, LocalEngineId, ModelInfo, ModelRef, ProviderInfo, ProviderUsage, Settings, UiLocale } from "./types";

export type * from "./stage2";
import { VOICE_METHODS, type VoiceApi } from "./stage3";
export type * from "./stage3";

// ---------------------------------------------------------------- views

export interface HomeView {
  language: Language;
  /** Most recent unfinished session in this language. */
  resume?: { session: SessionMeta; lastTutorLine?: string };
  /** Grammar the tutor will bring back naturally (S1-19). Max 3. */
  followUps: GrammarSummary[];
  /** Next unread spot in the most recently read document (S1-11). */
  reading?: { doc: LibraryDoc; paragraph: number; preview: string };
  /** Anki words queued for conversation (S1-14). Empty when Anki is off. */
  targets: PracticeTarget[];
  week: {
    activeMs: number;
    wordsWritten: number;
    distinctWords: number;
    firstUsed: number;
    /** 7 entries, oldest first. */
    daily: { date: string; activeMs: number }[];
  };
  recent: SessionMeta[];
  levels: Partial<Record<Skill, LevelEstimate>>;
  /** True when no level estimate exists yet: offer placement. */
  needsPlacement: boolean;
}

export interface SessionView {
  meta: SessionMeta;
  messages: ChatMessage[];
  /** All corrections in this session (the UI hides them until the end in "end" feedback mode). */
  corrections: Correction[];
  /** Anki words woven into this session and their status. */
  targets: PracticeTarget[];
  /** Grammar points observed or taught in this session. */
  grammarInPlay: GrammarSummary[];
  /** Reading sessions: the document. */
  doc?: LibraryDoc;
  /** The tutor uses the beginner persona (isBeginner); the chat shows readings above its words by default. */
  beginner?: boolean;
}

export interface EndSummary {
  session: SessionMeta;
  corrections: Correction[];
  grammar: { summary: GrammarSummary; observations: GrammarObservation[] }[];
  newWords: WordUsage[];
  targets: PracticeTarget[];
}

export interface GrammarDetail {
  summary: GrammarSummary;
  /** Newest first. */
  observations: GrammarObservation[];
  corrections: Correction[];
  /** Sessions referenced by observations, for links. */
  sessions: SessionMeta[];
}

export interface RetryResult {
  ok: boolean;
  /** One short sentence for the learner. */
  feedback: string;
  correction: Correction;
}

export interface AnkiStatus {
  config: AnkiConfig;
  /** AnkiConnect reachable right now. */
  connected: boolean;
  version?: number;
  error?: string;
  /** Why the last ping failed: drives the troubleshooting help in Settings. */
  reason?: "refused" | "timeout" | "forbidden" | "not_ankiconnect" | "other";
  /** Low-level error text (for bug reports). */
  detail?: string;
  /** AnkiConnect URL that was tried. */
  url?: string;
  snapshots: Partial<Record<Language, Pick<AnkiSnapshot, "syncedAt" | "matureCount" | "reviewedToday"> & { cards: number }>>;
}

export interface NewSessionOptions {
  language: Language;
  kind?: SessionKind;
  focusGrammarId?: string;
  /** practice: a course unit (src/shared/course). */
  unitId?: string;
  docId?: string;
  /** chat: a role-play scenario (src/shared/scenarios.ts). */
  scenarioId?: string;
}

export interface SaveWordInput {
  language: Language;
  word: string;
  reading?: string;
  definition?: string;
  sentence: string;
  source: SourceRef;
}

// ---------------------------------------------------------------- streaming events

export type ChatEvent =
  /** Canonical copy of the learner message, sent first. */
  | { requestId: string; sessionId: string; type: "user_saved"; message: ChatMessage }
  | { requestId: string; sessionId: string; type: "delta"; text: string }
  | { requestId: string; sessionId: string; type: "tool"; activity: ToolActivity }
  | { requestId: string; sessionId: string; type: "correction"; correction: Correction }
  | { requestId: string; sessionId: string; type: "done"; message: ChatMessage; view: SessionView }
  | { requestId: string; sessionId: string; type: "error"; message: string; aborted: boolean; view?: SessionView };

// ---------------------------------------------------------------- API

/**
 * Stage 2 methods live in per-feature slots (src/shared/stage2/: review, quiz, decks) so the
 * features can grow independently; SayfernApp binds each slot to its core service.
 */
export interface SayfernApi extends ReviewApi, QuizApi, DeckApi, VoiceApi {
  // settings, providers, auth
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  /** The interface language matched from the system's preferred languages (used when Settings.uiLocale is unset). */
  systemLocale(): Promise<UiLocale>;
  listProviders(): Promise<ProviderInfo[]>;
  listModels(): Promise<ModelInfo[]>;
  /** Plan limits, balance or local spend for a connected provider (connect screen). Never rejects for provider errors: they come back in `error`. */
  providerUsage(providerId: string): Promise<ProviderUsage>;
  setApiKey(providerId: string, key: string): Promise<void>;
  login(providerId: string): Promise<void>;
  cancelLogin(): Promise<void>;
  logout(providerId: string): Promise<void>;
  /** Saves a local server and reads its models. Rejects with the server's error if it cannot be reached. */
  connectLocal(engine: LocalEngineId, baseUrl: string, apiKey?: string): Promise<ModelInfo[]>;
  /** Forgets a local server. */
  disconnectLocal(engine: LocalEngineId): Promise<void>;
  answerAuthPrompt(promptId: string, value: string | null): Promise<void>;
  onAuthEvent(cb: (e: AuthEventPayload) => void): () => void;
  onAuthPrompt(cb: (p: AuthPromptPayload) => void): () => void;

  // languages & home
  listLanguages(): Promise<LanguageInfo[]>;
  getHome(language: Language): Promise<HomeView>;

  // sessions (S1-01, S1-02)
  listSessions(language: Language): Promise<SessionMeta[]>;
  getSession(id: string): Promise<SessionView | null>;
  newSession(opts: NewSessionOptions): Promise<SessionView>;
  renameSession(id: string, title: string): Promise<SessionMeta>;
  deleteSession(id: string): Promise<void>;
  /** "Go easier / go harder": -2..2, applied from the tutor's next reply. */
  setDifficulty(sessionId: string, difficulty: Difficulty): Promise<SessionMeta>;
  /** "New topic": the tutor drops the current topic and opens a fresh one. Progress arrives through onChatEvent. */
  newTopic(sessionId: string, model: ModelRef): Promise<{ requestId: string }>;
  /** Starts a tutor turn. Progress arrives through onChatEvent. */
  /** `spoken`: the text is a speech-to-text transcript of what the learner said (Stage 3). */
  send(sessionId: string, input: { text: string; pastedSpans?: string[]; spoken?: boolean }, model: ModelRef): Promise<{ requestId: string }>;
  abort(requestId: string): Promise<void>;
  onChatEvent(cb: (e: ChatEvent) => void): () => void;
  /** S1-08: translate one tutor message (cached on the message). */
  translate(messageId: string, model: ModelRef): Promise<string>;
  endSession(sessionId: string): Promise<EndSummary>;
  /** S1-24: renderer reports active (non-idle) time in small increments. */
  trackActivity(sessionId: string, ms: number): Promise<void>;

  // corrections (S1-06, S1-20)
  checkRetry(correctionId: string, text: string, model: ModelRef): Promise<RetryResult>;
  revealCorrection(correctionId: string): Promise<Correction>;
  disputeCorrection(correctionId: string, note: string): Promise<Correction>;

  // lookup & vocabulary (S1-07, S1-09)
  annotate(language: Language, text: string): Promise<Token[]>;
  lookup(language: Language, word: string): Promise<LookupResult>;
  dictionaryStatus(language: Language): Promise<DictionaryStatus>;
  installDictionary(language: Language): Promise<DictionaryStatus>;
  onDictionaryProgress(cb: (p: DictionaryProgress) => void): () => void;
  saveWord(input: SaveWordInput): Promise<SavedWord>;
  listSavedWords(language: Language): Promise<SavedWord[]>;
  deleteSavedWord(id: string): Promise<void>;

  // grammar (S1-15..S1-20)
  listGrammar(language: Language): Promise<GrammarSummary[]>;
  getGrammar(id: string): Promise<GrammarDetail | null>;
  disputeObservation(observationId: string, verdict: Verdict, note: string): Promise<GrammarDetail | null>;
  /** S1-19: new practice session focused on one pattern. `explain`: the tutor opens with a fresh explanation and a new example. */
  practiseGrammar(grammarId: string, opts?: { explain?: boolean }): Promise<SessionView>;

  // course (Duolingo-style units; only languages with a course, see src/shared/course)
  /** Units by level with status computed from grammar records. `available: false` for Beta languages. */
  getCourse(language: Language): Promise<CourseView>;
  /** New practice session on one course unit; the tutor opens it. `explain` ("Begin lesson"): an overview of the unit's grammar, then each point taught. Without it ("More practice"): plain conversation. */
  startUnit(unitId: string, opts?: { explain?: boolean }): Promise<SessionView>;

  // library (S1-10..S1-12)
  listDocs(language: Language): Promise<LibraryDoc[]>;
  /** Opens a file picker in main; imports the chosen files. */
  importDocs(language: Language, kind: DocKind): Promise<LibraryDoc[]>;
  getDoc(docId: string): Promise<LibraryDoc | null>;
  getParagraphs(docId: string, from: number, count: number): Promise<LibraryParagraph[]>;
  setCheckpoint(docId: string, paragraph: number, offset: number): Promise<LibraryDoc>;
  renameDoc(docId: string, title: string): Promise<LibraryDoc>;
  deleteDoc(docId: string): Promise<void>;
  searchLibrary(language: Language, query: string): Promise<LibraryHit[]>;
  /** Reuses the latest reading session for this doc or creates one. */
  openReading(docId: string): Promise<SessionView>;

  // progress (S1-22..S1-25)
  getProgress(language: Language, range: ProgressRange): Promise<ProgressStats>;

  // anki (S1-13, S1-14)
  ankiStatus(): Promise<AnkiStatus>;
  ankiSetConfig(config: AnkiConfig): Promise<AnkiStatus>;
  ankiDecks(): Promise<string[]>;
  ankiFields(deck: string): Promise<string[]>;
  ankiSync(language: Language): Promise<AnkiStatus>;
  /** Word counts, hardest words and next new words from the cached snapshot; null when never synced. */
  ankiOverview(language: Language): Promise<AnkiOverview | null>;

  // profile & level (S1-03, S1-04)
  getProfile(): Promise<LearnerProfile>;
  setProfile(patch: Partial<LearnerProfile>): Promise<LearnerProfile>;
  getLevels(language: Language): Promise<{ current: Partial<Record<Skill, LevelEstimate>>; history: LevelEstimate[] }>;
  setSelfLevel(language: Language, level: string): Promise<void>;
  /** `band`: the learner's own rough level, picked before the chat; the diagnostic starts there. */
  startPlacement(language: Language, band?: LevelBand): Promise<SessionView>;

  // data (F-11)
  exportData(): Promise<{ path: string } | null>;
  /**
   * Deletes every record, the library, settings and the Anki link, then restarts the backend fresh
   * (the renderer reloads afterwards). Downloaded dictionaries stay.
   * `keepSignIns`: keep model sign-ins and API keys.
   */
  eraseAllData(opts: { keepSignIns: boolean }): Promise<void>;
  /** Stage 3: asks macOS for microphone access (prompts once). True when Sayfern may record. */
  requestMicrophone(): Promise<boolean>;

  openExternal(url: string): Promise<void>;
  /** Asks GitHub for the newest release. Also in the macOS app menu (Sayfern > Check for Updates…). */
  checkForUpdates(): Promise<UpdateStatus>;
}

/** `flatpak`: this build runs in the Flatpak sandbox, so the software store (Flathub) updates it, not a download. */
export interface UpdateStatus {
  current: string;
  latest: string;
  available: boolean;
  /** The release page to download from (when `available`). */
  url: string;
  flatpak: boolean;
}

/**
 * IPC channel for each API method: `ipc:<methodName>`, invoked with the method's
 * arguments in order. Events use the channels below (main → renderer).
 */
export const EVENT_CHANNELS = {
  chat: "evt:chat",
  authEvent: "evt:auth",
  authPrompt: "evt:auth-prompt",
  dictionaryProgress: "evt:dictionary-progress",
} as const;

/** Every method except event subscriptions (`on*`), which listen on EVENT_CHANNELS instead. */
export type ApiMethod = Exclude<keyof SayfernApi, `on${string}`>;
export const ipcChannel = (m: ApiMethod): string => `ipc:${m}`;

/**
 * Every invokable method, for the generic preload bridge and main's handler table.
 * The Record type makes this a compile-time check: adding a method to SayfernApi
 * without listing it here (or listing an unknown one) is a type error.
 */
const METHOD_TABLE: Record<ApiMethod, true> = {
  ...REVIEW_METHODS,
  ...QUIZ_METHODS,
  ...DECK_METHODS,
  ...VOICE_METHODS,
  getSettings: true,
  setSettings: true,
  systemLocale: true,
  listProviders: true,
  listModels: true,
  providerUsage: true,
  setApiKey: true,
  login: true,
  cancelLogin: true,
  logout: true,
  connectLocal: true,
  disconnectLocal: true,
  answerAuthPrompt: true,
  listLanguages: true,
  getHome: true,
  listSessions: true,
  getSession: true,
  newSession: true,
  renameSession: true,
  deleteSession: true,
  setDifficulty: true,
  newTopic: true,
  send: true,
  abort: true,
  translate: true,
  endSession: true,
  trackActivity: true,
  checkRetry: true,
  revealCorrection: true,
  disputeCorrection: true,
  annotate: true,
  lookup: true,
  dictionaryStatus: true,
  installDictionary: true,
  saveWord: true,
  listSavedWords: true,
  deleteSavedWord: true,
  listGrammar: true,
  getGrammar: true,
  disputeObservation: true,
  practiseGrammar: true,
  listDocs: true,
  importDocs: true,
  getDoc: true,
  getParagraphs: true,
  setCheckpoint: true,
  renameDoc: true,
  deleteDoc: true,
  searchLibrary: true,
  openReading: true,
  getProgress: true,
  ankiStatus: true,
  ankiSetConfig: true,
  ankiDecks: true,
  ankiFields: true,
  ankiSync: true,
  ankiOverview: true,
  getProfile: true,
  setProfile: true,
  getLevels: true,
  getCourse: true,
  startUnit: true,
  setSelfLevel: true,
  startPlacement: true,
  exportData: true,
  eraseAllData: true,
  requestMicrophone: true,
  openExternal: true,
  checkForUpdates: true,
};

export const API_METHODS: readonly ApiMethod[] = Object.keys(METHOD_TABLE) as ApiMethod[];
