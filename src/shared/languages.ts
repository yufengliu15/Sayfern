// Learning-language registry: one entry per language Sayfern can teach.
// Pure data, shared by core, main and renderer. Language packs (src/core/lang) build their
// LanguageInfo from these entries; the renderer uses them before the backend answers.
import type { LanguageInfo } from "./lang";
import type { Language } from "./records";

/** Writing system, for script checks (deck cards, retry comparison) and fonts. */
export type Script = "han" | "japanese" | "hangul" | "latin" | "cyrillic";

/** Level scale family. CEFR covers the European languages, English and Vietnamese. */
export type LevelSystem = "hsk" | "jlpt" | "topik" | "cefr";

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export const TOPIK_LEVELS = ["TOPIK 1", "TOPIK 2", "TOPIK 3", "TOPIK 4", "TOPIK 5", "TOPIK 6"] as const;
export const HSK_LEVELS = ["HSK 1", "HSK 2", "HSK 3", "HSK 4", "HSK 5", "HSK 6", "HSK 7-9"] as const;
export const JLPT_LEVELS = ["N5", "N4", "N3", "N2", "N1"] as const;

export interface LanguageMeta {
  id: Language;
  /** English name, used in prompts to the model: "Spanish". */
  name: string;
  /** The language's own name: "Español". */
  nativeName: string;
  /** Single glyph for the language picker. */
  glyph: string;
  /** CSS font class in the renderer. */
  fontClass: string;
  /** BCP-47 tag for lang attributes, Intl.Segmenter and voices: "es", "pt-BR". */
  bcp47: string;
  script: Script;
  levelSystem: LevelSystem;
  levels: readonly string[];
  /** Reading shown above/next to words, if the app computes one. */
  readingName?: string;
  /** Search term for AnkiWeb shared decks. */
  ankiSearch: string;
  /** Variety the tutor writes, stated in the prompt: "Mexican Spanish (Latin American usage)". */
  variety: string;
  /** Session titles, written in the language itself. */
  titles: { chat: string; placement: string; practice: string };
}

export const LANGUAGE_META: Record<Language, LanguageMeta> = {
  zh: {
    id: "zh", name: "Chinese", nativeName: "中文", glyph: "中", fontClass: "zh", bcp47: "zh-Hans", script: "han",
    levelSystem: "hsk", levels: HSK_LEVELS, readingName: "Pinyin", ankiSearch: "chinese",
    variety: "Mandarin Chinese in simplified characters",
    titles: { chat: "新对话", placement: "水平测试", practice: "练习" },
  },
  ja: {
    id: "ja", name: "Japanese", nativeName: "日本語", glyph: "日", fontClass: "ja", bcp47: "ja", script: "japanese",
    levelSystem: "jlpt", levels: JLPT_LEVELS, readingName: "Reading", ankiSearch: "japanese",
    variety: "standard Japanese (Tokyo)",
    titles: { chat: "新しい会話", placement: "レベルチェック", practice: "練習" },
  },
  ko: {
    id: "ko", name: "Korean", nativeName: "한국어", glyph: "한", fontClass: "ko", bcp47: "ko", script: "hangul",
    levelSystem: "topik", levels: TOPIK_LEVELS, ankiSearch: "korean",
    variety: "standard Korean (Seoul), polite 해요체 unless the learner asks otherwise",
    titles: { chat: "새 대화", placement: "레벨 테스트", practice: "연습" },
  },
  en: {
    id: "en", name: "English", nativeName: "English", glyph: "En", fontClass: "lt", bcp47: "en", script: "latin",
    levelSystem: "cefr", levels: CEFR_LEVELS, ankiSearch: "english",
    variety: "standard English (North American spelling unless the learner prefers British)",
    titles: { chat: "New conversation", placement: "Level check", practice: "Practice" },
  },
  es: {
    id: "es", name: "Spanish", nativeName: "Español", glyph: "Es", fontClass: "lt", bcp47: "es", script: "latin",
    levelSystem: "cefr", levels: CEFR_LEVELS, ankiSearch: "spanish",
    variety: "neutral Latin American Spanish (ustedes, not vosotros) unless the learner asks for Spain",
    titles: { chat: "Nueva conversación", placement: "Prueba de nivel", practice: "Práctica" },
  },
  fr: {
    id: "fr", name: "French", nativeName: "Français", glyph: "Fr", fontClass: "lt", bcp47: "fr", script: "latin",
    levelSystem: "cefr", levels: CEFR_LEVELS, ankiSearch: "french",
    variety: "standard French (France)",
    titles: { chat: "Nouvelle conversation", placement: "Test de niveau", practice: "Pratique" },
  },
  de: {
    id: "de", name: "German", nativeName: "Deutsch", glyph: "De", fontClass: "lt", bcp47: "de", script: "latin",
    levelSystem: "cefr", levels: CEFR_LEVELS, ankiSearch: "german",
    variety: "standard German (Germany)",
    titles: { chat: "Neues Gespräch", placement: "Einstufungstest", practice: "Übung" },
  },
  it: {
    id: "it", name: "Italian", nativeName: "Italiano", glyph: "It", fontClass: "lt", bcp47: "it", script: "latin",
    levelSystem: "cefr", levels: CEFR_LEVELS, ankiSearch: "italian",
    variety: "standard Italian",
    titles: { chat: "Nuova conversazione", placement: "Test di livello", practice: "Pratica" },
  },
  pt: {
    id: "pt", name: "Portuguese", nativeName: "Português", glyph: "Pt", fontClass: "lt", bcp47: "pt-BR", script: "latin",
    levelSystem: "cefr", levels: CEFR_LEVELS, ankiSearch: "portuguese",
    variety: "Brazilian Portuguese unless the learner asks for European Portuguese",
    titles: { chat: "Nova conversa", placement: "Teste de nível", practice: "Prática" },
  },
  ru: {
    id: "ru", name: "Russian", nativeName: "Русский", glyph: "Ру", fontClass: "cy", bcp47: "ru", script: "cyrillic",
    levelSystem: "cefr", levels: CEFR_LEVELS, ankiSearch: "russian",
    variety: "standard Russian",
    titles: { chat: "Новый разговор", placement: "Тест на уровень", practice: "Практика" },
  },
  vi: {
    id: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", glyph: "Vi", fontClass: "lt", bcp47: "vi", script: "latin",
    levelSystem: "cefr", levels: CEFR_LEVELS, ankiSearch: "vietnamese",
    variety: "Northern (Hà Nội) Vietnamese unless the learner asks for Southern",
    titles: { chat: "Cuộc trò chuyện mới", placement: "Kiểm tra trình độ", practice: "Luyện tập" },
  },
};

/** LanguageInfo for a language straight from the registry (packs may override fields). */
export function languageInfo(id: Language): LanguageInfo {
  const m = LANGUAGE_META[id];
  return {
    id: m.id,
    name: m.name,
    nativeName: m.nativeName,
    glyph: m.glyph,
    fontClass: m.fontClass,
    levels: [...m.levels],
    readingName: m.readingName ?? "",
    bcp47: m.bcp47,
    script: m.script,
    levelSystem: m.levelSystem,
  };
}

/** Is the language written with CJK characters that get ruby readings (zh, ja)? */
export function hasRuby(id: Language): boolean {
  return id === "zh" || id === "ja";
}

/** Does the language separate words with spaces? */
export function spaceSeparated(id: Language): boolean {
  return id !== "zh" && id !== "ja";
}

/** Test for "this text is written in the language's script" (letters only, no punctuation check). */
export const SCRIPT_TEST: Record<Script, RegExp> = {
  han: /\p{Script=Han}/u,
  japanese: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
  hangul: /\p{Script=Hangul}/u,
  latin: /\p{Script=Latin}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
};

/** Script an interface locale is written in (for "does this text avoid the target language?" checks). */
export function localeScript(locale: string): Script {
  if (locale.startsWith("zh")) return "han";
  if (locale === "ja") return "japanese";
  if (locale === "ko") return "hangul";
  if (locale === "ru") return "cyrillic";
  return "latin";
}

/** Can text in script `a` contain characters of script `b`? (Japanese uses Han characters.) */
export function scriptsOverlap(a: Script, b: Script): boolean {
  if (a === b) return true;
  const cjk = (s: Script) => s === "han" || s === "japanese";
  return cjk(a) && cjk(b);
}

/**
 * True when `text` visibly contains the target language's script and the explanation language
 * doesn't share that script, i.e. a prompt meant to be in the explanation language leaks the target.
 * When the scripts overlap (Spanish target, English interface) there is no reliable check: false.
 */
export function leaksTargetScript(text: string, target: Language, explainLocale: string): boolean {
  const t = LANGUAGE_META[target].script;
  if (scriptsOverlap(t, localeScript(explainLocale))) return false;
  return SCRIPT_TEST[t].test(text);
}
