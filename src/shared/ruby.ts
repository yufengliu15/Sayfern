// Splits a token + reading into ruby segments: kana okurigana stays unannotated (ja), and pinyin
// is spread over characters when it splits cleanly into one syllable per character (zh). Shared by
// the renderer (hover text) and core (Anki deck cards).
import type { Language } from "./records";

export interface RubySeg {
  text: string;
  rt?: string;
}

const isKana = (ch: string) => /[぀-ヿー]/.test(ch);
const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

function jaSegs(text: string, reading: string): RubySeg[] {
  const t = [...text];
  const r = [...toHira(reading)];
  // Strip matching kana at both ends so furigana sits only over the kanji.
  let head = 0;
  while (head < t.length - 1 && head < r.length && isKana(t[head]) && toHira(t[head]) === r[head]) head++;
  let tail = 0;
  while (
    tail < t.length - head - 1 &&
    tail < r.length - head - 1 &&
    isKana(t[t.length - 1 - tail]) &&
    toHira(t[t.length - 1 - tail]) === r[r.length - 1 - tail]
  )
    tail++;
  const mid = t.slice(head, t.length - tail).join("");
  const midReading = r.slice(head, r.length - tail).join("");
  if (!mid || !midReading || toHira(mid) === midReading) return [{ text }];
  const out: RubySeg[] = [];
  if (head) out.push({ text: t.slice(0, head).join("") });
  out.push({ text: mid, rt: midReading });
  if (tail) out.push({ text: t.slice(t.length - tail).join("") });
  return out;
}

const SYL =
  /^(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(?:[aeiouüvāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+)(?:ng|n(?![aeiouüvāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ])|r(?![aeiouüvāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]))?/i;

/** Split "fēngjǐng" / "pá shān" into exactly n syllables, or null. */
function splitPinyin(reading: string, n: number): string[] | null {
  const parts = reading.split(/[\s']+/).filter(Boolean);
  if (parts.length === n) return parts;
  const out: string[] = [];
  let strict = true;
  const walk = (rest: string): boolean => {
    if (!rest) return out.length === n;
    if (out.length >= n) return false;
    const m = rest.match(SYL);
    if (!m) return false;
    // Try the longest match first, then back off (xian vs xi'an).
    for (let len = m[0].length; len >= 1; len--) {
      const piece = rest.slice(0, len);
      if (!SYL.test(piece) || piece.match(SYL)![0].length !== len) continue;
      // Pinyin writes an apostrophe before a vowel-initial syllable, so prefer consonant starts.
      if (out.length > 0 && /^[iuüvīíǐìūúǔùǖǘǚǜ]/i.test(piece)) continue; // never starts a syllable
      if (strict && out.length > 0 && /^[aeoāáǎàēéěèōóǒò]/i.test(piece)) continue;
      out.push(piece);
      if (walk(rest.slice(len))) return true;
      out.pop();
    }
    return false;
  };
  const joined = parts.join("");
  if (walk(joined)) return out;
  strict = false;
  out.length = 0;
  return walk(joined) ? out : null;
}

export function rubySegments(language: Language, text: string, reading: string | undefined): RubySeg[] {
  if (!reading) return [{ text }];
  if (language === "ja") return jaSegs(text, reading);
  const chars = [...text];
  const syl = chars.length > 1 ? splitPinyin(reading, chars.length) : [reading];
  if (!syl) return [{ text, rt: reading }];
  return chars.map((c, i) => ({ text: c, rt: syl[i] }));
}
