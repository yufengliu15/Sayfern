// Configurable quizzes (S2-04..S2-09). Implements QuizApi.
//
// Flow: startQuiz gathers material locally, stores a "generating" quiz and generates in the
// background (abortable); the renderer polls getQuiz. Fixed formats are graded here, open answers
// by the model. finishQuiz scores locally and records grammar evidence marked as quiz practice
// (origin "quiz", sessionId "quiz:<id>", assistance "prompted"), which grammar.ts counts apart from
// conversation and never lets reach "independent".
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { GrammarSummary, Language } from "../../shared/records";
import { LANGUAGES } from "../../shared/records";
import { fill, msg, type Translator } from "../../shared/i18n";
import { LANGUAGE_META } from "../../shared/languages";
import type {
  QuizAnswer,
  QuizApi,
  QuizChapter,
  QuizEstimate,
  QuizFocus,
  QuizFormat,
  QuizFormatChoice,
  QuizListItem,
  QuizOptions,
  QuizSource,
  QuizSpec,
  QuizSummary,
  QuizView,
} from "../../shared/stage2";
import { QUIZ_MAX_QUESTIONS } from "../../shared/stage2";
import type { ModelRef } from "../../shared/types";
import { isStruggling } from "../anki/words";
import { countableCorrection } from "../records/corrections";
import { type Stage2Deps, translatorFor, explanationFor } from "../stage2";
import { minutesFor, planFormats, questionCount } from "./estimate";
import { FEEDBACK, gradeLocal, gradeOpen, isLocallyGraded } from "./grade";
import { generateItems, GenerationError, planSlots } from "./generate";
import { GAP, QUIZ_FORMATS, seededRandom, shuffle, shuffleTiles, type QuizItem, toQuestion } from "./items";
import { catalogueAtLevel, examShort, examsFor, isValidExamLevel, resolveLevel, type ResolvedLevel } from "./levels";
import {
  ankiWords,
  chaptersOf,
  gatherMaterial,
  materialSize,
  needsWork,
  selectAnki,
  toGrammar,
  type PastQuizMistake,
} from "./material";
import { QuizStore, type QuizFile } from "./store";

export { QuizStore } from "./store";
export type { QuizFile } from "./store";

const FOCI: readonly QuizFocus[] = ["grammar", "vocabulary", "scenarios", "exam", "mixed"];
const FORMAT_CHOICES: readonly QuizFormatChoice[] = [...QUIZ_FORMATS, "mixed"];
const SOURCE_KINDS: readonly QuizSource["kind"][] = ["mistakes", "anki", "grammar", "document", "targets", "saved_words"];
const DAY = 24 * 60 * 60 * 1000;

export const FOCUS_LABEL: Record<QuizFocus, string> = {
  grammar: msg("Grammar"),
  vocabulary: msg("Vocabulary"),
  scenarios: msg("Scenarios"),
  exam: msg("Exam prep"),
  mixed: msg("Mixed"),
};

export const FORMAT_LABEL: Record<QuizFormatChoice, string> = {
  multiple_choice: msg("multiple choice"),
  cloze: msg("fill the gap"),
  ordering: msg("sentence order"),
  written: msg("written answers"),
  scenario: msg("role-play"),
  mixed: msg("mixed"),
};

/** Quiz evidence pseudo-session id (S2-09). */
export const quizSessionId = (quizId: string): string => `quiz:${quizId}`;

function languageName(language: Language): string {
  return LANGUAGE_META[language]?.name ?? language;
}

/** English stand-in when no translator is passed (tests). */
const EN: Pick<Translator, "t"> = { t: (en, vars) => fill(en, vars) };

/** Cleans a spec from the renderer: unknown values fall back, lengths are bounded. Throws on a bad language. */
export function sanitizeSpec(raw: QuizSpec): QuizSpec {
  if (!raw || !(LANGUAGES as readonly string[]).includes(raw.language)) throw new Error("Pick a language for the quiz.");
  const focus = FOCI.includes(raw.focus) ? raw.focus : "mixed";
  const format = FORMAT_CHOICES.includes(raw.format) ? raw.format : "mixed";
  const sources: QuizSource[] = [];
  for (const s of Array.isArray(raw.sources) ? raw.sources : []) {
    if (!s || !SOURCE_KINDS.includes(s.kind)) continue;
    const clean: QuizSource = { kind: s.kind };
    if (s.kind === "anki") clean.anki = s.anki === "struggling" || s.anki === "all" ? s.anki : "recent";
    if (s.kind === "grammar" && Array.isArray(s.grammarIds)) clean.grammarIds = s.grammarIds.filter((x) => typeof x === "string").slice(0, 30);
    if (s.kind === "document") {
      if (typeof s.docId !== "string" || !s.docId) continue;
      clean.docId = s.docId;
      if (typeof s.chapter === "string" && s.chapter.trim()) clean.chapter = s.chapter.trim();
    }
    sources.push(clean);
  }
  const level = raw.level?.kind === "exam" && isValidExamLevel(raw.language, raw.level) ? { kind: "exam" as const, exam: raw.level.exam, level: raw.level.level } : { kind: "current" as const };
  const len = raw.length as { questions?: unknown; minutes?: unknown } | undefined;
  const length =
    len && typeof len.minutes === "number" && Number.isFinite(len.minutes)
      ? { minutes: Math.max(1, Math.min(60, Math.round(len.minutes))) }
      : { questions: typeof len?.questions === "number" && Number.isFinite(len.questions) ? Math.round(len.questions) : 10 };
  return { language: raw.language, focus, sources, level, format, length };
}

function sourceLabel(s: QuizSource, grammar: Map<string, string>, docTitle: (id: string) => string | undefined, tr: Pick<Translator, "t">): string {
  switch (s.kind) {
    case "mistakes":
      return tr.t("my mistakes");
    case "anki":
      return s.anki === "struggling" ? tr.t("hard Anki words") : s.anki === "all" ? tr.t("my Anki words") : tr.t("this week's Anki");
    case "grammar": {
      const ids = s.grammarIds ?? [];
      if (ids.length === 1) return grammar.get(ids[0]) ?? tr.t("one grammar point");
      return ids.length ? tr.t("{n} grammar points", { n: ids.length }) : tr.t("grammar to work on");
    }
    case "document": {
      const t = (s.docId && docTitle(s.docId)) || tr.t("a document");
      return s.chapter ? `${t}, ${s.chapter}` : t;
    }
    case "targets":
      return tr.t("my goals");
    case "saved_words":
      return tr.t("saved words");
  }
}

/** "Grammar · my mistakes", "HSK 3 style · mixed". Computed locally, in the interface language. */
export function quizTitle(spec: QuizSpec, grammar: Map<string, string>, docTitle: (id: string) => string | undefined, tr: Pick<Translator, "t"> = EN): string {
  if (spec.level.kind === "exam") {
    return `${tr.t("{exam} style", { exam: examShort(spec.level.exam, spec.level.level) })} · ${tr.t(FORMAT_LABEL[spec.format])}`;
  }
  const src = spec.sources.map((s) => sourceLabel(s, grammar, docTitle, tr)).join(", ") || tr.t("anything at my level");
  return `${tr.t(FOCUS_LABEL[spec.focus])} · ${src}`;
}

export function summarize(q: Pick<QuizFile, "items" | "grammarLabels">): QuizSummary {
  const s: QuizSummary = { total: q.items.length, answered: 0, correct: 0, incorrect: 0, uncertain: 0, grammar: [], review: [] };
  const byGrammar = new Map<string, QuizSummary["grammar"][number]>();
  for (const it of q.items) {
    const a = it.answered;
    if (!a) continue;
    s.answered++;
    s[a.verdict]++;
    if (a.verdict !== "correct") s.review.push(it.id);
    if (it.grammarId) {
      let g = byGrammar.get(it.grammarId);
      if (!g) {
        g = { grammarId: it.grammarId, label: q.grammarLabels[it.grammarId] ?? it.grammarId, correct: 0, incorrect: 0, uncertain: 0 };
        byGrammar.set(it.grammarId, g);
      }
      g[a.verdict]++;
    }
  }
  s.grammar = [...byGrammar.values()];
  return s;
}

export function toView(q: QuizFile): QuizView {
  const v: QuizView = {
    id: q.id,
    language: q.language,
    title: q.title,
    spec: structuredClone(q.spec),
    status: q.status,
    createdAt: q.createdAt,
    alignment: q.alignment,
    provenance: q.provenance,
    generated: true,
    minutes: q.items.length ? minutesFor(q.items.map((i) => i.format)) : minutesFor(planFormats(q.spec.focus, q.spec.format, questionCount(q.spec.focus, q.spec.format, q.spec.length))),
    questions: q.items.map((it, i) => toQuestion(it, i, q.grammarLabels)),
    summary: summarize(q),
  };
  if (q.finishedAt) v.finishedAt = q.finishedAt;
  if (q.error) v.error = q.error;
  if (q.model) v.model = q.model;
  if (q.exam) v.exam = q.exam;
  if (q.retryOf) v.retryOf = q.retryOf;
  return v;
}

/** The sentence the learner produced, for grammar evidence. */
export function evidenceSpan(item: QuizItem): string {
  const r = item.answered?.response ?? "";
  if ((item.format === "cloze" || item.format === "multiple_choice") && item.text?.includes(GAP)) return item.text.replace(GAP, r);
  return r;
}

export class QuizService implements QuizApi {
  readonly store: QuizStore;
  private readonly inflight = new Map<string, AbortController>();
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly grading = new Set<string>();

  constructor(private readonly deps: Stage2Deps) {
    this.store = new QuizStore(join(deps.records.dataDir, "quizzes"));
  }

  // ------------------------------------------------------------ builder

  private async currentLevel(language: Language): Promise<string | null> {
    const { current } = await this.deps.records.getLevels(language);
    return current.writing?.level ?? current.recognition?.level ?? current.reading?.level ?? null;
  }

  private async pastMistakes(language: Language): Promise<PastQuizMistake[]> {
    const out: PastQuizMistake[] = [];
    for (const q of await this.store.all()) {
      if (q.language !== language) continue;
      for (const it of q.items) if (it.answered && it.answered.verdict === "incorrect" && !it.answered.revealed) out.push({ item: it, at: it.answered.at });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  async quizOptions(language: Language): Promise<QuizOptions> {
    if (!(LANGUAGES as readonly string[]).includes(language)) throw new Error("Unknown language.");
    const { records, library } = this.deps;
    const [corrections, grammar, saved, docs, anki, profile, past, level] = await Promise.all([
      records.listCorrections({ language }),
      records.listGrammar(language),
      records.listSavedWords(language),
      library.listDocs(language),
      ankiWords(this.deps, language),
      records.getProfile(),
      this.pastMistakes(language),
      this.currentLevel(language),
    ]);
    const now = this.deps.now();
    const recent = selectAnki(anki.words, "recent", now).length;
    const toWork = grammar.filter((g) => g.state !== "independent").length;
    const goal = profile.goals?.[language]?.trim();
    const options: QuizOptions = {
      language,
      counts: {
        mistakes: corrections.filter(countableCorrection).length + past.length,
        ankiRecent: recent,
        ankiStruggling: anki.words.filter(isStruggling).length,
        ankiAll: anki.words.filter((w) => w.status !== "new" && w.status !== "suspended").length,
        savedWords: saved.length,
        grammar: grammar.length,
        grammarToWork: grammar.filter(needsWork).length,
        targets: (goal ? 1 : 0) + Math.min(5, toWork) + Math.min(6, recent),
      },
      ankiSyncedAt: anki.syncedAt,
      ankiEnabled: anki.enabled,
      grammar: grammar.map((g) => ({ id: g.point.id, pattern: g.point.pattern, name: g.point.name, state: g.state, ...(g.point.level ? { level: g.point.level } : {}) })),
      docs: docs.filter((d) => d.paragraphCount > 0 && d.kind !== "personal").map((d) => ({ docId: d.id, title: d.title, kind: d.kind, paragraphs: d.paragraphCount })),
      currentLevel: level,
      exams: examsFor(language),
    };
    if (goal) options.goal = goal;
    return options;
  }

  async quizChapters(docId: string): Promise<QuizChapter[]> {
    const doc = await this.deps.library.getDoc(docId);
    if (!doc) return [];
    return chaptersOf(await this.deps.library.getParagraphs(docId, 0, doc.paragraphCount));
  }

  private async resolve(spec: QuizSpec): Promise<{ count: number; formats: QuizFormat[]; level: ResolvedLevel }> {
    const count = questionCount(spec.focus, spec.format, spec.length);
    const formats = planFormats(spec.focus, spec.format, count);
    const level = resolveLevel(spec.language, spec.level, await this.currentLevel(spec.language), await translatorFor(this.deps));
    return { count, formats, level };
  }

  async estimateQuiz(rawSpec: QuizSpec): Promise<QuizEstimate> {
    const spec = sanitizeSpec(rawSpec);
    const { count, formats, level } = await this.resolve(spec);
    const out: QuizEstimate = { questions: count, minutes: minutesFor(formats), alignment: level.alignment, provenance: level.provenance };
    if (level.exam) out.exam = level.exam;
    return out;
  }

  // ------------------------------------------------------------ generation

  async startQuiz(rawSpec: QuizSpec, modelRef: ModelRef): Promise<QuizView> {
    const spec = sanitizeSpec(rawSpec);
    // No sources = "anything at this level": only for exam practice.
    if (spec.sources.length === 0 && spec.focus !== "exam" && spec.level.kind !== "exam") throw new Error("Pick what to quiz you on first.");
    const model = this.deps.resolveModel(modelRef);
    const { language } = spec;
    const grammar = await this.deps.records.listGrammar(language);
    const material = await gatherMaterial(this.deps, spec, await this.pastMistakes(language), grammar);
    if (materialSize(material) === 0 && spec.sources.length > 0 && spec.focus !== "exam") {
      throw new Error(material.empty[0] ?? "There's nothing to quiz you on from that source yet.");
    }
    const { formats, level } = await this.resolve(spec);
    const labels = new Map(grammar.map((g) => [g.point.id, g.point.pattern]));
    const docTitles = new Map((await this.deps.library.listDocs(language)).map((d) => [d.id, d.title]));
    const id = this.deps.newId();
    const file: QuizFile = {
      v: 1,
      id,
      language,
      title: quizTitle(spec, labels, (d) => docTitles.get(d), await translatorFor(this.deps)),
      spec,
      status: "generating",
      createdAt: this.deps.now(),
      model: `${model.provider}/${model.id}`,
      alignment: level.alignment,
      provenance: level.provenance,
      items: [],
      grammarLabels: Object.fromEntries(grammar.map((g) => [g.point.id, g.point.pattern])),
    };
    if (level.exam) file.exam = level.exam;
    if (level.level) file.level = level.level;
    // Register the generation before the file exists, so readers never see an orphan "generating" quiz.
    const ctrl = new AbortController();
    this.inflight.set(id, ctrl);
    try {
      await this.store.create(file);
    } catch (err) {
      this.inflight.delete(id);
      throw err;
    }
    const catalogue = catalogueAtLevel(language, grammar, level.level, 14).map(toGrammar);
    const job = this.generate(id, { spec, model, material, catalogue, formats, level, grammar, signal: ctrl.signal }).finally(() => {
      if (this.inflight.get(id) === ctrl) this.inflight.delete(id);
      this.jobs.delete(id);
    });
    this.jobs.set(id, job);
    return toView(file);
  }

  /** Resolves when generation for `quizId` (if any) has finished. For tests and shutdown. */
  async whenGenerated(quizId: string): Promise<QuizView | null> {
    await this.jobs.get(quizId);
    return this.getQuiz(quizId);
  }

  private async generate(
    id: string,
    input: {
      spec: QuizSpec;
      model: Model<Api>;
      material: Awaited<ReturnType<typeof gatherMaterial>>;
      catalogue: ReturnType<typeof toGrammar>[];
      formats: QuizFormat[];
      level: ResolvedLevel;
      grammar: GrammarSummary[];
      signal: AbortSignal;
    },
  ): Promise<void> {
    const { spec, signal } = input;
    try {
      const pack = this.deps.lang.pack(spec.language);
      await pack.ready();
      const slots = planSlots(spec.focus, input.formats, input.material);
      const result = await generateItems({
        models: this.deps.models,
        model: input.model,
        language: spec.language,
        languageName: pack.info.name || languageName(spec.language),
        explain: await explanationFor(this.deps),
        level: input.level,
        focus: spec.focus,
        material: input.material,
        catalogue: input.catalogue,
        slots,
        ctx: {
          language: spec.language,
          normalize: (s) => pack.normalize(s),
          segment: (s) => pack.segment(s),
          grammarIds: new Set(input.grammar.map((g) => g.point.id)),
          correctionIds: new Set(input.material.mistakes.map((m) => m.correctionId).filter((x): x is string => !!x)),
          random: seededRandom(id),
        },
        now: this.deps.now,
        signal,
      });
      if (signal.aborted) return;
      const minimum = Math.max(2, Math.ceil(slots.length / 2));
      if (result.items.length < minimum) {
        throw new GenerationError(
          result.items.length === 0
            ? "The model didn't return any usable questions. Try again, or pick another model."
            : `The model returned only ${result.items.length} usable ${result.items.length === 1 ? "question" : "questions"}. Try again, or pick another model.`,
        );
      }
      const items: QuizItem[] = result.items.slice(0, QUIZ_MAX_QUESTIONS).map((it, i) => ({ ...it, id: `${id}-q${i + 1}` }));
      await this.store.update(id, (q) => {
        q.items = items;
        q.status = "ready";
      });
    } catch (err) {
      if (signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      await this.store
        .update(id, (q) => {
          q.status = "failed";
          q.error = message || "Couldn't write this quiz.";
        })
        .catch(() => undefined);
    }
  }

  async cancelQuizGeneration(quizId: string): Promise<void> {
    const ctrl = this.inflight.get(quizId);
    if (ctrl) {
      ctrl.abort();
      this.inflight.delete(quizId);
    }
    const q = await this.store.get(quizId);
    if (q && (q.status === "generating" || q.status === "failed")) await this.store.remove(quizId);
  }

  // ------------------------------------------------------------ reading

  async getQuiz(quizId: string): Promise<QuizView | null> {
    const q = await this.store.get(quizId);
    if (!q) return null;
    if (q.status === "generating" && !this.inflight.has(quizId)) {
      // The app quit while generating: say so instead of spinning forever.
      const updated = await this.store.update(quizId, (f) => {
        if (f.status === "generating") {
          f.status = "failed";
          f.error = "Generation stopped before it finished. Try again.";
        }
        return structuredClone(f);
      });
      return updated ? toView(updated) : null;
    }
    return toView(q);
  }

  async listQuizzes(language: Language): Promise<QuizListItem[]> {
    const now = this.deps.now();
    const out: QuizListItem[] = [];
    for (const q of await this.store.all()) {
      if (q.language !== language) continue;
      if (q.status === "failed") {
        // Failed generations are only useful right after they happen.
        if (now - q.createdAt > DAY) await this.store.remove(q.id).catch(() => undefined);
        continue;
      }
      const s = summarize(q);
      const item: QuizListItem = {
        id: q.id,
        language: q.language,
        title: q.title,
        status: q.status === "generating" && !this.inflight.has(q.id) ? "failed" : q.status,
        createdAt: q.createdAt,
        alignment: q.alignment,
        total: s.total,
        answered: s.answered,
        correct: s.correct,
      };
      if (item.status === "failed") continue;
      if (q.finishedAt) item.finishedAt = q.finishedAt;
      out.push(item);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  // ------------------------------------------------------------ answering

  private async requireQuiz(quizId: string): Promise<QuizFile> {
    const q = await this.store.get(quizId);
    if (!q) throw new Error("That quiz no longer exists.");
    if (q.status === "generating") throw new Error("The quiz is still being written.");
    if (q.status === "failed") throw new Error(q.error ?? "This quiz couldn't be written.");
    return q;
  }

  async answerQuestion(quizId: string, questionId: string, response: string, modelRef: ModelRef | null, opts: { reveal?: boolean } = {}): Promise<QuizView> {
    const q = await this.requireQuiz(quizId);
    const item = q.items.find((i) => i.id === questionId);
    if (!item) throw new Error("That question isn't in this quiz.");
    if (item.answered) return toView(q);
    const key = `${quizId}:${questionId}`;
    if (this.grading.has(key)) throw new Error("Still checking that answer.");
    this.grading.add(key);
    try {
      const text = typeof response === "string" ? response.trim().slice(0, 2000) : "";
      const pack = this.deps.lang.pack(q.language);
      await pack.ready();
      const base = { response: text, answer: item.answer, explanation: item.explanation, at: this.deps.now() };
      let answer: QuizAnswer;
      if (opts.reveal) {
        answer = { ...base, revealed: true, verdict: "incorrect", feedback: FEEDBACK.revealed, gradedBy: "local" };
      } else if (!text) {
        answer = { ...base, verdict: "incorrect", feedback: FEEDBACK.empty, gradedBy: "local" };
      } else if (isLocallyGraded(item)) {
        const verdict = gradeLocal(item, text, (s) => pack.normalize(s));
        answer = { ...base, verdict, feedback: verdict === "correct" ? FEEDBACK.correct : FEEDBACK.incorrect, gradedBy: "local" };
      } else {
        let model: Model<Api> | null = null;
        try {
          model = modelRef ? this.deps.resolveModel(modelRef) : null;
        } catch {
          model = null;
        }
        const explain = await explanationFor(this.deps);
        const graded = await gradeOpen({ models: this.deps.models, model, languageName: pack.info.name, explain, item, response: text, now: this.deps.now() });
        answer = { ...base, ...graded };
      }
      if (item.accepted.length) answer.accepted = [...item.accepted];
      const updated = await this.store.update(quizId, (f) => {
        const it = f.items.find((i) => i.id === questionId);
        if (it && !it.answered) it.answered = answer;
        return structuredClone(f);
      });
      if (!updated) throw new Error("That quiz no longer exists.");
      return toView(updated);
    } finally {
      this.grading.delete(key);
    }
  }

  async finishQuiz(quizId: string): Promise<QuizView> {
    const q = await this.requireQuiz(quizId);
    const now = this.deps.now();
    // S2-09: answers linked to a grammar point become quiz evidence (prompted practice).
    const inputs = q.items
      .filter((it) => it.grammarId && it.answered && !it.answered.revealed && evidenceSpan(it))
      .map((it) => ({
        grammarId: it.grammarId!,
        sessionId: quizSessionId(q.id),
        messageId: it.id,
        span: evidenceSpan(it),
        verdict: it.answered!.verdict,
        assistance: "prompted" as const,
        note: `Quiz · ${FORMAT_LABEL[it.format]}`,
        at: it.answered!.at,
        origin: "quiz" as const,
        quizId: q.id,
      }));
    if (inputs.length) await this.deps.records.recordObservations(q.language, inputs);
    const updated = await this.store.update(quizId, (f) => {
      if (f.status !== "finished") {
        f.status = "finished";
        f.finishedAt = now;
      }
      f.evidenceAt ??= now;
      return structuredClone(f);
    });
    if (!updated) throw new Error("That quiz no longer exists.");
    return toView(updated);
  }

  async retryMistakes(quizId: string): Promise<QuizView> {
    const q = await this.requireQuiz(quizId);
    const wrong = q.items.filter((it) => it.answered && it.answered.verdict !== "correct");
    if (!wrong.length) throw new Error("No mistakes to retry in this quiz.");
    const id = this.deps.newId();
    const random = seededRandom(id);
    const retry = `${(await translatorFor(this.deps)).t("Retry")} · `;
    const items: QuizItem[] = wrong.map((it, i) => {
      const copy: QuizItem = structuredClone(it);
      delete copy.answered;
      copy.id = `${id}-q${i + 1}`;
      if (copy.choices) copy.choices = shuffle(copy.choices, random);
      if (copy.tiles) copy.tiles = shuffleTiles(copy.tiles, random);
      return copy;
    });
    const file: QuizFile = {
      v: 1,
      id,
      language: q.language,
      title: q.title.startsWith(retry) ? q.title : `${retry}${q.title}`,
      spec: structuredClone(q.spec),
      status: "ready",
      createdAt: this.deps.now(),
      alignment: q.alignment,
      provenance: q.provenance,
      items,
      grammarLabels: { ...q.grammarLabels },
      retryOf: q.id,
    };
    if (q.model) file.model = q.model;
    if (q.exam) file.exam = q.exam;
    if (q.level) file.level = q.level;
    await this.store.create(file);
    return toView(file);
  }

  async deleteQuiz(quizId: string): Promise<void> {
    const ctrl = this.inflight.get(quizId);
    if (ctrl) {
      ctrl.abort();
      this.inflight.delete(quizId);
    }
    await this.store.remove(quizId);
    await this.deps.records.deleteObservations({ sessionId: quizSessionId(quizId) });
  }

  // ------------------------------------------------------------ export & shutdown

  /** Every quiz with keys and answers, for the data export (F-11). */
  async exportAll(): Promise<QuizFile[]> {
    return (await this.store.all()).sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Aborts running generations (erase, quit). */
  abortAll(): void {
    for (const c of this.inflight.values()) c.abort();
    this.inflight.clear();
  }
}
