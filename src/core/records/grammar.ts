// Grammar point merging and locally-derived summaries (S1-15..S1-20, S1-25).
import type {
  GrammarCounts,
  GrammarObservation,
  GrammarPoint,
  GrammarState,
  GrammarSummary,
  Language,
  SourceRef,
} from "../../shared/records";
import type { GrammarPointInput } from "../contracts";

function filled(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function sourceKey(s: SourceRef): string {
  return s.kind === "library" ? `library:${s.docId}:${s.paragraph}` : `session:${s.sessionId}:${s.messageId}`;
}

export function unionSources(a: SourceRef[], b: SourceRef[]): SourceRef[] {
  const seen = new Set(a.map(sourceKey));
  const out = [...a];
  for (const s of b) {
    const k = sourceKey(s);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

export function newGrammarPoint(input: GrammarPointInput, now: number): GrammarPoint {
  const p: GrammarPoint = {
    id: input.id,
    language: input.language,
    pattern: input.pattern ?? "",
    name: input.name ?? "",
    explanation: input.explanation ?? "",
    examples: input.examples ? structuredClone(input.examples) : [],
    sources: input.sources ? unionSources([], input.sources) : [],
    createdAt: now,
    updatedAt: now,
  };
  if (filled(input.reading)) p.reading = input.reading;
  if (filled(input.level)) p.level = input.level;
  if (input.introduced) p.introducedAt = now;
  return p;
}

/** Merge an upsert into an existing point in place: empty values never wipe stored ones. */
export function mergeGrammarPoint(p: GrammarPoint, input: GrammarPointInput, now: number): void {
  if (filled(input.pattern)) p.pattern = input.pattern;
  if (filled(input.name)) p.name = input.name;
  if (filled(input.reading)) p.reading = input.reading;
  if (filled(input.level)) p.level = input.level;
  if (filled(input.explanation)) p.explanation = input.explanation;
  if (input.examples && input.examples.length > 0) p.examples = structuredClone(input.examples);
  if (input.sources && input.sources.length > 0) p.sources = unionSources(p.sources, input.sources);
  if (input.introduced && p.introducedAt === undefined) p.introducedAt = now;
  p.updatedAt = now;
}

/** Placeholder so an observation of an unknown point is never dropped. */
export function stubGrammarPoint(id: string, language: Language, now: number): GrammarPoint {
  const colon = id.indexOf(":");
  return {
    id,
    language,
    pattern: colon >= 0 ? id.slice(colon + 1) : id,
    name: "",
    explanation: "",
    examples: [],
    sources: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Stage 2 (S2-09): evidence from a quiz answer rather than from conversation. */
export function isQuizObservation(o: Pick<GrammarObservation, "origin" | "sessionId">): boolean {
  return o.origin === "quiz" || o.sessionId.startsWith("quiz:");
}

function emptyCounts(): GrammarCounts {
  return { correct: 0, incorrect: 0, uncertain: 0, unassessed: 0 };
}

function rateOf(c: GrammarCounts): number | null {
  const assessed = c.correct + c.incorrect;
  return assessed > 0 ? c.correct / assessed : null;
}

/**
 * Counts, rate, state and last use from observations (current verdicts, after disputes).
 * Quiz evidence (S2-09) is counted apart in `quiz` and never feeds `counts`, `rate` or
 * `lastUsedAt` (spontaneous use). A correct quiz answer is prompted practice: it can move a
 * point to "with_help" but never to "independent", whatever its assistance says.
 */
export function summarizeGrammar(point: GrammarPoint, observations: GrammarObservation[]): GrammarSummary {
  const counts = emptyCounts();
  const quizCounts = emptyCounts();
  let quizLast: number | undefined;
  let state: GrammarState = "introduced";
  let lastUsedAt: number | undefined;
  for (const o of observations) {
    if (o.grammarId !== point.id) continue;
    if (isQuizObservation(o)) {
      if (o.verdict in quizCounts) quizCounts[o.verdict]++;
      if (o.verdict === "correct" && state === "introduced") state = "with_help";
      if (quizLast === undefined || o.at > quizLast) quizLast = o.at;
      continue;
    }
    if (o.verdict in counts) counts[o.verdict]++;
    if (o.verdict === "correct") {
      if (o.assistance === "independent") state = "independent";
      else if (state !== "independent") state = "with_help";
    }
    if (lastUsedAt === undefined || o.at > lastUsedAt) lastUsedAt = o.at;
  }
  const summary: GrammarSummary = {
    point,
    state,
    counts,
    rate: rateOf(counts),
  };
  if (lastUsedAt !== undefined) summary.lastUsedAt = lastUsedAt;
  if (quizLast !== undefined) summary.quiz = { counts: quizCounts, rate: rateOf(quizCounts), lastAt: quizLast };
  return summary;
}

/** lastUsedAt desc (never-used last), then updatedAt desc. */
export function compareSummaries(a: GrammarSummary, b: GrammarSummary): number {
  const la = a.lastUsedAt ?? -Infinity;
  const lb = b.lastUsedAt ?? -Infinity;
  if (la !== lb) return lb - la;
  return b.point.updatedAt - a.point.updatedAt;
}
