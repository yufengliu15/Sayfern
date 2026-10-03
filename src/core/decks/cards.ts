// Deck cards (S2-15): the "Sayfern Vocab" note type, turning a model card into a checked card
// with Sayfern's own tools (dictionary readings, pinyin-pro / kuromoji ruby), and the Anki note.
import type { DictEntry, Token } from "../../shared/lang";
import { msg } from "../../shared/i18n";
import { hasRuby, LANGUAGE_META, SCRIPT_TEST, spaceSeparated } from "../../shared/languages";
import type { Language } from "../../shared/records";
import { rubySegments } from "../../shared/ruby";
import type { DeckAudioProvider, DeckCardStatus, DeckCardView, DeckRubySeg } from "../../shared/stage2";
import type { AnkiNoteInput, AnkiNoteType, LanguageService } from "../contracts";

/** A card as stored in the project file (audio = Anki media file names, not data). */
export interface StoredCard extends Omit<DeckCardView, "audio"> {
  audio?: { word?: string; sentence?: string };
  /** Cache keys of the clips (records/deck-audio/<key>.mp3). */
  audioKeys?: { word?: string; sentence?: string };
}

const CSS = `.card { font-family: -apple-system, "Helvetica Neue", sans-serif; font-size: 20px; line-height: 1.5; text-align: center; color: #1c1e1b; background: #fbf9f4; padding: 12px; }
.word, .sentence { font-family: "Noto Serif SC", "Noto Serif JP", "Songti SC", "Hiragino Mincho ProN", serif; }
.word { font-size: 52px; line-height: 1.3; margin: 8px 0; }
.sentence { font-size: 26px; margin-top: 14px; }
.sentence b { color: #2e5b45; font-weight: 600; }
ruby rt { font-family: -apple-system, "Helvetica Neue", sans-serif; font-size: 0.42em; color: #6b6d64; }
.reading { font-size: 18px; color: #6b6d64; }
.definition { font-size: 22px; margin-top: 10px; }
.translation { font-size: 17px; color: #3d403a; margin-top: 6px; }
.notes { font-size: 15px; color: #6b6d64; margin-top: 12px; }
.nightMode .card, .night_mode .card { color: #ede8dc; background: #1c1e1b; }
.nightMode .sentence b, .night_mode .sentence b { color: #a9c8b2; }
.nightMode .translation, .night_mode .translation, .nightMode .reading, .night_mode .reading { color: #c9c3b5; }`;

/**
 * Front: the word and the example sentence, no reading (that is the recall test).
 * Back: ruby over the word, reading, meaning, the sentence with full ruby, translation, audio.
 * Word is the first field, so Anki's duplicate check is on the word.
 */
export const VOCAB_NOTE_TYPE: AnkiNoteType = {
  name: "Sayfern Vocab",
  fields: ["Word", "Reading", "WordRuby", "Definition", "Sentence", "SentenceRuby", "Translation", "Notes", "WordAudio", "SentenceAudio"],
  isCloze: false,
  css: CSS,
  templates: [
    {
      Name: "Recognition",
      Front: `<div class="word">{{Word}}</div><div class="sentence">{{Sentence}}</div>`,
      Back:
        `<div class="word">{{WordRuby}}</div><div class="reading">{{Reading}}</div>{{WordAudio}}<hr id="answer">` +
        `<div class="definition">{{Definition}}</div><div class="sentence">{{SentenceRuby}}</div>{{SentenceAudio}}` +
        `<div class="translation">{{Translation}}</div>{{#Notes}}<div class="notes">{{Notes}}</div>{{/Notes}}`,
    },
  ],
};

export const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function rubyHtml(segs: DeckRubySeg[], opts: { ruby: boolean }): string {
  let out = "";
  let inTarget = false;
  for (const s of segs) {
    if (!!s.target !== inTarget) {
      out += s.target ? "<b>" : "</b>";
      inTarget = !!s.target;
    }
    out += opts.ruby && s.rt ? `<ruby>${escapeHtml(s.text)}<rt>${escapeHtml(s.rt)}</rt></ruby>` : escapeHtml(s.text);
  }
  if (inTarget) out += "</b>";
  return out;
}

export function noteFor(card: StoredCard, deckName: string, tags: string[]): AnkiNoteInput {
  const sound = (f?: string) => (f ? `[sound:${f}]` : "");
  return {
    deckName,
    modelName: VOCAB_NOTE_TYPE.name,
    fields: {
      Word: escapeHtml(card.word),
      Reading: escapeHtml(card.reading),
      WordRuby: rubyHtml(card.wordRuby, { ruby: true }),
      Definition: escapeHtml(card.definition),
      Sentence: rubyHtml(card.sentenceRuby, { ruby: false }),
      SentenceRuby: rubyHtml(card.sentenceRuby, { ruby: true }),
      Translation: escapeHtml(card.translation),
      Notes: card.notes ? escapeHtml(card.notes) : "",
      WordAudio: sound(card.audio?.word),
      SentenceAudio: sound(card.audio?.sentence),
    },
    tags,
  };
}

// ---------------------------------------------------------------- checking a model card

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;
/** Longest item: a word, or a saying or set phrase (CJK characters). */
export const MAX_ITEM_CHARS = 16;
/** Languages written with spaces: longest item in characters and words. */
export const MAX_ITEM_CHARS_SPACED = 48;
export const MAX_ITEM_WORDS = 5;
const TARGET_SCRIPT: Record<Language, RegExp> = Object.fromEntries(
  (Object.keys(LANGUAGE_META) as Language[]).map((l) => [l, l === "zh" ? HAN : l === "ja" ? /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/ : SCRIPT_TEST[LANGUAGE_META[l].script]]),
) as Record<Language, RegExp>;

/** Item-shape problem for a word or set phrase, or null. */
export function itemProblem(language: Language, word: string): string | null {
  if (spaceSeparated(language)) {
    const words = word.split(/\s+/).filter(Boolean);
    if ([...word].length > MAX_ITEM_CHARS_SPACED || words.length > MAX_ITEM_WORDS || /[.!?;:。！？]/.test(word.replace(/\.\.\.$/, ""))) return "not a word or set phrase";
    return null;
  }
  if ([...word].length > MAX_ITEM_CHARS || /[\s。！？!?.;:；：]/.test(word) || /^[，、,]|[，、,]$/.test(word)) return "not a word or set phrase";
  return null;
}

/**
 * Where an inflected word sits in a sentence, for languages written with spaces: the first token
 * whose lemma is the word, else one that shares a stem with it (hablar → hablé, Tisch → Tische).
 */
function findInflected(tokens: Token[], word: string, language: Language): Token | undefined {
  const w = word.toLocaleLowerCase(LANGUAGE_META[language].bcp47);
  const lower = (t: Token) => t.text.toLocaleLowerCase(LANGUAGE_META[language].bcp47);
  const byLemma = tokens.find((t) => t.isWord && (t.lemma ?? "").toLocaleLowerCase() === w);
  if (byLemma) return byLemma;
  const chars = [...w];
  if (chars.length < 4) return undefined;
  const stem = chars.slice(0, Math.max(3, chars.length - 3)).join("");
  return tokens.find((t) => t.isWord && lower(t).startsWith(stem));
}
const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** Comparable form of a reading: pinyin without spaces or apostrophes (ü kept), kana as hiragana. */
export function normReading(language: Language, r: string): string {
  const s = r.normalize("NFC").trim().toLowerCase();
  if (language === "zh")
    return s
      .replace(/[\s'’·-]+/g, "")
      .replace(/v/g, "ü")
      .replace(/u:/g, "ü");
  return toHira(s).replace(/[\s・]+/g, "");
}

export const normWord = (w: string): string => w.normalize("NFKC").trim();

export interface RawCard {
  word: string;
  reading: string;
  definition: string;
  sentence: string;
  translation: string;
  notes: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function rawCard(v: unknown): RawCard | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const word = normWord(str(o.word));
  if (!word) return null;
  return {
    word,
    reading: str(o.reading),
    definition: str(o.definition ?? o.meaning),
    sentence: str(o.sentence ?? o.example),
    translation: str(o.translation ?? o.sentence_translation),
    notes: str(o.notes),
  };
}

export interface CardContext {
  language: Language;
  lang: Pick<LanguageService, "annotate" | "lookup">;
  /** "CC-CEDICT" / "JMdict" when installed, else null. */
  dictionary: string | null;
}

export type CardCheck = { ok: true; card: StoredCard } | { ok: false; problem: string };

function dictMatches(entries: DictEntry[], word: string): DictEntry[] {
  return entries.filter((e) => e.headword === word || e.variants?.includes(word));
}

/** Reading of a whole word from the language pack (pinyin-pro or kuromoji), joined. */
async function packReading(ctx: CardContext, toks: Token[]): Promise<string> {
  const parts: string[] = [];
  for (const t of toks) {
    if (t.reading) parts.push(t.reading);
    else if (ctx.language === "ja" && /^[\u3040-\u30ffー]+$/.test(t.text)) parts.push(t.text);
    else if (TARGET_SCRIPT[ctx.language].test(t.text)) return "";
  }
  // Pinyin of a phrase reads better with a space between words; kana runs together.
  return parts.join(ctx.language === "zh" ? " " : "");
}

/** Splits segments so that [from, to) is marked as target (character offsets in the joined text). */
function markTarget(segs: DeckRubySeg[], from: number, to: number): DeckRubySeg[] {
  const out: DeckRubySeg[] = [];
  let pos = 0;
  for (const s of segs) {
    const a = pos;
    const b = pos + s.text.length;
    pos = b;
    if (b <= from || a >= to) {
      out.push(s);
      continue;
    }
    if ((a >= from && b <= to) || s.rt) {
      out.push({ ...s, target: true });
      continue;
    }
    // Plain text crossing the boundary: split it.
    const cut = [Math.max(a, from), Math.min(b, to)];
    if (cut[0] > a) out.push({ text: s.text.slice(0, cut[0] - a) });
    out.push({ text: s.text.slice(cut[0] - a, cut[1] - a), target: true });
    if (cut[1] < b) out.push({ text: s.text.slice(cut[1] - a) });
  }
  return out;
}

/**
 * Turns a model card into a checked card: the word must be in the target script and appear in the
 * sentence (ja: a conjugated form counts), the reading is checked against the dictionary and the
 * reader, and both rubies are built locally. Returns a readable problem when the card can't be used.
 */
export async function checkCard(raw: RawCard, ctx: CardContext, status: DeckCardStatus = "sample"): Promise<CardCheck> {
  const { language } = ctx;
  const word = raw.word;
  if (!TARGET_SCRIPT[language].test(word)) return { ok: false, problem: "the word isn't written in the target script" };
  // Single words, or sayings and set phrases (a comma inside is fine, sentence punctuation is not).
  const shape = itemProblem(language, word);
  if (shape) return { ok: false, problem: shape };
  if (!raw.sentence || !TARGET_SCRIPT[language].test(raw.sentence)) return { ok: false, problem: "no example sentence" };
  if (!raw.translation) return { ok: false, problem: "no translation of the sentence" };
  if (!hasRuby(language)) return checkPlainCard(raw, ctx, status);

  const checks: string[] = [];

  // Where is the word in the sentence?
  const tokens = await ctx.lang.annotate(language, raw.sentence);
  let from = raw.sentence.indexOf(word);
  let to = from + word.length;
  if (from < 0) {
    const tok = tokens.find((t) => t.isWord && (t.lemma ?? t.text) === word);
    if (!tok) return { ok: false, problem: "the sentence doesn't use the word" };
    from = tok.start;
    to = tok.end;
  }

  // Reading: dictionary first, then the reader; the model's reading only when nothing contradicts it.
  const model = raw.reading;
  const wordTokens = await ctx.lang.annotate(language, word);
  const phrase = wordTokens.filter((t) => t.isWord).length > 1;
  const local = await packReading(ctx, wordTokens);
  let reading = model || local;
  let entries: DictEntry[] = [];
  if (ctx.dictionary) {
    const res = await ctx.lang.lookup(language, word).catch(() => null);
    entries = dictMatches(res?.entries ?? [], word);
  }
  const n = (r: string) => normReading(language, r);
  if (entries.length) {
    const readings = entries.map((e) => e.reading);
    const has = (r: string) => !!r && readings.some((d) => n(d) === n(r));
    if (has(model)) {
      reading = model;
      checks.push(`Reading checked in ${ctx.dictionary}`);
    } else if (has(local)) {
      reading = readings.find((d) => n(d) === n(local)) ?? local;
      checks.push(model ? `Reading fixed with ${ctx.dictionary} (model wrote ${model})` : `Reading from ${ctx.dictionary}`);
    } else {
      reading = (entries.find((e) => e.common) ?? entries[0]).reading;
      checks.push(model ? `Reading fixed with ${ctx.dictionary} (model wrote ${model})` : `Reading from ${ctx.dictionary}`);
    }
  } else if (local && model && n(local) !== n(model)) {
    reading = local;
    checks.push(`Reading from Sayfern's reader (model wrote ${model})${ctx.dictionary ? `; not in ${ctx.dictionary}` : ""}`);
  } else if (!ctx.dictionary) {
    checks.push(msg("Install the dictionary to check readings"));
  } else {
    checks.push(`Not in ${ctx.dictionary}: check this one`);
  }
  if (!reading) return { ok: false, problem: "no reading" };
  if (language === "zh" && !phrase) reading = reading.replace(/\s+/g, "");

  let definition = raw.definition;
  if (!definition && entries.length) {
    definition = entries[0].senses
      .slice(0, 3)
      .map((s) => s.glosses.slice(0, 2).join(", "))
      .join("; ");
    checks.push(msg("Meaning from the dictionary"));
  }
  if (!definition) return { ok: false, problem: "no meaning" };

  // Ruby: the word with the checked reading; the sentence from the reader, with the checked
  // reading on the target when the token is exactly the word.
  // A phrase gets ruby word by word from the reader; a single word gets the checked reading.
  const wordRuby: DeckRubySeg[] = phrase
    ? wordTokens.flatMap((t) => (t.isWord && t.reading ? rubySegments(language, t.text, t.reading) : [{ text: t.text }]))
    : rubySegments(language, word, reading);
  let sentence: DeckRubySeg[] = [];
  for (const t of tokens) {
    const r = t.text === word && t.start === from ? reading : t.reading;
    sentence.push(...(t.isWord && r ? rubySegments(language, t.text, r) : [{ text: t.text }]));
  }
  sentence = markTarget(sentence, from, to);

  const card: StoredCard = {
    word,
    reading,
    wordRuby,
    definition,
    sentence: raw.sentence,
    sentenceRuby: sentence,
    translation: raw.translation,
    checks,
    status,
  };
  if (raw.notes) card.notes = raw.notes;
  return { ok: true, card };
}

/**
 * Cards for languages without ruby (Korean, Vietnamese, the European languages, English): the word
 * must appear in the sentence (case-insensitive, or inflected), the meaning is checked against the
 * dictionary when one is installed, and the reading is the model's (Russian stress) or empty.
 */
async function checkPlainCard(raw: RawCard, ctx: CardContext, status: DeckCardStatus): Promise<CardCheck> {
  const { language } = ctx;
  const word = raw.word;
  const checks: string[] = [];
  const tag = LANGUAGE_META[language].bcp47;
  const tokens = await ctx.lang.annotate(language, raw.sentence);
  let from = raw.sentence.toLocaleLowerCase(tag).indexOf(word.toLocaleLowerCase(tag));
  let to = from + word.length;
  if (from < 0) {
    const tok = findInflected(tokens, word, language);
    if (!tok) return { ok: false, problem: "the sentence doesn't use the word" };
    from = tok.start;
    to = tok.end;
  }

  let entries: DictEntry[] = [];
  if (ctx.dictionary) {
    const res = await ctx.lang.lookup(language, word).catch(() => null);
    const lw = word.toLocaleLowerCase(tag);
    entries = (res?.entries ?? []).filter((e) => e.headword.toLocaleLowerCase(tag) === lw || e.variants?.some((v) => v.toLocaleLowerCase(tag) === lw));
    checks.push(entries.length ? `Word found in ${ctx.dictionary}` : `Not in ${ctx.dictionary}: check this one`);
  } else {
    checks.push(msg("Install the dictionary to check words"));
  }

  // Russian: keep the model's stress-marked form only when it spells the same word.
  let reading = "";
  if (language === "ru" && raw.reading) {
    const plain = raw.reading.normalize("NFD").replace(/\u0301/g, "").normalize("NFC");
    if (plain.toLocaleLowerCase(tag) === word.toLocaleLowerCase(tag)) reading = raw.reading.normalize("NFC");
  }

  let definition = raw.definition;
  if (!definition && entries.length) {
    definition = entries[0].senses
      .slice(0, 3)
      .map((s) => s.glosses.slice(0, 2).join(", "))
      .join("; ");
    checks.push(msg("Meaning from the dictionary"));
  }
  if (!definition) return { ok: false, problem: "no meaning" };

  const sentence = markTarget([{ text: raw.sentence }], from, to);
  const card: StoredCard = {
    word,
    reading,
    wordRuby: [{ text: word }],
    definition,
    sentence: raw.sentence,
    sentenceRuby: sentence,
    translation: raw.translation,
    checks,
    status,
  };
  if (raw.notes) card.notes = raw.notes;
  return { ok: true, card };
}

/** Texts to speak for a card: the word and the sentence. */
export const speechTexts = (c: Pick<StoredCard, "word" | "sentence">) => ({ word: c.word, sentence: c.sentence });
