// Course (Duolingo-style path): the `course` tutor tool and the text the tutor reads about a unit.
// Unit status comes from src/shared/course (computed from grammar records, never by a model, S1-25).
import { StringEnum, Type } from "@earendil-works/pi-ai";
import {
  buildCourseView,
  courseFor,
  courseLevel,
  grammarStates,
  nextUnit,
  unitStatus,
  type Course,
  type CourseUnit,
  type CourseView,
  type GrammarStates,
} from "../../shared/course";
import { LANGUAGE_META } from "../../shared/languages";
import type { GrammarState, Language } from "../../shared/records";
import type { TutorTool } from "../contracts";
import { translatorOf, type TutorDeps } from "../agent/deps";
import { obj, str } from "../agent/text";

const STATE_TEXT: Record<GrammarState, string> = {
  introduced: "introduced, not used correctly yet",
  with_help: "used correctly with help",
  independent: "used correctly on their own",
};

/** Unit ids start with the language ("ja-n5-01"); Chinese and Japanese lists use 、. */
function wordSeparator(unit: CourseUnit) {
  const script = LANGUAGE_META[unit.id.split("-")[0] as Language]?.script;
  return script === "han" || script === "japanese" ? "、" : ", ";
}

const stateText = (states: GrammarStates, id: string) => {
  const st = states.get(id);
  return st ? STATE_TEXT[st] : "not seen yet";
};

function unitStatusLine(unit: CourseUnit, states: GrammarStates) {
  const { status, solid } = unitStatus(unit, states);
  return `Status: ${status}, ${solid}/${unit.grammar.length} points used correctly on their own.`;
}

/** Everything the tutor needs about one unit, with the learner's state per point. */
export function unitText(unit: CourseUnit, states: GrammarStates): string {
  return [
    `Unit ${unit.id} (${unit.level}): ${unit.title}. ${unitStatusLine(unit, states)}`,
    `Goal: ${unit.goal}`,
    "Grammar (use these ids in record_evidence):",
    ...unit.grammar.map((g) => `- ${g.id} | ${g.pattern} | ${g.name}. ${g.note} Learner: ${stateText(states, g.id)}.`),
    `Topic ideas: ${unit.topics.join("; ")}.`,
    `Core words: ${unit.words.join(wordSeparator(unit))}.`,
  ].join("\n");
}

/** The unit without the learner's state: the same all session, so it can stay in the cached system prompt. */
export function unitPlan(unit: CourseUnit): string {
  return [
    `Unit ${unit.id} (${unit.level}): ${unit.title}.`,
    `Goal: ${unit.goal}`,
    "Grammar (use these ids in record_evidence):",
    ...unit.grammar.map((g) => `- ${g.id} | ${g.pattern} | ${g.name}. ${g.note}`),
    `Topic ideas: ${unit.topics.join("; ")}.`,
    `Core words: ${unit.words.join(wordSeparator(unit))}.`,
  ].join("\n");
}

/** The learner's state per point of the unit, for the notes sent with each reply. */
export function unitProgress(unit: CourseUnit, states: GrammarStates): string {
  return [unitStatusLine(unit, states), ...unit.grammar.map((g) => `- ${g.id}: ${stateText(states, g.id)}`)].join("\n");
}

/** Most units the overview lists: full-syllabus courses have up to ~60 units per level. */
const OVERVIEW_MAX_UNITS = 40;

export function overviewText(course: Course, view: CourseView, levels: readonly string[]): string {
  const at = view.learnerLevel ? levels.indexOf(view.learnerLevel) : -1;
  const lo = Math.max(0, at - 1);
  const hi = at < 0 ? 1 : at + 1;
  const near = view.levels
    .filter((l) => {
      const i = levels.indexOf(l.level);
      return i >= lo && i <= hi;
    })
    .map((l) => ({ ...l, units: l.units.filter((u) => u.status !== "done") }));
  // The learner's level first, then the one above, then the one below.
  const rank = (level: string) => {
    const i = levels.indexOf(level);
    return i === at ? 0 : i > at ? 1 : 2;
  };
  const open = [...near].sort((x, y) => rank(x.level) - rank(y.level)).flatMap((l) => l.units);
  const listed = open.slice(0, OVERVIEW_MAX_UNITS);
  const next = course.units.find((u) => u.id === view.nextUnitId);
  return [
    `Course: ${course.basis}.`,
    `Learner level: ${view.learnerLevel ?? "unknown"}.`,
    next ? `Next unit: ${next.id} "${next.title}" (${next.level}).` : "Every unit is done.",
    "Units near their level, not done yet (id | level | title | status | points used on their own | first patterns):",
    ...listed.map((u) => `${u.id} | ${u.level} | ${u.title} | ${u.status} | ${u.solid}/${u.total} | ${u.patterns.slice(0, 3).join("; ")}`),
    ...(open.length > listed.length ? [`(${open.length - listed.length} more units at these levels.)`] : []),
    'Call course with action "unit" and a unit_id for a unit\'s grammar, topics and words.',
  ].join("\n");
}

const CourseParams = Type.Object({
  action: StringEnum(["overview", "unit"] as const, { description: '"overview": where the learner stands. "unit": one unit\'s grammar, topics and words.' }),
  unit_id: Type.Optional(Type.String({ description: 'For action "unit". Leave out for the suggested next unit.' })),
});

/** The tutor's view of the course. Offered only for languages that have one. */
export function courseTool(deps: TutorDeps, language: Language): TutorTool | null {
  const course = courseFor(language);
  if (!course) return null;
  return {
    name: "course",
    description:
      "The learner's course: units in textbook order, each with grammar points, topic ideas and core words, and which points the learner already uses. Call it when you want to move on and need the next thing to teach.",
    parameters: CourseParams,
    recordingOnly: false,
    async execute(rawArgs, ctx) {
      const args = obj(rawArgs);
      const tr = await translatorOf(deps);
      const [grammar, levels] = await Promise.all([ctx.records.listGrammar(language), ctx.records.getLevels(language)]);
      const scale = ctx.lang.pack(language).info.levels;
      const states = grammarStates(grammar);
      if (str(args.action) === "unit") {
        const id = str(args.unit_id);
        const unit = id ? course.units.find((u) => u.id === id) : nextUnit(course, scale, states, courseLevel(levels.current));
        if (!unit) return { content: `No unit ${id}. Call course with action "overview" for the unit ids.`, activity: tr.t("Looked at the course") };
        return { content: unitText(unit, states), activity: tr.t("Opened course unit: {title}", { title: tr.t(unit.title) }) };
      }
      const view = buildCourseView(language, scale, grammar, levels.current);
      return { content: overviewText(course, view, scale), activity: tr.t("Looked at the course") };
    },
  };
}
