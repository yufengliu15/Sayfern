// Cleaning Anki field values into plain words.

const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ensp: " ", emsp: " ", thinsp: " ",
  zwj: "", zwnj: "", shy: "", hellip: "…", mdash: "—", ndash: "–", middot: "·",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "";
    }
    return NAMED[body.toLowerCase()] ?? m;
  });
}

/** Removes HTML, sound tags, entities and whitespace noise; keeps furigana brackets. */
function stripMarkup(value: string): string {
  let s = value;
  s = s.replace(/\[sound:[^\]]*\]/gi, " ");
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<(rt|rp)[^>]*>[\s\S]*?<\/\1\s*>/gi, ""); // HTML ruby annotations
  s = s.replace(/<br\s*\/?>|<\/(div|p|li)\s*>/gi, " ");
  s = s.replace(/<[^>]*>/g, "");
  s = decodeEntities(s);
  return s.replace(/[\s ]+/g, " ").trim();
}

// Anki furigana syntax: "日本[にほん] 語[ご]". The optional space before a
// bracketed segment only marks where the base text starts.
const FURIGANA = / ?([^\s[\]]+?)\[([^\]]*)\]/g;

/** Field value → plain text: no HTML, no &nbsp;, no furigana brackets. */
export function cleanField(value: string | undefined): string {
  if (!value) return "";
  return stripMarkup(value).replace(FURIGANA, "$1").trim();
}

/** Reading implied by furigana brackets ("日本[にほん]語[ご]" → "にほんご"), if any. */
export function furiganaReading(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const s = stripMarkup(value);
  if (!/\[[^\]]+\]/.test(s)) return undefined;
  // Replace each bracketed segment's base with its reading; the base is the
  // run of kanji right before the bracket (kana before it is kept as is).
  const out = s.replace(/ ?([^\s[\]]*?)([\p{Script=Han}々〆ヶ]+)\[([^\]]*)\]/gu, (_m, lead: string, _base: string, reading: string) => lead + reading);
  // Pinyin keeps its spaces; kana readings drop the segment separators.
  const r = /[A-Za-z\u00C0-\u024F]/.test(out) ? out.replace(/\s+/g, " ").trim() : out.replace(/\s+/g, "");
  return r || undefined;
}
