// Request options per model. Some reasoning models cannot switch thinking off
// (e.g. claude-sonnet-5-5, claude-opus-5, gpt-5, o3): with no reasoning level
// pi-ai leaves them on the provider default (Anthropic: adaptive at "high"
// effort; OpenAI: "medium"), and the thinking tokens count against maxTokens.
// A 200-token retry check or a 1500-token reply then often comes back empty or
// cut off. For those models ask for the lowest effort and add headroom.
import { clampThinkingLevel, getSupportedThinkingLevels, type Api, type Model, type ThinkingLevel } from "@earendil-works/pi-ai";

/** Extra output tokens for models that always think. Unused tokens cost nothing. */
export const THINKING_HEADROOM = 4096;

export function requestOptions(model: Model<Api>, answerTokens: number): { maxTokens: number; reasoning?: ThinkingLevel } {
  if (!model.reasoning || getSupportedThinkingLevels(model).includes("off")) return { maxTokens: answerTokens };
  const level = clampThinkingLevel(model, "low");
  return level === "off" ? { maxTokens: answerTokens } : { maxTokens: answerTokens + THINKING_HEADROOM, reasoning: level };
}

/**
 * Models that need the evidence pass (turn.ts): they tend to end their turn at the final answer
 * without calling record_evidence. Claude follows the "reply, then record" protocol reliably;
 * OpenAI's GPT models (API or ChatGPT sign-in) and most others often don't.
 */
export function needsEvidencePass(model: Pick<Model<Api>, "api" | "id">): boolean {
  if (model.api.startsWith("anthropic")) return false;
  return !/claude/i.test(model.id);
}
