// Japanese language pack: kuromoji (IPADIC) tokenization, hiragana readings, lemmas.
import { createRequire } from "node:module";
import path from "node:path";
import kuromoji, { type IpadicFeatures, type Tokenizer } from "kuromoji";
import type { LanguageInfo, Token } from "../../shared/lang";
import type { LanguagePack } from "../contracts";
import { hasHan, hasJapaneseScript, normalizeText, toHiragana } from "./text";

export const JA_INFO: LanguageInfo = {
  id: "ja",
  name: "Japanese",
  nativeName: "日本語",
  glyph: "日",
  fontClass: "ja",
  levels: ["N5", "N4", "N3", "N2", "N1"],
  readingName: "Reading",
};

export function defaultKuromojiDicPath(): string {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve("kuromoji/package.json")), "dict") + path.sep;
}

interface Piece {
  text: string;
  start: number;
  end: number;
  f?: IpadicFeatures;
}

// Auxiliary verbs that are part of a verb/adjective's conjugation (merged into it for hover).
const CONJUGATION_AUX = new Set(["ます", "た", "だ", "ない", "ぬ", "ん", "たい", "れる", "られる", "せる", "させる", "う", "よう", "まい", "です", "たがる"]);

function isHead(f?: IpadicFeatures): boolean {
  return !!f && (f.pos === "動詞" || f.pos === "形容詞") && f.pos_detail_1 === "自立";
}

function isAttachable(f?: IpadicFeatures): boolean {
  if (!f) return false;
  if (f.pos === "助動詞") return CONJUGATION_AUX.has(f.basic_form);
  if (f.pos === "助詞") return f.pos_detail_1 === "接続助詞" && (f.surface_form === "て" || f.surface_form === "で");
  if (f.pos === "動詞") return f.pos_detail_1 === "非自立" || f.pos_detail_1 === "接尾";
  if (f.pos === "形容詞") return f.pos_detail_1 === "非自立";
  return false;
}

function hiraganaReading(f?: IpadicFeatures, surface = ""): string {
  const r = f?.reading;
  return toHiragana(r && r !== "*" ? r : surface);
}

function isWordFeature(f: IpadicFeatures | undefined, text: string): boolean {
  if (!f || f.pos === "記号") return false;
  if (f.pos === "名詞" && f.pos_detail_1 === "数") return false;
  return hasJapaneseScript(text);
}

const CONTENT_NOUN_EXCLUDE = new Set(["数", "非自立", "接尾", "特殊"]);

function isContent(f: IpadicFeatures): boolean {
  if (!hasJapaneseScript(f.surface_form)) return false;
  switch (f.pos) {
    case "名詞":
      return !CONTENT_NOUN_EXCLUDE.has(f.pos_detail_1);
    case "動詞":
    case "形容詞":
      return f.pos_detail_1 === "自立";
    case "副詞":
    case "感動詞":
      return true;
    default:
      return false;
  }
}

export class JapanesePack implements LanguagePack {
  readonly info = JA_INFO;
  private tokenizer?: Tokenizer<IpadicFeatures>;
  private loading?: Promise<void>;
  private readonly dicPath?: string;

  constructor(opts: { dicPath?: string } = {}) {
    this.dicPath = opts.dicPath;
  }

  ready(): Promise<void> {
    this.loading ??= new Promise<void>((resolve, reject) => {
      kuromoji.builder({ dicPath: this.dicPath ?? defaultKuromojiDicPath() }).build((err, tokenizer) => {
        if (err) {
          this.loading = undefined; // allow a retry
          reject(err);
          return;
        }
        this.tokenizer = tokenizer;
        resolve();
      });
    });
    return this.loading;
  }

  private tokenize(text: string): IpadicFeatures[] {
    if (!this.tokenizer) throw new Error("Japanese tokenizer is not loaded: await pack.ready() before segment()");
    return this.tokenizer.tokenize(text);
  }

  /** kuromoji tokens aligned to the input, with gap pieces so the text is covered exactly. */
  private pieces(text: string): Piece[] {
    const out: Piece[] = [];
    let cursor = 0;
    for (const f of this.tokenize(text)) {
      const s = f.surface_form;
      if (!s) continue;
      const at = text.startsWith(s, cursor) ? cursor : text.indexOf(s, cursor);
      if (at < 0) continue;
      if (at > cursor) out.push({ text: text.slice(cursor, at), start: cursor, end: at });
      out.push({ text: s, start: at, end: at + s.length, f });
      cursor = at + s.length;
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor), start: cursor, end: text.length });
    return out;
  }

  segment(text: string): Token[] {
    const pieces = this.pieces(text);
    const tokens: Token[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const head = pieces[i];
      const group = [head];
      if (isHead(head.f)) {
        while (i + 1 < pieces.length && pieces[i + 1].start === group[group.length - 1].end && isAttachable(pieces[i + 1].f)) {
          group.push(pieces[++i]);
        }
      }
      const surface = group.map((p) => p.text).join("");
      const token: Token = { text: surface, start: head.start, end: group[group.length - 1].end, isWord: isWordFeature(head.f, surface) };
      if (token.isWord && head.f) {
        if (hasHan(surface)) {
          const reading = group.map((p) => hiraganaReading(p.f, p.text)).join("");
          if (!hasHan(reading)) token.reading = reading; // unknown kanji: no reading rather than a wrong one
        }
        if (head.f.basic_form && head.f.basic_form !== "*") token.lemma = head.f.basic_form;
      }
      tokens.push(token);
    }
    return tokens;
  }

  learnerWords(text: string): string[] {
    return this.tokenize(text)
      .filter(isContent)
      .map((f) => (f.basic_form && f.basic_form !== "*" ? f.basic_form : f.surface_form));
  }

  normalize(text: string): string {
    return normalizeText(text);
  }

  promptNotes(): string {
    return (
      "Japanese: write natural Japanese with kanji, hiragana and katakana as a native writer would, using polite form (です/ます) unless the learner prefers casual speech. " +
      "The learner's level uses the JLPT scale (N5 easiest to N1); choose vocabulary, kanji and grammar near their level. " +
      "Do not add furigana, readings in brackets or romaji unless the learner asks: the app shows readings and a dictionary when they hover a word."
    );
  }
}
