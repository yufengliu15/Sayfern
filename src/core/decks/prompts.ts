// Deck generation prompts and model calls (S2-15): choosing the words, then writing the cards.
// The rules condense /ankigen's Mandarin and Japanese references; Sayfern then checks readings
// and builds the ruby itself (cards.ts), so the model never writes HTML.
import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import { LANGUAGE_META } from "../../shared/languages";
import type { Language } from "../../shared/records";
import { DECK_BEGINNER, type DeckSpec } from "../../shared/stage2";
import { requestOptions } from "../agent/options";
import { arr, obj } from "../agent/text";
import { levelInfo } from "../quiz/levels";
import { extractJson } from "../quiz/json";

const NAME = (l: Language): string => (l === "zh" ? "Mandarin Chinese" : `${LANGUAGE_META[l].name} (${LANGUAGE_META[l].variety})`);

const WORD_FORM: Record<Language, string> = {
  zh: "word = simplified characters, the dictionary form.",
  ja: "word = the standard written form: kanji with okurigana (食べる, 新しい), kana for words normally written in kana (ある, きれい, とても), katakana for loanwords. Verbs in dictionary form, i-adjectives in plain form.",
  ko: "word = the dictionary form in Hangul: verbs and adjectives ending in -다 (먹다, 예쁘다), nouns without particles. No Hanja.",
  en: "word = the base form: verbs without \"to\" (run), nouns in the singular, phrasal verbs as one item (give up).",
  es: "word = the dictionary form: verbs in the infinitive (hablar), nouns in the singular without an article, adjectives in the masculine singular.",
  fr: "word = the dictionary form: verbs in the infinitive (parler), nouns in the singular without an article, adjectives in the masculine singular.",
  de: "word = the dictionary form: verbs in the infinitive (sprechen), nouns in the singular with a capital letter and no article, adjectives uninflected.",
  it: "word = the dictionary form: verbs in the infinitive (parlare), nouns in the singular without an article, adjectives in the masculine singular.",
  pt: "word = the dictionary form in European Portuguese spelling (1990 agreement): verbs in the infinitive (falar), nouns in the singular without an article, adjectives in the masculine singular.",
  ru: "word = the dictionary form in Cyrillic without stress marks: verbs in the infinitive, nouns in the nominative singular, adjectives in the masculine nominative singular.",
  vi: "word = standard Vietnamese spelling with every tone mark (học sinh, cảm ơn); a word of several syllables is one item.",
};

export function levelGuidance(spec: Pick<DeckSpec, "language" | "level">): string {
  if (spec.level === DECK_BEGINNER)
    return "Level: complete beginner, starting from zero. Choose the first words a beginner needs: greetings, people, numbers, time, food, places, and the most common verbs and adjectives.";
  const info = levelInfo(spec.language, spec.level);
  if (!info) return `Level: ${spec.level}.`;
  return `Level: ${spec.level}. Learners at this level know about ${info.words} words in total. Choose words that belong at ${spec.level}: new at this level or just below it, not words every beginner already knows.`;
}

// ---------------------------------------------------------------- words

export function wordsSystemPrompt(language: Language, explain = "English"): string {
  return [
    `You choose vocabulary for a new Anki deck for a learner of ${NAME(language)}, in the app Sayfern.`,
    'Reply with strict JSON only: {"words": [{"word": "...", "hint": "..."}]}.',
    WORD_FORM[language],
    `hint = 2 to 6 words in ${explain}: the meaning, so the card writer picks the intended sense.`,
    "Real, common words only: no proper names, no made-up compounds, no phrases unless they are fixed expressions learners study as one item.",
    `When the learner asks for sayings, set phrases, idioms or expressions, give those items instead of single words (${LANGUAGE_META[language].script === "latin" || LANGUAGE_META[language].script === "cyrillic" || language === "ko" ? "up to 5 words" : "up to 16 characters"} each, no sentence-final punctuation).`,
    "When the learner names a word list, frequency list, corpus or exam list, follow it as closely as you know it, in its order, and never pad it with invented entries.",
    "No duplicates, and never an item from the avoid list.",
  ].join("\n");
}

export function wordsUserPrompt(input: {
  spec: DeckSpec;
  count: number;
  /** Items already taken from the list (chosen or skipped as known). */
  taken?: number;
  avoid: string[];
  goal?: string;
  guidance?: string;
}): string {
  const { spec } = input;
  const request = spec.request.trim();
  const order =
    spec.order === "theme"
      ? "Order: grouped by sub-theme, related items next to each other."
      : "Order: most useful first (how often the item appears in real speech and text).";
  const lines: string[] = [];
  if (request) {
    lines.push(
      `What the learner wants (this decides which items go in the deck, and their source and order when it names them): ${request}`,
      `The learner's level: ${spec.level === DECK_BEGINNER ? "complete beginner" : spec.level}. Use it for anything the request leaves open; the request wins when they disagree.`,
      `${order} Unless the request sets its own order.`,
    );
  } else {
    lines.push(levelGuidance(spec), "Theme: general, everyday vocabulary.", order);
  }
  if (input.taken)
    lines.push(`Items 1 to ${input.taken} of this list are already taken (the most recent are in the avoid list). Continue from item ${input.taken + 1}.`);
  if (input.goal) lines.push(`The learner's goal: ${input.goal}`);
  if (input.guidance) lines.push(`The learner's notes on this deck: ${input.guidance}`);
  if (input.avoid.length) lines.push("", `Avoid list (already chosen or already in the learner's Anki): ${input.avoid.join("、")}`);
  lines.push("", `Give exactly ${input.count} new items.`);
  return lines.join("\n");
}

export interface WordPick {
  word: string;
  hint?: string;
}

export function parseWords(raw: string): WordPick[] {
  const parsed = extractJson(raw);
  const list = Array.isArray(parsed) ? parsed : arr(obj(parsed).words ?? obj(parsed).items);
  const out: WordPick[] = [];
  for (const v of list) {
    if (typeof v === "string") {
      out.push({ word: v.trim() });
      continue;
    }
    const o = obj(v);
    const word = typeof o.word === "string" ? o.word.trim() : "";
    if (!word) continue;
    out.push(typeof o.hint === "string" && o.hint.trim() ? { word, hint: o.hint.trim() } : { word });
  }
  return out;
}

// ---------------------------------------------------------------- cards

const CARD_RULES: Record<Language, string[]> = {
  zh: [
    "reading = pinyin with tone marks, syllables of one word run together (tèbié). Neutral tone unmarked (háizi). Citation tones: no tone sandhi (bù, yī, nǐ hǎo).",
    "Polyphonic characters are the most common mistake: check the reading of this word, not the character's usual one (觉得 juéde but 睡觉 shuìjiào; 银行 yínháng; 长大 zhǎngdà).",
    "sentence = natural spoken Mandarin in simplified characters, 8 to 20 characters, full-width punctuation. Every other word at or below the deck's level.",
  ],
  ja: [
    "reading = kana for the whole word (hiragana; katakana for katakana words). Check on and kun readings, rendaku (手紙 てがみ) and whole-word readings (今日 きょう, 大人 おとな) for this word.",
    "sentence = natural modern Japanese, polite です/ます unless the word is casual, about 8 to 20 characters. Correct, idiomatic particles. The word may be conjugated in the sentence. Every other word at or below the deck's level.",
    "notes = short, only when useful: the counter for a noun, the transitive or intransitive partner of a verb, な-adjective, する-verb, usually written in kana, false-friend loanwords.",
  ],
  ko: [
    "reading = empty string (Hangul is read as written).",
    "sentence = natural modern Korean in polite 해요체, about 5 to 12 words (eojeol). The word may be conjugated or take particles in the sentence. Every other word at or below the deck's level.",
    "notes = short, only when useful: an honorific or casual form, an irregular conjugation (ㅂ, ㄷ, 르), a common confusable.",
  ],
  en: [
    "reading = empty string.",
    "sentence = natural modern English, 6 to 14 words. Use the word in the same form when you can; a verb may be inflected. Every other word at or below the deck's level.",
    "notes = short, only when useful: an irregular past form, the particle of a phrasal verb, a British and American difference, a common confusable.",
  ],
  es: [
    "reading = empty string.",
    "sentence = natural modern Spanish, 6 to 14 words. Use the word in the same form when you can; a verb may be conjugated. Every other word at or below the deck's level.",
    "notes = short, only when useful: the gender of a noun that breaks the -o/-a pattern (el problema, la mano), an irregular verb form, ser or estar, a false friend.",
  ],
  fr: [
    "reading = empty string.",
    "sentence = natural modern French, 6 to 14 words, correct elision and agreement. Use the word in the same form when you can; a verb may be conjugated. Every other word at or below the deck's level.",
    "notes = short, only when useful: the gender of a noun (le, la), an irregular form, être or avoir in the passé composé, a false friend.",
  ],
  de: [
    "reading = empty string.",
    "sentence = natural modern German, 6 to 14 words, correct case endings. Use the word in the same form when you can; a verb may be conjugated or split. Every other word at or below the deck's level.",
    "notes = for nouns always the article and plural (der Tisch, die Tische); for verbs, a separable prefix, an irregular past or haben/sein when useful.",
  ],
  it: [
    "reading = empty string.",
    "sentence = natural modern Italian, 6 to 14 words. Use the word in the same form when you can; a verb may be conjugated. Every other word at or below the deck's level.",
    "notes = short, only when useful: the gender of a noun that breaks the pattern, an irregular plural or verb form, essere or avere in the passato prossimo.",
  ],
  pt: [
    "reading = empty string.",
    "sentence = natural modern European Portuguese (Portugal), 6 to 14 words. Use the word in the same form when you can; a verb may be conjugated. Every other word at or below the deck's level.",
    "notes = short, only when useful: the gender of a noun that breaks the pattern, an irregular form, ser or estar, a word that differs in Brazil.",
  ],
  ru: [
    "reading = the word with an acute accent on the stressed vowel (молоко́, говори́ть); empty for one-syllable words.",
    "sentence = natural modern Russian, 5 to 12 words, correct cases. Use the word in the same form when you can; it may be declined or conjugated. Every other word at or below the deck's level.",
    "notes = short, only when useful: the aspect partner of a verb (делать / сделать), the gender of a noun ending in -ь, an irregular form, the case a verb or preposition takes.",
  ],
  vi: [
    "reading = empty string.",
    "sentence = natural modern Vietnamese (Northern usage), 6 to 14 words, every tone mark correct. Every other word at or below the deck's level.",
    "notes = short, only when useful: the classifier for a noun (con mèo, cái bàn), a Southern word that differs, a common confusable.",
  ],
};

/** `explain`: the learner's interface language, used for meanings, translations and notes ("German"). */
export function cardsSystemPrompt(language: Language, explain = "English"): string {
  return [
    `You write Anki vocabulary cards for a learner of ${NAME(language)}, in the app Sayfern. Sayfern checks readings against a dictionary and adds ruby and audio itself: write plain text, never HTML, ruby or brackets.`,
    'Reply with strict JSON only: {"cards": [ ... ]}, one card per word, in the order given.',
    "Card fields: word (exactly as given, even when it is a saying or set phrase), reading, definition, sentence, translation, notes (optional).",
    `For a saying or set phrase: definition = its meaning in plain ${explain} (and the literal meaning when it helps), sentence = a natural sentence that uses it.`,
    `definition = short and concrete ${explain}, 1 to 3 senses separated by commas, like a good curated deck. Not a dictionary dump.`,
    "sentence = one example sentence that uses the word exactly once, in a realistic situation. The word should be the hardest thing in it. Vary the sentence frames across cards.",
    `translation = natural ${explain} for the sentence.`,
    `notes = written in ${explain}.`,
    ...CARD_RULES[language],
    `Plain punctuation in ${explain} text: no em dashes.`,
  ].join("\n");
}

export function cardsUserPrompt(input: { spec: DeckSpec; words: WordPick[]; guidance?: string }): string {
  const lines = [levelGuidance(input.spec)];
  if (input.spec.request.trim()) lines.push(`What the learner asked this deck to cover: ${input.spec.request.trim()}`);
  if (input.guidance) lines.push(`The learner's notes on these cards (follow them): ${input.guidance}`);
  lines.push("", "Words:", ...input.words.map((w, i) => `${i + 1}. ${w.word}${w.hint ? ` (${w.hint})` : ""}`));
  return lines.join("\n");
}

export function parseCards(raw: string): unknown[] {
  const parsed = extractJson(raw);
  return Array.isArray(parsed) ? parsed : arr(obj(parsed).cards ?? obj(parsed).items);
}

// ---------------------------------------------------------------- model call

export class DeckModelError extends Error {}

/** One request; returns the reply text. Throws DeckModelError when the model fails or is stopped. */
export async function ask(
  models: MutableModels,
  model: Model<Api>,
  input: { system: string; user: string; maxTokens: number; signal: AbortSignal; now: () => number },
): Promise<string> {
  const reply = await models.completeSimple(
    model,
    { systemPrompt: input.system, messages: [{ role: "user", content: input.user, timestamp: input.now() }] },
    { ...requestOptions(model, input.maxTokens), signal: input.signal },
  );
  if (reply.stopReason === "aborted" || input.signal.aborted) throw new DeckModelError("Stopped.");
  if (reply.stopReason === "error") throw new DeckModelError(reply.errorMessage || "The model request failed.");
  return reply.content.map((c) => (c.type === "text" ? c.text : "")).join("");
}

/** Output tokens for a request of `n` words / cards. */
export const wordTokens = (n: number) => 300 + n * 30;
export const cardTokens = (n: number) => 500 + n * 170;
