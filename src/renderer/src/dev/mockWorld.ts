// The mock backend's mutable state, shared with the Stage 2 mock slots (mockReview, mockQuiz,
// mockDecks) so each feature's mock can read and change the same corrections, words, grammar,
// Anki cards and sessions as mockApi.ts. Never loaded inside Electron.
import type { Token } from "../../../shared/lang";
import type {
  AnkiCard,
  AnkiConfig,
  ChatMessage,
  Correction,
  GrammarObservation,
  GrammarPoint,
  Language,
  LibraryDoc,
  PracticeTarget,
  SavedWord,
  SessionMeta,
} from "../../../shared/records";
import type { Settings } from "../../../shared/types";
import { LANGUAGES } from "../../../shared/records";

export interface MockSessionRec {
  meta: SessionMeta;
  messages: ChatMessage[];
  targets: PracticeTarget[];
  grammarIds: string[];
  replyIdx: number;
}

export interface MockWorld {
  /** Mock start time. */
  T0: number;
  /** ?fresh=1 or ?onboarding=1: no records. */
  fresh: boolean;
  /** ?anki=offline */
  ankiOffline: boolean;
  sessions: Map<string, MockSessionRec>;
  corrections: Map<string, Correction>;
  grammar: Map<string, GrammarPoint>;
  observations: GrammarObservation[];
  savedWords: SavedWord[];
  docs: LibraryDoc[];
  ankiCards: Record<Language, AnkiCard[]>;
  ankiConfig(): AnkiConfig;
  settings(): Settings;
  /** Same segmentation the mock uses for hover lookup. */
  segment(language: Language, text: string): Token[];
}

export const MOCK_MIN = 60_000;
export const MOCK_HOUR = 60 * MOCK_MIN;
export const MOCK_DAY = 24 * MOCK_HOUR;
/** The mock only has rich data for zh and ja: fill the other languages with `fill`. */
export function everyLanguage<T>(given: Partial<Record<Language, T>>, fill: (l: Language) => T): Record<Language, T> {
  return Object.fromEntries(LANGUAGES.map((l) => [l, given[l] ?? fill(l)])) as Record<Language, T>;
}
export const mockClone = <T>(v: T): T => structuredClone(v);
export const mockWait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
export const mockId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
