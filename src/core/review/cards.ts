// Corrections → Anki cards (S2-03): drafts, the Sayfern note types and the notes sent to
// AnkiConnect. Pure functions; the model call for situations lives in situations.ts.
import { msg, type Translator } from "../../shared/i18n";
import { LANGUAGE_META, leaksTargetScript } from "../../shared/languages";
import type { Language } from "../../shared/records";
import { clozeFront, type AnkiCardDraft, type AnkiCardStyle, type ReviewItem } from "../../shared/stage2";
import type { AnkiNoteInput, AnkiNoteType } from "../contracts";
import { revisedText } from "./list";

const CSS = `.card { font-family: -apple-system, "Helvetica Neue", sans-serif; font-size: 20px; line-height: 1.5; text-align: center; color: #1c1e1b; background: #fbf9f4; padding: 12px; }
.sentence, .cloze-text { font-family: "Noto Serif SC", "Noto Serif JP", "Songti SC", "Hiragino Mincho ProN", serif; font-size: 28px; }
.sentence b, .cloze { color: #2e5b45; font-weight: 600; }
.prompt { font-size: 22px; }
.explanation { margin-top: 14px; font-size: 16px; color: #3d403a; }
.source { margin-top: 10px; font-size: 12px; color: #6b6d64; }
.nightMode .card, .night_mode .card { color: #ede8dc; background: #1c1e1b; }
.nightMode .sentence b, .nightMode .cloze, .night_mode .cloze { color: #a9c8b2; }
.nightMode .explanation, .night_mode .explanation { color: #c9c3b5; }`;

const EXTRA = `{{#Explanation}}<div class="explanation">{{Explanation}}</div>{{/Explanation}}{{#Source}}<div class="source">{{Source}}</div>{{/Source}}`;

/**
 * "Situation → sentence": the sentence is the first field so Anki's duplicate check is on the
 * sentence (stable), not on the generated prompt.
 */
export const RECALL_NOTE_TYPE: AnkiNoteType = {
  name: "Sayfern Recall",
  fields: ["Sentence", "Prompt", "Explanation", "Source"],
  isCloze: false,
  css: CSS,
  templates: [
    {
      Name: "Situation to sentence",
      Front: `<div class="prompt">{{Prompt}}</div>`,
      Back: `<div class="prompt">{{Prompt}}</div><hr id="answer"><div class="sentence">{{Sentence}}</div>${EXTRA}`,
    },
  ],
};

/** "Fill the gap". */
export const CLOZE_NOTE_TYPE: AnkiNoteType = {
  name: "Sayfern Cloze",
  fields: ["Text", "Explanation", "Source"],
  isCloze: true,
  css: CSS,
  templates: [
    {
      Name: "Fill the gap",
      Front: `<div class="cloze-text">{{cloze:Text}}</div>`,
      Back: `<div class="cloze-text">{{cloze:Text}}</div>${EXTRA}`,
    },
  ],
};

export const noteTypeFor = (style: AnkiCardStyle): AnkiNoteType => (style === "cloze" ? CLOZE_NOTE_TYPE : RECALL_NOTE_TYPE);

export const hasCjk = (s: string): boolean => /[぀-ヿ㐀-鿿豈-﫿]/.test(s);

/** "周末计划 · Sep 29, 2026" (date in the interface language). */
export function sourceLabel(item: ReviewItem, tr?: Pick<Translator, "date">): string {
  const at = item.session?.at ?? item.correction.createdAt;
  const date = tr ? tr.date(at) : new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return item.session ? `${item.session.title} · ${date}` : date;
}

/** Anki tags: no spaces. */
export function tagsFor(item: ReviewItem): string[] {
  const tags = ["sayfern", `sayfern::${item.correction.kind}`];
  if (item.correction.grammarId) tags.push(item.correction.grammarId.replace(/\s+/g, "_"));
  return tags;
}

/** Removes the answer from a text shown on the front (explanation-based prompts). */
export function maskAnswer(text: string, answer: string): string {
  if (!answer) return text;
  return text.split(answer).join("___");
}

const KIND_HINT = {
  vocabulary: msg("a better word"),
  grammar: msg("grammar"),
  other: msg("more natural wording"),
};

/** Translator stand-in for callers without a locale (tests): English. */
const ENGLISH: Pick<Translator, "t" | "locale" | "date" | "language"> = {
  locale: "en",
  t: (en) => en,
  date: (at) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
  language: (id) => LANGUAGE_META[id]?.name ?? id,
};

/**
 * Local hint for a cloze gap, in the interface language: a dictionary gloss of the fixed part when
 * there is one, otherwise the grammar point's name, otherwise a hint by kind. Never contains the answer
 * or text in the target language's script.
 */
export function clozeHint(item: ReviewItem, gloss?: string, language?: Language, tr: Pick<Translator, "t" | "locale"> = ENGLISH): string {
  const c = item.correction;
  const leaks = (h: string) => (language ? leaksTargetScript(h, language, tr.locale) : hasCjk(h));
  const candidates = [
    c.kind === "grammar" ? item.grammar?.name : undefined,
    gloss,
    item.grammar?.name,
    tr.t(c.kind === "vocabulary" ? KIND_HINT.vocabulary : c.kind === "grammar" ? KIND_HINT.grammar : KIND_HINT.other),
  ];
  for (const raw of candidates) {
    const h = raw?.trim();
    if (h && !h.includes(c.corrected) && !leaks(h)) return h.length > 60 ? `${h.slice(0, 57).trimEnd()}…` : h;
  }
  return "";
}

function baseDraft(item: ReviewItem, style: AnkiCardStyle, tr: Pick<Translator, "date">): Omit<AnkiCardDraft, "front"> {
  return {
    correctionId: item.correction.id,
    style,
    back: revisedText(item.revised),
    gap: item.revised.fixed,
    explanation: item.correction.explanation,
    source: sourceLabel(item, tr),
    tags: tagsFor(item),
  };
}

export function clozeDraft(item: ReviewItem, gloss?: string, language?: Language, tr: Pick<Translator, "t" | "locale" | "date" | "language"> = ENGLISH): AnkiCardDraft {
  const base = baseDraft(item, "cloze", tr);
  const hint = clozeHint(item, gloss, language, tr);
  return { ...base, hint, front: clozeFront(base.back, base.gap, hint) };
}

/** Situation card with the prompt supplied (model) or built from the explanation (fallback). */
export function situationDraft(item: ReviewItem, language: Language, situation?: string, tr: Pick<Translator, "t" | "locale" | "date" | "language"> = ENGLISH): AnkiCardDraft {
  const base = baseDraft(item, "situation", tr);
  if (situation) return { ...base, front: situation };
  return { ...base, front: fallbackSituation(item, language, tr), fallback: true };
}

export function fallbackSituation(item: ReviewItem, language: Language, tr: Pick<Translator, "t" | "language"> = ENGLISH): string {
  const c = item.correction;
  const lang = tr.language(language);
  const explanation = maskAnswer(c.explanation, c.corrected).trim();
  const vars = { language: lang, grammar: item.grammar?.name ?? "", title: item.session?.title ?? "" };
  const head = item.grammar
    ? item.session
      ? tr.t('Say it in {language}, using {grammar} (from "{title}").', vars)
      : tr.t("Say it in {language}, using {grammar}.", vars)
    : c.kind === "vocabulary"
      ? item.session
        ? tr.t('Say it in {language}, with the right word (from "{title}").', vars)
        : tr.t("Say it in {language}, with the right word.", vars)
      : item.session
        ? tr.t('Say it in {language}, naturally (from "{title}").', vars)
        : tr.t("Say it in {language}, naturally.", vars);
  return `${head} ${explanation}`.trim();
}

/** Parse {"cards":[{"id","situation"}]} (or a bare array) from a model reply, defensively. */
export function parseSituations(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const candidates = [cleaned.match(/\{[\s\S]*\}/)?.[0], cleaned.match(/\[[\s\S]*\]/)?.[0]].filter((x): x is string => !!x);
  for (const text of candidates) {
    try {
      const v = JSON.parse(text) as unknown;
      const list = Array.isArray(v) ? v : (v as { cards?: unknown })?.cards;
      if (!Array.isArray(list)) continue;
      for (const e of list as { id?: unknown; situation?: unknown }[]) {
        if (typeof e?.id === "string" && typeof e.situation === "string" && e.situation.trim()) out.set(e.id, e.situation.trim());
      }
      if (out.size) return out;
    } catch {
      // try the next candidate
    }
  }
  return out;
}

/** A model situation is usable when it avoids the target language, is short, and doesn't give the answer away. */
export function usableSituation(s: string | undefined, item: ReviewItem, language?: Language, locale = "en"): string | undefined {
  const t = s?.replace(/\s+/g, " ").trim();
  const leaks = (x: string) => (language ? leaksTargetScript(x, language, locale) : hasCjk(x));
  if (!t || t.length > 220 || leaks(t) || t.includes(item.correction.corrected)) return undefined;
  return t;
}

// ---------------------------------------------------------------- notes

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Cloze markup can't contain "::" or "}}" inside the answer or hint. */
const clozeSafe = (s: string) => escapeHtml(s).replace(/::/g, ":").replace(/\}\}/g, "}");

/** Why a draft can't be exported, or null. */
export function draftProblem(d: AnkiCardDraft): string | null {
  if (!d.back.trim()) return "The answer side is empty.";
  if (d.style === "cloze") {
    if (!d.gap.trim()) return "Choose the part to hide.";
    if (!d.back.includes(d.gap)) return "The hidden part must appear in the sentence.";
  } else if (!d.front.trim()) {
    return "The situation is empty.";
  }
  return null;
}

export function noteFor(d: AnkiCardDraft, deck: string): AnkiNoteInput {
  const type = noteTypeFor(d.style);
  const at = d.gap ? d.back.indexOf(d.gap) : -1;
  const before = at >= 0 ? d.back.slice(0, at) : d.back;
  const after = at >= 0 ? d.back.slice(at + d.gap.length) : "";
  const common = { Explanation: escapeHtml(d.explanation.trim()), Source: escapeHtml(d.source.trim()) };
  if (d.style === "cloze") {
    const hint = d.hint?.trim() ? `::${clozeSafe(d.hint.trim())}` : "";
    const text = `${escapeHtml(before)}{{c1::${clozeSafe(d.gap)}${hint}}}${escapeHtml(after)}`;
    return { deckName: deck, modelName: type.name, fields: { Text: text, ...common }, tags: d.tags };
  }
  const sentence = at >= 0 ? `${escapeHtml(before)}<b>${escapeHtml(d.gap)}</b>${escapeHtml(after)}` : escapeHtml(d.back);
  return { deckName: deck, modelName: type.name, fields: { Sentence: sentence, Prompt: escapeHtml(d.front.trim()), ...common }, tags: d.tags };
}
