// Interfaces between core modules. Each module implements one of these and is
// constructed with plain dependencies (a data directory, fetch, etc.) so it can
// be unit-tested in Node without Electron.
//
// Ownership (see docs/stage1.md):
//   RecordsStore     → src/core/records/
//   LanguageService  → src/core/lang/
//   LibraryService   → src/core/library/
//   AnkiService      → src/core/anki/
//   Tutor            → src/core/agent/
import type { Message } from "@earendil-works/pi-ai";
import type { DictionaryProgress, DictionaryStatus, LanguageInfo, LookupResult, Token } from "../shared/lang";
import type {
  AnkiCard,
  AnkiConfig,
  AnkiOverview,
  AnkiSnapshot,
  AnkiWord,
  AnkiWordFilter,
  AnkiWordPage,
  AnkiWordStatus,
  ChatMessage,
  Correction,
  CorrectionKind,
  FeedbackMode,
  GrammarObservation,
  GrammarPoint,
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
  TargetStatus,
  Verdict,
  WordUsage,
} from "../shared/records";

// ================================================================ records

export interface NewSessionInput {
  language: Language;
  kind: SessionKind;
  feedbackMode: FeedbackMode;
  focusGrammarId?: string;
  /** practice sessions: open with a fresh explanation of the focus pattern. */
  openWith?: "explain";
  /** practice sessions: the course unit to work through. */
  unitId?: string;
  docId?: string;
  /** placement sessions: the learner's own rough level. */
  levelBand?: LevelBand;
  /** chat sessions: the role-play scenario. */
  scenarioId?: string;
  title?: string;
}

export interface CorrectionInput {
  sessionId: string;
  messageId: string;
  original: string;
  corrected: string;
  explanation: string;
  kind: CorrectionKind;
  grammarId?: string;
}

export interface GrammarPointInput {
  id: string;
  language: Language;
  pattern: string;
  name: string;
  reading?: string;
  level?: string;
  explanation?: string;
  examples?: GrammarPoint["examples"];
  sources?: GrammarPoint["sources"];
  /** true when the tutor is teaching it now (sets introducedAt once). */
  introduced?: boolean;
}

export type ObservationInput = Omit<GrammarObservation, "id" | "at" | "language" | "disputed"> & { at?: number };

/**
 * Local learning records. JSON-file backed, one process, serialized writes.
 * Every derived number (counts, rates, states, stats) is computed here with
 * ordinary code, never by a model (S1-25).
 */
export interface RecordsStore {
  // sessions & messages
  createSession(input: NewSessionInput): Promise<SessionMeta>;
  getSession(id: string): Promise<SessionMeta | null>;
  listSessions(language: Language): Promise<SessionMeta[]>; // newest first, excludes empty sessions older than 1 day
  updateSession(id: string, patch: Partial<Omit<SessionMeta, "id" | "language" | "createdAt">>): Promise<SessionMeta>;
  deleteSession(id: string): Promise<void>;
  getMessages(sessionId: string): Promise<ChatMessage[]>;
  appendMessage(message: ChatMessage): Promise<void>;
  updateMessage(sessionId: string, messageId: string, patch: Partial<ChatMessage>): Promise<ChatMessage>;
  /** Provider-neutral transcript (pi-ai messages) kept beside the display messages. */
  getTranscript(sessionId: string): Promise<Message[]>;
  setTranscript(sessionId: string, transcript: Message[]): Promise<void>;
  addUsage(sessionId: string, usage: { input: number; output: number; cost: number }): Promise<void>;
  addActiveTime(sessionId: string, ms: number, at?: number): Promise<void>;
  /** S3-04: voice practice time (speaking and listening), kept apart from text practice. */
  addVoiceTime(sessionId: string, ms: number, at?: number): Promise<void>;

  // corrections
  /** Idempotent per (messageId, original): returns the existing record on a repeat (S1-27). */
  addCorrection(input: CorrectionInput): Promise<Correction>;
  getCorrection(id: string): Promise<Correction | null>;
  updateCorrection(id: string, patch: Partial<Correction>): Promise<Correction>;
  listCorrections(filter: { language: Language; sessionId?: string; grammarId?: string }): Promise<Correction[]>;

  // grammar
  upsertGrammarPoint(input: GrammarPointInput): Promise<GrammarPoint>;
  getGrammarPoint(id: string): Promise<GrammarPoint | null>;
  /** Idempotent: observation ids are deterministic (see observationId). Returns only newly stored ones. */
  recordObservations(language: Language, inputs: ObservationInput[]): Promise<GrammarObservation[]>;
  listObservations(filter: { language: Language; grammarId?: string; sessionId?: string }): Promise<GrammarObservation[]>;
  disputeObservation(id: string, verdict: Verdict, note: string): Promise<GrammarObservation>;
  listGrammar(language: Language): Promise<GrammarSummary[]>;
  getGrammarSummary(id: string): Promise<GrammarSummary | null>;

  // vocabulary & usage
  saveWord(input: Omit<SavedWord, "id" | "createdAt">): Promise<SavedWord>;
  listSavedWords(language: Language): Promise<SavedWord[]>;
  deleteSavedWord(id: string): Promise<void>;
  /**
   * Record the learner-produced words of one message (already segmented, pasted
   * spans already removed). Returns words used for the first time ever (S1-22).
   */
  recordLearnerWords(input: {
    language: Language;
    sessionId: string;
    messageId: string;
    sentence: string;
    words: string[];
    at: number;
  }): Promise<WordUsage[]>;
  /**
   * Recounts the learner words of every stored learner message with `wordsOf` and rebuilds word usage
   * from them. Runs only when `key` (the filter's inputs) differs from the last run for the language.
   * Returns whether it ran.
   */
  recountLearnerWords(language: Language, key: string, wordsOf: (message: ChatMessage) => string[]): Promise<boolean>;
  /** Cheap check before loading a language pack: `key` differs from the last recount and there are words to recount. */
  needsRecount(language: Language, key: string): Promise<boolean>;
  getWordUsage(language: Language, word: string): Promise<WordUsage | null>;

  // anki practice targets per session (S1-14)
  getTargets(sessionId: string): Promise<PracticeTarget[]>;
  setTargets(sessionId: string, targets: PracticeTarget[]): Promise<void>;
  markTargets(sessionId: string, words: string[], status: TargetStatus): Promise<PracticeTarget[]>;

  // level & profile
  recordLevel(estimate: LevelEstimate): Promise<void>;
  getLevels(language: Language): Promise<{ current: Partial<Record<Skill, LevelEstimate>>; history: LevelEstimate[] }>;
  getProfile(): Promise<LearnerProfile>;
  setProfile(patch: Partial<LearnerProfile>): Promise<LearnerProfile>;

  // analytics & export
  getProgress(language: Language, range: ProgressRange, anki?: AnkiSnapshot | null): Promise<ProgressStats>;
  /** Everything, as one JSON-serializable object (F-11). */
  exportAll(): Promise<Record<string, unknown>>;
}

// ================================================================ language

/**
 * One implementation per language (F-08). Adding a language = adding a pack.
 * Extensions may register packs at runtime.
 */
export interface LanguagePack {
  info: LanguageInfo;
  /** Must be ready before segment/annotate are called (e.g. loads the Japanese tokenizer). */
  ready(): Promise<void>;
  /** Tokens covering the whole text in order (see Token contract). */
  segment(text: string): Token[];
  /** Words the learner produced, for vocabulary stats: word tokens only, lemmatized. */
  learnerWords(text: string): string[];
  /** For comparing a retry with a correction: strip punctuation/space, width-fold. */
  normalize(text: string): string;
  /** Tutor prompt fragment describing this language's conventions (script, readings, level scale). */
  promptNotes(): string;
}

export interface DictionaryProvider {
  status(): Promise<DictionaryStatus>;
  /** Downloads + parses + indexes into dataDir. Idempotent. */
  install(onProgress: (p: DictionaryProgress) => void): Promise<DictionaryStatus>;
  /** Exact then lemma lookups; [] when not installed. */
  lookup(word: string): Promise<import("../shared/lang").DictEntry[]>;
  /** Longest dictionary word starting at `index` in `text` (for better segmentation), or 0. */
  longestMatch?(text: string, index: number): number;
}

export interface LanguageService {
  languages(): LanguageInfo[];
  pack(language: Language): LanguagePack;
  /** Segment + readings, ready for rendering hoverable text / ruby. */
  annotate(language: Language, text: string): Promise<Token[]>;
  lookup(language: Language, word: string): Promise<LookupResult>;
  dictionaryStatus(language: Language): Promise<DictionaryStatus>;
  installDictionary(language: Language, onProgress: (p: DictionaryProgress) => void): Promise<DictionaryStatus>;
  /** Extensions can add languages (F-08, F-09). */
  registerPack(pack: LanguagePack, dictionary?: DictionaryProvider): void;
}

// ================================================================ library

export interface ImportResult {
  doc: LibraryDoc;
}

export interface LibraryService {
  importFile(path: string, language: Language, kind: import("../shared/records").DocKind): Promise<LibraryDoc>;
  /** For tests and "paste text" imports. */
  importText(input: { title: string; text: string; language: Language; kind: import("../shared/records").DocKind; format?: "txt" | "md" }): Promise<LibraryDoc>;
  listDocs(language: Language): Promise<LibraryDoc[]>;
  getDoc(docId: string): Promise<LibraryDoc | null>;
  getParagraphs(docId: string, from: number, count: number): Promise<LibraryParagraph[]>;
  setCheckpoint(docId: string, paragraph: number, offset: number): Promise<LibraryDoc>;
  renameDoc(docId: string, title: string): Promise<LibraryDoc>;
  deleteDoc(docId: string): Promise<void>;
  /** Keyword search (CJK-aware) across a language's documents (S1-12). */
  search(language: Language, query: string, limit?: number): Promise<LibraryHit[]>;
  /** Text of kind:"personal" docs for the tutor's personal context (S1-03), truncated to maxChars. */
  personalContext(language: Language, maxChars: number): Promise<string>;
}

// ================================================================ anki

export interface AnkiService {
  getConfig(): Promise<AnkiConfig>;
  setConfig(config: AnkiConfig): Promise<AnkiConfig>;
  /** AnkiConnect reachable? Never throws. */
  ping(): Promise<{ connected: boolean; version?: number; error?: string }>;
  deckNames(): Promise<string[]>;
  fieldNames(deck: string): Promise<string[]>;
  /**
   * Pulls every card of the language's mapped decks (status, new-queue order, leech tag)
   * plus 90 days of review history, and caches the snapshot.
   */
  sync(language: Language): Promise<AnkiSnapshot>;
  /** Last cached snapshot (works while Anki is closed). */
  snapshot(language: Language): Promise<AnkiSnapshot | null>;
  /**
   * Sync in the background when enabled, the language has a deck, and the snapshot is
   * missing or older than maxAgeMs. Never throws; resolves with the (possibly old) snapshot.
   */
  ensureFresh(language: Language, maxAgeMs: number): Promise<AnkiSnapshot | null>;
  findCard(language: Language, word: string): Promise<AnkiCard | null>;
  /** Words (cards grouped by cleaned word) from the cached snapshot; see words.ts queryWords for sorting. */
  words(language: Language, filter?: AnkiWordFilter): Promise<AnkiWordPage>;
  /** Hardest words right now (struggle score above the threshold), hardest first. */
  struggling(language: Language, limit?: number, opts?: { deck?: string }): Promise<AnkiWord[]>;
  /** For each word: its status in Anki, or "unknown" when no card has it (matched on word or reading). */
  checkWords(language: Language, words: string[]): Promise<Record<string, AnkiWordStatus | "unknown">>;
  /** Vocabulary counts, next new words and hardest words; null when never synced. */
  overview(language: Language): Promise<AnkiOverview | null>;
  /**
   * Choose words to weave into conversation: recently studied words and the words with
   * the highest struggle scores, skipping words the learner already uses a lot (usageCount(word) >= 3).
   */
  selectTargets(language: Language, count: number, usageCount: (word: string) => Promise<number>): Promise<PracticeTarget[]>;

  // Note creation (Stage 2, S2-03: corrections → Anki cards).
  /** Creates the note type unless one with this name exists. True when it was created. */
  ensureNoteType(type: AnkiNoteType): Promise<boolean>;
  /** Creates the deck if needed (AnkiConnect createDeck is a no-op for an existing deck). */
  ensureDeck(deck: string): Promise<void>;
  /**
   * Adds notes, never duplicates: checks them first (canAddNotesWithErrorDetail, or canAddNotes on
   * older AnkiConnect), then adds the rest with addNotes. One result per input note, in order.
   * Throws AnkiUnreachableError when Anki can't be reached.
   */
  addNotes(notes: AnkiNoteInput[]): Promise<AnkiAddResult[]>;
  /**
   * Stores a file in Anki's media folder (AnkiConnect storeMediaFile) and returns the name Anki
   * used. Reference it from a field as `[sound:<name>]`. Throws AnkiUnreachableError when Anki can't be reached.
   */
  storeMedia(filename: string, base64: string): Promise<string>;
}

/** An Anki note type (AnkiConnect createModel). */
export interface AnkiNoteType {
  name: string;
  /** In order; the first field is what Anki checks for duplicates. */
  fields: string[];
  isCloze: boolean;
  css: string;
  templates: { Name: string; Front: string; Back: string }[];
}

export interface AnkiNoteInput {
  deckName: string;
  modelName: string;
  /** Field name → HTML. */
  fields: Record<string, string>;
  tags: string[];
}

export type AnkiAddResult = { status: "added"; noteId: number } | { status: "duplicate" } | { status: "failed"; error: string };

// ================================================================ tutor (agent loop)

export type TutorEvent =
  | { type: "user_saved"; message: ChatMessage }
  | { type: "delta"; text: string }
  | { type: "tool"; activity: import("../shared/records").ToolActivity }
  | { type: "correction"; correction: Correction };

export interface TurnInput {
  sessionId: string;
  text: string;
  pastedSpans?: string[];
  /** The learner spoke this message; `text` is the speech-to-text transcript (Stage 3). */
  spoken?: boolean;
  model: import("@earendil-works/pi-ai").Model<import("@earendil-works/pi-ai").Api>;
  signal: AbortSignal;
  onEvent(e: TutorEvent): void;
}

/** A tutor turn with no learner message. */
export type OpeningInput = Omit<TurnInput, "text" | "pastedSpans" | "spoken"> & { newTopic?: boolean };

export interface Tutor {
  /**
   * One learner turn: save the learner message, stream the reply, run tools,
   * record evidence, persist. Resolves with the saved tutor message (which
   * carries `error` on failure/abort instead of throwing, after saving it).
   */
  runTurn(input: TurnInput): Promise<ChatMessage>;
  /**
   * Reading/practice/placement sessions: the tutor speaks first. Same events, no learner message.
   * With `newTopic`, mid-session: the learner pressed "New topic" and the tutor opens a fresh one.
   */
  runOpening(input: OpeningInput): Promise<ChatMessage>;
  translate(sessionId: string, messageId: string, model: TurnInput["model"]): Promise<string>;
  checkRetry(correctionId: string, text: string, model: TurnInput["model"]): Promise<import("../shared/api").RetryResult>;
  endSession(sessionId: string): Promise<import("../shared/api").EndSummary>;
}

// ================================================================ extensions (F-09)

/**
 * A tool contributed by core or an extension. `recordingOnly` tools just store
 * data: after the model calls them the turn ends without a follow-up request
 * (S1-27). Other tools return content the model needs, so the loop continues.
 */
export interface TutorTool {
  name: string;
  description: string;
  /** TypeBox schema (import { Type } from "@earendil-works/pi-ai"). */
  parameters: import("@earendil-works/pi-ai").TSchema;
  recordingOnly: boolean;
  execute(args: unknown, ctx: ToolContext): Promise<{ content: string; activity: string }>;
}

export interface ToolContext {
  sessionId: string;
  language: Language;
  /** The learner message this turn answers (absent for openings). */
  userMessageId?: string;
  records: RecordsStore;
  library: LibraryService;
  anki: AnkiService;
  lang: LanguageService;
}

export interface ExtensionHost {
  /** Tools contributed by enabled extensions. */
  tools(): TutorTool[];
  /** Extra system-prompt paragraphs contributed by enabled extensions. */
  promptAdditions(language: Language): string[];
}
