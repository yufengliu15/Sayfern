// The tutor "brain" (docs/stage1.md: agent/): system prompt, tools, streaming
// turn loop, translation, correction retries, end-of-session summaries.
import { randomUUID } from "node:crypto";
import type { RetryResult, EndSummary } from "../../shared/api";
import type { ChatMessage } from "../../shared/records";
import type { Tutor, TurnInput } from "../contracts";
import type { TutorDeps, TutorOptions } from "./deps";
import { checkRetry } from "./retry";
import { endSession, translate } from "./session";
import { runOpening, runTurn } from "./turn";

export type { TutorDeps, TutorOptions } from "./deps";
export { buildSystemPrompt, gatherPromptData, renderSystemPrompt } from "./prompt";
export { turnTools } from "./tools";

export class SayfernTutor implements Tutor {
  private readonly deps: TutorDeps;

  constructor(opts: TutorOptions) {
    this.deps = {
      ...opts,
      now: opts.now ?? Date.now,
      newId: opts.newId ?? randomUUID,
      ankiEnabled: opts.ankiEnabled ?? (async () => (await opts.anki.getConfig()).enabled),
    };
  }

  runTurn(input: TurnInput): Promise<ChatMessage> {
    return runTurn(this.deps, input);
  }

  runOpening(input: Omit<TurnInput, "text" | "pastedSpans">): Promise<ChatMessage> {
    return runOpening(this.deps, input);
  }

  translate(sessionId: string, messageId: string, model: TurnInput["model"]): Promise<string> {
    return translate(this.deps, sessionId, messageId, model);
  }

  checkRetry(correctionId: string, text: string, model: TurnInput["model"]): Promise<RetryResult> {
    return checkRetry(this.deps, correctionId, text, model);
  }

  endSession(sessionId: string): Promise<EndSummary> {
    return endSession(this.deps, sessionId);
  }
}
