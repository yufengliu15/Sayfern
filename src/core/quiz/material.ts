// Quiz material, gathered locally from the learner's records (S2-05): corrections and earlier quiz
// mistakes, Anki words, grammar points, a library document or chapter, learning targets and saved
// words. The model only sees what is gathered here.
import type { AnkiWord, GrammarSummary, Language, LibraryParagraph } from "../../shared/records";
import type { QuizChapter, QuizSource, QuizSpec } from "../../shared/stage2";
import { isStruggling } from "../anki/words";
import { countableCorrection } from "../records/corrections";
import type { Stage2Deps } from "../stage2";
import type { QuizItem } from "./items";

const DAY = 24 * 60 * 60 * 1000;
export const RECENT_ANKI_DAYS = 7;
const MAX_WORDS = 24;
const MAX_MISTAKES = 16;
const MAX_GRAMMAR = 10;
const PASSAGE_CHARS = 2400;

export interface MaterialGrammar {
  id: string;
  pattern: string;
  name: string;
  level?: string;
  explanation?: string;
}

export interface MaterialWord {
  word: string;
  reading?: string;
  meaning?: string;
  /** "struggling in Anki", "reviewed this week", "saved from a chat". */
  why: string;
  sentence?: string;
}

export interface MaterialMistake {
  /** Correction id (chat corrections only). */
  correctionId?: string;
  original: string;
  corrected: string;
  explanation: string;
  grammarId?: string;
  /** "chat" correction or an earlier "quiz" answer. */
  from: "chat" | "quiz";
}

export interface Material {
  grammar: MaterialGrammar[];
  words: MaterialWord[];
  mistakes: MaterialMistake[];
  passage?: { title: string; chapter?: string; text: string };
  goal?: string;
  /** Labels of sources that gave nothing (for a readable error). */
  empty: string[];
}

/** Earlier wrong quiz answers, newest first. */
export interface PastQuizMistake {
  item: QuizItem;
  at: number;
}

export function toGrammar(g: GrammarSummary): MaterialGrammar {
  const out: MaterialGrammar = { id: g.point.id, pattern: g.point.pattern, name: g.point.name };
  if (g.point.level) out.level = g.point.level;
  if (g.point.explanation) out.explanation = g.point.explanation;
  return out;
}

export function needsWork(g: GrammarSummary): boolean {
  return g.state !== "independent" || (g.rate !== null && g.rate < 0.7) || (g.quiz?.rate != null && g.quiz.rate < 0.7);
}

export async function ankiWords(deps: Stage2Deps, language: Language): Promise<{ enabled: boolean; syncedAt: number | null; words: AnkiWord[] }> {
  const config = await deps.anki.getConfig().catch(() => null);
  if (!config?.enabled) return { enabled: false, syncedAt: null, words: [] };
  const page = await deps.anki.words(language, { status: "all", limit: 1000 }).catch(() => null);
  return { enabled: true, syncedAt: page?.syncedAt ?? null, words: page?.items ?? [] };
}

export function selectAnki(words: AnkiWord[], mode: NonNullable<QuizSource["anki"]>, now: number): { word: AnkiWord; why: string }[] {
  const recentCut = now - RECENT_ANKI_DAYS * DAY;
  const struggling = words.filter(isStruggling).sort((a, b) => b.struggle - a.struggle);
  const recent = words
    .filter((w) => w.status !== "new" && w.status !== "suspended" && (w.lastReviewAt ?? 0) >= recentCut)
    .sort((a, b) => (b.lastReviewAt ?? 0) - (a.lastReviewAt ?? 0));
  const out: { word: AnkiWord; why: string }[] = [];
  const seen = new Set<string>();
  const add = (w: AnkiWord, why: string) => {
    if (seen.has(w.word)) return;
    seen.add(w.word);
    out.push({ word: w, why });
  };
  if (mode === "struggling") for (const w of struggling) add(w, "hard for you in Anki");
  else if (mode === "recent") {
    for (const w of struggling.filter((s) => recent.includes(s))) add(w, "reviewed this week, still hard");
    for (const w of recent) add(w, "reviewed this week");
  } else {
    for (const w of struggling) add(w, "hard for you in Anki");
    for (const w of recent) add(w, "reviewed this week");
    for (const w of words) if (w.status === "known" || w.status === "learning") add(w, "in your Anki deck");
  }
  return out;
}

/** Headings of a document with their paragraph ranges. */
export function chaptersOf(paragraphs: LibraryParagraph[]): QuizChapter[] {
  const out: QuizChapter[] = [];
  for (const p of paragraphs) {
    const h = p.heading?.trim();
    if (!h) continue;
    const last = out[out.length - 1];
    if (last && last.heading === h) last.paragraphs = p.index - last.from + 1;
    else out.push({ heading: h, from: p.index, paragraphs: 1 });
  }
  return out;
}

function passageText(paragraphs: LibraryParagraph[], max: number): string {
  let text = "";
  for (const p of paragraphs) {
    if (text.length + p.text.length > max) {
      if (!text) text = p.text.slice(0, max);
      break;
    }
    text += (text ? "\n" : "") + p.text;
  }
  return text;
}

function wordOf(w: AnkiWord, why: string): MaterialWord {
  const out: MaterialWord = { word: w.word, why };
  if (w.reading) out.reading = w.reading;
  if (w.meaning) out.meaning = w.meaning;
  return out;
}

export async function gatherMaterial(deps: Stage2Deps, spec: QuizSpec, pastMistakes: PastQuizMistake[], grammar: GrammarSummary[]): Promise<Material> {
  const { language } = spec;
  const m: Material = { grammar: [], words: [], mistakes: [], empty: [] };
  const addGrammar = (g: GrammarSummary) => {
    if (m.grammar.length < MAX_GRAMMAR && !m.grammar.some((x) => x.id === g.point.id)) m.grammar.push(toGrammar(g));
  };
  const addWord = (w: MaterialWord) => {
    if (m.words.length < MAX_WORDS && !m.words.some((x) => x.word === w.word)) m.words.push(w);
  };

  for (const source of spec.sources) {
    const before = m.grammar.length + m.words.length + m.mistakes.length + (m.passage ? 1 : 0) + (m.goal ? 1 : 0);
    switch (source.kind) {
      case "mistakes": {
        const corrections = (await deps.records.listCorrections({ language })).filter(countableCorrection).reverse();
        const chat = corrections.slice(0, MAX_MISTAKES - Math.min(6, pastMistakes.length));
        for (const c of chat) {
          const mm: MaterialMistake = { correctionId: c.id, original: c.original, corrected: c.corrected, explanation: c.explanation, from: "chat" };
          if (c.grammarId) mm.grammarId = c.grammarId;
          m.mistakes.push(mm);
        }
        for (const p of pastMistakes.slice(0, MAX_MISTAKES - m.mistakes.length)) {
          const it = p.item;
          const shown = it.text ? `${it.text}${it.answered?.response ? ` (answered: ${it.answered.response})` : ""}` : it.answered?.response ?? "";
          const mm: MaterialMistake = { original: shown, corrected: it.answer, explanation: it.explanation, from: "quiz" };
          if (it.grammarId) mm.grammarId = it.grammarId;
          m.mistakes.push(mm);
        }
        for (const mm of m.mistakes) {
          const g = mm.grammarId ? grammar.find((x) => x.point.id === mm.grammarId) : undefined;
          if (g) addGrammar(g);
        }
        break;
      }
      case "anki": {
        const { words } = await ankiWords(deps, language);
        for (const { word, why } of selectAnki(words, source.anki ?? "recent", deps.now())) addWord(wordOf(word, why));
        break;
      }
      case "grammar": {
        const ids = source.grammarIds?.filter(Boolean) ?? [];
        const picked = ids.length ? grammar.filter((g) => ids.includes(g.point.id)) : grammar.filter(needsWork);
        for (const g of picked) addGrammar(g);
        break;
      }
      case "document": {
        if (!source.docId) break;
        const doc = await deps.library.getDoc(source.docId);
        if (!doc || doc.language !== language || doc.paragraphCount === 0) break;
        let paragraphs: LibraryParagraph[];
        if (source.chapter) {
          const all = await deps.library.getParagraphs(doc.id, 0, doc.paragraphCount);
          paragraphs = all.filter((p) => p.heading?.trim() === source.chapter);
        } else {
          const from = doc.checkpoint ? Math.max(0, doc.checkpoint.paragraph - 2) : 0;
          paragraphs = await deps.library.getParagraphs(doc.id, from, 40);
        }
        const text = passageText(paragraphs, PASSAGE_CHARS);
        if (text) m.passage = { title: doc.title, ...(source.chapter ? { chapter: source.chapter } : {}), text };
        break;
      }
      case "targets": {
        const profile = await deps.records.getProfile();
        const goal = profile.goals?.[language]?.trim();
        if (goal) m.goal = goal;
        for (const g of grammar.filter((x) => x.state !== "independent").slice(0, 5)) addGrammar(g);
        const { words } = await ankiWords(deps, language);
        for (const { word, why } of selectAnki(words, "recent", deps.now()).slice(0, 6)) addWord(wordOf(word, why));
        break;
      }
      case "saved_words": {
        for (const w of await deps.records.listSavedWords(language)) {
          const mw: MaterialWord = { word: w.word, why: "you saved it", sentence: w.sentence };
          if (w.reading) mw.reading = w.reading;
          if (w.definition) mw.meaning = w.definition;
          addWord(mw);
        }
        break;
      }
    }
    const after = m.grammar.length + m.words.length + m.mistakes.length + (m.passage ? 1 : 0) + (m.goal ? 1 : 0);
    if (after === before) m.empty.push(SOURCE_EMPTY[source.kind]);
  }
  return m;
}

export const SOURCE_EMPTY: Record<QuizSource["kind"], string> = {
  mistakes: "You have no corrections or quiz mistakes yet.",
  anki: "No Anki words to use. Sync Anki in Settings, or pick another source.",
  grammar: "No grammar points to use yet.",
  document: "That document has no text to quiz from.",
  targets: "No learning targets yet. Add a goal in Settings, or practise a little first.",
  saved_words: "You haven't saved any words yet.",
};

export function materialSize(m: Material): number {
  return m.grammar.length + m.words.length + m.mistakes.length + (m.passage ? 1 : 0) + (m.goal ? 1 : 0);
}
