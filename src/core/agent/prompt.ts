// System prompt, rebuilt from local records at the start of every turn (S1-05).
import type { LanguageInfo } from "../../shared/lang";
import type {
  AnkiOverview,
  GrammarPoint,
  GrammarSummary,
  LearnerProfile,
  LevelEstimate,
  LibraryDoc,
  LibraryParagraph,
  PracticeTarget,
  SessionMeta,
  Skill,
} from "../../shared/records";
import { SKILLS } from "../../shared/records";
import type { TutorDeps } from "./deps";

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
  targets: PracticeTarget[];
  catalogue: GrammarPoint[];
  focus?: GrammarPoint | null;
  reading?: { doc: LibraryDoc; current: number; paragraphs: LibraryParagraph[] } | null;
  additions: string[];
  /** Anki vocabulary summary, when Anki is on and the language has a snapshot. */
  anki?: { overview: AnkiOverview; now: number } | null;
}

/** Grammar to bring back naturally: still being learned, or recently missed. Skips the session's focus. */
export function pickFollowUps(
  grammar: GrammarSummary[],
  lastAssessed: Map<string, { verdict: string; at: number }>,
  now: number,
  skipId?: string,
): GrammarSummary[] {
  const out: GrammarSummary[] = [];
  for (const g of grammar) {
    if (out.length >= MAX_FOLLOW_UPS) break;
    if (g.point.id === skipId) continue;
    const last = lastAssessed.get(g.point.id);
    const recentMiss = !!last && last.verdict === "incorrect" && now - last.at <= RECENT_MISS_MS;
    if (g.state === "introduced" || g.state === "with_help" || recentMiss) out.push(g);
  }
  return out;
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

  const lastAssessed = new Map<string, { verdict: string; at: number }>();
  for (const o of observations) {
    if (o.verdict !== "correct" && o.verdict !== "incorrect") continue;
    const prev = lastAssessed.get(o.grammarId);
    if (!prev || o.at >= prev.at) lastAssessed.set(o.grammarId, { verdict: o.verdict, at: o.at });
  }

  const data: PromptData = {
    session,
    info: pack.info,
    promptNotes: pack.promptNotes(),
    levels: levels.current,
    profile,
    personalContext,
    followUps: pickFollowUps(grammar, lastAssessed, deps.now(), session.focusGrammarId),
    targets: targets.filter((t) => t.status === "pending" || t.status === "asked"),
    catalogue: grammar.slice(0, MAX_CATALOGUE).map((g) => g.point),
    additions: deps.extensions?.promptAdditions(language) ?? [],
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
  const lines = d.followUps.map((g) => `- ${g.point.pattern || g.point.id} (${g.point.name || g.point.id}), ${g.state.replace("_", " ")}`);
  return [
    "# Grammar to revisit",
    "Create natural chances for the learner to use these in their answers. Never name the pattern, show the formula or ask them to use it; let the situation invite it.",
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

function catalogueBlock(d: PromptData): string {
  const head = [
    "# Grammar ids",
    `When you record grammar, reuse an id below if it fits. Otherwise invent one as "${d.session.language}:<ascii-slug>" (lowercase letters, digits, hyphens), e.g. "${d.session.language === "ja" ? "ja:te-iru" : "zh:chule-hai"}".`,
  ];
  if (d.catalogue.length === 0) return [...head, "(none yet)"].join("\n");
  return [...head, "id | pattern | name", ...d.catalogue.map((p) => `${p.id} | ${p.pattern} | ${p.name}`)].join("\n");
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

const FEEDBACK_RULES = [
  "# Feedback",
  "- Never put corrections in your reply text. The app shows them from your record_evidence call.",
  "- Correct real mistakes only. Style improvements use kind \"style\"; they are suggestions, not errors.",
  "- `original` must be copied exactly from the learner's latest message.",
  "- Judge each grammar point in a sentence separately: one observation per pattern attempt, with its own verdict.",
  "- A corrected retry, or a sentence written right after you modeled the pattern, is not independent use (use assistance \"corrected_retry\" or \"prompted\").",
  "- When you teach or explain a pattern, include it under `taught`.",
].join("\n");

const TOOL_PROTOCOL = [
  "# Tool protocol",
  "Write your reply text FIRST. Then, at the very end, call record_evidence ONCE with everything for this turn (corrections, observations, taught, level).",
  "Never call record_evidence before writing the reply, and never call it twice in a turn. Skip it if there is nothing to record.",
  "Other tools (search_library, and the anki_* tools when offered) may be called before you reply when you need their results.",
].join("\n");

export function renderSystemPrompt(d: PromptData): string {
  const lang = `${d.info.name} (${d.info.nativeName})`;
  const persona = [
    `You are Sayfern, a warm, curious tutor helping someone practise ${lang} through conversation.`,
    `- Reply mostly in ${d.info.nativeName}, slightly above the learner's level.`,
    "- Keep replies to 1 to 3 short sentences and end with one natural question.",
    "- No translations, pinyin, furigana or romaji unless the learner asks.",
    `- If the learner writes in English, answer briefly and invite them to try saying it in ${d.info.nativeName}.`,
  ].join("\n");

  const blocks = [
    persona,
    d.promptNotes,
    levelLines(d),
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
