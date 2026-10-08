// Language packs for languages written with spaces: English, Spanish, French, German, Italian,
// Portuguese, Russian (SpacedPack), Korean (KoreanPack: eojeol words, particles and endings
// lemmatized) and Vietnamese (VietnamesePack: syllables joined into dictionary words).
// Segmentation is Intl.Segmenter; lemmas come from lemma.ts, checked against the installed
// dictionary when there is one.
import type { LanguageInfo, Token } from "../../shared/lang";
import { LANGUAGE_META, languageInfo } from "../../shared/languages";
import type { Language } from "../../shared/records";
import type { LanguagePack } from "../contracts";
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
}

const LETTER = /\p{L}/u;

/** Elided articles and pronouns written onto the next word: l'homme, dell'anno, c'est. */
const ELISION: Partial<Record<Language, RegExp>> = {
  fr: /^((?:qu|lorsqu|puisqu|jusqu|quoiqu|[ldjnmtsc])['’])(\p{L}.*)$/iu,
  it: /^((?:dell|dall|nell|sull|all|coll|quell|bell|sant|un|l|d|c|m|t|s|v|n)['’])(\p{L}.*)$/iu,
};

function tokenStart(text: string, offset: number, isWord: boolean): Token {
  return { text, start: offset, end: offset + text.length, isWord };
}

const LEVEL_NOTE: Record<string, string> = {
  cefr: "The learner's level uses the CEFR scale (A1 easiest to C2); choose vocabulary and grammar near their level.",
  topik: "The learner's level uses the TOPIK scale (TOPIK 1 easiest to TOPIK 6); choose vocabulary and grammar near their level.",
};

const EXTRA_NOTE: Partial<Record<Language, string>> = {
  ko: "Write natural Hangul with standard spacing (띄어쓰기). No Hanja and no romanization unless the learner asks.",
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
    "Do not add translations unless the learner asks: the app shows a dictionary when they hover a word.",
  ]
    .filter(Boolean)
    .join(" ");
}

export class SpacedPack implements LanguagePack {
  readonly info: LanguageInfo;
  protected readonly segmenter: Intl.Segmenter;

  constructor(
    readonly language: Language,
    protected readonly dictionary?: WordIndex,
  ) {
    this.info = languageInfo(language);
    this.segmenter = new Intl.Segmenter(LANGUAGE_META[language].bcp47, { granularity: "word" });
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

  learnerWords(text: string): string[] {
    const tag = LANGUAGE_META[this.language].bcp47;
    return this.segment(text)
      .filter((t) => t.isWord)
      .map((t) => {
        const w = t.lemma ?? t.text;
        // German nouns keep their capital letter; other languages compare in lower case.
        return this.language === "de" && t.lemma ? w : w.toLocaleLowerCase(tag);
      });
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
