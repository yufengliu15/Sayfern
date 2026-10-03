// Mock implementation of the Stage 2 ReviewApi slot for the browser dev server. Owned by the review feature.
// Seeds a believable set of Chinese and Japanese corrections (unless ?fresh=1) and simulates
// drafting (cloze locally, situations after a "model" delay) and the AnkiConnect export.
import type { Correction, Language } from "../../../shared/records";
import {
  clozeFront,
  REVIEW_KIND,
  type AnkiCardDraft,
  type ExportAnkiCardsResult,
  type ReviewApi,
  type ReviewItem,
  type ReviewKindFilter,
  type ReviewStatusFilter,
} from "../../../shared/stage2";
import { sentenceAt } from "../lib/format";
import { LANGUAGE_META } from "../../../shared/languages";
import { everyLanguage, MOCK_DAY, MOCK_HOUR, MOCK_MIN, mockClone, mockWait, type MockWorld } from "./mockWorld";

interface Seed {
  id: string;
  language: Language;
  sessionId: string;
  sentence: string;
  original: string;
  corrected: string;
  explanation: string;
  kind: Correction["kind"];
  grammarId?: string;
  ago: number;
  status?: Correction["status"];
  retries?: Correction["retries"];
  disputeNote?: string;
  exported?: boolean;
  situation?: string;
}

const SEEDS: Seed[] = [
  { id: "c-rv-zh-1", language: "zh", sessionId: "s-zh-film", sentence: "我很兴奋看这部电影。", original: "兴奋", corrected: "期待", explanation: "兴奋 is excitement in the moment. For looking forward to something, use 期待.", kind: "vocabulary", ago: 10 * MOCK_DAY + 3 * MOCK_MIN, situation: "Tell a friend you're looking forward to seeing this film." },
  { id: "c-rv-zh-2", language: "zh", sessionId: "s-zh-food", sentence: "这家饭馆的菜很好吃的。", original: "很好吃的", corrected: "很好吃", explanation: "Style, not an error. The final 的 is fine in speech but sounds heavy here.", kind: "style", ago: 8 * MOCK_DAY + 2 * MOCK_MIN, situation: "Tell the waiter the food at this restaurant is delicious." },
  { id: "c-rv-zh-3", language: "zh", sessionId: "s-zh-food", sentence: "服务员，我们想付钱。", original: "我们想付钱", corrected: "麻烦买单", explanation: "In a restaurant, ask for the bill with 买单. 麻烦 makes it polite.", kind: "phrasing", ago: 8 * MOCK_DAY + 9 * MOCK_MIN, exported: true, situation: "Politely ask the waiter for the bill." },
  { id: "c-rv-zh-4", language: "zh", sessionId: "s-zh-uni", sentence: "我不了解他的电话号码。", original: "了解", corrected: "知道", explanation: "了解 means understanding someone or something in depth. For a fact like a phone number, use 知道.", kind: "vocabulary", ago: 5 * MOCK_DAY + 6 * MOCK_MIN, status: "retried_wrong", retries: [{ text: "我不明白他的电话号码。", ok: false, at: 0 }], situation: "Say you don't know his phone number." },
  { id: "c-rv-zh-5", language: "zh", sessionId: "s-zh-uni", sentence: "我的宿舍比他的宿舍很大。", original: "很大", corrected: "大一点儿", explanation: "比 comparisons don't take 很. Use the plain adjective, or add 一点儿 for a small difference.", kind: "grammar", grammarId: "zh:bi-comparison", ago: 5 * MOCK_DAY + 2 * MOCK_MIN, situation: "Say your dorm room is a little bigger than his." },
  { id: "c-rv-zh-6", language: "zh", sessionId: "s-zh-film", sentence: "他说中文说的很好。", original: "说的很好", corrected: "说得很好", explanation: "得 links a verb to how well it's done: 说得很好.", kind: "grammar", ago: 10 * MOCK_DAY + 8 * MOCK_MIN, exported: true, situation: "Say that he speaks Chinese really well." },
  { id: "c-rv-zh-7", language: "zh", sessionId: "s-zh-film", sentence: "我非常非常喜欢这个电影。", original: "非常非常喜欢", corrected: "特别喜欢", explanation: "Style. Repeating 非常 sounds childish in writing. 特别 carries the same force.", kind: "style", ago: 10 * MOCK_DAY + 12 * MOCK_MIN, status: "disputed", disputeNote: "I say it this way when I talk, it's fine casually." },
  { id: "c-rv-zh-8", language: "zh", sessionId: "s-zh-uni", sentence: "我昨天买了一个书。", original: "一个书", corrected: "一本书", explanation: "Books take the measure word 本.", kind: "vocabulary", ago: 5 * MOCK_DAY + 15 * MOCK_MIN, status: "revealed", situation: "Say you bought a book yesterday." },
  { id: "c-rv-zh-9", language: "zh", sessionId: "s-zh-food", sentence: "我们吃饭在七点。", original: "吃饭在七点", corrected: "七点吃饭", explanation: "Time words come before the verb: 七点吃饭.", kind: "grammar", ago: 8 * MOCK_DAY + 20 * MOCK_MIN, situation: "Tell your friend you're having dinner at seven." },
  { id: "c-rv-zh-10", language: "zh", sessionId: "s-zh-weekend", sentence: "我明天要看见我的朋友。", original: "看见", corrected: "见", explanation: "看见 is to see with your eyes. To meet up with a friend, use 见 or 见面.", kind: "vocabulary", ago: 2 * MOCK_HOUR + 30 * MOCK_MIN, situation: "Say you're meeting your friend tomorrow." },
  { id: "c-rv-ja-1", language: "ja", sessionId: "s-ja-film", sentence: "私はジブリの映画を好きです。", original: "映画を", corrected: "映画が", explanation: "好き takes が for the thing you like, not を.", kind: "grammar", ago: 6 * MOCK_DAY + 4 * MOCK_MIN, situation: "Tell a friend you like Ghibli films." },
  { id: "c-rv-ja-2", language: "ja", sessionId: "s-ja-film", sentence: "週末に映画をよく見物します。", original: "見物します", corrected: "見ます", explanation: "見物 is sightseeing. For films, just use 見る.", kind: "vocabulary", ago: 6 * MOCK_DAY + 9 * MOCK_MIN, exported: true, situation: "Say you often watch films on the weekend." },
  { id: "c-rv-ja-3", language: "ja", sessionId: "s-ja-film", sentence: "私はトトロが一番好きです。", original: "私はトトロが", corrected: "トトロが", explanation: "Style. Once it's clear you're talking about yourself, Japanese drops 私は.", kind: "style", ago: 6 * MOCK_DAY + 11 * MOCK_MIN, situation: "Say Totoro is your favourite." },
];

/** Sentences for the corrections mockApi seeds, whose stored messages don't hold them. */
const EXTRA_SENTENCES: Record<string, string> = {
  "c-zh-uni-1": "除了中文课，还我有三门课。",
  "c-zh-film-1": "上个周末我和朋友去了看电影。",
};

const SITUATIONS: Record<string, string> = {
  "c-zh1-1": "Tell a friend you went hiking yesterday.",
  "c-zh-uni-1": "Say that besides Chinese, you also have three other classes.",
  "c-zh-film-1": "Tell a friend you went to see a film last weekend.",
  "c-ja1-1": "Tell a friend the weekend was a lot of fun.",
};

const GLOSS: Record<string, string> = { 期待: "look forward to", 知道: "know (a fact)", 一本书: "a book", 见: "meet", 見ます: "watch" };
const LANGUAGE_NAME = everyLanguage<string>({ zh: "Chinese", ja: "Japanese" }, (l) => LANGUAGE_META[l].name);

const fold = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

export function createReviewMock(world: MockWorld): ReviewApi {
  const sentences = new Map<string, string>(Object.entries(EXTRA_SENTENCES));
  /** First fields already in "Anki", for duplicate detection. */
  const inAnki = new Set<string>();
  let noteId = 1_727_000_000_000;

  if (!world.fresh) {
    for (const s of SEEDS) {
      if (!world.sessions.has(s.sessionId)) continue;
      const createdAt = world.T0 - s.ago;
      const c: Correction = {
        id: s.id,
        language: s.language,
        sessionId: s.sessionId,
        messageId: `${s.sessionId}-rv`,
        original: s.original,
        corrected: s.corrected,
        explanation: s.explanation,
        kind: s.kind,
        createdAt,
        status: s.status ?? "open",
        retries: (s.retries ?? []).map((r) => ({ ...r, at: createdAt + MOCK_MIN })),
      };
      if (s.grammarId && world.grammar.has(s.grammarId)) c.grammarId = s.grammarId;
      if (s.disputeNote) c.disputeNote = s.disputeNote;
      if (s.exported) {
        c.exportedAt = createdAt + MOCK_HOUR;
        c.ankiNoteIds = [noteId++];
      }
      world.corrections.set(c.id, c);
      sentences.set(c.id, s.sentence);
      if (s.situation) SITUATIONS[c.id] = s.situation;
    }
  }

  function item(c: Correction): ReviewItem {
    const rec = world.sessions.get(c.sessionId);
    const text = sentences.get(c.id) ?? rec?.messages.find((m) => m.id === c.messageId)?.text;
    const idx = text ? text.indexOf(c.original) : -1;
    const sentence = text && idx >= 0 ? sentenceAt(text, idx) : c.original;
    const at = sentence.indexOf(c.original);
    const out: ReviewItem = {
      correction: mockClone(c),
      sentence,
      revised: at >= 0 ? { before: sentence.slice(0, at), fixed: c.corrected, after: sentence.slice(at + c.original.length) } : { before: "", fixed: c.corrected, after: "" },
    };
    if (rec) out.session = { id: rec.meta.id, title: rec.meta.title, kind: rec.meta.kind, at: rec.meta.createdAt };
    const g = c.grammarId ? world.grammar.get(c.grammarId) : undefined;
    if (g) out.grammar = { id: g.id, pattern: g.pattern, name: g.name };
    return out;
  }

  const revised = (it: ReviewItem) => `${it.revised.before}${it.revised.fixed}${it.revised.after}`;

  const statusOk = (c: Correction, s: ReviewStatusFilter = "all") =>
    s === "all" ||
    (s === "practise" && (c.status === "open" || c.status === "retried_wrong" || c.status === "revealed")) ||
    (s === "fixed" && c.status === "retried_ok") ||
    (s === "disputed" && c.status === "disputed") ||
    (s === "not_exported" && !c.exportedAt && c.status !== "disputed");

  const source = (it: ReviewItem) => {
    const date = new Date(it.session?.at ?? it.correction.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return it.session ? `${it.session.title} · ${date}` : date;
  };

  const base = (it: ReviewItem, style: AnkiCardDraft["style"]): Omit<AnkiCardDraft, "front"> => ({
    correctionId: it.correction.id,
    style,
    back: revised(it),
    gap: it.revised.fixed,
    explanation: it.correction.explanation,
    source: source(it),
    tags: ["sayfern", `sayfern::${it.correction.kind}`, ...(it.correction.grammarId ? [it.correction.grammarId] : [])],
  });

  const hintFor = (it: ReviewItem) => {
    const c = it.correction;
    if (c.kind === "grammar" && it.grammar) return it.grammar.name;
    return GLOSS[c.corrected] ?? it.grammar?.name ?? (c.kind === "vocabulary" ? "a better word" : c.kind === "grammar" ? "grammar" : "more natural wording");
  };

  const fallbackFront = (it: ReviewItem, language: Language) => {
    const c = it.correction;
    const focus = it.grammar ? `using ${it.grammar.name}` : c.kind === "vocabulary" ? "with the right word" : "naturally";
    const topic = it.session ? ` (from "${it.session.title}")` : "";
    return `Say it in ${LANGUAGE_NAME[language]}, ${focus}${topic}. ${c.explanation.split(c.corrected).join("___")}`;
  };

  for (const c of world.corrections.values()) if (c.exportedAt) inAnki.add(`cloze:${revised(item(c))}`);

  return {
    listReviewCorrections: async (filter) => {
      await mockWait(120);
      const all = [...world.corrections.values()].filter((c) => c.language === filter.language).map(item);
      const needle = filter.search ? fold(filter.search) : "";
      const matches = all.filter(
        (it) =>
          statusOk(it.correction, filter.status) &&
          (!filter.grammarId || it.correction.grammarId === filter.grammarId) &&
          (!needle ||
            [it.sentence, revised(it), it.correction.explanation, it.session?.title, it.grammar?.pattern, it.grammar?.name].some((h) => h && fold(h).includes(needle))),
      );
      const counts: Record<ReviewKindFilter, number> = { all: matches.length, grammar: 0, vocabulary: 0, phrasing: 0 };
      for (const it of matches) counts[REVIEW_KIND[it.correction.kind]]++;
      const kind = filter.kind ?? "all";
      const grammar = new Map<string, { id: string; pattern: string; name: string; count: number }>();
      for (const it of all) {
        if (!it.grammar) continue;
        const g = grammar.get(it.grammar.id) ?? { ...it.grammar, count: 0 };
        g.count++;
        grammar.set(g.id, g);
      }
      return {
        items: matches.filter((it) => kind === "all" || REVIEW_KIND[it.correction.kind] === kind).sort((a, b) => b.correction.createdAt - a.correction.createdAt),
        counts,
        grammarPoints: [...grammar.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
        total: all.length,
      };
    },

    draftAnkiCards: async (input, model) => {
      const skipped: { correctionId: string; reason: string }[] = [];
      const items: ReviewItem[] = [];
      for (const id of input.correctionIds) {
        const c = world.corrections.get(id);
        if (!c || c.language !== input.language) skipped.push({ correctionId: id, reason: "This correction no longer exists." });
        else if (c.status === "disputed") skipped.push({ correctionId: id, reason: "You marked this one as not a mistake." });
        else items.push(item(c));
      }
      if (input.style === "cloze") {
        await mockWait(80);
        return {
          cards: items.map((it) => {
            const b = base(it, "cloze");
            const hint = hintFor(it);
            return { ...b, hint, front: clozeFront(b.back, b.gap, hint) };
          }),
          skipped,
        };
      }
      if (!model) {
        await mockWait(80);
        return {
          cards: items.map((it) => ({ ...base(it, "situation"), front: fallbackFront(it, input.language), fallback: true })),
          skipped,
          notice: "Pick a model to write situations. For now the prompts come from the explanations, so edit them before adding.",
        };
      }
      await mockWait(900 + items.length * 120);
      const cards = items.map((it): AnkiCardDraft => {
        const s = SITUATIONS[it.correction.id];
        return s ? { ...base(it, "situation"), front: s } : { ...base(it, "situation"), front: fallbackFront(it, input.language), fallback: true };
      });
      const notice = cards.some((c) => c.fallback) ? "Some prompts come from the explanations because the model's answer was unusable. Edit them before adding." : undefined;
      return { cards, skipped, ...(notice ? { notice } : {}) };
    },

    exportAnkiCards: async (input) => {
      const deck = input.deck.trim();
      if (!deck) throw new Error("Choose a deck first.");
      if (!input.cards.length) throw new Error("Select at least one correction to export.");
      const config = world.ankiConfig();
      if (!config.enabled) throw new Error("Anki is turned off. Turn it on in Settings > Anki, then try again.");
      await mockWait(900);
      if (world.ankiOffline) throw new Error("Anki didn't answer in time. On macOS this usually means App Nap paused Anki while it's in the background.");
      const at = Date.now();
      const results: ExportAnkiCardsResult["results"] = input.cards.map((card) => {
        if (!card.back.trim()) return { correctionId: card.correctionId, status: "failed", error: "The answer side is empty." };
        if (card.style === "cloze" && (!card.gap || !card.back.includes(card.gap)))
          return { correctionId: card.correctionId, status: "failed", error: "The hidden part must appear in the sentence." };
        const key = `${card.style}:${card.back}`;
        const c = world.corrections.get(card.correctionId);
        if (inAnki.has(key)) {
          if (c) c.exportedAt = at;
          return { correctionId: card.correctionId, status: "duplicate" };
        }
        inAnki.add(key);
        const id = noteId++;
        if (c) {
          c.exportedAt = at;
          c.ankiNoteIds = [...(c.ankiNoteIds ?? []), id];
        }
        return { correctionId: card.correctionId, status: "added", noteId: id };
      });
      config.exportDecks = { ...config.exportDecks, [input.language]: deck };
      const n = (s: string) => results.filter((r) => r.status === s).length;
      return { deck, added: n("added"), duplicates: n("duplicate"), failed: n("failed"), results };
    },
  };
}
