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
import type { GrammarState, Language } from "../../shared/records";
import type { TutorTool } from "../contracts";
import { translatorOf, type TutorDeps } from "../agent/deps";
import { obj, str } from "../agent/text";

const STATE_TEXT: Record<GrammarState, string> = {
  introduced: "introduced, not used correctly yet",
  with_help: "used correctly with help",
  independent: "used correctly on their own",
};

/** Everything the tutor needs about one unit, with the learner's state per point. */
export function unitText(unit: CourseUnit, states: GrammarStates): string {
  const { status, solid } = unitStatus(unit, states);
  return [
    `Unit ${unit.id} (${unit.level}): ${unit.title}. Status: ${status}, ${solid}/${unit.grammar.length} points used correctly on their own.`,
    `Goal: ${unit.goal}`,
    "Grammar (use these ids in record_evidence):",
    ...unit.grammar.map((g) => {
      const st = states.get(g.id);
      return `- ${g.id} | ${g.pattern} | ${g.name}. ${g.note} Learner: ${st ? STATE_TEXT[st] : "not seen yet"}.`;
    }),
    `Topic ideas: ${unit.topics.join("; ")}.`,
    `Core words: ${unit.words.join("、")}.`,
  ].join("\n");
}

export function overviewText(course: Course, view: CourseView, levels: readonly string[]): string {
  const at = view.learnerLevel ? levels.indexOf(view.learnerLevel) : -1;
  const lo = Math.max(0, at - 1);
  const hi = at < 0 ? 1 : at + 1;
  const near = view.levels.filter((l) => {
    const i = levels.indexOf(l.level);
    return i >= lo && i <= hi;
  });
  const next = course.units.find((u) => u.id === view.nextUnitId);
  return [
    `Course: ${course.basis}.`,
    `Learner level: ${view.learnerLevel ?? "unknown"}.`,
    next ? `Next unit: ${next.id} "${next.title}" (${next.level}).` : "Every unit is done.",
    "Units near their level (id | level | title | status | points used on their own):",
    ...near.flatMap((l) => l.units.map((u) => `${u.id} | ${u.level} | ${u.title} | ${u.status} | ${u.solid}/${u.total}`)),
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
