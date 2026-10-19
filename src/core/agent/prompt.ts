// The tutor's prompt, rebuilt from local records at the start of every turn (S1-05). It has two parts:
// the system prompt, which stays the same all session so providers can cache it with the history, and
// the notes for this reply (levels, pacing, targets, grammar ids), which change every turn and ride on
// the newest learner message (turn.ts). ADR 39.
import type { LanguageInfo } from "../../shared/lang";
import type {
  AnkiOverview,
  GrammarObservation,
  GrammarPoint,
  GrammarSummary,
  LearnerProfile,
  LevelEstimate,
  LibraryDoc,
  LibraryParagraph,
  PracticeTarget,
  SessionMeta,
  Skill,
  Difficulty,
} from "../../shared/records";
import { SKILLS } from "../../shared/records";
import { bandLevels, levelBand } from "../../shared/languages";
import { courseFor, courseLevel, findUnit, grammarStates, nextUnit, type Course, type CourseGrammar, type CourseUnit, type GrammarStates } from "../../shared/course";
import { unitPlan, unitProgress } from "../course";
import { findScenario } from "../../shared/scenarios";
import { countableCorrection } from "../records/corrections";
import { isQuizObservation } from "../records/grammar";
import { explainIn, type TutorDeps } from "./deps";
import { TUNING } from "./tuning";

// Every tutor rule is written once in this file, in the block that owns it (see renderSystemPrompt):
// persona (how to talk, how to bring in a target), session blocks (what to work on), then feedback
// and tool protocol. Per-kind field rules for record_evidence live in its parameter descriptions
// (tools.ts). Tuning numbers live in tuning.ts.

/** Counted locally from the session's messages and corrections (S1-25), for the pacing block. */
export interface Pacing {
  /** Learner replies since the current topic started, the latest one included. */
  turnsOnTopic: number;
  /** Earlier learner replies in a row (before the latest) with no countable correction (a grammar one, not disputed). */
  cleanStreak: number;
  /** Mean length in characters of the learner's last 3 replies on this topic. */
  recentLength: number;
}

export interface PromptData {
  session: SessionMeta;
  info: LanguageInfo;
  promptNotes: string;
  levels: Partial<Record<Skill, LevelEstimate>>;
  profile: LearnerProfile;
  personalContext: string;
  followUps: GrammarSummary[];
  /** Latest conversation miss per grammar point (the learner's own words), for the revisit block. */
  lastMisses: Map<string, GrammarObservation>;
  /** Clock at gather time, for "how long ago" labels. */
  now: number;
  targets: PracticeTarget[];
  catalogue: GrammarPoint[];
  focus?: GrammarPoint | null;
  reading?: { doc: LibraryDoc; current: number; paragraphs: LibraryParagraph[] } | null;
  /** Anki vocabulary summary, when Anki is on and the language has a snapshot. */
  anki?: { overview: AnkiOverview; now: number } | null;
  /** The language the tutor explains in (interface language): "German". Default English. */
  explain?: string;
  pacing?: Pacing;
  /** Course languages only: the suggested next unit and its points the learner does not use alone yet. */
  course?: { course: Course; next?: CourseUnit; points: CourseGrammar[] } | null;
  /** Course unit sessions: the unit and the learner's state per point. */
  unit?: { unit: CourseUnit; states: GrammarStates } | null;
}

/**
 * Grammar to bring back naturally: still being learned, or recently missed. Skips the session's focus.
 * Recent misses come first, most recent first, so the tutor's priority is the mistake the learner
 * just made (often in the previous session); the rest keep their catalogue order.
 */
export function pickFollowUps(
  grammar: GrammarSummary[],
  lastAssessed: Map<string, { verdict: string; at: number }>,
  now: number,
  skipId?: string,
): GrammarSummary[] {
  const misses: { g: GrammarSummary; at: number }[] = [];
  const rest: GrammarSummary[] = [];
  for (const g of grammar) {
    if (g.point.id === skipId) continue;
    const last = lastAssessed.get(g.point.id);
    const recentMiss = !!last && last.verdict === "incorrect" && now - last.at <= TUNING.recentMissMs;
    if (recentMiss) misses.push({ g, at: last.at });
    else if (g.state === "introduced" || g.state === "with_help") rest.push(g);
  }
  misses.sort((a, b) => b.at - a.at);
  return [...misses.map((m) => m.g), ...rest].slice(0, TUNING.maxFollowUps);
}

/** Keep only misses that are still the latest verdict and recent, so a later success hides them. */
function currentMisses(
  misses: Map<string, GrammarObservation>,
  lastAssessed: Map<string, { verdict: string; at: number }>,
  now: number,
): Map<string, GrammarObservation> {
  const out = new Map<string, GrammarObservation>();
  for (const [id, o] of misses) {
    const last = lastAssessed.get(id);
    if (last && last.verdict === "incorrect" && last.at === o.at && now - o.at <= TUNING.recentMissMs) out.set(id, o);
  }
  return out;
}

/** Latest incorrect conversation observation per grammar point (quiz answers excluded, S2-09). */
export function lastConversationMisses(observations: readonly GrammarObservation[]): Map<string, GrammarObservation> {
  const out = new Map<string, GrammarObservation>();
  for (const o of observations) {
    if (o.verdict !== "incorrect" || isQuizObservation(o)) continue;
    const prev = out.get(o.grammarId);
    if (!prev || o.at >= prev.at) out.set(o.grammarId, o);
  }
  return out;
}

/**
 * Latest correct/incorrect verdict per grammar point from conversation evidence only.
 * Quiz answers are prompted practice (S2-09): they never hide a recent miss in conversation
 * or steer which patterns the tutor brings back.
 */
export function lastConversationVerdicts(
  observations: readonly GrammarObservation[],
): Map<string, { verdict: string; at: number }> {
  const last = new Map<string, { verdict: string; at: number }>();
  for (const o of observations) {
    if (o.verdict !== "correct" && o.verdict !== "incorrect") continue;
    if (isQuizObservation(o)) continue;
    const prev = last.get(o.grammarId);
    if (!prev || o.at >= prev.at) last.set(o.grammarId, { verdict: o.verdict, at: o.at });
  }
  return last;
}

/** Pacing numbers from the stored messages and corrections. */
export function computePacing(
  messages: readonly { id: string; role: "user" | "tutor"; text: string; topicStart?: boolean }[],
  correctedIds: ReadonlySet<string>,
): Pacing {
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "tutor" && messages[i].topicStart) {
      start = i + 1;
      break;
    }
  }
  const learner = messages.slice(start).filter((m) => m.role === "user");
  let cleanStreak = 0;
  for (let i = learner.length - 2; i >= 0 && !correctedIds.has(learner[i].id); i--) cleanStreak++;
  const recent = learner.slice(-3);
  const recentLength = recent.length ? Math.round(recent.reduce((t, m) => t + [...m.text.trim()].length, 0) / recent.length) : 0;
  return { turnsOnTopic: learner.length, cleanStreak, recentLength };
}

export async function gatherPromptData(deps: TutorDeps, session: SessionMeta): Promise<PromptData> {
  const { records, lang, library } = deps;
  const language = session.language;
  const pack = lang.pack(language);
  const [levels, profile, personalContext, grammar, observations, targets, messages, corrections] = await Promise.all([
    records.getLevels(language),
    records.getProfile(),
    library.personalContext(language, TUNING.personalContextChars).catch(() => ""),
    records.listGrammar(language),
    records.listObservations({ language }),
    records.getTargets(session.id),
    records.getMessages(session.id).catch(() => []),
    records.listCorrections({ language, sessionId: session.id }).catch(() => []),
  ]);

  const lastAssessed = lastConversationVerdicts(observations);

  const data: PromptData = {
    session,
    info: pack.info,
    promptNotes: pack.promptNotes(),
    levels: levels.current,
    profile,
    personalContext,
    followUps: pickFollowUps(grammar, lastAssessed, deps.now(), session.focusGrammarId),
    lastMisses: currentMisses(lastConversationMisses(observations), lastAssessed, deps.now()),
    now: deps.now(),
    targets: targets.filter((t) => t.status === "pending" || t.status === "asked"),
    catalogue: grammar.slice(0, TUNING.maxCatalogue).map((g) => g.point),
    explain: await explainIn(deps),
    pacing: computePacing(messages, new Set(corrections.filter(countableCorrection).map((c) => c.messageId))),
  };

  const course = courseFor(language);
  if (course) {
    const states = grammarStates(grammar);
    const next = nextUnit(course, pack.info.levels, states, courseLevel(levels.current));
    const points = (next?.grammar ?? []).filter((g) => states.get(g.id) !== "independent").slice(0, TUNING.courseNextPoints);
    data.course = { course, ...(next ? { next } : {}), points };
    if (session.unitId) {
      const found = findUnit(session.unitId);
      data.unit = found ? { unit: found.unit, states } : null;
    }
  }

  if (await deps.ankiEnabled().catch(() => false)) {
    const overview = await deps.anki.overview(language).catch(() => null);
    if (overview) data.anki = { overview, now: deps.now() };
  }
  if (session.kind === "practice" && session.focusGrammarId) {
    data.focus = await records.getGrammarPoint(session.focusGrammarId);
  }
  if (session.kind === "reading" && session.docId) {
    const doc = await library.getDoc(session.docId);
    if (doc) {
      const current = doc.checkpoint?.paragraph ?? 0;
      const from = Math.max(0, current - 1);
      const paragraphs = await library.getParagraphs(doc.id, from, current - from + 4);
      data.reading = { doc, current, paragraphs };
    } else {
      data.reading = null;
    }
  }
  return data;
}

export async function buildPrompt(deps: TutorDeps, session: SessionMeta) {
  return renderPrompt(await gatherPromptData(deps, session));
}

/** Everything the tutor is told for a turn, system prompt and notes as one text (tests, benchmark). */
export async function buildSystemPrompt(deps: TutorDeps, session: SessionMeta): Promise<string> {
  return renderSystemPrompt(await gatherPromptData(deps, session));
}

function levelLines(d: PromptData): string {
  const known = SKILLS.filter((s) => d.levels[s]);
  if (known.length === 0) return "Level: unknown. Start simple and adjust from the evidence in their messages.";
  const parts = SKILLS.map((s) => {
    const e = d.levels[s];
    return e ? `${s} ${e.level} (${e.confidence} confidence)` : `${s} unknown`;
  });
  return `Current level estimates: ${parts.join("; ")}.`;
}

/** Where the learner is on the level scale, 0 (bottom) to 1 (top); undefined when no level is known. */
function levelShare(d: Pick<PromptData, "levels" | "info">): number | undefined {
  const level = courseLevel(d.levels);
  const i = level ? d.info.levels.indexOf(level) : -1;
  if (i < 0) return undefined;
  return d.info.levels.length > 1 ? i / (d.info.levels.length - 1) : 0;
}

/**
 * Beginners get their own persona (beginnerPersonaBlock): no level yet, a level in the Beginner band (A1-A2,
 * N5-N4, HSK 1-3, TOPIK 1-2), or a placement chat started as a beginner.
 */
export function isBeginner(d: Pick<PromptData, "levels" | "session">): boolean {
  if (d.session.kind === "placement" && d.session.levelBand) return d.session.levelBand === "beginner";
  const level = courseLevel(d.levels);
  return !level || levelBand(level) === "beginner";
}

/** The language beginners may fall back on: the interface language, unless that is the language they learn. */
function ownLanguage(d: Pick<PromptData, "info" | "explain">): string {
  const explain = d.explain || "English";
  return explain.toLowerCase().startsWith(d.info.name.toLowerCase()) ? "their own language" : explain;
}

const room = (max: number) => `. When the reply brings in a target, you may write more to set up a natural context for it, up to ${max} sentences in all`;

/** Reply length grows with the learner's level, up to real paragraphs. Beginners: beginnerPersonaBlock. */
export function lengthRule(d: Pick<PromptData, "levels" | "info">): string {
  const share = levelShare(d);
  const cap = TUNING.sentenceCap;
  if (share === undefined) return `Keep replies to 1 to 3 short sentences${room(cap.unknown)}`;
  if (share < TUNING.midBelow) return `Write 2 or 3 sentences, linked with connectors they know${room(cap.mid)}`;
  return `Write 2 to 4 sentences; a short paragraph is fine${room(cap.advanced)}`;
}

function courseBlock(d: PromptData): string {
  if (d.session.kind !== "chat") return "";
  if (!d.course) return `# Course\nThere is no level-by-level course for ${d.info.name} in Sayfern yet. Judge which grammar and words come next from their level and their messages.`;
  const { course, next, points } = d.course;
  if (!next) return `# Course (${course.basis})\nThey have used every course point on their own. Keep stretching them with richer topics.`;
  const lines = [
    `# Course (${course.basis})`,
    `Up next for them: unit ${next.id} "${next.title}" (${next.level}). Goal: ${next.goal}`,
  ];
  if (points.length) {
    lines.push(
      "When you move on, bring in one of these, one at a time:",
      ...points.map((g) => `- ${g.pattern} (${g.name}, id ${g.id}). ${g.note}`),
    );
  }
  lines.push(`Topic ideas for this unit: ${next.topics.join("; ")}. Call the course tool for other units, topics and words.`);
  return lines.join("\n");
}

const ANSWER_FIRST = "Always answer what the learner just said first, and never drop a question they asked.";

/**
 * When to move on. Openings and "New topic" have their own kickoff, so this is for learner turns.
 * Unit sessions move on per point (sessionBlock) and role-plays end with the scene (roleplayBlock):
 * they get no second move-on rule here.
 */
export function pacingBlock(d: Pick<PromptData, "session">): string {
  if (d.session.kind === "placement" || d.session.kind === "reading") return "";
  if (d.session.unitId || d.session.scenarioId) return ["# Pacing", ANSWER_FIRST].join("\n");
  return [
    "# Pacing",
    `${ANSWER_FIRST} Then decide: stay on the topic or move on.`,
    "- Stay while they are invested: longer replies, their own questions, a story in progress.",
    `- Move on when the topic is used up: after about ${TUNING.moveOnTurns} exchanges, when their replies get short and add nothing new, or when ${TUNING.easyStreak} replies in a row have no grammar mistakes (it is too easy for them).`,
    "- Moving on means a natural bridge to a new topic, or a harder angle on the same one (an opinion, a comparison, a hypothetical) that calls for the next grammar point. Never ask them whether they want to change topic; just do it smoothly (set topic_change when you do).",
  ].join("\n");
}

/** The pacing numbers for this reply (notes). Only where the full pacing rules apply. */
export function pacingFacts(d: Pick<PromptData, "pacing" | "session">): string {
  const p = d.pacing;
  if (!p || p.turnsOnTopic === 0 || d.session.kind === "placement" || d.session.kind === "reading" || d.session.unitId || d.session.scenarioId) return "";
  const facts = [`This topic has run for ${p.turnsOnTopic} of the learner's replies (this one included).`];
  if (p.cleanStreak > 0) facts.push(`Their ${p.cleanStreak} previous ${p.cleanStreak === 1 ? "reply" : "replies"} had no grammar mistakes.`);
  if (p.recentLength) facts.push(`Their recent replies average ${p.recentLength} characters.`);
  const due = p.turnsOnTopic >= TUNING.moveOnTurns || p.cleanStreak >= TUNING.easyStreak;
  return ["# Pacing now", facts.join(" "), ...(due ? ["The topic is used up: unless they are clearly invested, move on in this reply."] : [])].join("\n");
}

function learnerBlock(d: PromptData): string {
  const lines: string[] = [];
  if (d.profile.name) lines.push(`Name: ${d.profile.name}`);
  if (d.profile.about.trim()) lines.push(`About them: ${d.profile.about.trim()}`);
  const goal = d.profile.goals[d.session.language];
  if (goal) lines.push(`Goal for ${d.info.name}: ${goal}`);
  if (d.personalContext.trim()) {
    lines.push("Personal notes they shared (use for topics; do not quote back at length):");
    lines.push(d.personalContext.trim());
  }
  return lines.length ? `# The learner\n${lines.join("\n")}` : "";
}

function followUpBlock(d: PromptData): string {
  if (d.followUps.length === 0) return "";
  let earlierSession = false;
  const lines = d.followUps.map((g, i) => {
    const head = `${i + 1}. ${g.point.pattern || g.point.id} (${g.point.name || g.point.id}), ${g.state.replace("_", " ")}`;
    const miss = d.lastMisses.get(g.point.id);
    if (!miss) return head;
    const where = miss.sessionId === d.session.id ? "earlier in this session" : "in an earlier session";
    if (miss.sessionId !== d.session.id) earlierSession = true;
    return `${head}. Last missed ${where} (${ago(Math.max(0, d.now - miss.at))}): "${miss.span}"`;
  });
  return [
    "# Grammar to revisit",
    "Create natural chances for the learner to use these in their answers.",
    "Item 1 is the priority: bring it in within your first two replies. Then work in the others when the conversation allows.",
    ...(earlierSession
      ? ["You may refer back to the earlier session once, briefly (what they talked about, not the mistake). Never repeat an old correction."]
      : []),
    ...lines,
  ].join("\n");
}

function targetBlock(d: PromptData): string {
  if (d.targets.length === 0) return "";
  const lines = d.targets.map((t) => {
    const extra = [t.reading, t.meaning].filter(Boolean).join(", ");
    return `- ${t.word}${extra ? ` (${extra})` : ""}`;
  });
  return [
    "# Words from their Anki reviews",
    "Use one or two per reply at most, so the learner can recognise and reuse them. Never say they come from Anki.",
    ...lines,
  ].join("\n");
}

function ago(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return "under an hour ago";
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Compact vocabulary summary from Anki (S1-14). Kept short: it is sent every turn. */
function ankiBlock(d: PromptData): string {
  if (!d.anki) return "";
  const o = d.anki.overview;
  const c = o.counts;
  const fmt = (x: number) => x.toLocaleString("en-US");
  const short = (w: string) => ([...w].length > 12 ? `${[...w].slice(0, 11).join("")}…` : w);
  const lines = [
    `# Anki knowledge (synced ${ago(Math.max(0, d.anki.now - o.syncedAt))})`,
    `Vocabulary: ${fmt(c.known)} known (${fmt(o.mature)} mature), ${fmt(c.learning)} learning, ${fmt(o.newRemaining)} not studied yet.`,
  ];
  const hard = o.topStruggling.slice(0, TUNING.ankiHardest).map((w) => (w.reasons[0] ? `${short(w.word)} (${w.reasons[0]})` : short(w.word)));
  if (hard.length) lines.push(`Hardest now: ${hard.join(", ")}.`);
  const next = o.nextNew.slice(0, TUNING.ankiNextNew).map((w) => short(w.word));
  if (next.length) lines.push(`Next new words: ${next.join(", ")}.`);
  lines.push(
    "Use mostly words they know, plus a little above them. Unsure whether they know a word you want to use? Call anki_check_words. Treat the hardest words as targets. Introduce at most one upcoming new word per reply, with a light gloss.",
  );
  return lines.join("\n");
}

const GRAMMAR_ID_EXAMPLE: Partial<Record<string, string>> = {
  zh: "zh:chule-hai",
  ja: "ja:te-iru",
  ko: "ko:go-sipda",
  es: "es:subjunctive-ojala",
  fr: "fr:passe-compose-etre",
  de: "de:dative-prepositions",
  it: "it:passato-prossimo",
  pt: "pt:personal-infinitive",
  ru: "ru:verbs-of-motion",
  vi: "vi:da-past",
  en: "en:present-perfect",
};

function catalogueBlock(d: PromptData): string {
  const head = [
    "# Grammar ids",
    `When you record grammar, reuse an id below if it fits. Otherwise invent one as "${d.session.language}:<ascii-slug>" (lowercase letters, digits, hyphens), e.g. "${GRAMMAR_ID_EXAMPLE[d.session.language] ?? `${d.session.language}:past-tense`}".`,
  ];
  if (d.catalogue.length === 0) return [...head, "(none yet)"].join("\n");
  return [...head, "id | pattern | name", ...d.catalogue.map((p) => `${p.id} | ${p.pattern} | ${p.name}`)].join("\n");
}

const DIFFICULTY_LINES: Record<Exclude<Difficulty, 0>, string> = {
  [-2]: "Much easier. Stay at or a little below their level: high-frequency words, short simple sentences (one clause), concrete everyday topics. Keep it natural, never baby talk.",
  [-1]: "Easier. Stay at their level rather than above it: common words, short sentences, familiar topics.",
  1: "Harder. Go further above their level than usual: some less common vocabulary, a linked or subordinate clause in most replies, grammar from the next level up, and topics that ask for opinions, plans or comparisons.",
  2: "Much harder. Stretch further: roughly one level above their estimate, richer vocabulary and connectors, more complex grammar (conditionals, passives, nuance), and thought-provoking topics (hypotheticals, current issues, abstract ideas).",
};

/** "Go easier / go harder" slider (session setting). Empty at the default. */
export function difficultyBlock(d: Pick<PromptData, "session">): string {
  const level = d.session.difficulty ?? 0;
  if (!level) return "";
  return [
    "# Difficulty (the learner's choice)",
    DIFFICULTY_LINES[level],
    "Stay within reason: never more than about one level above their estimate, and keep each reply understandable from context. If they clearly struggle (several mistakes in a row, switching to another language, saying they don't understand), ease off a little within this setting.",
  ].join("\n");
}

const MISS_RULE = "After two misses (they avoid it or get it wrong), model it in a sentence of your own, then invite them to try again.";

/** Unit sessions the learner opened with "go over the grammar first". */
const unitOverview = (language: string) => [
  "The learner asked for a quick overview of this unit's grammar before practising. In your first reply only, before anything else, give it (here you may name the patterns):",
  `- One short line per grammar point, in the order above: the pattern, what it does in plain ${language}, and one short example sentence.`,
  "- Keep the whole overview brief, a reminder of what is coming. It is not a full lesson and does not replace their textbook: no tables, no lists of exceptions, no exercises.",
  "Then open the conversation as below, with a question that invites the first point.",
  "",
];

/** A course unit opened with "Begin lesson" (overview, then each point taught). "More practice" units are plain conversation. */
const unitLesson = (s: SessionMeta) => !!s.unitId && s.openWith === "explain";

function sessionBlock(d: PromptData): string {
  const s = d.session;
  switch (s.kind) {
    case "practice": {
      if (s.unitId) {
        if (!d.unit) return "# Session: course unit\nThis course unit no longer exists. Chat about whatever interests the learner.";
        const lesson = unitLesson(s);
        return [
          lesson ? "# Session: course unit" : "# Session: course unit (more practice)",
          unitPlan(d.unit.unit),
          "",
          ...(lesson
            ? [
                ...unitOverview(introLanguage(d)),
                "Work through this unit as a conversation. Pick one topic idea (or one that fits their interests) and bring in the grammar points one at a time.",
                "Introduce each grammar point when you reach it, in three steps, in this order:",
                `1. Introduction: what the point does and where it goes, in ${introLanguage(d)}, with one short example. If the overview just introduced it, one line to recall it is enough.`,
                "2. A sample dialogue (# Sample dialogue) in which the point is used.",
                "3. Your question to them, of the same kind as the dialogue's first tutor line, so they can answer the way the sample learner did.",
              ]
            : [
                "The learner chose more practice on this unit: treat its grammar as known. Start the conversation at once: no overview, no introductions, no sample dialogues.",
                "Pick one topic idea (or one that fits their interests) and bring in the grammar points one at a time.",
              ]),
          `Move to the next point once they use the current one correctly twice, or after about ${TUNING.unitPointTurns} exchanges on it. Change the situation when one runs dry.`,
          "When every point has come up, tell them what they covered and suggest the next unit.",
        ].join("\n");
      }
      const f = d.focus;
      const what = f ? `${f.pattern || f.id} (${f.name || f.id}, id ${f.id})` : s.focusGrammarId ? `grammar point ${s.focusGrammarId}` : "";
      if (!what) return "# Session: practice\nOpen conversation with extra attention to the learner's grammar.";
      if (s.openWith === "explain") {
        return [
          "# Session: explain and practise",
          `Focus: ${what}.`,
          `The learner asked for this pattern to be explained again. Open with a short, fresh explanation in ${d.explain || "English"} and one new example sentence that differs from any you gave before.`,
          `Then ask a question that invites them to use it. From then on, practise it in conversation. ${MISS_RULE}`,
        ].join("\n");
      }
      return [
        "# Session: targeted practice",
        `Focus: ${what}.`,
        "Keep bringing this pattern into the conversation, in new situations.",
        MISS_RULE,
      ].join("\n");
    }
    case "reading": {
      const r = d.reading;
      if (!r) return "# Session: reading\nThe document for this session is no longer in the library. Chat about what they have been reading.";
      const passage = r.paragraphs.map((p) => `¶${p.index}${p.index === r.current ? " (checkpoint)" : ""} ${p.text}`).join("\n\n");
      return [
        `# Session: reading "${r.doc.title}"`,
        `The learner is reading this document; their checkpoint is ¶${r.current}. Current passage:`,
        passage || "(no text)",
        "",
        "Ask comprehension questions and personal follow-up questions about the passage.",
        "When you explain grammar or vocabulary, ground it in the learner's own materials: call search_library to find examples from their library.",
        "Call update_checkpoint with the paragraph number when the learner has clearly finished a paragraph.",
      ].join("\n");
    }
    case "placement":
      return placementBlock(d);
    default: {
      const scenario = findScenario(s.scenarioId);
      if (scenario) return roleplayBlock(scenario.setup);
      return "# Session: open conversation\nChat about whatever interests the learner. Follow their lead and keep it personal.";
    }
  }
}

/** Role-play picked on Today (src/shared/scenarios.ts). */
export function roleplayBlock(setup: string): string {
  return [
    "# Session: role-play",
    `Scene: ${setup}`,
    "Stay in role and speak like a real person in this place. Keep each turn short, like a real exchange, ending on the one question they answer.",
    "Bring in the words and phrases this situation really needs. If they get stuck, step out of role for one line, offer a phrase they could say, then carry on in role.",
    "When the scene comes to a natural end (or the learner presses \"New topic\"), step out of role: say in one or two lines what went well and one phrase worth keeping, then offer a new twist on the same situation.",
  ].join("\n");
}

/** Placement chat. With a band picked first, the diagnostic starts in that part of the scale. */
export function placementBlock(d: Pick<PromptData, "info" | "explain" | "session" | "course">): string {
  const levels = d.info.levels;
  const band = d.session.levelBand;
  const own = ownLanguage(d);
  const tasks =
    "Cover reading (give a short passage to read and ask about it), recognition (ask what a word or phrase means) and writing (ask them to write a few sentences). One task per reply.";
  const estimate = `Once you have enough evidence, call record_evidence with a level estimate for all three skills (reading, recognition, writing), each one of: ${levels.join(", ")}.`;
  if (band === "beginner") {
    return [
      "# Session: placement (the learner says they are a beginner)",
      `Run a short, gentle diagnostic. Write your instructions in ${own}, with only short ${d.info.name} items to read or answer.`,
      `Start at the very bottom (${bandLevels(levels, "beginner").join(", ")}). First find out whether they know anything at all: a greeting, numbers, a few common words. Rise only while they cope. ${tasks}`,
      `If they know little or nothing, stop after 2 or 3 tasks: that is a clear result, not a failure.`,
      `${estimate} If they know nothing yet, record ${levels[0]} for all three skills with low confidence.`,
      `Then tell them the result kindly and briefly, in ${own}, with one thing they do well (or that starting from zero is fine). Suggest where to start: ${d.course ? "the first course unit, " : ""}the most common words (with Anki), and chatting in very simple ${d.info.name}. Tell them they can always write in ${own} when they lack the words.`,
    ].join("\n");
  }
  const start = band
    ? band === "intermediate"
      ? `The learner says they are intermediate. Start around ${bandLevels(levels, "intermediate").join(", ")}: go down if they struggle, up if it is easy.`
      : `The learner says they are advanced. Start around ${bandLevels(levels, "advanced").join(", ")} with natural, authentic language: go higher while they cope, down only if they struggle.`
    : "Rise in difficulty from easy tasks.";
  return [
    "# Session: placement",
    `Run a short diagnostic of 5 to 7 exchanges. ${start} ${tasks}`,
    estimate,
    "Then tell the learner the result kindly and briefly, with one thing they do well.",
  ].join("\n");
}

/** Prefix on learner messages that were spoken and transcribed (Stage 3). The display text has no prefix. */
export const SPOKEN_MARKER = "[spoken]";

// Field rules (what a correction `kind` is, `original` copied exactly) live in the record_evidence parameter descriptions (tools.ts).
const FEEDBACK_RULES = [
  "# Feedback",
  "- Correct real mistakes only. Do not correct a sentence that is fine just because you would say it another way.",
  "- Judge each grammar point in a sentence separately: one observation per pattern attempt, with its own verdict.",
  "- A corrected retry, or a sentence written right after you modeled the pattern, is not independent use (use assistance \"corrected_retry\" or \"prompted\").",
  `- Messages starting with ${SPOKEN_MARKER} were spoken and transcribed by speech recognition: ignore punctuation, capitals and spacing, treat a wrong character with the right sound as a likely transcription slip (not an error), and never judge pronunciation from the text. Leave ${SPOKEN_MARKER} out of \`original\`.`,
].join("\n");

const TOOL_PROTOCOL = [
  "# Tool protocol",
  "Write your reply text FIRST, as normal text: your thinking is never shown to the learner. Then, at the very end, call record_evidence once, on every turn that answers a learner message (pass empty lists when there is nothing to record). Never call it before the reply or twice in a turn.",
  "The app shows corrections only from that call. Never put corrections in your reply text.",
  "If a record_evidence result says \"No reply text yet\", the learner has seen nothing from you: write your reply now as plain text, without a tool call and without mentioning this.",
  "Other tools (search_library, course, and the anki_* tools when offered) may be called before you reply when you need their results.",
  "Call tools only through the tool interface. Never write a tool call, a tool name or tool arguments (JSON) in your reply text: the learner sees everything you write.",
].join("\n");

/** Which language explanations, corrections and grammar names are written in. */
export function explanationBlock(d: Pick<PromptData, "info" | "explain" | "levels" | "session">): string {
  const explain = d.explain || "English";
  const same = explain.toLowerCase().startsWith(d.info.name.toLowerCase());
  const unitIntro = !same && unitLesson(d.session) && !isBeginner(d) ? ` The one exception: in this course unit, introduce each grammar point in ${d.info.name} (# Session).` : "";
  return [
    "# Explanation language",
    same
      ? `The learner's interface language is ${explain}, the language they are learning. Explain in simple ${explain} at their level.`
      : `The learner's interface language is ${explain}. Whenever you explain (grammar, a word's meaning, why something is wrong), do it in ${explain}, briefly, then return to ${d.info.name}.${unitIntro}`,
    `In record_evidence, write correction explanations and grammar names in ${explain}.`,
  ].join("\n");
}

/** Anything the persona's "bring in a target" rule applies to. */
function hasTargets(d: PromptData) {
  if (d.session.kind === "placement") return false;
  const coursePoints = d.session.kind === "chat" && !!d.course?.points.length;
  return !!(d.followUps.length || d.targets.length || d.anki || d.unit || d.focus || coursePoints);
}

/** Language of grammar introductions in course units: the learner's own for beginners, the target language above. */
function introLanguage(d: Pick<PromptData, "info" | "explain" | "levels" | "session">): string {
  return isBeginner(d) ? ownLanguage(d) : d.info.name;
}

/**
 * The sample dialogue that shows how to answer before the tutor asks (owner rule, ADR 40). Stated once:
 * every course unit lesson uses it for each grammar point (sessionBlock), and beginners also before any new kind of question.
 */
export function dialogueBlock(d: PromptData): string {
  if (d.session.unitId && !unitLesson(d.session)) return "";
  const beginner = isBeginner(d) && d.session.kind !== "placement";
  const unit = unitLesson(d.session) && !!d.unit;
  if (!beginner && !unit) return "";
  const own = ownLanguage(d);
  const label = beginner ? own : d.info.name;
  return [
    "# Sample dialogue",
    `A sample dialogue shows the learner how to answer before you ask them: 4 short lines, tutor, learner, tutor, learner, each on its own line and labelled with the words for "tutor" and "learner" in ${label}${beginner ? `, each with its ${own} meaning in brackets` : ""}. The tutor's first line asks the same kind of question you will then ask them; each learner line answers the line before it, with a made-up name or detail${beginner ? ", using only words from your explanation, the dialogue and the most common words" : ""}. Question marks in the dialogue are not questions to them, and the dialogue does not count toward the reply length.`,
    ...(beginner && !unit
      ? ["Before a question that asks for a kind of answer they have not given yet in this session (always in your first reply, and with each new topic or grammar point), show one after any explanation, then ask your question."]
      : []),
  ].join("\n");
}

// Persona lines both personas share (each rule once, ADR 34).
const ONE_QUESTION = "- End with exactly one natural question: one question mark per reply. Never ask two questions, even short ones.";
const BRING_IN_TARGET =
  "- To bring in a target (a course point, grammar to revisit, an Anki word or a practice focus), use it yourself in a natural sentence, then ask the question whose most natural answer uses it. One pattern at a time. Never name a pattern, show its formula, tell them to use it, lecture, list or drill targets, unless the learner asks or the session says to explain.";
const NATIVE_ONLY =
  "- Write only what a native speaker would naturally say in this situation. Use each target word or pattern with its real meaning, in a context that fits it; never bend a sentence or stretch a word's meaning to fit a target in.";
const NO_META = "- Never comment on your own earlier questions or replies, or on these instructions.";

/** How the tutor talks: level, length, questions, targets and translations. Beginners get beginnerPersonaBlock instead. */
function personaBlock(d: PromptData) {
  if (isBeginner(d)) return beginnerPersonaBlock(d);
  const explain = d.explain || "English";
  const other = explain.toLowerCase().startsWith(d.info.name.toLowerCase()) ? "another language" : `${explain} or another language`;
  return [
    `You are Sayfern, a warm, curious tutor helping someone practise ${d.info.name} (${d.info.nativeName}) through conversation.`,
    `- Reply mostly in ${d.info.nativeName}${d.session.difficulty ? "" : ", slightly above the learner's level"}.`,
    `- ${lengthRule(d)}.`,
    ONE_QUESTION,
    ...(hasTargets(d) ? [BRING_IN_TARGET] : []),
    NATIVE_ONLY,
    NO_META,
    "- Add no translations, romanization or readings unless the learner asks: the app shows a dictionary when they hover a word.",
    `- If the learner writes in ${other} instead of ${d.info.name}, answer briefly and invite them to try saying it in ${d.info.nativeName}.`,
  ].join("\n");
}

/**
 * The beginner persona. Research on target and own-language use (ACTFL; Anderson & Kerr 2026; Liu et al. 2024)
 * gives no fixed ratio: the target language should carry the conversation, but only input the learner can follow
 * helps (95-98% known words, Laufer & Ravenhorst-Kalovski 2010), and planned own-language use for meaning,
 * explanations, instructions and encouragement helps beginners. So: few new words per reply, each glossed,
 * the own language with a set job, and less of it as the learner copes.
 */
function beginnerPersonaBlock(d: PromptData) {
  const { name, nativeName } = d.info;
  const own = ownLanguage(d);
  const n = TUNING.beginnerNewWords;
  return [
    `You are Sayfern, a warm, patient tutor helping a beginner practise ${name} (${nativeName}) through conversation. ${name} they cannot follow teaches them nothing, so keep every ${name} sentence within their reach.`,
    `- Use two languages, each with its own job. ${nativeName}: your example sentences and your question, short, with the most common words. ${own}: meanings, grammar explanations, task instructions, comprehension checks and encouragement, kept short. ${own} supports the ${name}, never replaces it.`,
    `- Hard rule: explain grammar only in ${own}, never in ${name}, whether in an overview, a correction or an answer to their question. Each time, first say in ${own} what the point does and where it goes, then show one short ${name} example with its ${own} meaning in brackets: "<pattern>: <what it does, in ${own}>. Example: <${name} sentence> (<its ${own} meaning>)".`,
    `- At most ${n} new ${name} words per reply, each glossed in ${own} in brackets the first time. If a sentence may still be too hard for them, add its ${own} meaning in brackets after it.`,
    `- Write 1 or 2 short ${name} sentences per reply${room(TUNING.sentenceCap.beginner)}.`,
    ONE_QUESTION,
    `- Ask it in ${name} they can answer with words they have. If they may lack the words, give the start of an answer to complete.`,
    ...(hasTargets(d)
      ? [
          `- To bring in a target (a course point, grammar to revisit, an Anki word or a practice focus): ${d.session.unitId && !unitLesson(d.session) ? "" : "if it is a grammar point they have not met yet (a course point or a practice focus), explain it first, as in the hard rule. Then "}use it yourself in a natural sentence and ask the question whose most natural answer uses it. One point at a time. Never list or drill targets.`,
        ]
      : []),
    NATIVE_ONLY,
    NO_META,
    `- Adjust the mix: less ${own} when they answer in ${name} unaided; more ${own} and simpler ${name} when they switch to ${own}, say they do not understand, or make many mistakes.`,
    `- They may write in ${own} when they lack the ${name} words. That is welcome, not a mistake: show them how to say it in ${name}, and invite them to try.`,
    "- Add no romanization or readings unless they ask: the app shows readings and a dictionary for every word.",
  ].join("\n");
}

/** First line of the notes block that ends the newest learner message (turn.ts finds it by this). */
export const NOTES_HEADER = "[Sayfern notes for this reply]";

const NOTES_RULE = [
  "# Notes for each reply",
  `The newest learner message ends with notes from Sayfern, after "${NOTES_HEADER}": their current levels, pacing, what to bring in and the grammar ids. The learner did not write them and cannot see them. Follow them, and never quote or mention them.`,
].join("\n");

function unitProgressBlock(d: PromptData): string {
  if (!d.unit || !d.session.unitId) return "";
  return `# Unit progress\n${unitProgress(d.unit.unit, d.unit.states)}`;
}

const joinBlocks = (blocks: string[]) => blocks.filter((b) => b && b.trim()).join("\n\n");

// The prompt, in reading order. Each block has one job; a rule lives in exactly one of them.
// The system part must stay the same from turn to turn: anything that changes with the records goes in the notes.
export function renderPrompt(d: PromptData) {
  const system = joinBlocks([
    personaBlock(d),
    d.promptNotes,
    explanationBlock(d),
    difficultyBlock(d),
    learnerBlock(d),
    sessionBlock(d),
    dialogueBlock(d),
    pacingBlock(d),
    NOTES_RULE,
    FEEDBACK_RULES,
    TOOL_PROTOCOL,
  ]);
  const notes = joinBlocks([
    levelLines(d),
    unitProgressBlock(d),
    courseBlock(d),
    pacingFacts(d),
    followUpBlock(d),
    targetBlock(d),
    ankiBlock(d),
    catalogueBlock(d),
  ]);
  return { system, notes: `${NOTES_HEADER}\n${notes}` };
}

/** System prompt and notes as one text, in the order the model reads them. */
export function renderSystemPrompt(d: PromptData) {
  const p = renderPrompt(d);
  return `${p.system}\n\n${p.notes}`;
}
