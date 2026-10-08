// Course: an ordered path of units per learning language ("Duolingo-style" levels and topics).
// Pure data plus the view types the renderer shows. Core computes every unit's status from the
// learner's grammar records (src/core/course); the model never decides progress.
//
// Only languages with a course get the Course screen, the `course` tutor tool and the course
// prompt block. The others are marked Beta in the interface: the tutor still works, but it has
// no level-by-level syllabus, so results may vary. docs/roadmap.md lists the languages still to do.
import type { GrammarState, GrammarSummary, Language, LevelEstimate, Skill } from "../records";
import { DE_COURSE } from "./de";
import { EN_COURSE } from "./en";
import { ES_COURSE } from "./es";
import { FR_COURSE } from "./fr";
import { IT_COURSE } from "./it";
import { JA_COURSE } from "./ja";
import { KO_COURSE } from "./ko";
import { PT_COURSE } from "./pt";
import { ZH_COURSE } from "./zh";

export interface CourseGrammar {
  /** Grammar point id, the same ids record_evidence uses: "zh:le-completion". */
  id: string;
  /** Surface pattern in the target language: "V + 了". */
  pattern: string;
  /** Short English name (the tutor's catalogue). */
  name: string;
  /** One English line for the tutor: how the pattern is used, a typical trap. */
  note: string;
  /** The point in the source syllabus, for courses that follow one in full: "HSK 3.0 #57", "EGP 412". */
  ref?: string;
}

export interface CourseUnit {
  /** Stable id: "zh-hsk2-04". */
  id: string;
  /** A value from the language's level scale (LANGUAGE_META levels): "HSK 2". */
  level: string;
  /** Learner-facing title, English text as the translation key (wrapped in msg()). */
  title: string;
  /** English can-do goal for the tutor. */
  goal: string;
  grammar: CourseGrammar[];
  /** English situation ideas for the tutor. */
  topics: string[];
  /** A few core words in the target language. */
  words: string[];
}

export interface Course {
  language: Language;
  /** What the order follows: English (prompt, tool output), translated on the Course screen. */
  basis: string;
  units: CourseUnit[];
}

export const COURSES: Partial<Record<Language, Course>> = {
  zh: ZH_COURSE,
  ja: JA_COURSE,
  ko: KO_COURSE,
  en: EN_COURSE,
  es: ES_COURSE,
  fr: FR_COURSE,
  de: DE_COURSE,
  it: IT_COURSE,
  pt: PT_COURSE,
};

export function courseFor(language: Language): Course | undefined {
  return COURSES[language];
}

/** Languages without a course are Beta: the tutor works, with no syllabus behind it. */
export function isBeta(language: Language): boolean {
  return !COURSES[language];
}

export function findUnit(unitId: string): { course: Course; unit: CourseUnit } | undefined {
  for (const course of Object.values(COURSES)) {
    const unit = course?.units.find((x) => x.id === unitId);
    if (course && unit) return { course, unit };
  }
  return undefined;
}

// ---------------------------------------------------------------- views (computed in core)

/** done = every point used correctly on the learner's own; started = some evidence or a unit session. */
export type UnitStatus = "new" | "started" | "done";

/** One grammar point of a unit, with the learner's state (null = not seen yet). */
export interface UnitPointView {
  id: string;
  pattern: string;
  name: string;
  state: GrammarState | null;
}

export interface UnitView {
  id: string;
  level: string;
  title: string;
  patterns: string[];
  points: UnitPointView[];
  status: UnitStatus;
  /** Grammar points used correctly on the learner's own. */
  solid: number;
  total: number;
  /** The unit the course suggests next. */
  next: boolean;
}

export interface CourseView {
  language: Language;
  /** False for Beta languages: `levels` is empty. */
  available: boolean;
  basis: string;
  /** The level the course starts from (the learner's estimate), if known. */
  learnerLevel?: string;
  nextUnitId?: string;
  levels: { level: string; units: UnitView[] }[];
}

// ---------------------------------------------------------------- status (pure, shared with the mock backend)

export type GrammarStates = ReadonlyMap<string, GrammarState>;

export function grammarStates(grammar: readonly GrammarSummary[]): Map<string, GrammarState> {
  return new Map(grammar.map((g) => [g.point.id, g.state]));
}

/** The level the course plans from: the writing estimate first (it is what the learner produces). */
export function courseLevel(levels: Partial<Record<Skill, LevelEstimate>>): string | undefined {
  return levels.writing?.level ?? levels.recognition?.level ?? levels.reading?.level;
}

export function unitStatus(unit: CourseUnit, states: GrammarStates, opened = false): { status: UnitStatus; solid: number } {
  const solid = unit.grammar.filter((g) => states.get(g.id) === "independent").length;
  if (unit.grammar.length > 0 && solid === unit.grammar.length) return { status: "done", solid };
  const seen = unit.grammar.some((g) => states.has(g.id));
  return { status: seen || opened ? "started" : "new", solid };
}

/** Index of the first unit at or above `level`; 0 when the level is unknown or not on the scale. */
function startIndex(course: Course, levels: readonly string[], level?: string): number {
  const at = level ? levels.indexOf(level) : -1;
  if (at < 0) return 0;
  const i = course.units.findIndex((u) => levels.indexOf(u.level) >= at);
  return i < 0 ? course.units.length : i;
}

/** The unit to suggest: the first one not done from the learner's level on, else the first not done at all. */
export function nextUnit(course: Course, levels: readonly string[], states: GrammarStates, level?: string): CourseUnit | undefined {
  const open = (u: CourseUnit) => unitStatus(u, states).status !== "done";
  return course.units.slice(startIndex(course, levels, level)).find(open) ?? course.units.find(open);
}

export function buildCourseView(
  language: Language,
  levels: readonly string[],
  grammar: readonly GrammarSummary[],
  estimates: Partial<Record<Skill, LevelEstimate>>,
  openedUnits: ReadonlySet<string> = new Set(),
): CourseView {
  const course = courseFor(language);
  if (!course) return { language, available: false, basis: "", levels: [] };
  const states = grammarStates(grammar);
  const learnerLevel = courseLevel(estimates);
  const next = nextUnit(course, levels, states, learnerLevel);
  const byLevel = new Map<string, UnitView[]>();
  for (const u of course.units) {
    const { status, solid } = unitStatus(u, states, openedUnits.has(u.id));
    const view: UnitView = {
      id: u.id,
      level: u.level,
      title: u.title,
      patterns: u.grammar.map((g) => g.pattern),
      points: u.grammar.map((g) => ({ id: g.id, pattern: g.pattern, name: g.name, state: states.get(g.id) ?? null })),
      status,
      solid,
      total: u.grammar.length,
      next: u.id === next?.id,
    };
    byLevel.set(u.level, [...(byLevel.get(u.level) ?? []), view]);
  }
  return {
    language,
    available: true,
    basis: course.basis,
    ...(learnerLevel ? { learnerLevel } : {}),
    ...(next ? { nextUnitId: next.id } : {}),
    levels: [...byLevel].map(([level, units]) => ({ level, units })),
  };
}
