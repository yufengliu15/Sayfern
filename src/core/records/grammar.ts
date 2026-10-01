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

/** Counts, rate, state and last use from observations (current verdicts, after disputes). */
export function summarizeGrammar(point: GrammarPoint, observations: GrammarObservation[]): GrammarSummary {
  const counts: GrammarCounts = { correct: 0, incorrect: 0, uncertain: 0, unassessed: 0 };
  let state: GrammarState = "introduced";
  let lastUsedAt: number | undefined;
  for (const o of observations) {
    if (o.grammarId !== point.id) continue;
    if (o.verdict in counts) counts[o.verdict]++;
    if (o.verdict === "correct") {
      if (o.assistance === "independent") state = "independent";
      else if (state !== "independent") state = "with_help";
    }
    if (lastUsedAt === undefined || o.at > lastUsedAt) lastUsedAt = o.at;
  }
  const assessed = counts.correct + counts.incorrect;
  const summary: GrammarSummary = {
    point,
    state,
    counts,
    rate: assessed > 0 ? counts.correct / assessed : null,
  };
  if (lastUsedAt !== undefined) summary.lastUsedAt = lastUsedAt;
  return summary;
}

/** lastUsedAt desc (never-used last), then updatedAt desc. */
export function compareSummaries(a: GrammarSummary, b: GrammarSummary): number {
  const la = a.lastUsedAt ?? -Infinity;
  const lb = b.lastUsedAt ?? -Infinity;
  if (la !== lb) return lb - la;
  return b.point.updatedAt - a.point.updatedAt;
}
