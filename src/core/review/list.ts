// Review list (S2-01, S2-02): pure helpers that turn stored corrections into review items,
// filter them and count them. Counts are computed here, never by a model (S1-25).
import type { ChatMessage, Correction, GrammarPoint, SessionMeta } from "../../shared/records";
import {
  type ReviewFilter,
  type ReviewItem,
  type ReviewKindFilter,
  type ReviewList,
  type ReviewStatusFilter,
} from "../../shared/stage2";

const SENTENCE_END = /[。！？!?\n]/;

/** The sentence of `text` around `offset` (keeps its terminator). Same rule as the renderer's sentenceAt. */
export function sentenceAt(text: string, offset: number): string {
  let a = offset;
  while (a > 0 && !SENTENCE_END.test(text[a - 1])) a--;
  let b = offset;
  while (b < text.length && !SENTENCE_END.test(text[b])) b++;
  if (b < text.length && text[b] !== "\n") b++;
  return text.slice(a, b).trim();
}

/** The learner sentence holding the problem, and that sentence with the fix applied. */
export function sentenceAndRevision(c: Pick<Correction, "original" | "corrected">, messageText?: string): Pick<ReviewItem, "sentence" | "revised"> {
  const idx = messageText && c.original ? messageText.indexOf(c.original) : -1;
  if (!messageText || idx < 0) return { sentence: c.original, revised: { before: "", fixed: c.corrected, after: "" } };
  const sentence = sentenceAt(messageText, idx);
  const at = sentence.indexOf(c.original);
  if (at < 0) return { sentence: c.original, revised: { before: "", fixed: c.corrected, after: "" } };
  return {
    sentence,
    revised: { before: sentence.slice(0, at), fixed: c.corrected, after: sentence.slice(at + c.original.length) },
  };
}

export const revisedText = (r: ReviewItem["revised"]): string => `${r.before}${r.fixed}${r.after}`;

export function buildItem(
  c: Correction,
  messages: ChatMessage[] | undefined,
  session: SessionMeta | null | undefined,
  grammar: GrammarPoint | null | undefined,
): ReviewItem {
  const text = messages?.find((m) => m.id === c.messageId)?.text;
  const item: ReviewItem = { correction: c, ...sentenceAndRevision(c, text) };
  if (session) item.session = { id: session.id, title: session.title, kind: session.kind, at: session.createdAt };
  if (grammar) item.grammar = { id: grammar.id, pattern: grammar.pattern, name: grammar.name };
  return item;
}

export function matchesStatus(c: Correction, status: ReviewStatusFilter = "all"): boolean {
  switch (status) {
    case "practise":
      return c.status === "open" || c.status === "retried_wrong" || c.status === "revealed";
    case "fixed":
      return c.status === "retried_ok";
    case "disputed":
      return c.status === "disputed";
    case "not_exported":
      return !c.exportedAt && c.status !== "disputed";
    default:
      return true;
  }
}

const fold = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

export function matchesSearch(item: ReviewItem, search?: string): boolean {
  const needle = search ? fold(search) : "";
  if (!needle) return true;
  const c = item.correction;
  const hay = [item.sentence, revisedText(item.revised), c.original, c.corrected, c.explanation, item.session?.title, item.grammar?.pattern, item.grammar?.name];
  return hay.some((h) => h && fold(h).includes(needle));
}

/** Filters, sorts newest first and counts per chip. `items` are all corrections of one language. */
export function reviewList(items: ReviewItem[], filter: ReviewFilter): ReviewList {
  const kind: ReviewKindFilter = filter.kind ?? "all";
  const base = items.filter(
    (it) =>
      matchesStatus(it.correction, filter.status) &&
      (!filter.grammarId || it.correction.grammarId === filter.grammarId) &&
      matchesSearch(it, filter.search),
  );
  const counts: Record<ReviewKindFilter, number> = { all: base.length, grammar: 0, typo: 0, speaking: 0 };
  for (const it of base) counts[it.correction.kind]++;

  const grammar = new Map<string, { id: string; pattern: string; name: string; count: number }>();
  for (const it of items) {
    if (!it.grammar) continue;
    const g = grammar.get(it.grammar.id) ?? { ...it.grammar, count: 0 };
    g.count++;
    grammar.set(g.id, g);
  }

  const shown = base
    .filter((it) => kind === "all" || it.correction.kind === kind)
    .sort((a, b) => b.correction.createdAt - a.correction.createdAt || b.correction.id.localeCompare(a.correction.id));
  return {
    items: shown,
    counts,
    grammarPoints: [...grammar.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
    total: items.length,
  };
}
