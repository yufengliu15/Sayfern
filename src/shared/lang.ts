// Language-service types shared with the renderer (hover lookup, ruby, dictionaries).
import type { AnkiCard, Language } from "./records";

export interface Token {
  /** Surface text exactly as it appears in the input. Concatenating all tokens reproduces the input. */
  text: string;
  start: number;
  end: number;
  /** false for punctuation, whitespace, latin, numbers. Only word tokens are hoverable. */
  isWord: boolean;
  /** Pinyin with tone marks (zh) or hiragana (ja). Absent when unknown or for kana-only words. */
  reading?: string;
  /** Dictionary form to look up (ja: 食べた → 食べる). Defaults to `text`. */
  lemma?: string;
}

export interface DictSense {
  glosses: string[];
  /** Part-of-speech or usage tags, short: "n", "v5r", "adj-i", "classifier". */
  tags?: string[];
}

export interface DictEntry {
  headword: string;
  /** Alternate written forms (traditional characters, other kanji spellings). */
  variants?: string[];
  reading: string;
  senses: DictSense[];
  /** Dictionary name: "CC-CEDICT", "JMdict", "WikDict", "Kengdic", "Wiktionary". */
  source: string;
  /** Common/frequent word marker where the dictionary provides it. */
  common?: boolean;
}

export interface LookupResult {
  query: string;
  entries: DictEntry[];
  /** Matching Anki card, if the learner has one for this word. */
  anki?: AnkiCard;
  /** First time the learner used this word in writing, if ever. */
  firstUsedAt?: number;
  /** Dictionary not installed yet: UI should offer to install. With entries, they come from a fallback (English glosses). */
  needsDictionary?: boolean;
  /** No dictionary exists for this language (with this interface language) yet. */
  noDictionary?: boolean;
}

export interface DictionaryStatus {
  language: Language;
  name: string;
  license: string;
  installed: boolean;
  entries?: number;
  version?: string;
  /** Approximate download size in MB, shown before installing. */
  downloadMb: number;
  installing?: boolean;
  error?: string;
}

export interface DictionaryProgress {
  language: Language;
  phase: "download" | "parse" | "index" | "done" | "error";
  /** 0..1 when known. */
  fraction?: number;
  message?: string;
}

export interface LanguageInfo {
  id: Language;
  /** "Chinese" */
  name: string;
  /** "中文" */
  nativeName: string;
  /** Single glyph for the language picker: "中", "日". */
  glyph: string;
  /** CSS font class used in the renderer: "zh" | "ja" | "ko" | "lt" (Latin) | "cy" (Cyrillic). */
  fontClass: string;
  /** Ordered level scale, easiest first: HSK 1..HSK 6, N5..N1. */
  levels: string[];
  /** Name of the reading system shown in lookups: "Pinyin", "Reading". Empty when the app shows no reading. */
  readingName: string;
  /** BCP-47 tag: "zh-Hans", "pt-BR". */
  bcp47?: string;
  script?: import("./languages").Script;
  levelSystem?: import("./languages").LevelSystem;
}
