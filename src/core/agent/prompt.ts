// System prompt, rebuilt from local records at the start of every turn (S1-05).
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
import { isQuizObservation } from "../records/grammar";
import { explainIn, type TutorDeps } from "./deps";

export const MAX_FOLLOW_UPS = 3;
export const MAX_CATALOGUE = 60;
export const PERSONAL_CONTEXT_CHARS = 1500;
export const ANKI_PROMPT_HARDEST = 5;
export const ANKI_PROMPT_NEXT_NEW = 8;
const RECENT_MISS_MS = 14 * 24 * 60 * 60 * 1000;

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
  additions: string[];
  /** Anki vocabulary summary, when Anki is on and the language has a snapshot. */
  anki?: { overview: AnkiOverview; now: number } | null;
  /** The language the tutor explains in (interface language): "German". Default English. */
  explain?: string;
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
    const recentMiss = !!last && last.verdict === "incorrect" && now - last.at <= RECENT_MISS_MS;
    if (recentMiss) misses.push({ g, at: last.at });
    else if (g.state === "introduced" || g.state === "with_help") rest.push(g);
  }
  misses.sort((a, b) => b.at - a.at);
  return [...misses.map((m) => m.g), ...rest].slice(0, MAX_FOLLOW_UPS);
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
    if (last && last.verdict === "incorrect" && last.at === o.at && now - o.at <= RECENT_MISS_MS) out.set(id, o);
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

export async function gatherPromptData(deps: TutorDeps, session: SessionMeta): Promise<PromptData> {
  const { records, lang, library } = deps;
  const language = session.language;
  const pack = lang.pack(language);
  const [levels, profile, personalContext, grammar, observations, targets] = await Promise.all([
    records.getLevels(language),
    records.getProfile(),
    library.personalContext(language, PERSONAL_CONTEXT_CHARS).catch(() => ""),
    records.listGrammar(language),
    records.listObservations({ language }),
    records.getTargets(session.id),
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
    catalogue: grammar.slice(0, MAX_CATALOGUE).map((g) => g.point),
    additions: deps.extensions?.promptAdditions(language) ?? [],
    explain: await explainIn(deps),
  };

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
    "Create natural chances for the learner to use these in their answers. Never name the pattern, show the formula or ask them to use it; let the situation invite it.",
    "Item 1 is the priority: within your first two replies, ask a question whose most natural answer uses it. Then work in the others when the conversation allows.",
    ...(earlierSession
      ? ["You may refer back to the earlier session once, briefly and warmly (what they talked about, not the mistake). Never repeat an old correction."]
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
    "Weave these into your questions naturally, one or two per reply at most, so the learner can recognise and reuse them. Never list them or say they come from Anki.",
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
  const hard = o.topStruggling.slice(0, ANKI_PROMPT_HARDEST).map((w) => (w.reasons[0] ? `${short(w.word)} (${w.reasons[0]})` : short(w.word)));
  if (hard.length) lines.push(`Hardest now: ${hard.join(", ")}.`);
  const next = o.nextNew.slice(0, ANKI_PROMPT_NEXT_NEW).map((w) => short(w.word));
  if (next.length) lines.push(`Next new words: ${next.join(", ")}.`);
  lines.push(
    "Stay mostly within words they know, one step above (i+1). Unsure whether they know a word you want to use? Call anki_check_words. Weave hard words in naturally; never drill or list them. Introduce at most one upcoming new word per reply, with a light gloss.",
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
  [-2]: "Much easier. Stay at or a little below their level: high-frequency words, short simple sentences (one clause), concrete everyday topics. This replaces \"slightly above the learner's level\". Keep it natural, never baby talk.",
  [-1]: "Easier. Stay at their level rather than above it: common words, short sentences, familiar topics. This replaces \"slightly above the learner's level\".",
  1: "Harder. Stretch a bit more than usual: some less common vocabulary, a linked or subordinate clause in most replies, grammar from the next level up, and topics that ask for opinions, plans or comparisons.",
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

function sessionBlock(d: PromptData): string {
  const s = d.session;
  switch (s.kind) {
    case "practice": {
      const f = d.focus;
      const what = f ? `${f.pattern || f.id} (${f.name || f.id}, id ${f.id})` : s.focusGrammarId ? `grammar point ${s.focusGrammarId}` : "";
      if (!what) return "# Session: practice\nOpen conversation with extra attention to the learner's grammar.";
      if (s.openWith === "explain") {
        return [
          "# Session: explain and practise",
          `Focus: ${what}.`,
          "The learner asked for this pattern to be explained again. Open with a short, fresh explanation (naming the pattern is fine here) and one new example sentence that differs from any you gave before.",
          "Then ask a question that invites them to use it. From then on, practise it in conversation; after two misses, model it again and invite another try.",
        ].join("\n");
      }
      return [
        "# Session: targeted practice",
        `Focus: ${what}.`,
        "Set up situations and questions that naturally invite this pattern, without naming it or showing its formula.",
        "After two misses (they avoid it or get it wrong), model it in a sentence of your own, then invite them to try again.",
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
      return [
        "# Session: placement",
        `Run a short diagnostic of 5 to 7 exchanges with rising difficulty. Cover reading (give a short passage to read and ask about it), recognition (ask what a word or phrase means) and writing (ask them to write a few sentences). One task per reply.`,
        `Once you have enough evidence, call record_evidence with a level estimate for all three skills (reading, recognition, writing), each one of: ${d.info.levels.join(", ")}.`,
        "Then tell the learner the result kindly and briefly, with one thing they do well.",
      ].join("\n");
    default:
      return "# Session: open conversation\nChat about whatever interests the learner. Follow their lead and keep it personal.";
  }
}

/** Prefix on learner messages that were spoken and transcribed (Stage 3). The display text has no prefix. */
export const SPOKEN_MARKER = "[spoken]";

const FEEDBACK_RULES = [
  "# Feedback",
  "- Never put corrections in your reply text. The app shows them from your record_evidence call.",
  "- Correct real mistakes only. Style improvements use kind \"style\"; they are suggestions, not errors.",
  "- `original` must be copied exactly from the learner's latest message.",
  "- Judge each grammar point in a sentence separately: one observation per pattern attempt, with its own verdict.",
  "- A corrected retry, or a sentence written right after you modeled the pattern, is not independent use (use assistance \"corrected_retry\" or \"prompted\").",
  "- When you teach or explain a pattern, include it under `taught`.",
  `- Messages starting with ${SPOKEN_MARKER} were spoken and transcribed by speech recognition: ignore punctuation and spacing, treat a wrong character with the right sound as a likely transcription slip (not an error), and never judge pronunciation from the text. Leave ${SPOKEN_MARKER} out of \`original\`.`,
].join("\n");

const TOOL_PROTOCOL = [
  "# Tool protocol",
  "Write your reply text FIRST. Then, at the very end, call record_evidence ONCE with everything for this turn (corrections, observations, taught, level).",
  "Never call record_evidence before writing the reply, and never call it twice in a turn.",
  "Call it on every turn that answers a learner message, even when there is nothing to correct (then pass empty lists). The learner only sees corrections that come through this call.",
  "Other tools (search_library, and the anki_* tools when offered) may be called before you reply when you need their results.",
  "Call tools only through the tool interface. Never write a tool call, a tool name or tool arguments (JSON) in your reply text: the learner sees everything you write.",
].join("\n");

/** Which language explanations, corrections and grammar names are written in. */
export function explanationBlock(d: Pick<PromptData, "info" | "explain">): string {
  const explain = d.explain || "English";
  const same = explain.toLowerCase().startsWith(d.info.name.toLowerCase());
  return [
    "# Explanation language",
    same
      ? `The learner's interface language is ${explain}, the language they are learning. Explain in simple ${explain} at their level.`
      : `The learner's interface language is ${explain}. Whenever you explain (grammar, a word's meaning, why something is wrong), do it in ${explain}, briefly, then return to ${d.info.name}.`,
    `In record_evidence, write correction explanations and grammar names in ${explain}.`,
  ].join("\n");
}

export function renderSystemPrompt(d: PromptData): string {
  const lang = `${d.info.name} (${d.info.nativeName})`;
  const explain = d.explain || "English";
  const other = explain.toLowerCase().startsWith(d.info.name.toLowerCase()) ? "another language" : `${explain} or another language`;
  const persona = [
    `You are Sayfern, a warm, curious tutor helping someone practise ${lang} through conversation.`,
    `- Reply mostly in ${d.info.nativeName}, slightly above the learner's level.`,
    "- Keep replies to 1 to 3 short sentences and end with exactly one natural question: one question mark per reply. Never ask two questions, even short ones.",
    "- No translations or romanization unless the learner asks.",
    `- If the learner writes in ${other} instead of ${d.info.name}, answer briefly and invite them to try saying it in ${d.info.nativeName}.`,
  ].join("\n");

  const blocks = [
    persona,
    d.promptNotes,
    explanationBlock(d),
    levelLines(d),
    difficultyBlock(d),
    learnerBlock(d),
    sessionBlock(d),
    followUpBlock(d),
    targetBlock(d),
    ankiBlock(d),
    catalogueBlock(d),
    FEEDBACK_RULES,
    TOOL_PROTOCOL,
    ...d.additions,
  ];
  return blocks.filter((b) => b && b.trim()).join("\n\n");
}
