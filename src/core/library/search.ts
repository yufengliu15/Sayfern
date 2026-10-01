// CJK-aware keyword search: character bigrams + single characters for CJK
// runs, lowercase words for everything else, BM25 ranking.

const CJK_WORD = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆〇]/u;
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

/** Weight of single CJK characters relative to bigrams and words. */
export const UNIGRAM_WEIGHT = 0.3;
const K1 = 1.2;
const B = 0.75;

export function isCjkWordChar(ch: string): boolean {
  return CJK_WORD.test(ch);
}

export function isUnigramTerm(term: string): boolean {
  const cps = Array.from(term);
  return cps.length === 1 && isCjkWordChar(cps[0]);
}

/** Search terms of a text, in order, with repeats. */
export function tokenizeForSearch(text: string): string[] {
  const terms: string[] = [];
  const cps = Array.from(text.normalize("NFKC").toLowerCase());
  let run: string[] = [];
  let word = "";
  const endRun = () => {
    for (let i = 0; i < run.length; i++) {
      terms.push(run[i]);
      if (i + 1 < run.length) terms.push(run[i] + run[i + 1]);
    }
    run = [];
  };
  const endWord = () => {
    if (word) terms.push(word);
    word = "";
  };
  for (const ch of cps) {
    if (isCjkWordChar(ch)) {
      endWord();
      run.push(ch);
    } else if (WORD_CHAR.test(ch)) {
      endRun();
      word += ch;
    } else {
      endRun();
      endWord();
    }
  }
  endRun();
  endWord();
  return terms;
}

/** Stored per document in index.json. */
export interface DocIndex {
  v: 1;
  /** Token count per paragraph. */
  lens: number[];
  /** term → flattened [paragraph, termFrequency, paragraph, termFrequency, …]. */
  postings: Record<string, number[]>;
}

export function buildIndex(paragraphs: { text: string }[]): DocIndex {
  const lens: number[] = [];
  const postings: Record<string, number[]> = Object.create(null) as Record<string, number[]>;
  paragraphs.forEach((p, i) => {
    const terms = tokenizeForSearch(p.text);
    lens.push(terms.length);
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t, n] of tf) (postings[t] ??= []).push(i, n);
  });
  return { v: 1, lens, postings };
}

function postingsOf(index: DocIndex, term: string): number[] | undefined {
  // Own properties only: terms like "constructor" must not hit Object.prototype.
  return Object.hasOwn(index.postings, term) ? index.postings[term] : undefined;
}

export interface ScoredParagraph {
  docId: string;
  paragraph: number;
  score: number;
}

/** BM25 over every paragraph of the given documents, treated as one collection. */
export function rankBm25(indexes: { docId: string; index: DocIndex }[], query: string): ScoredParagraph[] {
  const qterms = [...new Set(tokenizeForSearch(query))];
  if (qterms.length === 0) return [];
  let total = 0;
  let totalLen = 0;
  for (const { index } of indexes) {
    total += index.lens.length;
    for (const l of index.lens) totalLen += l;
  }
  if (total === 0) return [];
  const avg = totalLen / total || 1;

  const scores = new Map<string, ScoredParagraph>();
  for (const term of qterms) {
    let df = 0;
    for (const { index } of indexes) {
      const post = postingsOf(index, term);
      if (post) df += post.length / 2;
    }
    if (df === 0) continue;
    const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
    const w = isUnigramTerm(term) ? UNIGRAM_WEIGHT : 1;
    for (const { docId, index } of indexes) {
      const post = postingsOf(index, term);
      if (!post) continue;
      for (let k = 0; k < post.length; k += 2) {
        const p = post[k];
        const tf = post[k + 1];
        const len = index.lens[p] ?? avg;
        const s = (w * idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / avg));
        const key = `${docId}\u0000${p}`;
        const hit = scores.get(key);
        if (hit) hit.score += s;
        else scores.set(key, { docId, paragraph: p, score: s });
      }
    }
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}

/**
 * Trims `text` to about `max` characters centered on the best match of the
 * query (the whole query, else its longest term), adding "…" where cut.
 */
export function snippet(text: string, query: string, max = 300): string {
  const cps = Array.from(text);
  if (cps.length <= max) return text;
  const lower = text.toLowerCase();
  const q = query.normalize("NFKC").toLowerCase().trim();
  const candidates = [q, ...[...new Set(tokenizeForSearch(query))].sort((a, b) => Array.from(b).length - Array.from(a).length)];
  let at = -1;
  let matchLen = 0;
  for (const c of candidates) {
    if (!c) continue;
    const i = lower.indexOf(c);
    if (i >= 0) {
      at = Array.from(text.slice(0, i)).length;
      matchLen = Array.from(c).length;
      break;
    }
  }
  const center = at < 0 ? 0 : at + Math.floor(matchLen / 2);
  let start = Math.max(0, center - Math.floor(max / 2));
  const end = Math.min(cps.length, start + max);
  start = Math.max(0, end - max);
  return `${start > 0 ? "…" : ""}${cps.slice(start, end).join("").trim()}${end < cps.length ? "…" : ""}`;
}

/** Whole-query phrase bonus applied after BM25 (helps multi-term latin queries). */
export function phraseBonus(text: string, query: string): number {
  const q = query.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  if (!q || tokenizeForSearch(q).length < 2) return 1;
  const t = text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
  return t.includes(q) ? 1.25 : 1;
}
