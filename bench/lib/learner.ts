// Simulated learner: a model plays the learner, so the conversation can follow the
// tutor (answer its questions, try the pattern it invites). It sees only what the
// learner saw, runs outside the recording proxy (it never counts toward either
// harness), and reports the mistakes it made on purpose, which become the gold.
import { runClaude } from "./claude-cli";
import type { BenchConfig } from "./config";
import { jsonObjects } from "./judge";
import type { GoldError, GoldTurn, SimulatedLearnerSpec } from "./scenarios";
import { norm } from "./score";

export interface LearnerMessage {
  text: string;
  gold: GoldTurn;
  /** Reported mistakes whose `original` is not in the message (not counted as gold). */
  dropped: string[];
}

interface Reported {
  text?: unknown;
  errors?: { id?: unknown; original?: unknown; correct?: unknown; pattern?: unknown }[];
}

const RULES = `Write ONLY the learner's next message, in the learner's voice.
- Simplified Chinese, about 1 to 2 sentences, the way this learner would type in a chat. No pinyin, no translations, no notes about yourself.
- Reply to what the tutor just said or asked. If the tutor asks you to try a pattern, or asks a question whose natural answer uses one, try it.
- Never copy the tutor's sentences word for word, and never correct or grade the tutor.
- Make mistakes only where the plan says, at most one per message, spread over the conversation. Everywhere else, write correct Chinese at your level.

Then report every mistake in your message that the plan asked for. Answer with ONLY a JSON object:
{"text": "<your message>", "errors": [{"id": "<short-kebab-id>", "original": "<the wrong words plus 3 to 6 characters around them, copied exactly from text>", "correct": "<that same stretch, corrected>", "pattern": "<the rule you broke>"}]}
Use "errors": [] when the message has no mistakes.`;

export function learnerPrompt(spec: SimulatedLearnerSpec, level: string, conversation: string, turn: number): string {
  const last = turn === spec.turns - 1;
  return [
    "You play a language learner in a test of a Mandarin tutor.",
    "",
    `Learner: ${spec.persona}`,
    `Level: ${level}.`,
    "",
    "Plan (follow it across the whole conversation; count your own earlier messages):",
    ...spec.plan.map((p) => `- ${p}`),
    "",
    "Conversation so far (TUTOR is everything you saw: replies and correction notes):",
    conversation || "(nothing yet)",
    "",
    `This is your message ${turn + 1} of ${spec.turns}.${last ? " It is your last one: answer the tutor, then end the chat naturally." : ""}`,
    "",
    RULES,
  ].join("\n");
}

/** Parses the learner's reply. Mistakes whose `original` is not in the text are dropped, so gold always points at real text. */
export function parseLearner(raw: string, turn: number): LearnerMessage | null {
  for (const candidate of jsonObjects(raw).reverse()) {
    let o: Reported;
    try {
      o = JSON.parse(candidate) as Reported;
    } catch {
      continue;
    }
    if (typeof o.text !== "string" || !o.text.trim()) continue;
    const text = o.text.trim();
    const errors: GoldError[] = [];
    const dropped: string[] = [];
    for (const [i, e] of (Array.isArray(o.errors) ? o.errors : []).entries()) {
      const original = typeof e.original === "string" ? e.original.trim() : "";
      const correct = typeof e.correct === "string" ? e.correct.trim() : "";
      if (!original || !correct || !norm(text).includes(norm(original)) || norm(original) === norm(correct)) {
        dropped.push(original || JSON.stringify(e));
        continue;
      }
      const id = typeof e.id === "string" && e.id ? e.id : `error-${i + 1}`;
      errors.push({ id: `t${turn + 1}-${id}`, original, accept: [correct], pattern: typeof e.pattern === "string" ? e.pattern : "" });
    }
    return { text, gold: errors.length ? { errors } : { clean: true }, dropped };
  }
  return null;
}

export class SimulatedLearner {
  constructor(
    private readonly config: BenchConfig,
    private readonly spec: SimulatedLearnerSpec,
    private readonly level: string,
  ) {}

  /** The next learner message. Up to three attempts when the reply is not usable JSON. */
  async next(conversation: string, turn: number): Promise<LearnerMessage> {
    const prompt = learnerPrompt(this.spec, this.level, conversation, turn);
    let last = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw = await runClaude(this.config.learner, prompt);
      const msg = parseLearner(raw, turn);
      if (msg) return msg;
      last = raw;
    }
    throw new Error(`simulated learner returned no usable message: ${last.slice(0, 200)}`);
  }
}
