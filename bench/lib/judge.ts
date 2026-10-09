// Optional model judge for what string checks cannot decide (false positives,
// correctness of a fix, factual Anki answers, session-level checks). It sees
// only what the learner saw, with arm names removed, and runs outside the
// recording proxy so it never counts toward either harness.
import { runClaude } from "./claude-cli";
import type { BenchConfig } from "./config";
import type { BlockResult } from "./runner";
import { fixtureDir, loadManifest } from "./fixtures";
import { RATINGS, sessionTurns, sessionUnit, type Rating, type Scenario } from "./scenarios";
import { surface } from "./score";

/** Per-point verdicts on course units: explained in the opening overview; modeled or elicited in the conversation after it. */
export const POINT_VERDICTS = ["explained", "modeled", "elicited"] as const;
export type PointVerdict = (typeof POINT_VERDICTS)[number];
export type PointResult = { id: string } & Partial<Record<PointVerdict, boolean>>;

export interface JudgeItem {
  item: string;
  /** errors: per gold error */
  errors?: { id: string; flagged: boolean; correctFix: boolean }[];
  falsePositive?: boolean;
  tutorErrors?: number;
  correct?: boolean;
  pass?: boolean;
  /** Session items with `rate`: integer 1-5 per requested quality. */
  ratings?: Partial<Record<Rating, number>>;
  /** moveOn turns: this reply, or an earlier one in the current stretch, changed topic or raised the challenge. */
  movedOn?: boolean;
  /** stay turns: this reply engages with what the learner just raised or asked, without changing the subject. */
  stayed?: boolean;
  /** Course unit items: one entry per unit grammar point. */
  points?: PointResult[];
  note?: string;
}

export interface JudgeResult {
  block: string;
  items: JudgeItem[];
  error?: string;
  /** Item ids the judge returned no usable verdict for, after the retry. */
  missing?: string[];
}

export interface Item {
  item: string;
  kind: "turn" | "open" | "session";
  learner?: string;
  tutor: string;
  goldErrors?: { id: string; original: string; accept: string[]; pattern: string }[];
  clean?: boolean;
  fact?: string;
  checks?: string[];
  /** Session items: qualities to rate 1-5, and the learner's level they are rated against. */
  rate?: Rating[];
  learnerLevel?: string;
  /** Turn items: the topic is exhausted (moveOn) or the learner is invested (stay). */
  moveOn?: boolean;
  stay?: boolean;
  /** Turn items with moveOn/stay: the conversation so far, opening included. */
  before?: string;
  /** Course unit items: the unit's grammar points, and the verdicts wanted for each. */
  unitPoints?: { id: string; pattern: string; name: string }[];
  pointVerdicts?: PointVerdict[];
}

/** A rating is an integer 1-5; anything else counts as no verdict. */
export const validRating = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 5;

/** The learner level the judge rates against: the scenario's `learnerLevel`, else the fixture manifest's `selfLevel`. */
export function learnerLevel(config: BenchConfig, scenario: Scenario): string {
  return scenario.learnerLevel ?? loadManifest(fixtureDir(scenario.fixtures ?? config.fixtures)).selfLevel ?? "unknown";
}

export function judgeItems(block: BlockResult, scenario: Scenario, level = "unknown"): Item[] {
  const items: Item[] = [];
  for (const [si, session] of scenario.sessions.entries()) {
    const steps = block.steps.filter((s) => s.phase.session === si);
    const open = steps.find((s) => s.phase.step === "open");
    const unit = sessionUnit(session);
    const unitPoints = unit?.grammar.map((g) => ({ id: g.id, pattern: g.pattern, name: g.name }));
    const overview = !!unitPoints && !!session.explain;
    if (open?.output && (session.openChecks?.length || overview)) {
      items.push({
        item: `s${si}-open`,
        kind: "open",
        tutor: surface(open.output),
        ...(session.openChecks?.length ? { checks: session.openChecks } : {}),
        ...(overview ? { unitPoints, pointVerdicts: ["explained" as const] } : {}),
      });
    }
    const said = (s: BlockResult["steps"][number]) =>
      `${s.phase.step === "turn" && s.input ? `LEARNER: ${s.input}\n` : ""}TUTOR${s.phase.step === "open" ? " (opening)" : ""}: ${surface(s.output)}`;
    for (const { turn: ti, text, gold, step } of sessionTurns(session, steps)) {
      if (!step?.output) continue;
      const g = gold ?? {};
      items.push({
        item: `s${si}-t${ti}`,
        kind: "turn",
        learner: text,
        tutor: surface(step.output),
        ...(g.errors?.length ? { goldErrors: g.errors.map((e) => ({ id: e.id, original: e.original, accept: e.accept, pattern: e.pattern })) } : {}),
        ...(g.clean ? { clean: true } : {}),
        ...(g.anki?.fact ? { fact: g.anki.fact } : {}),
        ...(g.checks?.length ? { checks: g.checks } : {}),
        ...(g.moveOn || g.stay
          ? {
              ...(g.moveOn ? { moveOn: true } : { stay: true }),
              before: steps
                .filter((s) => (s.phase.step === "open" || s.phase.step === "turn") && s.phase.turn < ti)
                .map(said)
                .join("\n\n"),
            }
          : {}),
      });
    }
    if (session.checks?.length || session.rate?.length || unitPoints) {
      // Rated and unit sessions show the conversation only (opening and turns): the wrap-up at the end is not conversation.
      const transcript = session.rate?.length || unitPoints
        ? steps.filter((s) => s.phase.step === "open" || s.phase.step === "turn").map(said).join("\n\n")
        : steps.map((s) => `${s.input ? `LEARNER: ${s.input}\n` : ""}TUTOR: ${surface(s.output)}`).join("\n\n");
      items.push({
        item: `s${si}-session`,
        kind: "session",
        tutor: transcript,
        ...(session.checks?.length ? { checks: session.checks } : {}),
        ...(session.rate?.length ? { rate: session.rate, learnerLevel: level } : {}),
        ...(unitPoints ? { unitPoints, pointVerdicts: ["modeled" as const, "elicited" as const] } : {}),
      });
    }
  }
  return items;
}

/** The verdicts an item must carry to count: one per gold error, falsePositive, correct, pass, each rating, movedOn, stayed, each point verdict. */
export function needs(item: Item) {
  return {
    errors: (item.goldErrors ?? []).map((e) => e.id),
    clean: !!item.clean,
    fact: !!item.fact,
    checks: !!item.checks?.length,
    rate: item.rate ?? [],
    movedOn: !!item.moveOn,
    stayed: !!item.stay,
    points: (item.unitPoints ?? []).map((p) => p.id),
    pointVerdicts: item.pointVerdicts ?? [],
  };
}

/** The judge's verdict for one point, or undefined when it gave none. */
export const pointVerdict = (r: JudgeItem | undefined, id: string, v: PointVerdict) => {
  const x = r?.points?.find((p) => p.id === id)?.[v];
  return typeof x === "boolean" ? x : undefined;
};

/** Ids of items whose required verdicts are absent from `results`. */
export function missingVerdicts(items: Item[], results: JudgeItem[]): string[] {
  const byId = new Map(results.map((r) => [r.item, r]));
  return items
    .filter((it) => {
      const n = needs(it);
      if (!n.errors.length && !n.clean && !n.fact && !n.checks && !n.rate.length && !n.movedOn && !n.stayed && !n.points.length) return false;
      const r = byId.get(it.item);
      if (!r) return true;
      if (n.errors.some((id) => !r.errors?.some((e) => e.id === id))) return true;
      if (n.clean && typeof r.falsePositive !== "boolean") return true;
      if (n.fact && typeof r.correct !== "boolean") return true;
      if (n.checks && typeof r.pass !== "boolean") return true;
      if (n.rate.some((k) => !validRating(r.ratings?.[k]))) return true;
      if (n.movedOn && typeof r.movedOn !== "boolean") return true;
      if (n.stayed && typeof r.stayed !== "boolean") return true;
      if (n.points.some((id) => n.pointVerdicts.some((v) => pointVerdict(r, id, v) === undefined))) return true;
      return false;
    })
    .map((it) => it.item);
}

/** Merge verdicts: later results fill in items or fields the earlier ones lacked. */
function mergeResults(a: JudgeItem[], b: JudgeItem[]): JudgeItem[] {
  const out = new Map(a.map((r) => [r.item, { ...r }]));
  for (const r of b) {
    const cur = out.get(r.item);
    if (!cur) out.set(r.item, { ...r });
    else {
      for (const [k, v] of Object.entries(r)) if ((cur as Record<string, unknown>)[k] === undefined) (cur as Record<string, unknown>)[k] = v;
      // Ratings merge per quality, so a retry can fill in just the ones that were missing or invalid.
      for (const k of RATINGS) if (!validRating(cur.ratings?.[k]) && validRating(r.ratings?.[k])) cur.ratings = { ...cur.ratings, [k]: r.ratings[k] };
      // Point verdicts merge per point and verdict, for the same reason.
      if (r.points && cur.points !== r.points) {
        const byId = new Map(cur.points?.map((p) => [p.id, { ...p }]));
        for (const p of r.points) {
          const have = byId.get(p.id);
          if (!have) byId.set(p.id, { ...p });
          else for (const v of POINT_VERDICTS) if (typeof have[v] !== "boolean" && typeof p[v] === "boolean") have[v] = p[v];
        }
        cur.points = [...byId.values()];
      }
    }
  }
  return [...out.values()];
}

const RUBRIC = `You grade a Mandarin tutor. For each item below, return one JSON object. Judge only from what is written; do not use tools.

Rules:
- "tutor" is everything the learner saw for that step: the reply and any correction notes.
- errors: for each gold error, flagged = the tutor pointed out this mistake (in any language, any format); correctFix = the correction shown is one of the acceptable forms or equally correct. If not flagged, correctFix = false.
- falsePositive (only when "clean": true): true if the tutor claimed a grammar or vocabulary ERROR in the learner's message. Optional style suggestions clearly framed as optional do not count.
- tutorErrors: number of ungrammatical or clearly unnatural Mandarin sentences written by the tutor in this item (0 if none).
- correct (only when "fact" is given): true if the tutor's answer states the fact correctly and does not contradict it.
- pass (only when "checks" are given): true only if every check is satisfied.
- ratings (only when "rate" is given; the item is the whole conversation, opening included, and "learnerLevel" is the learner's level): give an integer 1-5 for each quality listed in "rate". Judge the TUTOR's side only. The learner's messages are a fixed script and cannot react to the tutor's questions or topic changes: never lower a rating because the learner's next message does not match what the tutor just asked. Judge what the tutor chose to do. Use the anchors:
  engagement (is the conversation engaging: varied, curious, personal follow-ups, not a repetitive interview?)
    1 = a scripted interview: formulaic questions, same shape every turn, little or no reaction to what the learner said.
    2 = mostly question after question; reacts to the learner only with praise or a word of acknowledgement.
    3 = polite and on topic; reacts to some content, but follow-ups are generic and predictable.
    4 = varied; picks up specific details the learner gave, asks personal follow-ups, sometimes adds something of its own (an opinion, a fact, a short story).
    5 = reads like a curious person: builds on the learner's details, shares something of its own, varies turn shape (comment, question, challenge), makes the learner want to write more.
  pacing (does it move on when it should, and stay when it should?)
    1 = stuck on one easy topic for most of the conversation, or changes topic every turn and drops what the learner cares about.
    2 = lingers on an exhausted topic for many exchanges after easy, short, correct answers; or often drops threads the learner is invested in.
    3 = moves on, but late; or sometimes moves on while the learner's question is unresolved.
    4 = answers, then moves to a new topic or a harder question soon after easy answers pile up; keeps topics the learner is invested in.
    5 = well timed throughout: follows the learner's own topic changes, develops what they care about, and raises the challenge or changes topic as soon as the current one is exhausted. No question left unresolved.
  level (are the tutor's questions and wording right for "learnerLevel"?)
    1 = far off for most of the conversation: baby questions well below the level asked again and again (for example "你喜欢吃什么？" every turn for an HSK 3 learner), or wording far above what the learner can read.
    2 = mostly off, with occasional fitting turns.
    3 = mixed: some turns fit the level, others are clearly too easy or too hard.
    4 = mostly right: wording within or slightly above the level, questions invite full sentences with reasons or opinions.
    5 = well calibrated and rising: wording at the level with a few new words just above it, questions need opinions, reasons, comparisons or plans suited to the level, no needless simplification.
  teaching (only for course units, where "unitPoints" lists the unit's grammar: how well does the tutor teach these points through the conversation after the opening?)
    1 = the unit is dropped after the opening: ordinary chat, or a lecture or drill with no real conversation.
    2 = few points come up, mostly only when the learner happens to use them; or several points are dumped into one reply.
    3 = about half the points come up; some prompts feel artificial ("make a sentence with X"), or corrections of unit points only give the fixed sentence.
    4 = most points come up one at a time in a natural context: the tutor uses the pattern itself and asks questions whose natural answer uses it; corrections of unit points briefly say the rule.
    5 = nearly every point comes up, one at a time, at a sensible pace: used by the tutor in a natural sentence, then invited with a question; corrections tie back to the pattern; it never feels like a drill.
- movedOn (only when "moveOn" is true; "before" is the conversation so far): the learner's topic is exhausted. true if the tutor's reply in this item, or any earlier tutor reply in the same stretch of conversation on this topic, changed the topic, opened a clearly new angle, or raised the challenge (a harder question, a new structure to use, a request for a longer answer). false if the tutor is still on the same topic with questions of the same easy kind.
- stayed (only when "stay" is true): the learner is invested in a topic or asked the tutor something. true if the tutor's reply answers what the learner asked and engages with what the learner raised. false if it ignores the question, drags back to an earlier topic, or changes the subject while the learner's question is unresolved.
- points (only when "unitPoints" is given): one entry {"id": ...} per unit point, in the same order, with each verdict listed in "pointVerdicts":
  explained (opening only): the opening names this point, says what it does, and gives an example sentence that uses it correctly. false if the point is missing, the explanation is wrong, or the example misuses it.
  modeled (whole session): in a reply AFTER the opening, the tutor itself uses this pattern correctly in a sentence of the conversation. The overview in the opening does not count, and neither does only repeating the learner's own sentence in a correction.
  elicited (whole session): in a reply AFTER the opening, the tutor asks a question or sets up a situation whose natural answer uses this pattern, or asks the learner to try it. Correcting the learner's use of the pattern does not count by itself.
- note: at most one short sentence.

Answer with ONLY a JSON object: {"items":[{"item":"...", "errors":[{"id":"...","flagged":true,"correctFix":true}], "falsePositive":false, "tutorErrors":0, "correct":true, "pass":true, "ratings":{"engagement":4,"pacing":3,"level":5}, "movedOn":true, "stayed":true, "points":[{"id":"...","modeled":true,"elicited":false}], "note":"..."}]}. Omit fields that do not apply.

Items:
`;

export async function judgeBlock(config: BenchConfig, block: BlockResult, scenario: Scenario): Promise<JudgeResult> {
  const key = `${block.arm}__${block.scenario}__rep${block.rep}`;
  const all = judgeItems(block, scenario, learnerLevel(config, scenario));
  if (!all.length) return { block: key, items: [] };
  // Up to three attempts. After the first, only the items still missing a verdict are resent,
  // so a reply that is unparseable or skips an item cannot silently shrink a denominator.
  let results: JudgeItem[] = [];
  let todo = all;
  let lastErr = "";
  for (let attempt = 0; attempt < 3 && todo.length; attempt++) {
    try {
      const text = await runClaude(config.judge, RUBRIC + JSON.stringify(todo, null, 1));
      const parsed = extractJudgeItems(text);
      if (parsed) results = mergeResults(results, parsed);
      else lastErr = `judge returned no usable JSON: ${text.slice(0, 200)}`;
    } catch (err) {
      lastErr = String((err as Error)?.message ?? err);
    }
    const miss = new Set(missingVerdicts(all, results));
    todo = all.filter((it) => miss.has(it.item));
  }
  const missing = missingVerdicts(all, results);
  return {
    block: key,
    items: results,
    ...(missing.length ? { missing, ...(lastErr ? { error: lastErr } : {}) } : {}),
  };
}

/** Top-level JSON objects in `text`, in order (braces inside strings are ignored). */
export function jsonObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"' && depth > 0) inStr = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}" && depth > 0) {
      depth--;
      if (depth === 0) out.push(text.slice(start, i + 1));
    }
  }
  return out;
}

/**
 * Judge items from a reply that may wrap the JSON in prose or code fences, or split it over
 * several objects. Items from every parseable `{"items": [...]}` are merged; null if none.
 */
export function extractJudgeItems(text: string): JudgeItem[] | null {
  let found = false;
  const items: JudgeItem[] = [];
  for (const raw of jsonObjects(text)) {
    try {
      const o = JSON.parse(raw) as { items?: unknown };
      if (Array.isArray(o.items)) {
        found = true;
        items.push(...(o.items as JudgeItem[]));
      }
    } catch {
      // not JSON (e.g. a brace in prose); skip it
    }
  }
  return found ? items : null;
}
