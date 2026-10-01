// Small text helpers shared by the language packs.
import type { Token } from "../../shared/lang";

const HAN = /\p{Script=Han}/u;
const KANA_ONLY = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・]+$/u;
const JAPANESE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u;

export function isHanChar(ch: string): boolean {
  return HAN.test(ch);
}

export function hasHan(text: string): boolean {
  return HAN.test(text);
}

export function isKanaOnly(text: string): boolean {
  return KANA_ONLY.test(text);
}

export function hasJapaneseScript(text: string): boolean {
  return JAPANESE_SCRIPT.test(text);
}

/** Katakana → hiragana (ー and other characters unchanged). */
export function toHiragana(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    out += c >= 0x30a1 && c <= 0x30f6 ? String.fromCodePoint(c - 0x60) : ch;
  }
  return out;
}

// Whitespace, Unicode punctuation (covers ASCII and CJK punctuation such as 。、「」！？),
// ASCII symbols and a few CJK symbols that are not letters (〒 〓 〠 〾 〿).
const STRIP = /[\s\p{P}$+<=>^`|~\u3012\u3013\u3020\u303e\u303f]/gu;

/** Width-fold (NFKC) and strip whitespace and punctuation, for comparing a retry with a correction. */
export function normalizeText(text: string): string {
  return text.normalize("NFKC").replace(STRIP, "");
}

/**
 * Split a run of non-CJK text (latin, digits, punctuation, spaces, emoji) into
 * non-word tokens: one per latin word, space run, punctuation mark or grapheme.
 */
const otherSegmenter = new Intl.Segmenter("en", { granularity: "word" });
export function otherTokens(text: string, offset: number): Token[] {
  const out: Token[] = [];
  for (const s of otherSegmenter.segment(text)) {
    out.push({ text: s.segment, start: offset + s.index, end: offset + s.index + s.segment.length, isWord: false });
  }
  return out;
}

/** Split text into maximal runs where `pred(char)` is constant (code-point aware). */
export function runs(text: string, pred: (ch: string) => boolean): { text: string; start: number; match: boolean }[] {
  const out: { text: string; start: number; match: boolean }[] = [];
  let i = 0;
  for (const ch of text) {
    const m = pred(ch);
    const last = out[out.length - 1];
    if (last && last.match === m) last.text += ch;
    else out.push({ text: ch, start: i, match: m });
    i += ch.length;
  }
  return out;
}

/** Tiny LRU keyed by string. */
export class Lru<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}
