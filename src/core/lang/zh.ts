// Chinese language pack: segmentation (dictionary FMM or Intl.Segmenter), pinyin readings.
import { pinyin } from "pinyin-pro";
import type { LanguageInfo, Token } from "../../shared/lang";
import type { LanguagePack } from "../contracts";
import { joinSyllables } from "./pinyin";
import { isHanChar, normalizeText, otherTokens, runs } from "./text";

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** What the pack needs from a dictionary for segmentation. */
export interface SegmentationDictionary {
  longestMatch(text: string, index: number): number;
  /** Sync: is the word list in memory? Absent = always usable. */
  hasIndex?(): boolean;
  /** Load a persisted word list if one is installed. */
  load?(): Promise<unknown>;
}

export const ZH_INFO: LanguageInfo = {
  id: "zh",
  name: "Chinese",
  nativeName: "中文",
  glyph: "中",
  fontClass: "zh",
  levels: ["HSK 1", "HSK 2", "HSK 3", "HSK 4", "HSK 5", "HSK 6", "HSK 7-9"],
  readingName: "Pinyin",
};

export class ChinesePack implements LanguagePack {
  readonly info = ZH_INFO;
  private readonly dictionary?: SegmentationDictionary;
  private readonly segmenter = new Intl.Segmenter("zh", { granularity: "word" });

  constructor(opts: { dictionary?: SegmentationDictionary } = {}) {
    this.dictionary = opts.dictionary;
  }

  async ready(): Promise<void> {
    await this.dictionary?.load?.();
  }

  private useDictionary(): boolean {
    const d = this.dictionary;
    return !!d && (d.hasIndex ? d.hasIndex() : true);
  }

  /** Split a run of Han characters into words. Returns lengths in UTF-16 units. */
  private splitHan(run: string): string[] {
    if (this.useDictionary()) {
      const out: string[] = [];
      let i = 0;
      while (i < run.length) {
        let len = this.dictionary!.longestMatch(run, i);
        const cp = run.codePointAt(i)! > 0xffff ? 2 : 1;
        if (len < cp) len = cp;
        out.push(run.slice(i, i + len));
        i += len;
      }
      return out;
    }
    return [...this.segmenter.segment(run)].map((s) => s.segment);
  }

  /** Per-character pinyin for a Han run (context-aware), as [start, end, syllable]. */
  private runPinyin(run: string): { start: number; end: number; py: string }[] {
    const out: { start: number; end: number; py: string }[] = [];
    let pos = 0;
    for (const item of pinyin(run, { type: "all", toneType: "symbol" })) {
      const len = item.origin.length;
      if (item.isZh && item.pinyin) out.push({ start: pos, end: pos + len, py: item.pinyin });
      pos += len;
    }
    return out;
  }

  segment(text: string): Token[] {
    const tokens: Token[] = [];
    for (const r of runs(text, isHanChar)) {
      if (!r.match) {
        tokens.push(...otherTokens(r.text, r.start));
        continue;
      }
      const py = this.runPinyin(r.text);
      let pos = 0;
      let k = 0;
      for (const word of this.splitHan(r.text)) {
        const end = pos + word.length;
        const syllables: string[] = [];
        while (k < py.length && py[k].start < pos) k++;
        while (k < py.length && py[k].end <= end) syllables.push(py[k++].py);
        const token: Token = { text: word, start: r.start + pos, end: r.start + end, isWord: true };
        if (syllables.length) token.reading = joinSyllables(syllables);
        tokens.push(token);
        pos = end;
      }
    }
    return tokens;
  }

  /** Han words only. A clause with kana is Japanese (a Japanese speaker's own language), so none of it counts. */
  learnerWords(text: string): string[] {
    return text
      .split(/[。！？!?，,；;：:\n]/u)
      .filter((clause) => !KANA.test(clause))
      .flatMap((clause) => this.segment(clause))
      .filter((t) => t.isWord)
      .map((t) => t.text);
  }

  normalize(text: string): string {
    return normalizeText(text);
  }

  promptNotes(): string {
    return (
      "Chinese: write in simplified characters (简体字) with full-width Chinese punctuation. " +
      "The learner's level uses the HSK scale (HSK 1 to HSK 6, then HSK 7-9)."
    );
  }
}
