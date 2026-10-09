// Language packs for languages written with spaces: English, Spanish, French, German, Italian,
// Portuguese, Russian (SpacedPack), Korean (KoreanPack: eojeol words, particles and endings
// lemmatized) and Vietnamese (VietnamesePack: syllables joined into dictionary words).
// Segmentation is Intl.Segmenter; lemmas come from lemma.ts, checked against the installed
// dictionary when there is one.
import type { LanguageInfo, Token } from "../../shared/lang";
import { LANGUAGE_META, languageInfo, type Script } from "../../shared/languages";
import type { Language } from "../../shared/records";
import type { LanguagePack } from "../contracts";
import { COMMON_WORDS, wordForms } from "./common-words";
import { lemmatize } from "./lemma";
import { normalizeText } from "./text";

/** What the packs need from a dictionary. All optional: packs work without one. */
export interface WordIndex {
  /** Sync: is the word list in memory? */
  hasIndex(): boolean;
  /** Load a persisted word list if one is installed. */
  load(): Promise<unknown>;
  /** Exact headword check (case as given). */
  has(word: string): boolean;
  /** Sync, after load: a word (lower case) of the learner's own language: used in the dictionary's glosses,
   *  or one of the interface language's common words. */
  ownWord?(word: string): boolean;
  /** Sync, after load: the words (lower case) of the headword's glosses. */
  glossWordsOf?(word: string): string[];
  /** Sync, after load: base code of the learner's own language ("en", "pt"), for plural and past forms. */
  ownLanguage?(): string | undefined;
}

const LETTER = /\p{L}/u;

/** A learner word must be written in the target language's script: English in a Korean session never counts. */
const SCRIPT_LETTER: Partial<Record<Script, RegExp>> = {
  latin: /\p{Script=Latin}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  hangul: /\p{Script=Hangul}/u,
};

const CLAUSE_BREAK = /[,;:()\[\]"“”«»„—–]/u;

/** Which language a word of a learner message is in. "unclear" words follow the rest of their sentence. */
export type WordSide = "target" | "own" | "unclear";

/**
 * The words of one sentence that count as the target language. A word of the learner's own language
 * never counts; an unclear word counts when the sentence has no own-language words, or fewer than target words.
 */
export function keepTarget<T>(words: readonly T[], sides: readonly WordSide[]): T[] {
  const own = sides.filter((s) => s === "own").length;
  const target = sides.filter((s) => s === "target").length;
  const unclearCounts = own === 0 || own < target;
  return words.filter((_, i) => sides[i] === "target" || (sides[i] === "unclear" && unclearCounts));
}

/** Elided articles and pronouns written onto the next word: l'homme, dell'anno, c'est. */
const ELISION: Partial<Record<Language, RegExp>> = {
  fr: /^((?:qu|lorsqu|puisqu|jusqu|quoiqu|[ldjnmtsc])['’])(\p{L}.*)$/iu,
  it: /^((?:dell|dall|nell|sull|all|coll|quell|bell|sant|un|l|d|c|m|t|s|v|n)['’])(\p{L}.*)$/iu,
};

function tokenStart(text: string, offset: number, isWord: boolean): Token {
  return { text, start: offset, end: offset + text.length, isWord };
}

const LEVEL_NOTE: Record<string, string> = {
  cefr: "The learner's level uses the CEFR scale (A1 easiest to C2).",
  topik: "The learner's level uses the TOPIK scale (TOPIK 1 easiest to TOPIK 6).",
};

const EXTRA_NOTE: Partial<Record<Language, string>> = {
  ko: "Write natural Hangul with standard spacing (띄어쓰기). No Hanja unless the learner asks.",
  ru: "Write in Cyrillic without stress marks unless the learner asks about stress.",
  vi: "Write every tone mark correctly. Use pronouns that fit a friendly tutor and an adult learner (mình / bạn) unless the learner prefers otherwise.",
  de: "Capitalize nouns, use correct case endings, and use du with the learner unless they prefer Sie.",
  fr: "Use tu with the learner unless they prefer vous.",
  es: "Use tú with the learner unless they prefer usted.",
  it: "Use tu with the learner unless they prefer Lei.",
  pt: "Use tu with the learner unless they prefer você or o senhor / a senhora.",
  en: "Use plain, natural conversational English.",
};

export function spacedPromptNotes(language: Language): string {
  const m = LANGUAGE_META[language];
  return [
    `${m.name}: write natural ${m.variety}.`,
    LEVEL_NOTE[m.levelSystem] ?? "",
    EXTRA_NOTE[language] ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export class SpacedPack implements LanguagePack {
  readonly info: LanguageInfo;
  protected readonly segmenter: Intl.Segmenter;
  private readonly sentences: Intl.Segmenter;

  constructor(
    readonly language: Language,
    protected readonly dictionary?: WordIndex,
  ) {
    this.info = languageInfo(language);
    this.segmenter = new Intl.Segmenter(LANGUAGE_META[language].bcp47, { granularity: "word" });
    this.sentences = new Intl.Segmenter(LANGUAGE_META[language].bcp47, { granularity: "sentence" });
  }

  async ready(): Promise<void> {
    await this.dictionary?.load().catch(() => undefined);
  }

  /** Dictionary check, only when the index is in memory (segment is sync). */
  protected has = (w: string): boolean => !!this.dictionary?.hasIndex() && this.dictionary.has(w);

  protected lemmaOf(surface: string): string | undefined {
    const useDict = !!this.dictionary?.hasIndex();
    return lemmatize(this.language, surface, useDict ? this.has : undefined);
  }

  protected wordToken(text: string, offset: number): Token[] {
    const elision = ELISION[this.language]?.exec(text);
    if (elision) {
      const [, head, rest] = elision;
      return [this.makeWord(head, offset), this.makeWord(rest, offset + head.length)];
    }
    return [this.makeWord(text, offset)];
  }

  protected makeWord(text: string, offset: number): Token {
    const isWord = LETTER.test(text);
    const t = tokenStart(text, offset, isWord);
    if (isWord) {
      const lemma = this.lemmaOf(text.replace(/[’]/g, "'").replace(/'$/, ""));
      if (lemma && lemma !== text) t.lemma = lemma;
    }
    return t;
  }

  segment(text: string): Token[] {
    const out: Token[] = [];
    for (const s of this.segmenter.segment(text)) {
      if (s.isWordLike) out.push(...this.wordToken(s.segment, s.index));
      else out.push(tokenStart(s.segment, s.index, false));
    }
    return out;
  }

  /** Only words in the target language: right script, and (Latin script) not a word of the learner's own language. */
  learnerWords(text: string): string[] {
    const meta = LANGUAGE_META[this.language];
    const script = SCRIPT_LETTER[meta.script];
    const out: string[] = [];
    // Learners switch language at clause breaks ("I like the beach, pero hace calor"): judge each clause alone.
    const clauses = [...this.sentences.segment(text)].flatMap((s) => s.segment.split(CLAUSE_BREAK));
    for (const clause of clauses) {
      const words = this.segment(clause).filter((t) => t.isWord && (!script || script.test(t.text)));
      const kept = meta.script === "latin" ? keepTarget(words, words.map((t) => this.side(t))) : words;
      for (const t of kept) {
        const w = t.lemma ?? t.text;
        // German nouns keep their capital letter; other languages compare in lower case.
        out.push(this.language === "de" && t.lemma ? w : w.toLocaleLowerCase(meta.bcp47));
      }
    }
    return out;
  }

  /**
   * Target: a headword of the target language that the learner's own language lacks, or has with the same
   * meaning (the dictionary's glosses contain the word itself: hotel, chocolate). Own: a word of the learner's
   * own language only. Unclear: in neither, a single letter (I, a), or in both with another meaning (a = to).
   */
  protected side(t: Token): WordSide {
    const word = t.text.replace(/[’]/g, "'").toLocaleLowerCase(LANGUAGE_META[this.language].bcp47);
    const d = this.dictionary;
    const common = COMMON_WORDS[this.language];
    // The common words also cover forms some dictionaries leave out (del, al).
    const inTarget = !!common?.has(word) || (!!d?.hasIndex() && (this.has(t.text) || this.has(word) || (!!t.lemma && this.has(t.lemma))));
    const inOwn = !!d?.ownWord && wordForms(word, this.ownBase()).some((f) => d.ownWord!(f));
    if (inTarget && !inOwn) return "target";
    if (inOwn && !inTarget) return "own";
    if (inTarget && [...word].length > 1 && d?.glossWordsOf?.(t.text).includes(word)) return "target";
    return "unclear";
  }

  /** Base code of the learner's own language for `wordForms`; English unless the index says otherwise. */
  protected ownBase(): string {
    return this.dictionary?.ownLanguage?.() ?? "en";
  }

  normalize(text: string): string {
    return normalizeText(text).toLocaleLowerCase(LANGUAGE_META[this.language].bcp47);
  }

  promptNotes(): string {
    return spacedPromptNotes(this.language);
  }
}

/** Korean: words are eojeol (a stem plus particles or endings); the lemma strips them. */
export class KoreanPack extends SpacedPack {
  constructor(dictionary?: WordIndex) {
    super("ko", dictionary);
  }

  protected override makeWord(text: string, offset: number): Token {
    const isWord = /\p{Script=Hangul}|\p{L}/u.test(text);
    const t = tokenStart(text, offset, isWord);
    if (isWord && /\p{Script=Hangul}/u.test(text)) {
      const lemma = this.lemmaOf(text);
      if (lemma && lemma !== text) t.lemma = lemma;
    }
    return t;
  }

  override normalize(text: string): string {
    return normalizeText(text);
  }
}

/** Longest dictionary word, in syllables. */
const VI_MAX_SYLLABLES = 4;

/** Vietnamese: each syllable is written apart; dictionary words of 2+ syllables are joined (học sinh). */
export class VietnamesePack extends SpacedPack {
  constructor(dictionary?: WordIndex) {
    super("vi", dictionary);
  }

  protected override lemmaOf(): string | undefined {
    return undefined;
  }

  override segment(text: string): Token[] {
    const raw = super.segment(text);
    if (!this.dictionary?.hasIndex()) return raw;
    const out: Token[] = [];
    for (let i = 0; i < raw.length; ) {
      const t = raw[i];
      if (!t.isWord) {
        out.push(t);
        i++;
        continue;
      }
      // Try the longest run of syllables separated by single spaces that the dictionary knows.
      let best = 1;
      let end = i;
      for (let n = 2, j = i; n <= VI_MAX_SYLLABLES; n++) {
        const space = raw[j + 1];
        const next = raw[j + 2];
        if (!space || !next || space.text !== " " || !next.isWord) break;
        j += 2;
        const phrase = text.slice(t.start, next.end);
        if (this.has(phrase) || this.has(phrase.toLocaleLowerCase("vi"))) {
          best = n;
          end = j;
        }
      }
      if (best === 1) {
        out.push(t);
        i++;
      } else {
        const last = raw[end];
        out.push({ text: text.slice(t.start, last.end), start: t.start, end: last.end, isWord: true });
        i = end + 1;
      }
    }
    return out;
  }
}
