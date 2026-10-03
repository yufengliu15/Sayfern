// Stage 2 · Anki deck generator (S2-14..S2-16).
// Owned by the decks feature. Types only (compiled by both node and web TS projects).
// Every invokable method added to DeckApi must also be listed in DECK_METHODS (compile-time check).
//
// A deck project builds a new standalone Anki deck from scratch: the model picks the words and
// writes the cards; Sayfern checks readings against the installed dictionary, builds the ruby
// locally, skips words already in the learner's Anki, adds audio and sends the notes through
// AnkiConnect. Big decks are made in batches (DECK_BATCH_SIZE) and can be resumed any time.
import { LANGUAGE_META } from "../languages";
import type { Language } from "../records";
import type { ModelRef } from "../types";

// ---------------------------------------------------------------- spec

/** "elevenlabs": the learner's ElevenLabs account. "edge": Microsoft Edge's free online voices (what /ankigen uses). */
export type DeckAudioProvider = "elevenlabs" | "edge";

/** "frequency": most useful words first. "theme": grouped by theme. The learner's request can set its own order. */
export type DeckOrder = "frequency" | "theme";

/** Level value meaning "starting from zero". */
export const DECK_BEGINNER = "beginner";

export interface DeckSpec {
  language: Language;
  /** One of the language's levels ("HSK 3", "N4") or DECK_BEGINNER. */
  level: string;
  /**
   * What the learner wants, in their words: "the 1,500 most common words by SUBTLEX-CH frequency",
   * "the most common foods", "common sayings". Decides which items go in the deck (and their source
   * and order when it names them). Empty = general vocabulary at the level. Up to DECK_REQUEST_MAX characters.
   */
  request: string;
  /** Number of cards wanted (DECK_MIN_CARDS..DECK_MAX_CARDS). */
  size: number;
  order: DeckOrder;
  /** Anki deck to create. Sub-decks with "::". */
  deckName: string;
  /** Leave out words that already have a card in the learner's Anki (from the last sync). */
  skipKnown: boolean;
  audio: DeckAudioProvider;
}

export const DECK_MIN_CARDS = 10;
export const DECK_REQUEST_MAX = 500;
export const DECK_MAX_CARDS = 2000;
/** Cards per batch: one model request, then audio and AnkiConnect. */
export const DECK_BATCH_SIZE = 25;
/** Sample cards shown before any card goes to Anki. */
export const DECK_SAMPLE_SIZE = 5;
export const ANKIWEB_SHARED_DECKS = "https://ankiweb.net/shared/decks";

// ---------------------------------------------------------------- audio accounts

export interface ElevenLabsVoice {
  id: string;
  name: string;
  /** "premade", "cloned", ... */
  category?: string;
}

export interface ElevenLabsStatus {
  connected: boolean;
  voiceId?: string;
  voiceName?: string;
  voices: ElevenLabsVoice[];
  /** Credits left this month (character_limit - character_count), when the key may read it. */
  creditsLeft?: number;
  creditLimit?: number;
  /** When the monthly credits reset (ms). */
  resetsAt?: number;
  /** Plan name, e.g. "free". */
  tier?: string;
  /** Last problem talking to ElevenLabs, readable. */
  error?: string;
}

// ---------------------------------------------------------------- options + estimate

export interface DeckOptions {
  language: Language;
  /** The language's level scale, easiest first ("HSK 1".."HSK 6", "N5".."N1"). */
  levels: string[];
  /** The learner's current level, or null before placement. */
  currentLevel: string | null;
  goal?: string;
  anki: {
    enabled: boolean;
    connected: boolean;
    /** Distinct words with a card in the last snapshot; null when never synced. */
    knownWords: number | null;
    syncedAt: number | null;
  };
  /** Readings are checked against this dictionary when installed (CC-CEDICT, JMdict). */
  dictionary: { name: string; installed: boolean; downloadMb: number };
  elevenlabs: ElevenLabsStatus;
  /** "Sayfern · HSK 3" style default deck name for this language. */
  defaultDeckName: string;
  /** AnkiWeb shared decks, searched for this language. */
  sharedDecksUrl: string;
}

/** Computed locally, no model. */
export interface DeckEstimate {
  cards: number;
  batches: number;
  /** Rough minutes for all batches (model + audio + Anki). */
  minutes: number;
  /** Characters sent to text to speech for the whole deck (word + sentence), roughly. */
  audioCharacters: number;
  /** ElevenLabs credits left after this deck, when known. Negative = not enough this month. */
  creditsAfter?: number;
}

// ---------------------------------------------------------------- project view

/**
 * planning: choosing the words and writing the sample cards. preview: samples ready for approval.
 * ready: approved, more batches to go. generating: a batch is running. done: every word handled.
 * failed: planning failed (see error); a failed batch goes back to "ready" with lastError.
 */
export type DeckStatus = "planning" | "preview" | "ready" | "generating" | "done" | "failed";

export interface DeckRubySeg {
  text: string;
  /** Reading above `text` (pinyin or kana). */
  rt?: string;
  /** Part of the target word in a sentence. */
  target?: boolean;
}

/** Card states: added to Anki, already in Anki (duplicate), or failed (reason in `error`). */
export type DeckCardStatus = "sample" | "added" | "duplicate" | "failed";

export interface DeckCardView {
  word: string;
  /** Pinyin with tone marks or kana. */
  reading: string;
  wordRuby: DeckRubySeg[];
  /** Short English meaning, 1 to 3 senses. */
  definition: string;
  sentence: string;
  sentenceRuby: DeckRubySeg[];
  translation: string;
  notes?: string;
  /** What Sayfern checked or fixed, in plain words: "Reading checked in CC-CEDICT". */
  checks: string[];
  /** data: URLs for the preview only (samples). */
  audio?: { word?: string; sentence?: string };
  /** Which voice service made the audio, when there is audio. */
  audioBy?: DeckAudioProvider;
  status: DeckCardStatus;
  noteId?: number;
  error?: string;
}

export interface DeckBatchLog {
  n: number;
  at: number;
  added: number;
  duplicates: number;
  failed: number;
  /** Words dropped before Anki (bad card, already known). */
  skipped: number;
  /** Clips that fell back from ElevenLabs to the free voices. */
  audioFallbacks?: number;
}

export interface DeckProjectView {
  id: string;
  language: Language;
  spec: DeckSpec;
  /** "provider/model-id" */
  model: string;
  modelRef: ModelRef;
  status: DeckStatus;
  createdAt: number;
  updatedAt: number;
  /** Readable planning failure. */
  error?: string;
  /** Last batch problem (the project stays resumable). */
  lastError?: string;
  /** What's happening right now, for the progress line. */
  activity?: string;
  /** Learner notes from the preview step, sent with every batch ("shorter sentences"). */
  guidance?: string;
  samples: DeckCardView[];
  /** The latest cards, newest batch first (at most 50). */
  recent: DeckCardView[];
  batches: DeckBatchLog[];
  /** All numbers computed locally. */
  progress: {
    /** Words chosen for the deck. */
    planned: number;
    added: number;
    duplicates: number;
    failed: number;
    /** Left out: already in your Anki, or not usable. */
    skipped: number;
    remaining: number;
    batchesLeft: number;
  };
  /** Continuous mode: keeps running batches until done or stopped. */
  continuous?: boolean;
}

export interface DeckListItem {
  id: string;
  language: Language;
  deckName: string;
  status: DeckStatus;
  createdAt: number;
  updatedAt: number;
  planned: number;
  added: number;
  remaining: number;
}

// ---------------------------------------------------------------- API

export interface DeckApi {
  /** What the generator can offer right now, with local counts. */
  deckOptions(language: Language): Promise<DeckOptions>;
  /** Batches, minutes and audio characters for a spec. Local, instant. */
  estimateDeck(spec: DeckSpec): Promise<DeckEstimate>;
  /**
   * Starts a project: picks the words and writes DECK_SAMPLE_SIZE sample cards in the background.
   * Returns at once with status "planning"; poll getDeckProject until "preview" or "failed".
   */
  startDeckProject(spec: DeckSpec, model: ModelRef): Promise<DeckProjectView>;
  /** New sample cards, optionally following the learner's notes (kept for every batch). */
  redoDeckSamples(projectId: string, guidance: string, model?: ModelRef): Promise<DeckProjectView>;
  /** Approves the samples: status "ready". Samples are added with the first batch. */
  approveDeckSamples(projectId: string): Promise<DeckProjectView>;
  /**
   * Runs the next batch in the background (status "generating"). `continuous` keeps going batch
   * after batch until the deck is done, a batch fails or stopDeckBatches is called.
   */
  runDeckBatch(projectId: string, model?: ModelRef, opts?: { continuous?: boolean }): Promise<DeckProjectView>;
  /** Stops after the current batch's model request is aborted. Cards already in Anki stay. */
  stopDeckBatches(projectId: string): Promise<DeckProjectView>;
  getDeckProject(projectId: string): Promise<DeckProjectView | null>;
  /** Newest first. */
  listDeckProjects(language?: Language): Promise<DeckListItem[]>;
  /** Deletes the project record. Notes already in Anki are not touched. */
  deleteDeckProject(projectId: string): Promise<void>;

  // ElevenLabs (optional audio). The key is stored with the model sign-ins (encrypted).
  elevenLabsStatus(): Promise<ElevenLabsStatus>;
  /** Checks the key with ElevenLabs, stores it and picks a default voice. Throws a readable error. */
  connectElevenLabs(apiKey: string): Promise<ElevenLabsStatus>;
  setElevenLabsVoice(voiceId: string): Promise<ElevenLabsStatus>;
  disconnectElevenLabs(): Promise<ElevenLabsStatus>;
}

export const DECK_METHODS: Record<Exclude<keyof DeckApi, `on${string}`>, true> = {
  deckOptions: true,
  estimateDeck: true,
  startDeckProject: true,
  redoDeckSamples: true,
  approveDeckSamples: true,
  runDeckBatch: true,
  stopDeckBatches: true,
  getDeckProject: true,
  listDeckProjects: true,
  deleteDeckProject: true,
  elevenLabsStatus: true,
  connectElevenLabs: true,
  setElevenLabsVoice: true,
  disconnectElevenLabs: true,
};

/** AnkiWeb shared-deck search for a language. */
export function sharedDecksUrl(language: Language): string {
  const q = LANGUAGE_META[language]?.ankiSearch ?? String(language);
  return `${ANKIWEB_SHARED_DECKS}?search=${encodeURIComponent(q)}`;
}


/**
 * "Sayfern::Chinese HSK 3 travel", "Sayfern::Japanese beginner". Anki makes "::" a sub-deck. A short
 * request (30 characters or less) goes in the name; a longer one is left out.
 */
export function suggestDeckName(language: Language, level: string, request: string): string {
  const lv = level === DECK_BEGINNER ? "beginner" : level;
  const r = request
    .replace(/::/g, " ")
    .replace(/["\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const t = r.length <= 30 ? r : "";
  return `Sayfern::${LANGUAGE_META[language]?.name ?? language} ${lv}${t ? ` ${t}` : ""}`;
}
