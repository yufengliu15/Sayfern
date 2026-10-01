// Numbered pinyin ("kao3 ya1", "lu:4", "le5") → tone marks ("kǎoyā", "lǜ", "le").

const MARKS: Record<string, string> = { "1": "\u0304", "2": "\u0301", "3": "\u030c", "4": "\u0300" };
const VOWELS = "aeiouü";

/** One numbered syllable → tone-marked syllable. Text without a trailing tone digit is returned as is (u: → ü). */
export function toneMark(syllable: string): string {
  const m = /^([A-Za-zÜü:]+?)([0-5])$/.exec(syllable);
  if (!m) return syllable.replace(/u:/g, "ü").replace(/U:/g, "Ü");
  let base = m[1].replace(/u:/g, "ü").replace(/U:/g, "Ü").replace(/v/g, "ü").replace(/V/g, "Ü");
  const tone = m[2];
  if (base.toLowerCase() === "r" && tone === "5") return base; // erhua: r5 → r
  const mark = MARKS[tone];
  if (!mark) return base; // neutral tone (5 or 0)
  const lower = base.toLowerCase();
  let idx = lower.indexOf("a");
  if (idx < 0) idx = lower.indexOf("e");
  if (idx < 0 && lower.includes("ou")) idx = lower.indexOf("o");
  if (idx < 0) {
    // last vowel: covers iu → u, ui → i, and single vowels
    for (let i = lower.length - 1; i >= 0; i--) {
      if (VOWELS.includes(lower[i])) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) idx = lower.search(/[mn]/); // syllabic m / n / ng (m2, ng4)
  if (idx < 0) return base;
  base = base.slice(0, idx + 1) + mark + base.slice(idx + 1);
  return base.normalize("NFC");
}

function startsWithVowel(syllable: string): boolean {
  const first = syllable.normalize("NFD")[0]?.toLowerCase();
  return first === "a" || first === "e" || first === "o";
}

/**
 * Join tone-marked syllables of one word without spaces, adding an apostrophe
 * before a syllable that starts with a, e or o (Xī'ān).
 */
export function joinSyllables(syllables: string[]): string {
  let out = "";
  syllables.forEach((s, i) => {
    if (i > 0 && startsWithVowel(s)) out += "'";
    out += s;
  });
  return out;
}

/**
 * A CEDICT pinyin field ("Bei3 jing1", "lu:4 se4", "yi1 ma3 dang1 xian1 , wan4 ma3") → display pinyin.
 * Syllables with tone digits are joined; other items (latin letters, "·") stay space separated.
 */
export function numberedToMarks(pinyin: string): string {
  const parts = pinyin.trim().split(/\s+/).filter(Boolean);
  let out = "";
  let prevSyllable = false;
  for (const p of parts) {
    const isSyllable = /[0-5]$/.test(p) && /[A-Za-z]/.test(p);
    const marked = toneMark(p);
    if (!out) out = marked;
    else if (p === "," || p === "，") out += ",";
    else if (isSyllable && prevSyllable) out += (startsWithVowel(marked) ? "'" : "") + marked;
    else out += " " + marked;
    prevSyllable = isSyllable;
  }
  return out;
}

/** Replace bracketed numbered pinyin inside a gloss: "CL:個|个[ge4]" → "CL:個|个[gè]". */
export function glossPinyin(gloss: string): string {
  return gloss.replace(/\[([A-Za-z:0-5 ,·]+)\]/g, (_, p: string) => `[${numberedToMarks(p)}]`);
}
