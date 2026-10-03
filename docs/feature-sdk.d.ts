// Sayfern feature SDK v1: what `window.sayfern` offers a feature's sandboxed UI.
// Load it in your HTML with <script src="/_sdk/sayfern-sdk.js"></script> (before your module scripts).
// Every call is async and goes to Sayfern through postMessage; arguments and results are plain JSON.
// Calls fail (reject) with a readable Error when an argument is invalid.

type Language = "zh" | "ja";

interface SayfernContext {
  featureId: string;
  version: number;
  /** The learner's current workspace. */
  language: Language;
  /** true inside the Customize preview (results are stored as preview results). */
  preview: boolean;
}

interface SayfernAnkiWord {
  word: string;
  reading?: string;
  meaning?: string;
  status: "new" | "learning" | "known" | "suspended";
  mature: boolean;
  lapses: number;
  /** 0..1, higher = harder for the learner right now. */
  struggle: number;
}

interface SayfernAnkiFilter {
  /** Default "all". "struggling" = hardest first. */
  status?: "new" | "learning" | "known" | "suspended" | "struggling" | "all";
  /** Substring of the word, reading or meaning. Max 50 characters. */
  search?: string;
  deck?: string;
  /** 1..200, default 50. */
  limit?: number;
  offset?: number;
}

interface SayfernGrammarPoint {
  id: string;
  /** "除了…还…", "〜ている" */
  pattern: string;
  /** Short English name. */
  name: string;
  reading?: string;
  /** "HSK 3", "N4" … */
  level?: string;
  explanation: string;
  examples: { text: string; translation: string }[];
  state: "introduced" | "with_help" | "independent";
  /** Correct share of assessed uses, null when none. */
  rate: number | null;
  lastUsedAt?: number;
}

interface SayfernSavedWord {
  word: string;
  reading?: string;
  definition?: string;
  sentence: string;
  savedAt: number;
}

interface SayfernLookup {
  query: string;
  /** The dictionary isn't installed yet (entries is empty). */
  needsDictionary: boolean;
  entries: { headword: string; reading: string; senses: { glosses: string[] }[] }[];
}

interface SayfernToken {
  text: string;
  start: number;
  end: number;
  /** false for punctuation, spaces, latin, numbers. */
  isWord: boolean;
  /** Pinyin with tone marks (zh) or hiragana (ja). */
  reading?: string;
  /** Dictionary form (ja: 食べた → 食べる). */
  lemma?: string;
}

interface SayfernResult {
  /** What was practised: the word, sentence or question id. Max 200 characters. */
  item: string;
  correct?: boolean;
  /** 0..1 */
  score?: number;
  answer?: string;
  expected?: string;
  /** Your own label, e.g. "measure-word". Max 40 characters. */
  kind?: string;
}

interface SayfernStoredResult extends SayfernResult {
  at: number;
  version: number;
  language: Language;
  preview: boolean;
}

interface SayfernSdk {
  readonly version: 1;
  context(): Promise<SayfernContext>;
  anki: {
    /** Words from the learner's Anki snapshot for the current language. Empty when Anki is off or never synced. */
    words(filter?: SayfernAnkiFilter): Promise<{ total: number; items: SayfernAnkiWord[]; syncedAt: number | null }>;
  };
  grammar: {
    /** Grammar patterns the tutor has recorded for this learner. */
    list(): Promise<SayfernGrammarPoint[]>;
  };
  words: {
    /** Words the learner saved from lookups. */
    saved(): Promise<SayfernSavedWord[]>;
  };
  /** Dictionary lookup (CC-CEDICT or JMdict). Max 40 characters. */
  lookup(word: string): Promise<SayfernLookup>;
  /** Segments text into words with readings. Max 5000 characters. */
  annotate(text: string): Promise<SayfernToken[]>;
  /** Per-feature JSON storage, 256 KB in total. get() returns null for a missing key; set(key, null) deletes. */
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<true>;
  };
  /** Practice results, kept per feature (not part of the tutor's grammar record). */
  results: {
    record(result: SayfernResult): Promise<true>;
    /** Newest first, current language only. limit 1..500, default 100. */
    list(limit?: number): Promise<SayfernStoredResult[]>;
  };
}

declare const sayfern: SayfernSdk;

// In test.js (run by run_tests in a sandbox, no DOM, no timers, no Node APIs):
declare function test(name: string, fn: () => void | Promise<void>): void;
declare const assert: {
  (value: unknown, message?: string): void;
  ok(value: unknown, message?: string): void;
  equal(actual: unknown, expected: unknown, message?: string): void;
  notEqual(actual: unknown, expected: unknown, message?: string): void;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  throws(fn: () => unknown, message?: string): void;
  rejects(fn: () => Promise<unknown>, message?: string): Promise<void>;
  fail(message?: string): never;
};
