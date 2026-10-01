// Core tutor tools (F-05). record_evidence and update_checkpoint are
// recording-only (S1-26, S1-27); search_library and the Anki tools (anki-tools.ts)
// return content the model needs, so the turn loop continues after them.
import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { TutorEvent, TutorTool, ToolContext, ObservationInput } from "../contracts";
import type {
  Assistance,
  CorrectionKind,
  GrammarExample,
  LevelEstimate,
  SessionMeta,
  Skill,
  SourceRef,
  Verdict,
} from "../../shared/records";
import { ankiTools } from "./anki-tools";
import type { TutorDeps } from "./deps";
import { arr, canonicalGrammarId, findOriginal, obj, oneOf, plural, str, truncate } from "./text";

/** Per-turn state the core tools read and write. */
export interface TurnState {
  session: SessionMeta;
  /** The learner message this turn answers (absent for openings). */
  userMessageId?: string;
  userText?: string;
  emit(e: TutorEvent): void;
  /** Library hits found by search_library this turn: candidate sources for the reply. */
  sources: SourceRef[];
  /** Corrections already announced this turn (a repeated call must not re-emit). */
  emittedCorrections: Set<string>;
}

const CORRECTION_KINDS: readonly CorrectionKind[] = ["grammar", "vocabulary", "phrasing", "style"];
const VERDICTS: readonly Verdict[] = ["correct", "incorrect", "uncertain", "unassessed"];
const ASSISTANCE: readonly Assistance[] = ["independent", "prompted", "corrected_retry"];
const SKILL_LIST: readonly Skill[] = ["reading", "recognition", "writing"];
const CONFIDENCE: readonly LevelEstimate["confidence"][] = ["low", "medium", "high"];

// StringEnum (plain `enum`) rather than anyOf/const: accepted by every provider, Google included.
const enumOf = <T extends readonly string[]>(values: T, description?: string) =>
  StringEnum(values, description ? { description } : undefined);

const RecordEvidenceParams = Type.Object({
  corrections: Type.Optional(
    Type.Array(
      Type.Object({
        original: Type.String({ description: "Exact substring of the learner's latest message that has the problem." }),
        corrected: Type.String({ description: "Replacement for `original`." }),
        explanation: Type.String({ description: "One short English sentence." }),
        kind: enumOf(CORRECTION_KINDS, "\"style\" = improvement, not an error."),
        grammar_id: Type.Optional(Type.String()),
      }),
    ),
  ),
  observations: Type.Optional(
    Type.Array(
      Type.Object({
        grammar_id: Type.String({ description: "\"<lang>:<ascii-slug>\"; reuse catalogue ids." }),
        pattern: Type.String({ description: "Surface pattern, e.g. 除了…还…" }),
        name: Type.String({ description: "Short English name." }),
        span: Type.String({ description: "The learner's text that attempts the pattern." }),
        verdict: enumOf(VERDICTS),
        assistance: enumOf(ASSISTANCE),
        note: Type.Optional(Type.String()),
      }),
    ),
  ),
  taught: Type.Optional(
    Type.Array(
      Type.Object({
        grammar_id: Type.String(),
        pattern: Type.String(),
        name: Type.String(),
        reading: Type.Optional(Type.String()),
        level: Type.Optional(Type.String()),
        explanation: Type.String({ description: "Plain text, a few sentences." }),
        examples: Type.Array(Type.Object({ text: Type.String(), translation: Type.String() })),
      }),
      { description: "Patterns you explained this turn." },
    ),
  ),
  level: Type.Optional(
    Type.Array(
      Type.Object({
        skill: enumOf(SKILL_LIST),
        level: Type.String({ description: "A value from the language's level scale." }),
        confidence: enumOf(CONFIDENCE),
        evidence: Type.String({ description: "One sentence." }),
      }),
    ),
  ),
});

function recordEvidence(deps: TutorDeps, turn: TurnState): TutorTool {
  return {
    name: "record_evidence",
    description:
      "Record learning evidence for this turn: corrections of the learner's latest message, grammar observations, patterns you taught, level estimates. Call it ONCE, after writing your reply. Nothing is shown to you; the app displays corrections.",
    parameters: RecordEvidenceParams,
    recordingOnly: true,
    async execute(rawArgs, ctx) {
      const args = obj(rawArgs);
      const { records } = ctx;
      const language = ctx.language;
      const pack = ctx.lang.pack(language);
      const done: string[] = [];
      const skipped: string[] = [];

      // taught → grammar points (introduced).
      let taughtCount = 0;
      for (const item of arr(args.taught).map(obj)) {
        const id = canonicalGrammarId(item.grammar_id, language, item.name);
        if (!id) continue;
        const examples: GrammarExample[] = arr(item.examples)
          .map(obj)
          .map((e) => ({ text: str(e.text), translation: str(e.translation) }))
          .filter((e) => e.text);
        await records.upsertGrammarPoint({
          id,
          language,
          pattern: str(item.pattern),
          name: str(item.name),
          reading: str(item.reading) || undefined,
          level: str(item.level) || undefined,
          explanation: str(item.explanation),
          examples,
          introduced: true,
        });
        taughtCount++;
      }
      if (taughtCount) done.push(`taught ${plural(taughtCount, "point")}`);

      // observations → grammar points (if unknown) + observations.
      const obsInputs: ObservationInput[] = [];
      const obsItems = arr(args.observations).map(obj);
      if (obsItems.length && !ctx.userMessageId) skipped.push(`${plural(obsItems.length, "observation")} (no learner message)`);
      else {
        for (const item of obsItems) {
          const id = canonicalGrammarId(item.grammar_id, language, item.name);
          const span = str(item.span);
          if (!id || !span) continue;
          const pattern = str(item.pattern);
          const name = str(item.name);
          const existing = await records.getGrammarPoint(id);
          if (!existing || (!existing.name && name)) {
            await records.upsertGrammarPoint({ id, language, pattern, name });
          }
          const input: ObservationInput = {
            grammarId: id,
            sessionId: ctx.sessionId,
            messageId: ctx.userMessageId!,
            span,
            verdict: oneOf(item.verdict, VERDICTS, "unassessed"),
            assistance: oneOf(item.assistance, ASSISTANCE, "prompted"),
          };
          const note = str(item.note);
          if (note) input.note = note;
          obsInputs.push(input);
        }
      }
      if (obsInputs.length) {
        const added = await records.recordObservations(language, obsInputs);
        if (added.length) done.push(plural(added.length, "observation"));
        const repeats = obsInputs.length - added.length;
        if (repeats) skipped.push(`${plural(repeats, "repeated observation")}`);
      }

      // corrections → stored + announced.
      const corrItems = arr(args.corrections).map(obj);
      let corrCount = 0;
      if (corrItems.length && !ctx.userMessageId) skipped.push(`${plural(corrItems.length, "correction")} (no learner message)`);
      else {
        const learnerText = turn.userText ?? "";
        let notFound = 0;
        for (const item of corrItems) {
          const original = findOriginal(learnerText, typeof item.original === "string" ? item.original : "", (s) => pack.normalize(s));
          const corrected = typeof item.corrected === "string" ? item.corrected.trim() : "";
          if (!original) {
            notFound++;
            continue;
          }
          if (original === corrected) continue;
          const gid = item.grammar_id ? canonicalGrammarId(item.grammar_id, language) : null;
          const c = await records.addCorrection({
            sessionId: ctx.sessionId,
            messageId: ctx.userMessageId!,
            original,
            corrected,
            explanation: str(item.explanation),
            kind: oneOf(item.kind, CORRECTION_KINDS, "grammar"),
            ...(gid ? { grammarId: gid } : {}),
          });
          if (!turn.emittedCorrections.has(c.id)) {
            turn.emittedCorrections.add(c.id);
            turn.emit({ type: "correction", correction: c });
            corrCount++;
          }
        }
        if (notFound) skipped.push(`${plural(notFound, "correction")} (text not found in the learner's message)`);
      }
      if (corrCount) done.unshift(plural(corrCount, "correction"));

      // level → estimates (invalid levels dropped).
      let levelCount = 0;
      let badLevels = 0;
      const scale = pack.info.levels;
      for (const item of arr(args.level).map(obj)) {
        const skill = oneOf(item.skill, SKILL_LIST, "" as Skill);
        const level = matchLevel(str(item.level), scale);
        if (!skill || !level) {
          badLevels++;
          continue;
        }
        await records.recordLevel({
          language,
          skill,
          level,
          confidence: oneOf(item.confidence, CONFIDENCE, "low"),
          evidence: str(item.evidence),
          examples: ctx.userMessageId ? [{ kind: "session", sessionId: ctx.sessionId, messageId: ctx.userMessageId }] : [],
          at: deps.now(),
          by: turn.session.kind === "placement" ? "placement" : "observed",
        });
        levelCount++;
      }
      if (levelCount) done.push(plural(levelCount, "level estimate"));
      if (badLevels) skipped.push(`${plural(badLevels, "level estimate")} (not on the ${scale[0]}…${scale[scale.length - 1]} scale)`);

      let activity = done.length ? `Logged ${done.join(", ")}` : "Nothing new to log";
      if (skipped.length) activity += `; skipped ${skipped.join(", ")}`;
      const content = skipped.length ? `Recorded. Skipped ${skipped.join(", ")}.` : "Recorded.";
      return { content, activity };
    },
  };
}

/** Map a model-written level onto the scale ("hsk3" → "HSK 3"), or null. */
export function matchLevel(level: string, scale: readonly string[]): string | null {
  const key = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
  const k = key(level);
  if (!k) return null;
  return scale.find((s) => key(s) === k) ?? null;
}

function searchLibrary(turn: TurnState): TutorTool {
  return {
    name: "search_library",
    description:
      "Search the learner's own library (textbooks, readers, personal notes) for a word or pattern. Use it to ground explanations in their materials.",
    parameters: Type.Object({
      query: Type.String({ description: "Word, phrase or pattern in the target language." }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
    }),
    recordingOnly: false,
    async execute(rawArgs, ctx) {
      const args = obj(rawArgs);
      const query = str(args.query);
      if (!query) return { content: "Give a non-empty query.", activity: "Searched library: (empty query)" };
      const limit = Math.min(8, Math.max(1, Math.floor(Number(args.limit)) || 4));
      const hits = await ctx.library.search(ctx.language, query, limit);
      for (const h of hits) {
        if (turn.sources.some((s) => s.kind === "library" && s.docId === h.docId && s.paragraph === h.paragraph)) continue;
        turn.sources.push({ kind: "library", docId: h.docId, paragraph: h.paragraph, title: h.title, quote: truncate(h.text, 80) });
      }
      const activity = `Searched library: ${query} (${plural(hits.length, "hit")})`;
      if (hits.length === 0) return { content: "No matches in the learner's library.", activity };
      const content = hits.map((h) => `[doc ${h.docId} ¶${h.paragraph}] ${h.title} — ${h.text}`).join("\n");
      return { content, activity };
    },
  };
}

function updateCheckpoint(session: SessionMeta): TutorTool {
  return {
    name: "update_checkpoint",
    description: "Move the learner's reading checkpoint to a paragraph (the ¶ number) once they have clearly finished the previous one.",
    parameters: Type.Object({ paragraph: Type.Integer({ minimum: 0 }) }),
    recordingOnly: true,
    async execute(rawArgs, ctx) {
      const paragraph = Math.floor(Number(obj(rawArgs).paragraph));
      if (!session.docId) throw new Error("This is not a reading session.");
      if (!Number.isFinite(paragraph)) throw new Error("paragraph must be a whole number.");
      await ctx.library.setCheckpoint(session.docId, paragraph, 0);
      return { content: `Checkpoint saved at ¶${paragraph}.`, activity: `Moved reading checkpoint to ¶${paragraph}` };
    },
  };
}

/**
 * Core tools for one turn, plus extension tools. update_checkpoint only in reading
 * sessions; the Anki tools only when Anki is on and the language has a snapshot.
 */
export function turnTools(deps: TutorDeps, turn: TurnState, opts: { anki?: boolean } = {}): TutorTool[] {
  const tools: TutorTool[] = [recordEvidence(deps, turn), searchLibrary(turn)];
  if (opts.anki) tools.push(...ankiTools(deps));
  if (turn.session.kind === "reading" && turn.session.docId) tools.push(updateCheckpoint(turn.session));
  const names = new Set(tools.map((t) => t.name));
  for (const t of deps.extensions?.tools() ?? []) {
    if (names.has(t.name)) continue; // core tools win on name clashes
    names.add(t.name);
    tools.push(t);
  }
  return tools;
}

export function toolContext(deps: TutorDeps, turn: TurnState): ToolContext {
  return {
    sessionId: turn.session.id,
    language: turn.session.language,
    ...(turn.userMessageId ? { userMessageId: turn.userMessageId } : {}),
    records: deps.records,
    library: deps.library,
    anki: deps.anki,
    lang: deps.lang,
  };
}
