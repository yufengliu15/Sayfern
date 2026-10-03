// Text helpers shared by the library parsers and search.

/** Parser output before it is stored. */
export interface ParsedParagraph {
  text: string;
  heading?: string;
}

export interface ParsedDoc {
  title?: string;
  paragraphs: ParsedParagraph[];
  warnings: string[];
}

/** Han, kana, CJK punctuation, full-width forms, CJK extensions. */
const CJK_CHAR = /[⺀-⿿　-〿぀-ヿ㄀-ㇿ㐀-䶿一-鿿豈-﫿︰-﹏＀-￯\u{20000}-\u{3FFFF}]/u;

export function isCjk(ch: string | undefined): boolean {
  return !!ch && CJK_CHAR.test(ch);
}

/** Sentence-ending punctuation used to decide paragraph ends in PDFs. */
export const SENTENCE_END = /[。！？!?．｡…」』）)"”’.]$/;

/**
 * Joins two lines of the same paragraph: no space when either side is CJK,
 * de-hyphenates latin words split across lines, otherwise one space.
 */
export function joinLines(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  const last = lastChar(a);
  const first = b[0];
  if (isCjk(last) || isCjk(first)) return a + b;
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

function lastChar(s: string): string | undefined {
  const cps = Array.from(s);
  return cps[cps.length - 1];
}

/**
 * Normalizes one paragraph: CRLF, trims lines and joins them (CJK without
 * spaces), collapses runs of ASCII whitespace. Full-width spaces inside CJK
 * text are left alone.
 */
export function cleanParagraph(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v ]+/g, " ").trim())
    .filter((l) => l.length > 0);
  let out = "";
  for (const l of lines) out = joinLines(out, l);
  return out.trim();
}

/**
 * Collapses insignificant (HTML-style) whitespace: runs that contain a line
 * break between two CJK characters disappear, other runs become one space.
 */
export function collapseWhitespace(text: string): string {
  return text.replace(/[ \t\n\r\f\v ]+/g, (run, offset: number, whole: string) => {
    const before = whole[offset - 1];
    const after = whole[offset + run.length];
    if (/[\n\r]/.test(run) && isCjk(before) && isCjk(after)) return "";
    return " ";
  });
}

/** Counts user-visible characters (code points). */
export function charLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/**
 * Decodes file bytes: UTF-8 (with or without BOM), UTF-16 with BOM, and
 * falls back to the legacy encodings common for the language (GB18030 / Shift_JIS / EUC-KR /
 * Windows-1251 / Windows-1258 / Windows-1252).
 */
const LEGACY_ENCODINGS: Record<string, string[]> = {
  zh: ["gb18030", "big5", "shift_jis"],
  ja: ["shift_jis", "euc-jp", "gb18030"],
  ko: ["euc-kr"],
  ru: ["windows-1251", "koi8-r"],
  vi: ["windows-1258"],
  en: ["windows-1252"],
  es: ["windows-1252"],
  fr: ["windows-1252"],
  de: ["windows-1252"],
  it: ["windows-1252"],
  pt: ["windows-1252"],
};

export function decodeText(bytes: Uint8Array, language?: string): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    const fallbacks = LEGACY_ENCODINGS[language ?? ""] ?? ["gb18030", "big5", "shift_jis"];
    for (const enc of fallbacks) {
      try {
        return new TextDecoder(enc, { fatal: true }).decode(bytes);
      } catch {
        // try the next one
      }
    }
    return new TextDecoder("utf-8").decode(bytes);
  }
}
